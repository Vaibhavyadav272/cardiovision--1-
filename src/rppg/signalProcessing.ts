import { HRVMetrics, RGBSample } from "../types";

/**
 * ============================================================================
 * CardioVision Signal Processing Engine
 * ============================================================================
 *
 * This file contains the shared signal-processing primitives used by the
 * G-Channel, CHROM, POS and Multi-ROI algorithms.
 *
 * Principles:
 *   - No target/reference BPM is used.
 *   - No BPM is inserted when the signal is unavailable.
 *   - No artificial SNR offsets are used.
 *   - Camera timestamps are used when available.
 *   - Spectral candidates are evaluated rather than blindly trusting one FFT
 *     bin.
 *   - Peak detection is adaptive and physiologically constrained.
 *
 * IMPORTANT:
 * Webcam rPPG is an optical estimation technique. It cannot guarantee
 * 100% clinical accuracy. The correct behavior for a poor signal is to
 * reject the measurement rather than manufacture a plausible BPM.
 * ============================================================================
 */

const MIN_HR_HZ = 0.75; // 45 BPM
const MAX_HR_HZ = 3.0; // 180 BPM
const MIN_HR_BPM = 45;
const MAX_HR_BPM = 180;

/* -------------------------------------------------------------------------- */
/* Basic statistics                                                            */
/* -------------------------------------------------------------------------- */

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;

  const m = mean(values);

  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/* -------------------------------------------------------------------------- */
/* Sampling-rate handling                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Estimate the actual sampling rate from camera timestamps.
 *
 * Browser camera capture does not guarantee exactly 30 FPS. If valid
 * timestamps are available, the median inter-frame interval is used.
 */
export function getEffectiveSampleRate(
  samples: RGBSample[],
  fallback = 30,
): number {
  if (samples.length < 3) return fallback;

  const timestamps = samples.map((s) => Number(s.timestamp));

  if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) {
    return fallback;
  }

  const intervals: number[] = [];

  for (let i = 1; i < timestamps.length; i++) {
    const dt = (timestamps[i] - timestamps[i - 1]) / 1000;

    /*
     * Ignore impossible gaps/duplicates. A long browser scheduling pause
     * should not be interpreted as the normal frame period.
     */
    if (dt > 0.005 && dt <= 0.2) {
      intervals.push(dt);
    }
  }

  if (intervals.length < 2) return fallback;

  const dt = median(intervals);
  const rate = 1 / dt;

  if (!Number.isFinite(rate) || rate < 10 || rate > 60) {
    return fallback;
  }

  return rate;
}

/* -------------------------------------------------------------------------- */
/* Signal smoothing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * 5-point Savitzky-Golay smoothing.
 *
 * The coefficients preserve low-frequency waveform shape better than a
 * simple moving average.
 */
export function smoothSignalSavitzkyGolay(signal: number[]): number[] {
  const n = signal.length;

  if (n < 5) return [...signal];

  const out = new Array<number>(n);

  out[0] = signal[0];
  out[1] = signal[1];

  for (let i = 2; i < n - 2; i++) {
    out[i] =
      (-3 * signal[i - 2] +
        12 * signal[i - 1] +
        17 * signal[i] +
        12 * signal[i + 1] -
        3 * signal[i + 2]) /
      35;
  }

  out[n - 2] = signal[n - 2];
  out[n - 1] = signal[n - 1];

  return out;
}

/**
 * 3-point median filter for isolated sensor spikes.
 */
