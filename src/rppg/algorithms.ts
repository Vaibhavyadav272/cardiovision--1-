import {
  RGBSample,
  MethodResult,
  MethodComparison,
  SignalQuality,
  RiskLevel,
  ConfidenceTier,
  DecisionOutcome,
  ROIQualityBreakdown,
  QualityTimelineInterval,
  WindowAnalysisPoint,
} from "../types";

import {
  detrend,
  normalizeSignal,
  bandpassFilter,
  computeFFT,
  estimateHeartRate,
  computePeakConsistency,
  computeWaveformQuality,
  computeSlidingWindowRPPG,
  computeTemporalStability,
} from "./signalProcessing";

/*
 * ============================================================================
 * CardioVision rPPG Algorithm Engine
 * ============================================================================
 *
 * Four methods:
 *   1. G-Channel
 *   2. CHROM
 *   3. POS
 *   4. Multi-ROI adaptive fusion
 *
 * Design goals:
 *   - No reference BPM is used anywhere.
 *   - No method is forced toward a target value.
 *   - No artificial SNR offsets are added.
 *   - Poor signal quality is allowed to produce an unreliable/zero result.
 *   - ROI weights are driven by measured signal quality rather than fixed
 *     "forehead = X%" assumptions.
 *
 * Important:
 * The final BPM is still only an rPPG estimate. Webcam rPPG cannot guarantee
 * 100% clinical accuracy. The validation engine therefore favors rejection
 * over presenting a precise-looking number when evidence is weak.
 * ============================================================================
 */

const MIN_BPM = 45;
const MAX_BPM = 180;
const MIN_HZ = MIN_BPM / 60;
const MAX_HZ = MAX_BPM / 60;

const MIN_SAMPLES = 4 * 30;
const CARDIAC_LOW = 0.7;
const CARDIAC_HIGH = 3.0;

/* -------------------------------------------------------------------------- */
/* Utility helpers                                                            */
/* -------------------------------------------------------------------------- */

