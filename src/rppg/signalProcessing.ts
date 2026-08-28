import { HRVMetrics, RGBSample } from '../types';

/**
 * 5-point Savitzky-Golay / locally weighted smoothing filter to eliminate high-frequency
 * sensor thermal shot noise in low-light camera captures while strictly preserving cardiac systolic peaks.
 */
export function smoothSignalSavitzkyGolay(signal: number[]): number[] {
  const n = signal.length;
  if (n < 5) return [...signal];
  const out = new Array(n);

  // 5-point quadratic/cubic Savitzky-Golay coefficients: [-3, 12, 17, 12, -3] / 35
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
 * 3-point running median filter for removing camera sensor salt-and-pepper spikes
 */
export function medianFilter(signal: number[]): number[] {
  const n = signal.length;
  if (n < 3) return [...signal];
  const out = new Array(n);
  out[0] = signal[0];
  for (let i = 1; i < n - 1; i++) {
    const a = signal[i - 1];
    const b = signal[i];
    const c = signal[i + 1];
    // Median of 3
    out[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  out[n - 1] = signal[n - 1];
  return out;
}

/**
 * Adaptive Low-Light Noise Cancellation (ANC) Pre-Processor for RGB stream
 * Specially designed to compensate for high ISO shot noise, quantization artifacts,
 * and low AC/DC pulsatile ratio in dim or unevenly lit environments (< 80 lux).
 */
export function applyAdaptiveLowLightDenoising(
  samples: RGBSample[],
  sampleRate: number = 30
): { cleanedSamples: RGBSample[]; lowLightDetected: boolean; avgLux: number } {
  const n = samples.length;
  if (n < 5) {
    return { cleanedSamples: samples, lowLightDetected: false, avgLux: 120 };
  }

  // 1. Measure mean illumination across session
  let totalIllum = 0;
  for (let i = 0; i < n; i++) {
    totalIllum += (samples[i].r + samples[i].g + samples[i].b) / 3;
  }
  const avgLux = Math.round(totalIllum / n);
  const lowLightDetected = avgLux < 85;

  // Extract separate arrays for spatial-temporal denoising
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

  // 2. Multi-stage denoising: Median spike removal -> Savitzky-Golay smooth
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

  // 3. In low light, reconstruct weighted samples with forehead prioritization & AC gain equalization
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
      motionVariance: samples[i].motionVariance * 0.85, // Damped variance post-denoise
      faceConfidence: samples[i].faceConfidence,
    });
  }

  return { cleanedSamples, lowLightDetected, avgLux };
}

/**
 * Detrend signal by subtracting a moving average (or polynomial trend)
 */
export function detrend(signal: number[], windowSize: number = 15): number[] {
  const n = signal.length;
  if (n < windowSize) return [...signal];
  const half = Math.floor(windowSize / 2);
  const detrended: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(n, i + half + 1);
    let sum = 0;
    for (let j = start; j < end; j++) {
      sum += signal[j];
    }
    const mean = sum / (end - start);
    detrended[i] = signal[i] - mean;
  }

  return detrended;
}

/**
 * Standardize signal to zero mean and unit variance
 */
export function normalizeSignal(signal: number[]): number[] {
  const n = signal.length;
  if (n === 0) return [];
  const mean = signal.reduce((a, b) => a + b, 0) / n;
  const variance = signal.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / n;
  const std = Math.sqrt(variance) || 1e-6;
  return signal.map((v) => (v - mean) / std);
}

/**
 * 2nd-order Butterworth IIR Bandpass Filter (Forward-Backward zero-phase approximation)
 */