export function medianFilter(signal: number[]): number[] {
  const n = signal.length;

  if (n < 3) return [...signal];

  const out = new Array<number>(n);

  out[0] = signal[0];

  for (let i = 1; i < n - 1; i++) {
    const a = signal[i - 1];
    const b = signal[i];
    const c = signal[i + 1];

    out[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }

  out[n - 1] = signal[n - 1];

  return out;
}

/**
 * Replace non-finite samples with the nearest valid sample.
 */
function sanitizeSignal(signal: number[]): number[] {
  if (!signal.length) return [];

  const output = signal.map((value) => (Number.isFinite(value) ? value : NaN));

  let firstValid = -1;

  for (let i = 0; i < output.length; i++) {
    if (Number.isFinite(output[i])) {
      firstValid = i;
      break;
    }
  }

  if (firstValid === -1) {
    return output.map(() => 0);
  }

  for (let i = 0; i < firstValid; i++) {
    output[i] = output[firstValid];
  }

  for (let i = firstValid + 1; i < output.length; i++) {
    if (!Number.isFinite(output[i])) {
      output[i] = output[i - 1];
    }
  }

  return output;
}

/**
 * Adaptive low-light denoising.
 *
 * `avgLux` is retained for compatibility with the existing application, but
 * the value is a camera RGB brightness proxy, not a calibrated lux reading.
 *
 * Motion variance is intentionally NOT artificially reduced.
 */
export function applyAdaptiveLowLightDenoising(
  samples: RGBSample[],
  sampleRate: number = 30,
): {
  cleanedSamples: RGBSample[];
  lowLightDetected: boolean;
  avgLux: number;
} {
  void sampleRate;

  const n = samples.length;

  if (n < 5) {
    return {
      cleanedSamples: samples,
      lowLightDetected: false,
      avgLux: 0,
    };
  }

  const avgBrightness = mean(samples.map((s) => (s.r + s.g + s.b) / 3));

  const lowLightDetected = avgBrightness < 85;

  const rawR = samples.map((s) => s.r);
  const rawG = samples.map((s) => s.g);
  const rawB = samples.map((s) => s.b);

  const fhR = samples.map((s) => s.forehead.r);
  const fhG = samples.map((s) => s.forehead.g);
  const fhB = samples.map((s) => s.forehead.b);

  const lcR = samples.map((s) => s.leftCheek.r);
  const lcG = samples.map((s) => s.leftCheek.g);
  const lcB = samples.map((s) => s.leftCheek.b);

  const rcR = samples.map((s) => s.rightCheek.r);
  const rcG = samples.map((s) => s.rightCheek.g);
  const rcB = samples.map((s) => s.rightCheek.b);

  const cleanR = smoothSignalSavitzkyGolay(medianFilter(rawR));

  const cleanG = smoothSignalSavitzkyGolay(medianFilter(rawG));

  const cleanB = smoothSignalSavitzkyGolay(medianFilter(rawB));

  const cleanFhR = smoothSignalSavitzkyGolay(medianFilter(fhR));

  const cleanFhG = smoothSignalSavitzkyGolay(medianFilter(fhG));

  const cleanFhB = smoothSignalSavitzkyGolay(medianFilter(fhB));

  const cleanLcR = smoothSignalSavitzkyGolay(medianFilter(lcR));

  const cleanLcG = smoothSignalSavitzkyGolay(medianFilter(lcG));

  const cleanLcB = smoothSignalSavitzkyGolay(medianFilter(lcB));

  const cleanRcR = smoothSignalSavitzkyGolay(medianFilter(rcR));

  const cleanRcG = smoothSignalSavitzkyGolay(medianFilter(rcG));

  const cleanRcB = smoothSignalSavitzkyGolay(medianFilter(rcB));

  const cleanedSamples: RGBSample[] = [];

  for (let i = 0; i < n; i++) {
    cleanedSamples.push({
      timestamp: samples[i].timestamp,

      r: cleanR[i],
      g: cleanG[i],
      b: cleanB[i],

      forehead: {
        r: cleanFhR[i],
        g: cleanFhG[i],
        b: cleanFhB[i],
      },

      leftCheek: {
        r: cleanLcR[i],
        g: cleanLcG[i],
        b: cleanLcB[i],
      },

      rightCheek: {
        r: cleanRcR[i],
        g: cleanRcG[i],
        b: cleanRcB[i],
      },

      motionVariance: samples[i].motionVariance,

      faceConfidence: samples[i].faceConfidence,
    });
  }

  return {
    cleanedSamples,
    lowLightDetected,
    /*
     * Kept under the existing property name for API compatibility.
     */
    avgLux: Math.round(avgBrightness),
  };
}

/* -------------------------------------------------------------------------- */
/* Detrending / normalization                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Remove slow baseline variation with a centered moving average.
 */
export function detrend(signal: number[], windowSize: number = 15): number[] {
  const n = signal.length;

  if (n === 0) return [];

  const safeWindow = Math.max(3, Math.floor(windowSize));

  if (n < safeWindow) {
    const m = mean(signal);
    return signal.map((value) => value - m);
  }

  const half = Math.floor(safeWindow / 2);

  const detrended = new Array<number>(n);

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - half);

    const end = Math.min(n, i + half + 1);

    let sum = 0;

    for (let j = start; j < end; j++) {
      sum += signal[j];
    }

    const localMean = sum / (end - start);

    detrended[i] = signal[i] - localMean;
  }

  return detrended;
}

/**
 * Zero mean / unit variance normalization.
 */
export function normalizeSignal(signal: number[]): number[] {
  if (!signal.length) return [];

  const clean = sanitizeSignal(signal);

  const m = mean(clean);
  const sd = standardDeviation(clean);

  if (!Number.isFinite(sd) || sd < 1e-10) {
    return clean.map(() => 0);
  }

  return clean.map((value) => (value - m) / sd);
}

/* -------------------------------------------------------------------------- */
/* Band-pass filtering                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Windowed-sinc FIR band-pass filter.
 *
 * This replaces the previous ad-hoc IIR coefficient calculation. A linear
 * phase FIR is easier to reason about and does not depend on an incorrectly
 * normalized Butterworth design.
 *
 * The filter is applied forward and backward to approximate zero phase.
 */