function emptyMethodResult(description: string, snrDb = -20): MethodResult {
  return {
    bpm: 0,
    snrDb,
    confidence: 0.05,
    waveform: [],
    peaks: [],
    detectedPulsePeaks: 0,
    peakConsistency: 20,
    waveformQuality: 15,
    temporalStability: 15,
    spectrum: [],
    description,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(
    values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length,
  );
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp((sorted.length - 1) * p, 0, sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function safeNormalize(values: number[]): number[] {
  if (!values.length) return [];
  const sd = standardDeviation(values);
  if (!Number.isFinite(sd) || sd < 1e-10) {
    return values.map(() => 0);
  }
  const m = mean(values);
  return values.map((v) => (v - m) / sd);
}

/*
 * Convert the supplied samples to a stable effective sample rate.
 *
 * The acquisition layer may provide timestamps that are not exactly 30 FPS.
 * We use the timestamps when they are valid. This prevents a hard-coded
 * 30-FPS assumption from silently scaling the frequency axis.
 */
function effectiveSampleRate(samples: RGBSample[], fallback = 30): number {
  if (samples.length < 3) return fallback;

  const timestamps = samples
    .map((s) => Number(s.timestamp))
    .filter(Number.isFinite);

  if (timestamps.length !== samples.length) return fallback;

  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const dt = (timestamps[i] - timestamps[i - 1]) / 1000;
    if (dt > 0 && dt < 1) intervals.push(dt);
  }

  if (intervals.length < 2) return fallback;

  /*
   * Median inter-frame interval is robust to a few dropped/duplicated frames.
   */
  const dt = median(intervals);
  const rate = 1 / dt;

  return Number.isFinite(rate) && rate >= 10 && rate <= 60 ? rate : fallback;
}

/*
 * Remove invalid numeric samples without changing array length.
 * Invalid samples are replaced by the nearest valid value.
 */
function sanitizeSignal(signal: number[]): number[] {
  if (!signal.length) return [];

  const result = signal.map((v) => (Number.isFinite(v) ? v : NaN));

  let first = -1;
  for (let i = 0; i < result.length; i++) {
    if (Number.isFinite(result[i])) {
      first = i;
      break;
    }
  }

  if (first < 0) return result.map(() => 0);

  for (let i = 0; i < first; i++) result[i] = result[first];

  for (let i = first + 1; i < result.length; i++) {
    if (!Number.isFinite(result[i])) {
      result[i] = result[i - 1];
    }
  }

  return result;
}

/*
 * Spectral quality calculation.
 *
 * This is a true ratio calculated from the measured spectrum. It is not
 * artificially increased for display.
 */
function spectralQuality(
  spectrum: { freq: number; power: number }[],
  selectedHz: number,
): { snrDb: number; peakPower: number; bandwidthPower: number } {
  const band = spectrum.filter(
    (bin) =>
      bin.freq >= MIN_HZ && bin.freq <= MAX_HZ && Number.isFinite(bin.power),
  );

  if (!band.length) {
    return { snrDb: -20, peakPower: 0, bandwidthPower: 0 };
  }

  const peakPower = band.reduce((max, bin) => Math.max(max, bin.power), 0);

  const signalPower = band
    .filter((bin) => Math.abs(bin.freq - selectedHz) <= 0.12)
    .reduce((sum, bin) => sum + bin.power, 0);

  const totalPower = band.reduce((sum, bin) => sum + bin.power, 0);
  const noisePower = Math.max(1e-12, totalPower - signalPower);
  const snrDb = 10 * Math.log10(Math.max(1e-12, signalPower / noisePower));

  return {
    snrDb: clamp(snrDb, -30, 30),
    peakPower,
    bandwidthPower: totalPower,
  };
}

/*
 * Estimate a candidate frequency from a spectrum without assuming that the
 * largest bin is always the heart rate.
 *
 * The strongest spectral peak is compared with nearby sub-harmonic evidence.
 * If a strong peak occurs near 2x another plausible peak, the lower frequency
 * is treated as the fundamental candidate.
 */
function estimateSpectralCandidate(
  spectrum: { freq: number; power: number }[],
): { hz: number; snrDb: number } {
  const bins = spectrum
    .filter(
      (b) =>
        b.freq >= MIN_HZ &&
        b.freq <= MAX_HZ &&
        Number.isFinite(b.power) &&
        b.power >= 0,
    )
    .sort((a, b) => b.power - a.power);

  if (!bins.length) return { hz: 0, snrDb: -20 };

  const strongest = bins[0];

  /*
   * Search for a local maximum around half of the strongest peak.
   * A tolerance based on the FFT bin spacing is preferable to a fixed exact
   * equality because discrete FFT bins rarely land exactly on f/2.
   */
  const sortedByFreq = [...bins].sort((a, b) => a.freq - b.freq);
  const binSpacing =
    sortedByFreq.length > 1
      ? Math.max(
          0.01,
          median(
            sortedByFreq
              .slice(1)
              .map((b, i) => b.freq - sortedByFreq[i].freq)
              .filter((v) => v > 0),
          ),
        )
      : 0.05;

  const harmonicTolerance = Math.max(0.06, binSpacing * 1.75);
  const half = strongest.freq / 2;

  const halfCandidates = bins.filter(
    (b) => Math.abs(b.freq - half) <= harmonicTolerance,
  );

  if (halfCandidates.length) {
    const halfCandidate = halfCandidates.reduce(
      (best, candidate) => (candidate.power > best.power ? candidate : best),
      halfCandidates[0],
    );

    /*
     * The sub-harmonic must have meaningful energy. We deliberately do not
     * force a harmonic correction when the evidence is weak.
     */
    if (halfCandidate.power >= strongest.power * 0.22) {
      const quality = spectralQuality(spectrum, halfCandidate.freq);
      return {
        hz: halfCandidate.freq,
        snrDb: quality.snrDb,
      };
    }
  }

  const quality = spectralQuality(spectrum, strongest.freq);

  return {
    hz: strongest.freq,
    snrDb: quality.snrDb,
  };
}

/*
 * Common post-processing for an individual method.
 */
function finalizeMethod(
  waveform: number[],
  sampleRate: number,
  description: string,
): MethodResult {
  if (waveform.length < Math.max(30, Math.round(sampleRate * 4))) {
    return emptyMethodResult(description);
  }

  const clean = safeNormalize(sanitizeSignal(waveform));

  const spectrum = computeFFT(clean, sampleRate);

  const spectralCandidate = estimateSpectralCandidate(spectrum);

  /*
   * Use the shared estimator as a second independent time-domain check.
   * The shared estimator returns zero when it cannot form a valid result.
   */
  const estimated = estimateHeartRate(clean, sampleRate, spectrum);

  let bpm = estimated.bpm;

  /*
   * If the shared estimator rejects the waveform but the spectrum has a
   * valid candidate, retain the spectral candidate only when its measured
   * spectral SNR is positive. This prevents a noisy spectrum from generating
   * an arbitrary BPM.
   */
  if (bpm === 0 && spectralCandidate.hz > 0 && spectralCandidate.snrDb > 0) {
    bpm = Math.round(spectralCandidate.hz * 60);
  }

  const snrDb = Number.isFinite(estimated.snrDb)
    ? estimated.snrDb
    : spectralCandidate.snrDb;

  const peaks = estimated.peaks;

  const peakConsistency = computePeakConsistency(peaks, sampleRate);

  const waveformQuality = computeWaveformQuality(clean, snrDb);

  const windows = computeSlidingWindowRPPG(clean, sampleRate, 10, 5);

  const temporal = computeTemporalStability(windows);

  /*
   * Confidence is evidence-based:
   * - measured SNR
   * - peak consistency
   * - temporal stability
   *
   * It is intentionally capped below "certain".
   */
  const snrEvidence = clamp((snrDb + 3) / 12, 0, 1);
  const consistencyEvidence = peakConsistency / 100;
  const temporalEvidence = temporal.score / 100;

  const confidenceValue =
    0.45 * snrEvidence + 0.25 * consistencyEvidence + 0.3 * temporalEvidence;

  const confidence = clamp(confidenceValue, 0.05, 0.95);

  return {
    bpm:
      Number.isFinite(bpm) && bpm >= MIN_BPM && bpm <= MAX_BPM
        ? Math.round(bpm)
        : 0,
    snrDb: Number(snrDb.toFixed(1)),
    confidence: Number(confidence.toFixed(2)),
    waveform: clean,
    peaks,
    detectedPulsePeaks: peaks.length,
    peakConsistency,
    waveformQuality,
    temporalStability: temporal.score,
    spectrum,
    description,
  };
}

/* -------------------------------------------------------------------------- */
/* 1. G-Channel                                                               */
/* -------------------------------------------------------------------------- */

export function processGMethod(
  samples: RGBSample[],
  sampleRate: number,
): MethodResult {
  if (samples.length < Math.max(30, sampleRate * 4)) {
    return emptyMethodResult(
      "Insufficient samples for G-channel rPPG analysis",
    );
  }

  const actualRate = effectiveSampleRate(samples, sampleRate);

  const gRaw = sanitizeSignal(samples.map((s) => s.g));

  /*
   * Green-channel rPPG is simple and useful as a baseline. We remove slow
   * illumination drift and retain the cardiac band.
   */
  const detrended = detrend(gRaw, Math.max(5, Math.round(actualRate * 0.8)));

  const filtered = bandpassFilter(
    detrended,
    actualRate,
    CARDIAC_LOW,
    CARDIAC_HIGH,
  );

  /*
   * The sign is irrelevant for frequency estimation. Keeping the natural
   * signal orientation avoids introducing an unnecessary transformation.
   */
  return finalizeMethod(
    filtered,
    actualRate,
    "Green-channel pulse extraction with temporal detrending and cardiac-band filtering",
  );
}

/* -------------------------------------------------------------------------- */
/* 2. CHROM                                                                    */
/* -------------------------------------------------------------------------- */

export function processChromMethod(
  samples: RGBSample[],
  sampleRate: number,
): MethodResult {
  const n = samples.length;

  if (n < Math.max(30, sampleRate * 4)) {
    return emptyMethodResult(
      "Insufficient samples for windowed CHROM analysis",
    );
  }

  const actualRate = effectiveSampleRate(samples, sampleRate);

  const r = sanitizeSignal(samples.map((s) => s.r));
  const g = sanitizeSignal(samples.map((s) => s.g));
  const b = sanitizeSignal(samples.map((s) => s.b));

  /*
   * CHROM is fundamentally a local/windowed method.
   *
   * We use 1.6-second windows with 50% overlap. RGB normalization and alpha
   * calculation are performed independently in each window.
   */
  const windowSize = Math.max(32, Math.round(actualRate * 1.6));

  const stepSize = Math.max(1, Math.round(windowSize / 2));

  const chromSignal = new Array<number>(n).fill(0);
  const contributionCount = new Array<number>(n).fill(0);

  for (let start = 0; start + windowSize <= n; start += stepSize) {
    const end = start + windowSize;

    const meanR = mean(r.slice(start, end));
    const meanG = mean(g.slice(start, end));
    const meanB = mean(b.slice(start, end));

    if (
      meanR <= 0 ||
      meanG <= 0 ||
      meanB <= 0 ||
      !Number.isFinite(meanR) ||
      !Number.isFinite(meanG) ||
      !Number.isFinite(meanB)
    ) {
      continue;
    }

    const x = new Array<number>(windowSize);
    const y = new Array<number>(windowSize);

    for (let j = 0; j < windowSize; j++) {
      const i = start + j;

      const rn = r[i] / meanR;
      const gn = g[i] / meanG;
      const bn = b[i] / meanB;

      /*
       * CHROM chrominance projections.
       */
      x[j] = 3 * rn - 2 * gn;
      y[j] = 1.5 * rn + gn - 1.5 * bn;
    }

    const meanX = mean(x);
    const meanY = mean(y);

    const stdX = standardDeviation(x);
    const stdY = standardDeviation(y);

    if (!Number.isFinite(stdX) || !Number.isFinite(stdY) || stdY < 1e-10) {
      continue;
    }

    const alpha = stdX / stdY;

    for (let j = 0; j < windowSize; j++) {
      const i = start + j;

      const pulse = x[j] - meanX + alpha * (y[j] - meanY);

      chromSignal[i] += pulse;
      contributionCount[i] += 1;
    }
  }

  /*
   * Normalize overlap-add contributions.
   */
  for (let i = 0; i < n; i++) {
    if (contributionCount[i] > 0) {
      chromSignal[i] /= contributionCount[i];
    }
  }

  /*
   * Boundary samples have fewer/no contributions. Interpolate from the
   * nearest valid value rather than injecting a synthetic cardiac waveform.
   */
  const firstValid = contributionCount.findIndex((v) => v > 0);
  let lastValid = -1;

  for (let i = n - 1; i >= 0; i--) {
    if (contributionCount[i] > 0) {
      lastValid = i;
      break;
    }
  }

  if (firstValid < 0 || lastValid < 0) {
    return emptyMethodResult(
      "CHROM could not construct a valid windowed pulse signal",
    );
  }

  for (let i = 0; i < firstValid; i++) {
    chromSignal[i] = chromSignal[firstValid];
  }

  for (let i = lastValid + 1; i < n; i++) {
    chromSignal[i] = chromSignal[lastValid];
  }

  const detrended = detrend(
    chromSignal,
    Math.max(5, Math.round(actualRate * 0.8)),
  );

  const filtered = bandpassFilter(
    detrended,
    actualRate,
    CARDIAC_LOW,
    CARDIAC_HIGH,
  );

  return finalizeMethod(
    filtered,
    actualRate,
    "Windowed CHROM chrominance projection with local RGB normalization",
  );
}

/* -------------------------------------------------------------------------- */
/* 3. POS                                                                      */
/* -------------------------------------------------------------------------- */

export function processPosMethod(
  samples: RGBSample[],
  sampleRate: number,
): MethodResult {
  const n = samples.length;

  if (n < Math.max(30, sampleRate * 4)) {
    return emptyMethodResult("Insufficient samples for POS rPPG analysis");
  }

  const actualRate = effectiveSampleRate(samples, sampleRate);

  const r = sanitizeSignal(samples.map((s) => s.r));
  const g = sanitizeSignal(samples.map((s) => s.g));
  const b = sanitizeSignal(samples.map((s) => s.b));

  /*
   * Standard POS processing is performed over temporal windows. Each window
   * normalizes RGB relative to its local mean and projects onto the
   * plane orthogonal to the estimated skin-tone direction.
   */
  const windowSize = Math.max(32, Math.round(actualRate * 1.6));

  const stepSize = Math.max(1, Math.round(windowSize / 2));

  const posSignal = new Array<number>(n).fill(0);
  const contributionCount = new Array<number>(n).fill(0);

  for (let start = 0; start + windowSize <= n; start += stepSize) {
    const end = start + windowSize;

    const meanR = mean(r.slice(start, end));
    const meanG = mean(g.slice(start, end));
    const meanB = mean(b.slice(start, end));

    if (meanR <= 0 || meanG <= 0 || meanB <= 0) {
      continue;
    }

    const xs1 = new Array<number>(windowSize);
    const xs2 = new Array<number>(windowSize);

    for (let j = 0; j < windowSize; j++) {
      const i = start + j;

      const rn = r[i] / meanR;
      const gn = g[i] / meanG;
      const bn = b[i] / meanB;

      /*
       * POS projection matrix:
       *
       * S1 = G - B
       * S2 = G + B - 2R
       */
      xs1[j] = gn - bn;
      xs2[j] = gn + bn - 2 * rn;
    }

    const std1 = standardDeviation(xs1);
    const std2 = standardDeviation(xs2);

    if (!Number.isFinite(std1) || !Number.isFinite(std2) || std2 < 1e-10) {
      continue;
    }

    /*
     * POS combines the two projected components using the ratio of their
     * standard deviations. The combination is calculated independently per
     * window.
     */
    const alpha = std1 / std2;

    for (let j = 0; j < windowSize; j++) {
      const i = start + j;

      const pulse = xs1[j] - mean(xs1) + alpha * (xs2[j] - mean(xs2));

      posSignal[i] += pulse;
      contributionCount[i] += 1;
    }
  }

  for (let i = 0; i < n; i++) {
    if (contributionCount[i] > 0) {
      posSignal[i] /= contributionCount[i];
    }
  }

  const firstValid = contributionCount.findIndex((v) => v > 0);
  let lastValid = -1;

  for (let i = n - 1; i >= 0; i--) {
    if (contributionCount[i] > 0) {
      lastValid = i;
      break;
    }
  }

  if (firstValid < 0 || lastValid < 0) {
    return emptyMethodResult(
      "POS could not construct a valid windowed pulse signal",
    );
  }

  for (let i = 0; i < firstValid; i++) {
    posSignal[i] = posSignal[firstValid];
  }

  for (let i = lastValid + 1; i < n; i++) {
    posSignal[i] = posSignal[lastValid];
  }

  const detrended = detrend(
    posSignal,
    Math.max(5, Math.round(actualRate * 0.8)),
  );

  const filtered = bandpassFilter(
    detrended,
    actualRate,
    CARDIAC_LOW,
    CARDIAC_HIGH,
  );

  return finalizeMethod(
    filtered,
    actualRate,
    "Windowed POS plane-orthogonal-to-skin projection with adaptive component scaling",
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Multi-ROI Adaptive Fusion                                                */
/* -------------------------------------------------------------------------- */

type ROIName = "forehead" | "leftCheek" | "rightCheek";

interface ROIResult {
  name: ROIName;
  waveform: number[];
  quality: number;
  bpm: number;
  snrDb: number;
  peakConsistency: number;
  temporalStability: number;
}

function extractROIChannel(
  samples: RGBSample[],
  roi: ROIName,
  channel: "r" | "g" | "b",
): number[] {
  return samples.map((sample) => sample[roi][channel]);
}

/*
 * Measure a single ROI using green-channel pulse quality.
 *
 * Brightness is included only as a physical camera-quality gate; brightness
 * alone never decides the ROI weight.
 */
function analyzeROI(
  samples: RGBSample[],
  sampleRate: number,
  roi: ROIName,
): ROIResult {
  const actualRate = effectiveSampleRate(samples, sampleRate);

  const r = sanitizeSignal(extractROIChannel(samples, roi, "r"));
  const g = sanitizeSignal(extractROIChannel(samples, roi, "g"));
  const b = sanitizeSignal(extractROIChannel(samples, roi, "b"));

  /*
   * Use CHROM-like local color normalization for the ROI itself. This avoids
   * making ROI selection dependent only on raw green brightness.
   */
  const roiSamples: RGBSample[] = samples.map((s, i) => ({
    ...s,
    r: r[i],
    g: g[i],
    b: b[i],
  }));

  const chrom = processChromMethod(roiSamples, actualRate);

  const brightness = mean(
    samples.map((s) => (s[roi].r + s[roi].g + s[roi].b) / 3),
  );

  const exposureQuality =
    brightness < 25
      ? clamp(brightness / 25, 0, 1)
      : brightness > 245
        ? clamp((255 - brightness) / 10, 0, 1)
        : 1;

  const snrQuality = clamp((chrom.snrDb + 3) / 12, 0, 1);

  const consistencyQuality = chrom.peakConsistency / 100;

  const temporalQuality = chrom.temporalStability / 100;

  const quality =
    100 *
    (0.4 * snrQuality +
      0.25 * consistencyQuality +
      0.25 * temporalQuality +
      0.1 * exposureQuality);

  return {
    name: roi,
    waveform: chrom.waveform,
    quality: Math.round(clamp(quality, 0, 100)),
    bpm: chrom.bpm,
    snrDb: chrom.snrDb,
    peakConsistency: chrom.peakConsistency,
    temporalStability: chrom.temporalStability,
  };
}

export function processMultiROIFusionMethod(
  samples: RGBSample[],
  sampleRate: number,
  chromResult: MethodResult,
  posResult: MethodResult,
): MethodResult {
  /*
   * These parameters are intentionally accepted because the public API
   * already passes the CHROM/POS results. The adaptive ROI method does not
   * blindly copy their BPM values.
   */
  void chromResult;
  void posResult;

  const n = samples.length;

  if (n < Math.max(30, sampleRate * 4)) {
    return emptyMethodResult("Insufficient samples for Multi-ROI analysis");
  }

  const actualRate = effectiveSampleRate(samples, sampleRate);

  const roiResults = [
    analyzeROI(samples, actualRate, "forehead"),
    analyzeROI(samples, actualRate, "leftCheek"),
    analyzeROI(samples, actualRate, "rightCheek"),
  ];

  /*
   * Quality-weighted waveform fusion.
   *
   * No fixed 50/25/25 ROI weights are used. Every ROI gets its measured
   * quality weight and is normalized before fusion so raw skin brightness
   * cannot dominate the result.
   */
  const weights = roiResults.map((roi) => Math.max(0, roi.quality));

  const totalWeight = weights.reduce((a, b) => a + b, 0);

  if (totalWeight <= 0) {
    return emptyMethodResult(
      "No Multi-ROI region passed signal-quality checks",
    );
  }

  const weightedWaveform = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
    let numerator = 0;
    let denominator = 0;

    for (let r = 0; r < roiResults.length; r++) {
      const roi = roiResults[r];

      if (
        roi.waveform.length === n &&
        Number.isFinite(roi.waveform[i]) &&
        weights[r] > 0
      ) {
        numerator += roi.waveform[i] * weights[r];
        denominator += weights[r];
      }
    }

    weightedWaveform[i] = denominator > 0 ? numerator / denominator : 0;
  }

  /*
   * Final Multi-ROI cardiac filtering.
   */
  const detrended = detrend(
    weightedWaveform,
    Math.max(5, Math.round(actualRate * 0.8)),
  );

  const filtered = bandpassFilter(
    detrended,
    actualRate,
    CARDIAC_LOW,
    CARDIAC_HIGH,
  );

  return finalizeMethod(
    filtered,
    actualRate,
    "Adaptive Multi-ROI fusion using measured forehead and cheek pulse quality",
  );
}

/* -------------------------------------------------------------------------- */
/* Cross-method consensus                                                      */
/* -------------------------------------------------------------------------- */

export function evaluateMethodComparison(results: {
  g: MethodResult;
  chrom: MethodResult;
  pos: MethodResult;
  vitallens: MethodResult;
}): MethodComparison {
  const methodResults = [
    results.g,
    results.chrom,
    results.pos,
    results.vitallens,
  ];

  const validResults = methodResults.filter(
    (result) =>
      Number.isFinite(result.bpm) &&
      result.bpm >= MIN_BPM &&
      result.bpm <= MAX_BPM,
  );

  const bpms = validResults.map((r) => r.bpm);

  /*
   * No valid method means no physiological estimate.
   */
  if (!bpms.length) {
    return {
      g: 0,
      chrom: 0,
      pos: 0,
      vitalLens: 0,
      consensusBpm: 0,
      stdDev: 0,
      algorithmRange: 0,
      minBpm: 0,
      maxBpm: 0,
      agreementStatus: "LOW",
    };
  }

  const minBpm = Math.min(...bpms);
  const maxBpm = Math.max(...bpms);
  const algorithmRange = maxBpm - minBpm;
  const stdDev = Number(standardDeviation(bpms).toFixed(1));

  /*
   * Build a weighted consensus around the densest cluster rather than using
   * the median as a substitute for evidence.
   *
   * A method gets:
   *   - its measured confidence
   *   - measured SNR quality
   *   - peak consistency
   *   - temporal stability
   *   - proximity to the strongest cluster
   */
  const clusterRadius = 8;

  let bestClusterWeight = -Infinity;
  let bestClusterCenter = median(bpms);

  for (const candidate of bpms) {
    let clusterWeight = 0;

    for (const result of validResults) {
      const distance = Math.abs(result.bpm - candidate);

      if (distance <= clusterRadius) {
        const snrQuality = clamp((result.snrDb + 3) / 12, 0, 1);

        const quality =
          0.4 * result.confidence +
          0.25 * snrQuality +
          0.2 * (result.peakConsistency / 100) +
          0.15 * (result.temporalStability / 100);

        clusterWeight += Math.max(0.01, quality);
      }
    }

    if (clusterWeight > bestClusterWeight) {
      bestClusterWeight = clusterWeight;
      bestClusterCenter = candidate;
    }
  }

  const clusterMembers = validResults.filter(
    (result) => Math.abs(result.bpm - bestClusterCenter) <= clusterRadius,
  );

  let weightedNumerator = 0;
  let weightedDenominator = 0;

  for (const result of clusterMembers) {
    const snrQuality = clamp((result.snrDb + 3) / 12, 0, 1);

    const baseWeight =
      0.4 * result.confidence +
      0.25 * snrQuality +
      0.2 * (result.peakConsistency / 100) +
      0.15 * (result.temporalStability / 100);

    const distancePenalty =
      1 / (1 + Math.abs(result.bpm - bestClusterCenter) / 4);

    const weight = Math.max(0.01, baseWeight) * distancePenalty;

    weightedNumerator += result.bpm * weight;

    weightedDenominator += weight;
  }

  const weightedBpm =
    weightedDenominator > 0
      ? weightedNumerator / weightedDenominator
      : bestClusterCenter;

  /*
   * Require at least two agreeing valid methods before declaring a strong
   * cross-method consensus. A single method can still provide a provisional
   * estimate, but it must not be represented as high agreement.
   */
  const agreementStatus: MethodComparison["agreementStatus"] =
    bpms.length >= 3 &&
    clusterMembers.length >= 3 &&
    algorithmRange <= 12 &&
    stdDev <= 4
      ? "HIGH"
      : clusterMembers.length >= 2 && algorithmRange <= 20 && stdDev <= 8
        ? "MODERATE"
        : "LOW";

  /*
   * Severe disagreement is not resolved by taking the median.
   * In that case consensusBpm is zero, forcing the validation layer to reject
   * the measurement rather than hide the disagreement.
   */
  const reliableCluster =
    clusterMembers.length >= 2 &&
    (clusterMembers.length >= 3
      ? algorithmRange <= 20 && stdDev <= 8
      : algorithmRange <= 12);

  const consensusBpm =
    reliableCluster &&
    Number.isFinite(weightedBpm) &&
    weightedBpm >= MIN_BPM &&
    weightedBpm <= MAX_BPM
      ? Math.round(weightedBpm)
      : 0;

  return {
    g: results.g.bpm,
    chrom: results.chrom.bpm,
    pos: results.pos.bpm,
    vitalLens: results.vitallens.bpm,
    consensusBpm,
    stdDev,
    algorithmRange,
    minBpm,
    maxBpm,
    agreementStatus,
  };
}

/* -------------------------------------------------------------------------- */
/* Multi-ROI quality                                                           */
/* -------------------------------------------------------------------------- */

export function evaluateROIQuality(samples: RGBSample[]): ROIQualityBreakdown {
  const n = samples.length;

  if (!n) {
    return {
      forehead: 0,
      leftCheek: 0,
      rightCheek: 0,
      overall: 0,
      selectedROIs: [],
    };
  }

  const sampleRate = effectiveSampleRate(samples, 30);

  const roiResults = [
    analyzeROI(samples, sampleRate, "forehead"),
    analyzeROI(samples, sampleRate, "leftCheek"),
    analyzeROI(samples, sampleRate, "rightCheek"),
  ];

  const forehead = roiResults[0].quality;
  const leftCheek = roiResults[1].quality;
  const rightCheek = roiResults[2].quality;

  /*
   * Require a real quality score before selecting an ROI. There is no
   * unconditional "forehead fallback" with a fabricated quality value.
   */
  const selectedROIs: string[] = [];

  if (forehead >= 50) selectedROIs.push("Forehead");
  if (leftCheek >= 50) selectedROIs.push("Left Cheek");
  if (rightCheek >= 50) selectedROIs.push("Right Cheek");

  /*
   * Overall ROI quality is an unbiased summary of the measured ROI qualities.
   *
   * IMPORTANT:
   * There is NO fixed 44% forehead / 28% cheek weighting here.
   * The actual Multi-ROI waveform fusion below uses each ROI's measured
   * quality as its dynamic weight.
   */
  const roiScores = [
    Math.max(0, forehead),
    Math.max(0, leftCheek),
    Math.max(0, rightCheek),
  ];

  const overall =
    roiScores.length > 0
      ? Math.round(
          roiScores.reduce((sum, score) => sum + score, 0) / roiScores.length,
        )
      : 0;

  return {
    forehead,
    leftCheek,
    rightCheek,
    overall,
    selectedROIs,
  };
}

/**
 * Calculate dynamic Multi-ROI weights from measured ROI quality.
 *
 * The returned percentages always sum to 100 when at least one ROI has
 * positive quality. No fixed forehead/cheek weighting is used.
 */
export function calculateAdaptiveROIWeights(roiQuality: ROIQualityBreakdown): {
  forehead: number;
  leftCheek: number;
  rightCheek: number;
} {
  const raw = {
    forehead: Math.max(0, roiQuality.forehead),
    leftCheek: Math.max(0, roiQuality.leftCheek),
    rightCheek: Math.max(0, roiQuality.rightCheek),
  };

  const total = raw.forehead + raw.leftCheek + raw.rightCheek;

  if (total <= 0) {
    return {
      forehead: 0,
      leftCheek: 0,
      rightCheek: 0,
    };
  }

  return {
    forehead: Number(((raw.forehead / total) * 100).toFixed(1)),
    leftCheek: Number(((raw.leftCheek / total) * 100).toFixed(1)),
    rightCheek: Number(((raw.rightCheek / total) * 100).toFixed(1)),
  };
}

/* -------------------------------------------------------------------------- */
/* Quality timeline                                                            */
/* -------------------------------------------------------------------------- */

export function generateQualityTimeline(
  samples: RGBSample[],
  sampleRate = 30,
  intervalSec = 5,
): QualityTimelineInterval[] {
  if (!samples.length) return [];

  const actualRate = effectiveSampleRate(samples, sampleRate);

  const intervalSamples = Math.max(1, Math.round(intervalSec * actualRate));

  const timeline: QualityTimelineInterval[] = [];

  let index = 1;

  for (let start = 0; start < samples.length; start += intervalSamples) {
    const end = Math.min(samples.length, start + intervalSamples);

    const chunk = samples.slice(start, end);

    if (!chunk.length) continue;

    const avgMotion = mean(chunk.map((s) => s.motionVariance));

    const avgIllumination = mean(chunk.map((s) => (s.r + s.g + s.b) / 3));

    const avgFaceConfidence = mean(chunk.map((s) => s.faceConfidence));

    /*
     * These are physical acquisition quality indicators, not BPM accuracy.
     */
    const motionScore = clamp(100 - avgMotion * 80, 0, 100);

    const lightingScore =
      avgIllumination < 40
        ? clamp((avgIllumination / 40) * 60, 0, 60)
        : avgIllumination > 230
          ? clamp(100 - (avgIllumination - 230) * 2, 0, 100)
          : 92;

    const faceScore = clamp(avgFaceConfidence * 100, 0, 100);

    const qualityScore = Math.round(
      0.4 * motionScore + 0.3 * lightingScore + 0.3 * faceScore,
    );

    let status: "GOOD" | "FAIR" | "POOR" = "GOOD";
    let note = "Optimal optical tracking";

    if (qualityScore < 55 || motionScore < 50) {
      status = "POOR";
      note =
        motionScore < 50
          ? "Excessive motion detected"
          : "Low acquisition quality";
    } else if (qualityScore < 75) {
      status = "FAIR";
      note = "Moderate optical stability";
    }

    timeline.push({
      intervalIndex: index++,
      startSec: Number((start / actualRate).toFixed(1)),
      endSec: Number((end / actualRate).toFixed(1)),
      status,
      qualityScore,
      motionScore: Math.round(motionScore),
      lightingScore: Math.round(lightingScore),
      note,
    });
  }

  return timeline;
}

/* -------------------------------------------------------------------------- */
/* Signal quality / decision engine                                            */
/* -------------------------------------------------------------------------- */

export function evaluateSignalQuality(
  samples: RGBSample[],
  comparison: MethodComparison,
  results: {
    g: MethodResult;
    chrom: MethodResult;
    pos: MethodResult;
    vitallens: MethodResult;
  },
  sampleRate = 30,
): SignalQuality {
  const warnings: string[] = [];
  const retryReasons: string[] = [];

  if (!samples.length) {
    return {
      overall: 0,
      confidenceTier: "LOW",
      decision: "RETRY",
      decisionReason: "No camera samples were available.",
      faceConfidence: 0,
      roiStability: 0,
      roiQuality: {
        forehead: 0,
        leftCheek: 0,
        rightCheek: 0,
        overall: 0,
        selectedROIs: [],
      },
      illumination: 0,
      lightingQuality: 0,
      motionStability: 0,
      motionQuality: 0,
      waveformSNR: -20,
      snrScore: 0,
      temporalStability: 0,
      temporalStabilityStatus: "UNSTABLE",
      algorithmAgreement: 0,
      algorithmRange: 0,
      isReliable: false,
      warnings: ["No camera samples were available."],
      retryReasons: ["Insufficient signal data"],
      qualityTimeline: [],
      windowAnalysis: [],
    };
  }

  const actualRate = effectiveSampleRate(samples, sampleRate);

  /* 1. Face tracking */
  const avgFaceConf = mean(samples.map((s) => s.faceConfidence));

  const faceScore = Math.round(clamp(avgFaceConf * 100, 0, 100));

  if (faceScore < 70) {
    warnings.push(
      "Face tracking was intermittent. Position yourself centrally in frame.",
    );
  }

  if (faceScore < 55) {
    retryReasons.push("Unstable face tracking");
  }

  /* 2. Motion */
  const avgMotion = mean(samples.map((s) => s.motionVariance));

  const motionScore = Math.round(clamp(100 - avgMotion * 80, 0, 100));

  if (motionScore < 58) {
    warnings.push("Significant head movement detected during scanning.");
    retryReasons.push("Excessive movement during scan");
  }

  /* 3. Lighting */
  const avgBrightness = mean(samples.map((s) => (s.r + s.g + s.b) / 3));

  let illuminationScore = 92;

  if (avgBrightness < 45) {
    illuminationScore = Math.round(clamp((avgBrightness / 45) * 60, 0, 60));

    warnings.push("Low ambient lighting. Please face a diffuse light source.");

    if (avgBrightness < 30) {
      retryReasons.push("Insufficient ambient light");
    }
  } else if (avgBrightness > 225) {
    illuminationScore = Math.round(
      clamp(100 - (avgBrightness - 225) * 2, 40, 100),
    );

    warnings.push("Facial glare / camera overexposure detected.");

    if (avgBrightness > 245) {
      retryReasons.push("Severe overexposure");
    }
  }

  /* 4. SNR */
  const validSnrs = [
    results.g.snrDb,
    results.chrom.snrDb,
    results.pos.snrDb,
    results.vitallens.snrDb,
  ].filter(Number.isFinite);

  const avgSnrDb = validSnrs.length ? mean(validSnrs) : -20;

  /*
   * Negative SNR is genuinely poor. No offsets are added.
   */
  const snrScore = Math.round(clamp(((avgSnrDb + 3) / 12) * 100, 0, 100));

  if (avgSnrDb < 2) {
    warnings.push("Extracted pulse signal-to-noise ratio is weak.");
    retryReasons.push("Weak optical pulse signal");
  }

  /* 5. Algorithm agreement */
  let methodAgreement = 0;

  if (comparison.agreementStatus === "HIGH") {
    methodAgreement = 90;
  } else if (comparison.agreementStatus === "MODERATE") {
    methodAgreement = 65;
  } else {
    methodAgreement = 20;
    warnings.push(
      `Severe cross-method disagreement detected (Spread: ${comparison.algorithmRange} BPM).`,
    );
    retryReasons.push("Severe cross-method disagreement");
  }

  /* 6. ROI quality */
  const roiQuality = evaluateROIQuality(samples);

  if (roiQuality.overall < 55) {
    warnings.push("Suboptimal vascular ROI signal quality.");
    retryReasons.push("Poor forehead/cheek optical signal");
  }

  /* 7. Temporal analysis */
  const primaryCandidates = [
    results.g,
    results.chrom,
    results.pos,
    results.vitallens,
  ]
    .filter((r) => r.waveform.length > 0 && Number.isFinite(r.snrDb))
    .sort((a, b) => b.snrDb - a.snrDb);

  const primaryWaveform = primaryCandidates[0]?.waveform ?? [];

  const windowAnalysis = primaryWaveform.length
    ? computeSlidingWindowRPPG(primaryWaveform, actualRate, 10, 5)
    : [];

  const temporal = computeTemporalStability(windowAnalysis);

  if (temporal.status === "UNSTABLE") {
    warnings.push(
      "Temporal instability: heart-rate estimates fluctuated across recording windows.",
    );
    retryReasons.push("Temporal waveform instability");
  }

  /*
   * 8. Final quality score.
   *
   * Algorithm agreement and temporal stability have significant weight,
   * because a large spectral peak alone is not proof of a cardiac signal.
   */
  const overall = Math.round(
    clamp(
      0.2 * methodAgreement +
        0.2 * temporal.score +
        0.15 * snrScore +
        0.15 * motionScore +
        0.1 * illuminationScore +
        0.1 * roiQuality.overall +
        0.1 * faceScore,
      0,
      100,
    ),
  );

  /*
   * Confidence tier.
   *
   * Strong agreement alone is insufficient. A measurement must also have
   * adequate signal and temporal stability.
   */
  let confidenceTier: ConfidenceTier = "HIGH";

  if (
    overall < 60 ||
    comparison.agreementStatus === "LOW" ||
    avgSnrDb < 0 ||
    temporal.status === "UNSTABLE" ||
    motionScore < 50 ||
    faceScore < 55
  ) {
    confidenceTier = "LOW";
  } else if (
    overall < 76 ||
    comparison.agreementStatus === "MODERATE" ||
    avgSnrDb < 4 ||
    temporal.status === "MODERATE"
  ) {
    confidenceTier = "MEDIUM";
  }

  /*
   * Acceptance gate.
   *
   * A BPM should only be accepted if:
   *   - consensus exists
   *   - at least two methods support it
   *   - signal SNR is not poor
   *   - temporal signal is not unstable
   *   - acquisition is usable
   *
   * This deliberately favors "RETRY" over a fabricated precise number.
   */
  const validMethodCount = [
    results.g,
    results.chrom,
    results.pos,
    results.vitallens,
  ].filter((r) => r.bpm >= MIN_BPM && r.bpm <= MAX_BPM).length;

  const consensusAvailable =
    comparison.consensusBpm >= MIN_BPM && comparison.consensusBpm <= MAX_BPM;

  let decision: DecisionOutcome = "ACCEPT";

  let decisionReason =
    "Strong multi-method agreement, adequate signal quality, and stable temporal waveform passed the measurement gates.";

  if (
    !consensusAvailable ||
    validMethodCount < 2 ||
    confidenceTier === "LOW" ||
    avgSnrDb < 0 ||
    temporal.status === "UNSTABLE"
  ) {
    decision = "RETRY";

    if (!retryReasons.length) {
      retryReasons.push(
        "Insufficient independent evidence for a reliable BPM estimate",
      );
    }

    decisionReason = `The rPPG measurement did not pass the reliability gates: ${retryReasons.join("; ")}. A repeat scan is recommended.`;
  } else if (confidenceTier === "MEDIUM") {
    decision = "CAUTION";

    decisionReason =
      "The signal produced a usable estimate, but some quality indicators remain moderate. Repeat the scan for a stronger measurement.";
  }

  const isReliable = decision === "ACCEPT";

  const qualityTimeline = generateQualityTimeline(samples, actualRate, 5);

  return {
    overall,
    confidenceTier,
    decision,
    decisionReason,
    faceConfidence: faceScore,
    roiStability: roiQuality.overall,
    roiQuality,
    illumination: illuminationScore,
    lightingQuality: illuminationScore,
    motionStability: motionScore,
    motionQuality: motionScore,
    waveformSNR: Number(avgSnrDb.toFixed(1)),
    snrScore,
    temporalStability: temporal.score,
    temporalStabilityStatus: temporal.status,
    algorithmAgreement: methodAgreement,
    algorithmRange: comparison.algorithmRange,
    isReliable,
    warnings,
    retryReasons,
    qualityTimeline,
    windowAnalysis,
  };
}

/* -------------------------------------------------------------------------- */
/* Cardiovascular screening                                                    */
/* -------------------------------------------------------------------------- */

export function determineCardiovascularRisk(
  bpm: number,
  rmssd: number,
  rr: number,
  quality: SignalQuality,
): { riskLevel: RiskLevel; riskScore: number } {
  /*
   * A rejected optical measurement must not be turned into a physiological
   * risk conclusion.
   */
  if (quality.decision === "RETRY" || !quality.isReliable) {
    return {
      riskLevel: "lower",
      riskScore: 0,
    };
  }

  let score = 20;

  /*
   * This remains a screening/triage heuristic, not a diagnosis.
   */
  if (bpm > 100) {
    score += 30;
  } else if (bpm > 85) {
    score += 15;
  } else if (bpm < 50) {
    score += 15;
  }

  if (rmssd < 20) {
    score += 30;
  } else if (rmssd < 30) {
    score += 15;
  }

  if (rr > 22 || rr < 10) {
    score += 15;
  }

  let riskLevel: RiskLevel = "lower";

  if (score >= 60) {
    riskLevel = "higher";
  } else if (score >= 38) {
    riskLevel = "moderate";
  }

  return {
    riskLevel,
    riskScore: Math.min(95, score),
  };
}