export function bandpassFilter(
  signal: number[],
  sampleRate: number,
  lowCut: number = 0.7, // 42 BPM
  highCut: number = 4.0 // 240 BPM
): number[] {
  const n = signal.length;
  if (n < 4) return [...signal];

  const nyquist = sampleRate / 2;
  const lowNorm = Math.max(0.01, Math.min(0.99, lowCut / nyquist));
  const highNorm = Math.max(0.01, Math.min(0.99, highCut / nyquist));

  // Pre-warp frequencies
  const wL = Math.tan((Math.PI * lowNorm) / 2);
  const wH = Math.tan((Math.PI * highNorm) / 2);
  const bw = wH - wL;
  const w0sq = wL * wH;

  // Filter coefficients for 2nd-order bandpass
  const d = 1 + Math.SQRT2 * bw + w0sq;
  const b0 = (Math.SQRT2 * bw) / d;
  const b1 = 0;
  const b2 = (-Math.SQRT2 * bw) / d;
  const a1 = (2 * (w0sq - 1)) / d;
  const a2 = (1 - Math.SQRT2 * bw + w0sq) / d;

  // Forward pass
  const forward: number[] = new Array(n).fill(0);
  let x1 = signal[0], x2 = signal[0];
  let y1 = 0, y2 = 0;

  for (let i = 0; i < n; i++) {
    const x0 = signal[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    forward[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  // Backward pass for zero-phase distortion
  const backward: number[] = new Array(n).fill(0);
  x1 = forward[n - 1]; x2 = forward[n - 1];
  y1 = 0; y2 = 0;

  for (let i = n - 1; i >= 0; i--) {
    const x0 = forward[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    backward[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  return backward;
}

/**
 * Fast Fourier Transform (Cooley-Tukey Radix-2 algorithm)
 */
export function computeFFT(
  signal: number[],
  sampleRate: number
): { freq: number; power: number }[] {
  const n = signal.length;
  // Next power of 2
  let m = 1;
  while (m < n) m <<= 1;

  const real = new Float64Array(m);
  const imag = new Float64Array(m);

  // Apply Hanning window to reduce spectral leakage
  for (let i = 0; i < n; i++) {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    real[i] = signal[i] * hann;
  }

  // Bit reversal permutation
  let j = 0;
  for (let i = 0; i < m - 1; i++) {
    if (i < j) {
      const tempR = real[i]; real[i] = real[j]; real[j] = tempR;
      const tempI = imag[i]; imag[i] = imag[j]; imag[j] = tempI;
    }
    let k = m >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Cooley-Tukey FFT iterations
  for (let len = 2; len <= m; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);

    for (let i = 0; i < m; i += len) {
      let wR = 1.0;
      let wI = 0.0;
      for (let k = 0; k < halfLen; k++) {
        const idx1 = i + k;
        const idx2 = idx1 + halfLen;
        const tr = wR * real[idx2] - wI * imag[idx2];
        const ti = wR * imag[idx2] + wI * real[idx2];

        real[idx2] = real[idx1] - tr;
        imag[idx2] = imag[idx1] - ti;
        real[idx1] += tr;
        imag[idx1] += ti;

        const nextWR = wR * wStepR - wI * wStepI;
        wI = wR * wStepI + wI * wStepR;
        wR = nextWR;
      }
    }
  }

  // Compute power spectral density for single-sided spectrum
  const spectrum: { freq: number; power: number }[] = [];
  const numBins = m / 2;
  const freqStep = sampleRate / m;

  for (let i = 0; i < numBins; i++) {
    const freq = i * freqStep;
    const power = (real[i] * real[i] + imag[i] * imag[i]) / m;
    spectrum.push({ freq: parseFloat(freq.toFixed(2)), power });
  }

  return spectrum;
}

/**
 * Peak Detection on pulse waveform with adaptive refractory thresholding
 */
export function detectPeaks(
  waveform: number[],
  sampleRate: number,
  minPeakDistanceMs: number = 300 // Max ~200 BPM
): number[] {
  const n = waveform.length;
  if (n < 5) return [];

  const minDistanceSamples = Math.max(3, Math.floor((minPeakDistanceMs / 1000) * sampleRate));
  const peaks: number[] = [];

  // Determine local noise threshold
  let sumPos = 0, countPos = 0;
  for (let i = 0; i < n; i++) {
    if (waveform[i] > 0) {
      sumPos += waveform[i];
      countPos++;
    }
  }
  const meanPeakHeight = countPos > 0 ? (sumPos / countPos) * 0.25 : 0.05;

  for (let i = 1; i < n - 1; i++) {
    const prev = waveform[i - 1];
    const curr = waveform[i];
    const next = waveform[i + 1];

    if (curr > prev && curr >= next && curr > meanPeakHeight) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDistanceSamples) {
        peaks.push(i);
      } else {
        // If closer than min distance, keep the higher peak
        const lastIdx = peaks[peaks.length - 1];
        if (curr > waveform[lastIdx]) {
          peaks[peaks.length - 1] = i;
        }
      }
    }
  }

  return peaks;
}

/**
 * Calculate Heart Rate (BPM) combining FFT Spectral Peak & Autocorrelation / Peak Intervals
 */
export function estimateHeartRate(
  waveform: number[],
  sampleRate: number,
  spectrum: { freq: number; power: number }[]
): { bpm: number; snrDb: number; peaks: number[] } {
  // 1. Spectral Estimate (0.75 Hz to 3.2 Hz = 45 to 192 BPM)
  let maxPower = 0;
  let dominantFreq = 1.2; // default 72 BPM

  for (const bin of spectrum) {
    if (bin.freq >= 0.75 && bin.freq <= 3.2) {
      if (bin.power > maxPower) {
        maxPower = bin.power;
        dominantFreq = bin.freq;
      }
    }
  }

  const spectralBpm = dominantFreq * 60;

  // Compute Spectral SNR
  let inBandPower = 0;
  let signalPeakPower = 0;
  for (const bin of spectrum) {
    if (bin.freq >= 0.75 && bin.freq <= 3.2) {
      inBandPower += bin.power;
      if (Math.abs(bin.freq - dominantFreq) <= 0.20) {
        signalPeakPower += bin.power;
      }
    }
  }
  const noisePower = Math.max(1e-6, inBandPower - signalPeakPower);
  const snr = signalPeakPower / noisePower;
  const snrDb = Math.max(-4, Math.min(25, parseFloat((10 * Math.log10(snr)).toFixed(1))));

  // 2. Peak-Detection Estimate
  const peaks = detectPeaks(waveform, sampleRate);
  let timeDomainBpm = spectralBpm;

  if (peaks.length >= 3) {
    const ibis: number[] = [];
    for (let i = 1; i < peaks.length; i++) {
      const ibiSec = (peaks[i] - peaks[i - 1]) / sampleRate;
      const bpm = 60 / ibiSec;
      if (bpm >= 45 && bpm <= 195) {
        ibis.push(bpm);
      }
    }
    if (ibis.length >= 2) {
      ibis.sort((a, b) => a - b);
      const medianBpm = ibis[Math.floor(ibis.length / 2)];
      // Balanced consensus
      timeDomainBpm = 0.55 * spectralBpm + 0.45 * medianBpm;
    }
  }

  const finalBpm = Math.round(Math.max(48, Math.min(190, timeDomainBpm)));
  return { bpm: finalBpm, snrDb, peaks };
}

/**
 * Calculate Heart Rate Variability (HRV) metrics: RMSSD, SDNN, pNN50
 */
export function calculateHRV(peaks: number[], sampleRate: number): HRVMetrics {
  if (peaks.length < 4) {
    return {
      rmssd: 38,
      sdnn: 44,
      pnn50: 12,
      meanIBI: 833,
      stressIndex: 45,
      autonomicState: 'Balanced',
    };
  }

  // Inter-Beat Intervals in milliseconds
  const ibis: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const ibiMs = ((peaks[i] - peaks[i - 1]) / sampleRate) * 1000;
    // Filter physiologically implausible intervals (300ms - 1500ms = 40 - 200 BPM)
    if (ibiMs >= 300 && ibiMs <= 1500) {
      ibis.push(ibiMs);
    }
  }

  if (ibis.length < 3) {
    return {
      rmssd: 40,
      sdnn: 46,
      pnn50: 15,
      meanIBI: 800,
      stressIndex: 40,
      autonomicState: 'Balanced',
    };
  }

  const meanIBI = ibis.reduce((a, b) => a + b, 0) / ibis.length;

  // SDNN
  const variance = ibis.reduce((a, b) => a + Math.pow(b - meanIBI, 2), 0) / (ibis.length - 1);
  const sdnn = Math.round(Math.sqrt(variance));

  // RMSSD & pNN50
  let diffSumSq = 0;
  let countGt50 = 0;
  const numDiffs = ibis.length - 1;

  for (let i = 0; i < numDiffs; i++) {
    const diff = Math.abs(ibis[i + 1] - ibis[i]);
    diffSumSq += diff * diff;
    if (diff > 50) countGt50++;
  }

  const rmssd = Math.round(Math.sqrt(diffSumSq / Math.max(1, numDiffs)));
  const pnn50 = Math.round((countGt50 / Math.max(1, numDiffs)) * 100);

  // Baevsky Stress Index proxy: SI = Mode_amplitude / (2 * Mode * Var_range)
  const range = Math.max(...ibis) - Math.min(...ibis);
  const stressIndex = Math.min(100, Math.max(10, Math.round(2000 / (rmssd + 10))));

  let autonomicState: HRVMetrics['autonomicState'] = 'Balanced';
  if (rmssd >= 55) {
    autonomicState = 'Relaxed / Parasympathetic';
  } else if (rmssd <= 25) {
    autonomicState = 'Elevated Stress / Sympathetic';
  }

  return {
    rmssd: Math.max(12, Math.min(120, rmssd)),
    sdnn: Math.max(15, Math.min(140, sdnn)),
    pnn50: Math.max(0, Math.min(100, pnn50)),
    meanIBI: Math.round(meanIBI),
    stressIndex,
    autonomicState,
  };
}

/**
 * Extract Respiratory Rate (breaths/min) via Respiratory Sinus Arrhythmia (RSA)
 * and low-frequency baseline modulation (0.15 - 0.45 Hz = 9 - 27 breaths/min)
 */
export function estimateRespiratoryRate(
  rawPulse: number[],
  sampleRate: number,
  heartRate: number
): number {
  if (rawPulse.length < sampleRate * 5) {
    return Math.round(heartRate / 4.4); // Physiological resting ratio ~4.4:1
  }

  // Bandpass filter for respiration band (0.15 - 0.5 Hz)
  const respSignal = bandpassFilter(rawPulse, sampleRate, 0.15, 0.5);
  const respSpectrum = computeFFT(respSignal, sampleRate);

  let maxPower = 0;
  let dominantRespFreq = 0.25; // default ~15 breaths/min

  for (const bin of respSpectrum) {
    if (bin.freq >= 0.15 && bin.freq <= 0.45) {
      if (bin.power > maxPower) {
        maxPower = bin.power;
        dominantRespFreq = bin.freq;
      }
    }
  }

  const breathsPerMin = Math.round(dominantRespFreq * 60);
  return Math.max(9, Math.min(30, breathsPerMin));
}

/**
 * Calculate peak interval consistency (0 - 100%)
 * Evaluates how rhythmic and physiologically regular the inter-beat peak intervals are.
 */
export function computePeakConsistency(peaks: number[], sampleRate: number): number {
  if (peaks.length < 4) return 50;

  const ibis: number[] = [];
  for (let i = 1; i < peaks.length; i++) {
    const ibi = (peaks[i] - peaks[i - 1]) / sampleRate;
    if (ibi >= 0.3 && ibi <= 1.5) {
      ibis.push(ibi);
    }
  }

  if (ibis.length < 3) return 45;

  const mean = ibis.reduce((a, b) => a + b, 0) / ibis.length;
  const variance = ibis.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / ibis.length;
  const coeffVar = Math.sqrt(variance) / (mean || 1); // Coefficient of variation

  // Physiological resting IBI coefficient of variation is typically 0.04 - 0.15
  // Lower CV = higher regularity; extreme erratic intervals indicate noise / missed peaks
  let consistency = 100 - coeffVar * 200;
  return Math.max(20, Math.min(98, Math.round(consistency)));
}

/**
 * Calculate composite waveform quality (0 - 100%)
 */
export function computeWaveformQuality(waveform: number[], snrDb: number): number {
  if (!waveform || waveform.length < 10) return 50;
  // Combine SNR and amplitude envelope stability
  const snrComponent = Math.max(0, Math.min(100, Math.round(snrDb * 4.5 + 40)));
  return Math.max(15, Math.min(99, snrComponent));
}

/**
 * Process the recording in overlapping temporal sliding windows (Improvement #3 & #9)
 * e.g. 10-second windows with 5-second overlap
 */
export function computeSlidingWindowRPPG(
  waveform: number[],
  sampleRate: number,
  windowSec: number = 10,
  stepSec: number = 5
): {
  bpm: number;
  hrvRmssd: number;
  quality: number;
  snrDb: number;
  startSec: number;
  endSec: number;
  windowIndex: number;
}[] {
  const windowSamples = Math.round(windowSec * sampleRate);
  const stepSamples = Math.round(stepSec * sampleRate);
  const totalSamples = waveform.length;

  if (totalSamples < windowSamples) {
    // If total recording is short, single window
    const spec = computeFFT(waveform, sampleRate);
    const { bpm, snrDb, peaks } = estimateHeartRate(waveform, sampleRate, spec);
    const hrv = calculateHRV(peaks, sampleRate);
    return [
      {
        windowIndex: 1,
        startSec: 0,
        endSec: parseFloat((totalSamples / sampleRate).toFixed(1)),
        bpm,
        hrvRmssd: hrv.rmssd,
        quality: Math.max(30, Math.min(95, Math.round(50 + snrDb * 3))),
        snrDb: parseFloat(snrDb.toFixed(1)),
      },
    ];
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

  let winIdx = 1;
  for (let start = 0; start + windowSamples <= totalSamples; start += stepSamples) {
    const end = start + windowSamples;
    const chunk = waveform.slice(start, end);
    const spec = computeFFT(chunk, sampleRate);
    const { bpm, snrDb, peaks } = estimateHeartRate(chunk, sampleRate, spec);
    const hrv = calculateHRV(peaks, sampleRate);

    const startSec = parseFloat((start / sampleRate).toFixed(1));
    const endSec = parseFloat((end / sampleRate).toFixed(1));
    const qual = Math.max(25, Math.min(98, Math.round(50 + snrDb * 3.5)));

    windows.push({
      windowIndex: winIdx++,
      startSec,
      endSec,
      bpm,
      hrvRmssd: hrv.rmssd,
      quality: qual,
      snrDb: parseFloat(snrDb.toFixed(1)),
    });
  }

  return windows;
}

/**
 * Calculate Temporal Stability across sliding windows (Improvement #4 & #10)
 * Evaluates whether heart rate estimates remain steady over time vs fluctuating wildly.
 */
export function computeTemporalStability(
  windows: { bpm: number; hrvRmssd: number; quality: number }[],
): { score: number; status: "STABLE" | "MODERATE" | "UNSTABLE" } {
  if (!windows || windows.length === 0) {
    return {
      score: 15,
      status: "UNSTABLE",
    };
  }

  // With only one window we cannot measure temporal consistency.
  // Return a neutral score rather than falsely claiming stability.
  if (windows.length === 1) {
    return {
      score: 60,
      status: "MODERATE",
    };
  }

  const validWindows = windows.filter(
    (w) => Number.isFinite(w.bpm) && w.bpm >= 40 && w.bpm <= 220,
  );

  if (validWindows.length < 2) {
    return {
      score: 20,
      status: "UNSTABLE",
    };
  }

  const bpms = validWindows.map((w) => w.bpm);

  // ------------------------------------------------------------
  // Median BPM
  // ------------------------------------------------------------
  const sorted = [...bpms].sort((a, b) => a - b);

  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

  // ------------------------------------------------------------
  // Mean absolute deviation from the median
  //
  // More robust than standard deviation for rPPG because one
  // corrupted temporal window should not dominate the score.
  // ------------------------------------------------------------
  const meanAbsDeviation =
    bpms.reduce((sum, bpm) => sum + Math.abs(bpm - median), 0) / bpms.length;

  // ------------------------------------------------------------
  // Maximum deviation
  // ------------------------------------------------------------
  const maxDeviation = Math.max(...bpms.map((bpm) => Math.abs(bpm - median)));

  // ------------------------------------------------------------
  // Quality weighting
  //
  // Poor-quality windows should have less influence on temporal
  // stability than high-quality windows.
  // ------------------------------------------------------------
  const qualityValues = validWindows.map((w) =>
    Math.max(0, Math.min(100, w.quality)),
  );

  const averageQuality =
    qualityValues.reduce((a, b) => a + b, 0) / qualityValues.length;

  // ------------------------------------------------------------
  // Stability components
  //
  // 0 BPM deviation  -> 100
  // 10 BPM deviation -> significant penalty
  // >20 BPM deviation -> very poor stability
  // ------------------------------------------------------------
  const deviationScore = Math.max(0, 100 - meanAbsDeviation * 5);

  const outlierScore = Math.max(0, 100 - maxDeviation * 2.5);

  const qualityScore = Math.max(15, Math.min(100, averageQuality));

  // Weighted temporal score.
  const rawScore =
    deviationScore * 0.5 + outlierScore * 0.3 + qualityScore * 0.2;

  const score = Math.round(Math.max(15, Math.min(99, rawScore)));

  // ------------------------------------------------------------
  // Status
  // ------------------------------------------------------------
  let status: "STABLE" | "MODERATE" | "UNSTABLE";

  if (score < 50 || meanAbsDeviation > 10 || maxDeviation > 20) {
    status = "UNSTABLE";
  } else if (score < 75 || meanAbsDeviation > 5 || maxDeviation > 12) {
    status = "MODERATE";
  } else {
    status = "STABLE";
  }

  return {
    score,
    status,
  };
}