export function bandpassFilter(
  signal: number[],
  sampleRate: number,
  lowCut: number = CARDIAC_LOW,
  highCut: number = CARDIAC_HIGH,
): number[] {
  const input = sanitizeSignal(signal);

  const n = input.length;

  if (n < 9) return [...input];

  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return [...input];
  }

  const nyquist = sampleRate / 2;

  const low = clamp(lowCut, 0.01, nyquist * 0.95);

  const high = clamp(highCut, low + 0.01, nyquist * 0.98);

  /*
   * At normal webcam rates a 61-tap filter provides a reasonable transition
   * band without excessive temporal smoothing.
   */
  let taps = 61;

  /*
   * Keep the kernel odd and shorter than the recording.
   */
  if (n < taps * 2) {
    taps = Math.max(15, 2 * Math.floor((n - 1) / 4) + 1);
  }

  if (taps < 5) return [...input];

  const half = Math.floor(taps / 2);
  const kernel = new Array<number>(taps);

  const normalizedLow = low / sampleRate;

  const normalizedHigh = high / sampleRate;

  /*
   * Ideal band-pass impulse response:
   *
   * h[n] =
   *   2fc2 sinc(2fc2 n)
   * - 2fc1 sinc(2fc1 n)
   *
   * multiplied by a Hamming window.
   */
  for (let k = 0; k < taps; k++) {
    const m = k - half;

    let h: number;

    if (m === 0) {
      h = 2 * (normalizedHigh - normalizedLow);
    } else {
      h =
        (Math.sin(2 * Math.PI * normalizedHigh * m) -
          Math.sin(2 * Math.PI * normalizedLow * m)) /
        (Math.PI * m);
    }

    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * k) / (taps - 1));

    kernel[k] = h * hamming;
  }

  /*
   * Normalize DC response close to zero and normalize overall gain.
   */
  const kernelSum = kernel.reduce((a, b) => a + b, 0);

  if (Math.abs(kernelSum) > 1e-10) {
    const correction = kernelSum / taps;

    for (let i = 0; i < kernel.length; i++) {
      kernel[i] -= correction;
    }
  }

  const applyFIR = (values: number[]): number[] => {
    const output = new Array<number>(values.length);

    for (let i = 0; i < values.length; i++) {
      let sum = 0;

      for (let k = 0; k < taps; k++) {
        const index = i + k - half;

        /*
         * Edge extension prevents zeros from being injected into the
         * beginning/end of the pulse waveform.
         */
        const clampedIndex = Math.max(0, Math.min(values.length - 1, index));

        sum += values[clampedIndex] * kernel[k];
      }

      output[i] = sum;
    }

    return output;
  };

  const forward = applyFIR(input);

  const reversed = [...forward].reverse();

  const backward = applyFIR(reversed);

  return backward.reverse();
}

/* -------------------------------------------------------------------------- */
/* FFT                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Radix-2 FFT with Hann window and zero-padding.
 */
export function computeFFT(
  signal: number[],
  sampleRate: number,
): { freq: number; power: number }[] {
  const clean = sanitizeSignal(signal);

  const n = clean.length;

  if (n < 2 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return [];
  }

  /*
   * Zero-padding to the next power of two improves display/interpolation
   * density. It does not create new physiological information.
   */
  let m = 1;

  while (m < n) {
    m <<= 1;
  }

  /*
   * For very long recordings, cap FFT size while retaining the most recent
   * power-of-two segment. The caller normally uses 10-second windows.
   */
  const maxFFTSize = 16384;

  let working = clean;

  if (m > maxFFTSize) {
    working = clean.slice(clean.length - maxFFTSize);
    m = maxFFTSize;
  }

  const real = new Float64Array(m);

  const imag = new Float64Array(m);

  const length = working.length;

  /*
   * Hann window.
   */
  for (let i = 0; i < length; i++) {
    const window =
      length > 1 ? 0.5 * (1 - Math.cos((2 * Math.PI * i) / (length - 1))) : 1;

    real[i] = working[i] * window;
  }

  /*
   * Bit reversal.
   */
  let j = 0;

  for (let i = 0; i < m - 1; i++) {
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;

      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }

    let k = m >> 1;

    while (k <= j && k > 0) {
      j -= k;
      k >>= 1;
    }

    j += k;
  }

  /*
   * Cooley-Tukey radix-2.
   */
  for (let size = 2; size <= m; size <<= 1) {
    const half = size >> 1;

    const angle = (-2 * Math.PI) / size;

    const stepReal = Math.cos(angle);

    const stepImag = Math.sin(angle);

    for (let start = 0; start < m; start += size) {
      let wr = 1;
      let wi = 0;

      for (let k = 0; k < half; k++) {
        const i = start + k;

        const j2 = i + half;

        const tr = wr * real[j2] - wi * imag[j2];

        const ti = wr * imag[j2] + wi * real[j2];

        real[j2] = real[i] - tr;

        imag[j2] = imag[i] - ti;

        real[i] += tr;
        imag[i] += ti;

        const nextWr = wr * stepReal - wi * stepImag;

        wi = wr * stepImag + wi * stepReal;

        wr = nextWr;
      }
    }
  }

  const spectrum: {
    freq: number;
    power: number;
  }[] = [];

  const numBins = Math.floor(m / 2);

  const frequencyStep = sampleRate / m;

  /*
   * Power normalization is relative; the SNR calculation uses ratios, so
   * the absolute scale cancels.
   */
  for (let i = 0; i <= numBins; i++) {
    const power = (real[i] * real[i] + imag[i] * imag[i]) / m;

    spectrum.push({
      freq: i * frequencyStep,
      power,
    });
  }

  return spectrum;
}

/* -------------------------------------------------------------------------- */
/* Spectral peak analysis                                                      */
/* -------------------------------------------------------------------------- */

interface SpectralPeak {
  freq: number;
  power: number;
  index: number;
}

function findLocalSpectralPeaks(
  spectrum: {
    freq: number;
    power: number;
  }[],
): SpectralPeak[] {
  const candidates: SpectralPeak[] = [];

  for (let i = 1; i < spectrum.length - 1; i++) {
    const current = spectrum[i];

    if (current.freq < MIN_HR_HZ || current.freq > MAX_HR_HZ) {
      continue;
    }

    if (
      current.power >= spectrum[i - 1].power &&
      current.power > spectrum[i + 1].power
    ) {
      candidates.push({
        freq: current.freq,
        power: current.power,
        index: i,
      });
    }
  }

  return candidates.sort((a, b) => b.power - a.power);
}

/**
 * Quadratic interpolation around a spectral maximum.
 *
 * This gives a frequency estimate finer than the raw FFT-bin spacing.
 */
function interpolatePeakFrequency(
  spectrum: {
    freq: number;
    power: number;
  }[],
  index: number,
): number {
  if (index <= 0 || index >= spectrum.length - 1) {
    return spectrum[index]?.freq ?? 0;
  }

  const y1 = Math.log(Math.max(1e-20, spectrum[index - 1].power));

  const y2 = Math.log(Math.max(1e-20, spectrum[index].power));

  const y3 = Math.log(Math.max(1e-20, spectrum[index + 1].power));

  const denominator = y1 - 2 * y2 + y3;

  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) {
    return spectrum[index].freq;
  }

  const offset = 0.5 * ((y1 - y3) / denominator);

  const binSpacing = spectrum[index + 1].freq - spectrum[index].freq;

  return spectrum[index].freq + clamp(offset, -1, 1) * binSpacing;
}

/**
 * Estimate spectral SNR around a selected frequency.
 *
 * Signal power = narrow band around the selected cardiac peak.
 * Noise power = remaining cardiac-band power.
 */
function calculateSpectralSNR(
  spectrum: {
    freq: number;
    power: number;
  }[],
  selectedHz: number,
): number {
  if (!spectrum.length || selectedHz <= 0) {
    return -30;
  }

  const band = spectrum.filter(
    (bin) =>
      bin.freq >= MIN_HR_HZ &&
      bin.freq <= MAX_HR_HZ &&
      Number.isFinite(bin.power),
  );

  if (!band.length) return -30;

  const signalBandwidth = 0.12;

  const signalPower = band
    .filter((bin) => Math.abs(bin.freq - selectedHz) <= signalBandwidth)
    .reduce((sum, bin) => sum + bin.power, 0);

  const totalPower = band.reduce((sum, bin) => sum + bin.power, 0);

  const noisePower = Math.max(1e-12, totalPower - signalPower);

  if (signalPower <= 0 || !Number.isFinite(signalPower)) {
    return -30;
  }

  return clamp(10 * Math.log10(signalPower / noisePower), -30, 30);
}

/**
 * Select the fundamental frequency while checking for second-harmonic
 * ambiguity.
 *
 * Example:
 *   strong peak at 2.0 Hz
 *   meaningful peak at 1.0 Hz
 *
 * The lower frequency is considered as a possible fundamental only when the
 * spectrum actually contains supporting energy.
 */
function chooseFundamentalFrequency(
  spectrum: {
    freq: number;
    power: number;
  }[],
): {
  hz: number;
  snrDb: number;
} {
  const peaks = findLocalSpectralPeaks(spectrum);

  if (!peaks.length) {
    return {
      hz: 0,
      snrDb: -30,
    };
  }

  const strongest = peaks[0];

  const binSpacing =
    spectrum.length > 2
      ? median(
          spectrum
            .slice(1)
            .map((bin, i) => bin.freq - spectrum[i].freq)
            .filter((value) => value > 0),
        )
      : 0.05;

  const tolerance = Math.max(0.06, binSpacing * 2);

  const half = strongest.freq / 2;

  const halfPeak = peaks.find(
    (peak) => Math.abs(peak.freq - half) <= tolerance,
  );

  if (halfPeak && halfPeak.power >= strongest.power * 0.22) {
    const halfSnr = calculateSpectralSNR(spectrum, halfPeak.freq);

    const fullSnr = calculateSpectralSNR(spectrum, strongest.freq);

    /*
     * Prefer the lower fundamental when it has comparable spectral support.
     */
    if (halfSnr >= fullSnr - 2) {
      return {
        hz: halfPeak.freq,
        snrDb: halfSnr,
      };
    }
  }

  return {
    hz: strongest.freq,
    snrDb: calculateSpectralSNR(spectrum, strongest.freq),
  };
}

/* -------------------------------------------------------------------------- */
/* Peak detection                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Robust pulse peak detector.
 *
 * A candidate must:
 *   - be a local maximum
 *   - have meaningful prominence relative to local baseline
 *   - exceed an adaptive amplitude threshold
 *   - obey a physiological refractory period
 *
 * 400 ms minimum spacing corresponds to 150 BPM. This is deliberately
 * conservative for webcam rPPG and avoids counting high-frequency noise.
 */
export function detectPeaks(
  waveform: number[],
  sampleRate: number,
  minPeakDistanceMs: number = 400,
): number[] {
  const signal = sanitizeSignal(waveform);

  const n = signal.length;

  if (n < Math.max(30, Math.round(sampleRate * 3))) {
    return [];
  }

  const centered = detrend(signal, Math.max(5, Math.round(sampleRate * 0.8)));

  const sd = standardDeviation(centered);

  if (!Number.isFinite(sd) || sd < 1e-8) {
    return [];
  }

  const minDistance = Math.max(
    1,
    Math.round((minPeakDistanceMs / 1000) * sampleRate),
  );

  const radius = Math.max(2, Math.round(sampleRate * 0.15));

  const amplitudeThreshold = 0.35 * sd;

  const prominenceThreshold = 0.25 * sd;

  const candidates: {
    index: number;
    amplitude: number;
    prominence: number;
  }[] = [];

  for (let i = radius; i < n - radius; i++) {
    const value = centered[i];

    if (value < amplitudeThreshold) {
      continue;
    }

    if (value <= centered[i - 1] || value < centered[i + 1]) {
      continue;
    }

    let leftMin = Infinity;

    let rightMin = Infinity;

    for (let j = i - radius; j <= i; j++) {
      leftMin = Math.min(leftMin, centered[j]);
    }

    for (let j = i; j <= i + radius; j++) {
      rightMin = Math.min(rightMin, centered[j]);
    }

    const prominence = value - Math.max(leftMin, rightMin);

    if (prominence < prominenceThreshold) {
      continue;
    }

    candidates.push({
      index: i,
      amplitude: value,
      prominence,
    });
  }

  /*
   * Non-maximum suppression: strongest candidate wins when two candidates
   * occur inside the refractory period.
   */
  candidates.sort((a, b) => b.prominence - a.prominence);

  const selected: typeof candidates = [];

  for (const candidate of candidates) {
    const tooClose = selected.some(
      (other) => Math.abs(candidate.index - other.index) < minDistance,
    );

    if (!tooClose) {
      selected.push(candidate);
    }
  }

  selected.sort((a, b) => a.index - b.index);

  return selected.map((peak) => peak.index);
}

/* -------------------------------------------------------------------------- */
/* Heart-rate estimation                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Estimate BPM from spectral and temporal evidence.
 *
 * No default BPM is used. If the signal does not provide enough evidence,
 * bpm = 0 is returned and the validation layer can request a repeat scan.
 */
export function estimateHeartRate(
  waveform: number[],
  sampleRate: number,
  spectrum: {
    freq: number;
    power: number;
  }[],
): {
  bpm: number;
  snrDb: number;
  peaks: number[];
} {
  const clean = sanitizeSignal(waveform);

  if (clean.length < Math.max(60, Math.round(sampleRate * 4))) {
    return {
      bpm: 0,
      snrDb: -30,
      peaks: [],
    };
  }

  const spectral = chooseFundamentalFrequency(spectrum);

  const peaks = detectPeaks(clean, sampleRate, 400);

  /*
   * Time-domain IBI candidates.
   */
  const ibisSec: number[] = [];
  const ibiBpms: number[] = [];

  for (let i = 1; i < peaks.length; i++) {
    const ibi = (peaks[i] - peaks[i - 1]) / sampleRate;

    if (ibi >= 60 / MAX_HR_BPM && ibi <= 60 / MIN_HR_BPM) {
      ibisSec.push(ibi);
      ibiBpms.push(60 / ibi);
    }
  }

  /*
   * Spectral candidate.
   */
  const spectralBpm = spectral.hz > 0 ? spectral.hz * 60 : 0;

  let timeBpm = 0;

  if (ibiBpms.length >= 3) {
    /*
     * Median IBI is more robust than averaging all intervals.
     */
    const medianIbi = median(ibisSec);

    if (medianIbi > 0) {
      timeBpm = 60 / medianIbi;
    }
  }

  /*
   * Decision logic.
   *
   * We only combine time and spectral estimates when they independently
   * support approximately the same rate.
   */
  let bpm = 0;

  if (spectralBpm > 0 && timeBpm > 0) {
    const difference = Math.abs(spectralBpm - timeBpm);

    if (difference <= 8) {
      bpm = 0.65 * spectralBpm + 0.35 * timeBpm;
    } else {
      /*
       * Large disagreement means the two estimators are seeing different
       * periodicities. Do not average them into an arbitrary BPM.
       */
      bpm = spectralBpm;
    }
  } else if (spectralBpm > 0) {
    bpm = spectralBpm;
  } else if (timeBpm > 0) {
    bpm = timeBpm;
  }

  /*
   * Temporal regularity check.
   */
  let temporalConsistency = 0;

  if (ibiBpms.length >= 3) {
    const med = median(ibiBpms);

    const deviations = ibiBpms.map((value) => Math.abs(value - med));

    const mad = median(deviations);

    temporalConsistency = clamp(1 - mad / Math.max(1, med), 0, 1);
  }

  /*
   * Spectral SNR is measured from the actual spectrum.
   */
  const snrDb = spectral.snrDb;

  /*
   * If both the spectrum and temporal peak intervals exist and strongly
   * disagree, keep the spectral value but expose the poor SNR/temporal
   * evidence to the caller. The caller's confidence gate can reject it.
   */
  if (bpm > 0 && timeBpm > 0 && Math.abs(spectralBpm - timeBpm) > 15) {
    /*
     * Strong disagreement: do not allow a blended result.
     */
    bpm = spectralBpm;
  }

  if (!Number.isFinite(bpm) || bpm < MIN_HR_BPM || bpm > MAX_HR_BPM) {
    return {
      bpm: 0,
      snrDb,
      peaks,
    };
  }

  /*
   * If the signal has essentially no temporal consistency and very weak
   * spectrum, reject rather than reporting a false precision.
   */
  if (snrDb < -8 && temporalConsistency < 0.5) {
    return {
      bpm: 0,
      snrDb,
      peaks,
    };
  }

  return {
    bpm: Math.round(bpm),
    snrDb: Number(snrDb.toFixed(1)),
    peaks,
  };
}

/* -------------------------------------------------------------------------- */
/* HRV                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Calculate HRV metrics from detected beat intervals.
 *
 * No synthetic/fallback physiological values are returned. If there are not
 * enough reliable intervals, the metrics are zero.
 */
export function calculateHRV(peaks: number[], sampleRate: number): HRVMetrics {
  if (peaks.length < 3 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return {
      rmssd: 0,
      sdnn: 0,
      pnn50: 0,
      meanIBI: 0,
      stressIndex: 0,
      autonomicState: "Insufficient data",
    };
  }

  const ibis: number[] = [];

  for (let i = 1; i < peaks.length; i++) {
    const ibiMs = ((peaks[i] - peaks[i - 1]) / sampleRate) * 1000;

    if (ibiMs >= 60000 / MAX_HR_BPM && ibiMs <= 60000 / MIN_HR_BPM) {
      ibis.push(ibiMs);
    }
  }

  if (ibis.length < 3) {
    return {
      rmssd: 0,
      sdnn: 0,
      pnn50: 0,
      meanIBI: 0,
      stressIndex: 0,
      autonomicState: "Insufficient data",
    };
  }

  const meanIBI = mean(ibis);

  const variance =
    ibis.reduce((sum, value) => sum + (value - meanIBI) ** 2, 0) /
    Math.max(1, ibis.length - 1);

  const sdnn = Math.sqrt(variance);

  let sumSquaredDiff = 0;

  let countGt50 = 0;

  for (let i = 1; i < ibis.length; i++) {
    const diff = ibis[i] - ibis[i - 1];

    sumSquaredDiff += diff * diff;

    if (Math.abs(diff) > 50) {
      countGt50++;
    }
  }

  const differences = ibis.length - 1;

  const rmssd = Math.sqrt(sumSquaredDiff / Math.max(1, differences));

  const pnn50 = (countGt50 / Math.max(1, differences)) * 100;

  /*
   * A simple normalized variability index is used only as a descriptive
   * metric. It is not a clinical Baevsky stress index.
   */
  const variability = meanIBI > 0 ? rmssd / meanIBI : 0;

  const stressIndex = clamp(
    Math.round(100 * (1 - clamp(variability, 0, 1))),
    0,
    100,
  );

  let autonomicState: HRVMetrics["autonomicState"] = "Balanced";

  if (rmssd === 0) {
    autonomicState = "Insufficient data";
  } else if (rmssd >= 55) {
    autonomicState = "Relaxed / Parasympathetic";
  } else if (rmssd <= 25) {
    autonomicState = "Elevated Stress / Sympathetic";
  }

  return {
    rmssd: Math.round(rmssd),
    sdnn: Math.round(sdnn),
    pnn50: Math.round(clamp(pnn50, 0, 100)),
    meanIBI: Math.round(meanIBI),
    stressIndex,
    autonomicState,
  };
}

/* -------------------------------------------------------------------------- */
/* Respiratory rate                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Estimate respiratory rate from the low-frequency component of the pulse
 * waveform.
 *
 * If there is insufficient signal, returns 0 instead of a fabricated
 * physiological ratio.
 */
export function estimateRespiratoryRate(
  rawPulse: number[],
  sampleRate: number,
  heartRate: number,
): number {
  void heartRate;

  if (rawPulse.length < Math.max(1, Math.round(sampleRate * 8))) {
    return 0;
  }

  const respSignal = bandpassFilter(rawPulse, sampleRate, 0.15, 0.45);

  const spectrum = computeFFT(respSignal, sampleRate);

  let bestFreq = 0;
  let bestPower = -Infinity;

  for (const bin of spectrum) {
    if (bin.freq >= 0.15 && bin.freq <= 0.45 && bin.power > bestPower) {
      bestPower = bin.power;
      bestFreq = bin.freq;
    }
  }

  if (bestFreq <= 0 || !Number.isFinite(bestFreq)) {
    return 0;
  }

  return Math.round(clamp(bestFreq * 60, 9, 27));
}

/* -------------------------------------------------------------------------- */
/* Quality metrics                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Peak consistency from inter-beat intervals.
 */
export function computePeakConsistency(
  peaks: number[],
  sampleRate: number,
): number {
  if (peaks.length < 4) {
    return 0;
  }

  const ibis: number[] = [];

  for (let i = 1; i < peaks.length; i++) {
    const ibi = (peaks[i] - peaks[i - 1]) / sampleRate;

    if (ibi >= 60 / MAX_HR_BPM && ibi <= 60 / MIN_HR_BPM) {
      ibis.push(ibi);
    }
  }

  if (ibis.length < 3) {
    return 0;
  }

  const m = mean(ibis);

  const sd = standardDeviation(ibis);

  if (m <= 0 || !Number.isFinite(sd)) {
    return 0;
  }

  const cv = sd / m;

  /*
   * CV = 0 -> 100
   * CV >= 0.25 -> 0
   *
   * This is a signal regularity metric, not a medical "accuracy" percentage.
   */
  return Math.round(clamp((1 - cv / 0.25) * 100, 0, 100));
}

/**
 * Composite waveform quality based on actual signal statistics.
 *
 * This deliberately does not convert a negative SNR into an artificially
 * positive quality score.
 */
export function computeWaveformQuality(
  waveform: number[],
  snrDb: number,
): number {
  if (!waveform || waveform.length < 10) {
    return 0;
  }

  const clean = sanitizeSignal(waveform);

  const sd = standardDeviation(clean);

  if (!Number.isFinite(sd) || sd < 1e-10) {
    return 0;
  }

  /*
   * Use measured SNR as the dominant component.
   *
   * -3 dB -> 0
   * +9 dB -> 100
   */
  const snrScore = clamp(((snrDb + 3) / 12) * 100, 0, 100);

  /*
   * Amplitude stability:
   * compare first and second half RMS.
   */
  const midpoint = Math.floor(clean.length / 2);

  const first = clean.slice(0, midpoint);

  const second = clean.slice(midpoint);

  const firstSd = standardDeviation(first);

  const secondSd = standardDeviation(second);

  const amplitudeRatio =
    Math.min(firstSd, secondSd) / Math.max(firstSd, secondSd, 1e-10);

  const amplitudeScore = clamp(amplitudeRatio * 100, 0, 100);

  return Math.round(0.75 * snrScore + 0.25 * amplitudeScore);
}

/* -------------------------------------------------------------------------- */
/* Sliding-window analysis                                                     */
/* -------------------------------------------------------------------------- */

export function computeSlidingWindowRPPG(
  waveform: number[],
  sampleRate: number,
  windowSec: number = 10,
  stepSec: number = 5,
): {
  bpm: number;
  hrvRmssd: number;
  quality: number;
  snrDb: number;
  startSec: number;
  endSec: number;
  windowIndex: number;
}[] {
  if (!waveform.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return [];
  }

  const windowSamples = Math.max(1, Math.round(windowSec * sampleRate));

  const stepSamples = Math.max(1, Math.round(stepSec * sampleRate));

  const totalSamples = waveform.length;

  const processWindow = (
    chunk: number[],
    start: number,
    end: number,
    index: number,
  ) => {
    const spectrum = computeFFT(chunk, sampleRate);

    const estimate = estimateHeartRate(chunk, sampleRate, spectrum);

    const hrv = calculateHRV(estimate.peaks, sampleRate);

    const peakConsistency = computePeakConsistency(estimate.peaks, sampleRate);

    const waveformQuality = computeWaveformQuality(chunk, estimate.snrDb);

    const quality = Math.round(0.55 * waveformQuality + 0.45 * peakConsistency);

    return {
      windowIndex: index,
      startSec: Number((start / sampleRate).toFixed(1)),
      endSec: Number((end / sampleRate).toFixed(1)),
      bpm: estimate.bpm,
      hrvRmssd: hrv.rmssd,
      quality: clamp(quality, 0, 100),
      snrDb: estimate.snrDb,
    };
  };

  /*
   * For recordings shorter than one requested window, use the complete
   * recording only if it contains enough samples for HR estimation.
   */
  if (totalSamples < windowSamples) {
    if (totalSamples < sampleRate * 4) {
      return [];
    }

    return [processWindow(waveform, 0, totalSamples, 1)];
  }

  const windows: {
    bpm: number;
    hrvRmssd: number;
    quality: number;
    snrDb: number;
    startSec: number;
    endSec: number;
    windowIndex: number;
  }[] = [];

  let windowIndex = 1;

  for (
    let start = 0;
    start + windowSamples <= totalSamples;
    start += stepSamples
  ) {
    const end = start + windowSamples;

    const chunk = waveform.slice(start, end);

    windows.push(processWindow(chunk, start, end, windowIndex++));
  }

  return windows;
}

/* -------------------------------------------------------------------------- */
/* Temporal stability                                                          */
/* -------------------------------------------------------------------------- */

export function computeTemporalStability(
  windows: {
    bpm: number;
    hrvRmssd: number;
    quality: number;
  }[],
): {
  score: number;
  status: "STABLE" | "MODERATE" | "UNSTABLE";
} {
  if (!windows || windows.length === 0) {
    return {
      score: 0,
      status: "UNSTABLE",
    };
  }

  /*
   * Ignore windows that did not produce a BPM. A rejected window should not
   * be treated as a 0-BPM physiological measurement.
   */
  const valid = windows.filter(
    (window) =>
      Number.isFinite(window.bpm) &&
      window.bpm >= MIN_HR_BPM &&
      window.bpm <= MAX_HR_BPM,
  );

  if (valid.length === 0) {
    return {
      score: 0,
      status: "UNSTABLE",
    };
  }

  /*
   * One valid window cannot establish temporal stability.
   */
  if (valid.length === 1) {
    return {
      score: 50,
      status: "MODERATE",
    };
  }

  const bpms = valid.map((window) => window.bpm);

  const med = median(bpms);

  const absoluteDeviations = bpms.map((bpm) => Math.abs(bpm - med));

  const mad = median(absoluteDeviations);

  const maxDeviation = Math.max(...absoluteDeviations);

  /*
   * Median absolute deviation is robust to one corrupted window.
   */
  const stabilityFromMAD = clamp(1 - mad / 12, 0, 1);

  const stabilityFromMax = clamp(1 - maxDeviation / 30, 0, 1);

  const quality =
    mean(valid.map((window) => clamp(window.quality, 0, 100))) / 100;

  const validFraction = valid.length / windows.length;

  const rawScore =
    100 *
    (0.45 * stabilityFromMAD +
      0.25 * stabilityFromMax +
      0.2 * quality +
      0.1 * validFraction);

  const score = Math.round(clamp(rawScore, 0, 100));

  let status: "STABLE" | "MODERATE" | "UNSTABLE";

  if (validFraction < 0.5 || mad > 12 || maxDeviation > 30 || score < 50) {
    status = "UNSTABLE";
  } else if (
    validFraction < 0.75 ||
    mad > 6 ||
    maxDeviation > 15 ||
    score < 75
  ) {
    status = "MODERATE";
  } else {
    status = "STABLE";
  }

  return {
    score,
    status,
  };
}
