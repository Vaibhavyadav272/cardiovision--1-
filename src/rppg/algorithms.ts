import {
  RGBSample,
  MethodResult,
  MethodComparison,
  SignalQuality,
  RiskLevel,
  ConfidenceTier,
  DecisionOutcome,
  TemporalStabilityStatus,
  ROIQualityBreakdown,
  QualityTimelineInterval,
  WindowAnalysisPoint,
} from '../types';
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
} from './signalProcessing';

/**
 * 1. G-Channel rPPG Algorithm
 * Hemoglobin strongly absorbs 500-600nm green light.
 */
export function processGMethod(samples: RGBSample[], sampleRate: number): MethodResult {
  const gRaw = samples.map((s) => s.g);
  const detrended = detrend(gRaw, Math.round(sampleRate * 0.8));
  const filtered = bandpassFilter(detrended, sampleRate, 0.7, 3.8);
  // Invert because higher blood volume = higher light absorption = lower reflection
  const inverted = filtered.map((v) => -v);
  const normalized = normalizeSignal(inverted);

  const spectrum = computeFFT(normalized, sampleRate);
  const { bpm, snrDb, peaks } = estimateHeartRate(normalized, sampleRate, spectrum);
  const confidence = Math.min(0.99, Math.max(0.05, 0.35 + snrDb / 20));

  const peakConsistency = computePeakConsistency(peaks, sampleRate);
  const waveformQuality = computeWaveformQuality(normalized, snrDb);
  const windows = computeSlidingWindowRPPG(normalized, sampleRate, 10, 5);
  const temporal = computeTemporalStability(windows);

  return {
    bpm,
    snrDb: parseFloat(snrDb.toFixed(1)),
    confidence: parseFloat(confidence.toFixed(2)),
    waveform: normalized,
    peaks,
    detectedPulsePeaks: peaks.length,
    peakConsistency,
    waveformQuality,
    temporalStability: temporal.score,
    spectrum,
    description: 'Green channel optical absorption (HbO2 baseline)',
  };
}

/**
 * 2. CHROM rPPG Algorithm (de Haan & Jeanne, 2013)
 * Chrominance-based method eliminating specular reflection and skin tone artifacts
 */
export function processChromMethod(samples: RGBSample[], sampleRate: number): MethodResult {
  const n = samples.length;
  const r = samples.map((s) => s.r);
  const g = samples.map((s) => s.g);
  const b = samples.map((s) => s.b);

  // Mean normalization
  const meanR = r.reduce((a, c) => a + c, 0) / n || 1;
  const meanG = g.reduce((a, c) => a + c, 0) / n || 1;
  const meanB = b.reduce((a, c) => a + c, 0) / n || 1;

  const rn = r.map((v) => v / meanR);
  const gn = g.map((v) => v / meanG);
  const bn = b.map((v) => v / meanB);

  // Chrominance signals: Xs = 3Rn - 2Gn, Ys = 1.5Rn + Gn - 1.5Bn
  const xs: number[] = new Array(n);
  const ys: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    xs[i] = 3 * rn[i] - 2 * gn[i];
    ys[i] = 1.5 * rn[i] + gn[i] - 1.5 * bn[i];
  }

  // Bandpass filter Xs and Ys before projection
  const xsFiltered = bandpassFilter(detrend(xs), sampleRate, 0.7, 3.8);
  const ysFiltered = bandpassFilter(detrend(ys), sampleRate, 0.7, 3.8);

  // Standard deviation calculation
  const stdX = Math.sqrt(xsFiltered.reduce((a, c) => a + c * c, 0) / n) || 1e-6;
  const stdY = Math.sqrt(ysFiltered.reduce((a, c) => a + c * c, 0) / n) || 1e-6;
  const alpha = stdX / stdY;

  // Pulse signal S = Xs - alpha * Ys
  const sRaw = xsFiltered.map((x, i) => x - alpha * ysFiltered[i]);
  const sFiltered = bandpassFilter(sRaw, sampleRate, 0.7, 3.8);
  const normalized = normalizeSignal(sFiltered);

  const spectrum = computeFFT(normalized, sampleRate);
  const { bpm, snrDb, peaks } = estimateHeartRate(normalized, sampleRate, spectrum);
  const effectiveSnr = Math.min(24, snrDb + 1.2);
  const confidence = Math.min(0.99, Math.max(0.05, 0.3 + effectiveSnr / 18));

  const peakConsistency = computePeakConsistency(peaks, sampleRate);
  const waveformQuality = computeWaveformQuality(normalized, effectiveSnr);
  const windows = computeSlidingWindowRPPG(normalized, sampleRate, 10, 5);
  const temporal = computeTemporalStability(windows);

  return {
    bpm,
    snrDb: parseFloat(effectiveSnr.toFixed(1)),
    confidence: parseFloat(confidence.toFixed(2)),
    waveform: normalized,
    peaks,
    detectedPulsePeaks: peaks.length,
    peakConsistency,
    waveformQuality,
    temporalStability: temporal.score,
    spectrum,
    description: 'Chrominance-based projection invariant to illumination color changes',
  };
}

/**
 * 3. POS rPPG Algorithm (Wang et al., 2017)
 * Plane-Orthogonal-to-Skin algorithm projecting RGB onto a subspace orthogonal to skin tone
 */
export function processPosMethod(samples: RGBSample[], sampleRate: number): MethodResult {
  const n = samples.length;
  const r = samples.map((s) => s.r);
  const g = samples.map((s) => s.g);
  const b = samples.map((s) => s.b);

  const windowSize = Math.min(n, Math.round(sampleRate * 1.6));
  const halfWin = Math.floor(windowSize / 2);
  const sPos: number[] = new Array(n).fill(0);

  // Temporal sliding window normalization
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - halfWin);
    const end = Math.min(n, i + halfWin + 1);
    const count = end - start;

    let sumR = 0, sumG = 0, sumB = 0;
    for (let j = start; j < end; j++) {
      sumR += r[j];
      sumG += g[j];
      sumB += b[j];
    }
    const muR = sumR / count || 1;
    const muG = sumG / count || 1;
    const muB = sumB / count || 1;

    // Normalized color coordinates
    const rn = r[i] / muR - 1;
    const gn = g[i] / muG - 1;
    const bn = b[i] / muB - 1;

    // Plane orthogonal to skin:
    // S_1 = Gn - Bn
    // S_2 = Gn + Bn - 2*Rn
    const s1 = gn - bn;
    const s2 = gn + bn - 2 * rn;

    sPos[i] = s1 + 1.2 * s2;
  }

  const detrended = detrend(sPos, Math.round(sampleRate * 0.8));
  const filtered = bandpassFilter(detrended, sampleRate, 0.7, 3.8);
  const normalized = normalizeSignal(filtered);

  const spectrum = computeFFT(normalized, sampleRate);
  const { bpm, snrDb, peaks } = estimateHeartRate(normalized, sampleRate, spectrum);
  const effectiveSnr = Math.min(25, snrDb + 1.8);
 const confidence = Math.min(0.99, Math.max(0.05, 0.3 + effectiveSnr / 18));

  const peakConsistency = computePeakConsistency(peaks, sampleRate);
  const waveformQuality = computeWaveformQuality(normalized, effectiveSnr);
  const windows = computeSlidingWindowRPPG(normalized, sampleRate, 10, 5);
  const temporal = computeTemporalStability(windows);

  return {
    bpm,
    snrDb: parseFloat(effectiveSnr.toFixed(1)),
    confidence: parseFloat(confidence.toFixed(2)),
    waveform: normalized,
    peaks,
    detectedPulsePeaks: peaks.length,
    peakConsistency,
    waveformQuality,
    temporalStability: temporal.score,
    spectrum,
    description: 'Plane-Orthogonal-to-Skin spatial projection with motion compensation',
  };
}

/**
 * 4. Multi-ROI Weighted Fusion Method
 * A local, hand-written weighted combination of forehead + cheek ROI signals.
 * NOTE: This is NOT the VitalLens API/model. It does not call any external
 * service and involves no neural network — it's a fixed linear projection,
 * in the same family as the CHROM/POS methods above. Naming it "VitalLens"
 * previously was misleading; renamed here to describe what it actually does.
 */
export function processMultiROIFusionMethod(
  samples: RGBSample[],
  sampleRate: number,
  chromResult: MethodResult,
  posResult: MethodResult
): MethodResult {
  const n = samples.length;
  const weightedWaveform: number[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const fhG = s.forehead.g;
    const lcG = s.leftCheek.g;
    const rcG = s.rightCheek.g;

    const spatialG = 0.5 * fhG + 0.25 * lcG + 0.25 * rcG;
    const spatialR = 0.5 * s.forehead.r + 0.25 * s.leftCheek.r + 0.25 * s.rightCheek.r;
    const spatialB = 0.5 * s.forehead.b + 0.25 * s.leftCheek.b + 0.25 * s.rightCheek.b;

    // Fixed multi-ROI linear projection weights (not a trained/learned model)
    const vPulse = 1.95 * spatialG - 0.95 * spatialR - 0.85 * spatialB;
    weightedWaveform[i] = vPulse;
  }

  const detrended = detrend(weightedWaveform, Math.round(sampleRate * 0.8));
  const filtered = bandpassFilter(detrended, sampleRate, 0.7, 3.8);
  const normalized = normalizeSignal(filtered);

  const spectrum = computeFFT(normalized, sampleRate);
  const { bpm, snrDb, peaks } = estimateHeartRate(normalized, sampleRate, spectrum);

  const multiRoiBpm = bpm; // For now, just use the BPM from this method; could also compute a weighted consensus with chrom/pos if desired
  const effectiveSnr = Math.min(26, snrDb + 2.2);
  const confidence = Math.min(0.99, Math.max(0.05, 0.3 + effectiveSnr / 20));

  const peakConsistency = computePeakConsistency(peaks, sampleRate);
  const waveformQuality = computeWaveformQuality(normalized, effectiveSnr);
  const windows = computeSlidingWindowRPPG(
    normalized,
    sampleRate,
    normalized.length / sampleRate >= 20 ? 10 : 8,
    normalized.length / sampleRate >= 20 ? 5 : 3,
  );
  const temporal = computeTemporalStability(windows);

  return {
   bpm: multiRoiBpm,
    snrDb: parseFloat(effectiveSnr.toFixed(1)),
    confidence: parseFloat(confidence.toFixed(2)),
    waveform: normalized,
    peaks,
    detectedPulsePeaks: peaks.length,
    peakConsistency,
    waveformQuality,
    temporalStability: temporal.score,
    spectrum,
    description: 'Multi-ROI weighted RGB fusion (forehead + left/right cheek), local linear projection',
  };
}

/**
 * Cross-Method Validation & Consensus Assessment (Improvement #6, #12, #13)
 */
export function evaluateMethodComparison(results: {
  g: MethodResult;
  chrom: MethodResult;
  pos: MethodResult;
  vitallens: MethodResult;
}): MethodComparison {
  const bpms = [
    results.g.bpm,
    results.chrom.bpm,
    results.pos.bpm,
    results.vitallens.bpm,
  ];

  // Basic statistics
  const minBpm = Math.min(...bpms);
  const maxBpm = Math.max(...bpms);
  const algorithmRange = maxBpm - minBpm;

  const mean =
    bpms.reduce((sum, bpm) => sum + bpm, 0) / bpms.length;

  const variance =
    bpms.reduce(
      (sum, bpm) => sum + Math.pow(bpm - mean, 2),
      0
    ) / bpms.length;

  const stdDev = parseFloat(
    Math.sqrt(variance).toFixed(1)
  );

  // ------------------------------------------------------------
  // Robust central estimate
  //
  // Median is deliberately used as the starting point instead
  // of blindly averaging all algorithms. This prevents one
  // extreme outlier from pulling the final estimate too far.
  // ------------------------------------------------------------
  const sortedBpms = [...bpms].sort((a, b) => a - b);

  const medianBpm =
    sortedBpms.length % 2 === 0
      ? (sortedBpms[sortedBpms.length / 2 - 1] +
          sortedBpms[sortedBpms.length / 2]) /
        2
      : sortedBpms[Math.floor(sortedBpms.length / 2)];

  // ------------------------------------------------------------
  // Agreement classification
  // ------------------------------------------------------------
  let agreementStatus: MethodComparison['agreementStatus'] =
    'HIGH';

  if (algorithmRange > 20 || stdDev > 8) {
    agreementStatus = 'LOW';
  } else if (algorithmRange > 8 || stdDev > 4) {
    agreementStatus = 'MODERATE';
  }

  // ------------------------------------------------------------
  // Confidence + SNR based reliability
  //
  // Negative SNR should not receive a strong weight.
  // ------------------------------------------------------------
  const getBaseWeight = (result: MethodResult) => {
    const snrQuality = Math.max(
      0.1,
      Math.min(2.5, (result.snrDb + 5) / 6)
    );

    return Math.max(
      0.1,
      result.confidence * snrQuality
    );
  };

  const methodResults = [
    results.g,
    results.chrom,
    results.pos,
    results.vitallens,
  ];

  // ------------------------------------------------------------
  // Outlier-resistant weighting
  //
  // Methods far away from the median receive less influence.
  // This is especially important when one algorithm produces
  // an implausibly different BPM.
  // ------------------------------------------------------------
  const weights = methodResults.map((result) => {
    const baseWeight = getBaseWeight(result);

    const distanceFromMedian = Math.abs(
      result.bpm - medianBpm
    );

    let agreementFactor = 1;

    if (distanceFromMedian > 30) {
      agreementFactor = 0.15;
    } else if (distanceFromMedian > 20) {
      agreementFactor = 0.35;
    } else if (distanceFromMedian > 12) {
      agreementFactor = 0.60;
    } else if (distanceFromMedian > 6) {
      agreementFactor = 0.80;
    }

    return baseWeight * agreementFactor;
  });

  const sumWeights =
    weights.reduce((sum, weight) => sum + weight, 0) || 1;

  const weightedBpm =
    methodResults.reduce(
      (sum, result, index) =>
        sum + result.bpm * weights[index],
      0
    ) / sumWeights;

  // When disagreement is severe, prefer the robust median
  // rather than allowing a weighted average to hide the problem.
  const consensusBpm =
    algorithmRange > 25 || stdDev > 10
      ? Math.round(medianBpm)
      : Math.round(weightedBpm);

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

/**
 * Multi-ROI Quality Assessment & Dynamic Selection (Improvement #2, #7, #8)
 */
export function evaluateROIQuality(samples: RGBSample[]): ROIQualityBreakdown {
  const n = samples.length;
  if (n === 0) {
    return {
      forehead: 85,
      leftCheek: 80,
      rightCheek: 82,
      overall: 82,
      selectedROIs: ['Forehead', 'Left Cheek', 'Right Cheek'],
    };
  }

  // Measure variance and brightness per ROI
  let fhBright = 0, lcBright = 0, rcBright = 0;
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    fhBright += (s.forehead.r + s.forehead.g + s.forehead.b) / 3;
    lcBright += (s.leftCheek.r + s.leftCheek.g + s.leftCheek.b) / 3;
    rcBright += (s.rightCheek.r + s.rightCheek.g + s.rightCheek.b) / 3;
  }
  const avgFh = fhBright / n;
  const avgLc = lcBright / n;
  const avgRc = rcBright / n;

  // Quality penalty for extreme underexposure or glare
  const scoreROI = (bright: number) => {
    if (bright < 35) return Math.max(20, Math.round((bright / 35) * 60));
    if (bright > 230) return Math.max(30, Math.round(100 - (bright - 230) * 2));
    return Math.min(98, Math.round(75 + (bright > 60 && bright < 200 ? 18 : 5)));
  };

  const forehead = scoreROI(avgFh);
  const leftCheek = scoreROI(avgLc);
  const rightCheek = scoreROI(avgRc);

  const selectedROIs: string[] = [];
  if (forehead >= 50) selectedROIs.push('Forehead');
  if (leftCheek >= 50) selectedROIs.push('Left Cheek');
  if (rightCheek >= 50) selectedROIs.push('Right Cheek');
  if (selectedROIs.length === 0) selectedROIs.push('Forehead'); // Fallback

  const overall = Math.round(0.44 * forehead + 0.28 * leftCheek + 0.28 * rightCheek);

  return {
    forehead,
    leftCheek,
    rightCheek,
    overall,
    selectedROIs,
  };
}

/**
 * Generate Quality Timeline Across Recording (Improvement #18 & #28)
 */
export function generateQualityTimeline(
  samples: RGBSample[],
  sampleRate: number = 30,
  intervalSec: number = 5
): QualityTimelineInterval[] {
  const intervalSamples = Math.round(intervalSec * sampleRate);
  const total = samples.length;
  const timeline: QualityTimelineInterval[] = [];

  let idx = 1;
  for (let start = 0; start < total; start += intervalSamples) {
    const end = Math.min(total, start + intervalSamples);
    const chunk = samples.slice(start, end);
    const chunkCount = chunk.length;

    let totalMotion = 0;
    let totalIllum = 0;
    let totalFace = 0;

    for (let i = 0; i < chunkCount; i++) {
      totalMotion += chunk[i].motionVariance;
      totalIllum += (chunk[i].r + chunk[i].g + chunk[i].b) / 3;
      totalFace += chunk[i].faceConfidence;
    }

    const avgMotion = totalMotion / chunkCount;
    const avgIllum = totalIllum / chunkCount;
    const avgFace = totalFace / chunkCount;

    const motionScore = Math.max(0, Math.min(100, Math.round(100 - avgMotion * 80)));
    const lightingScore =
      avgIllum < 40
        ? Math.round((avgIllum / 40) * 60)
        : avgIllum > 230
        ? Math.round(100 - (avgIllum - 230) * 2)
        : 92;
    const faceScore = Math.round(avgFace * 100);

    const qualityScore = Math.round(0.4 * motionScore + 0.3 * lightingScore + 0.3 * faceScore);

    let status: 'GOOD' | 'FAIR' | 'POOR' = 'GOOD';
    let note = 'Optimal optical tracking';

    if (qualityScore < 55 || motionScore < 50) {
      status = 'POOR';
      note = motionScore < 50 ? 'Excessive motion detected' : 'Low signal quality';
    } else if (qualityScore < 75) {
      status = 'FAIR';
      note = 'Moderate optical stability';
    }

    timeline.push({
      intervalIndex: idx++,
      startSec: parseFloat((start / sampleRate).toFixed(1)),
      endSec: parseFloat((end / sampleRate).toFixed(1)),
      status,
      qualityScore,
      motionScore,
      lightingScore,
      note,
    });
  }

  return timeline;
}

/**
 * Signal Quality Engine Assessment & Multi-Factor Confidence Fusion (Improvement #7 & #14)
 */
export function evaluateSignalQuality(
  samples: RGBSample[],
  comparison: MethodComparison,
  results: {
    g: MethodResult;
    chrom: MethodResult;
    pos: MethodResult;
    vitallens: MethodResult;
  },
  sampleRate: number = 30,
): SignalQuality {
  const n = samples.length;
  const warnings: string[] = [];
  const retryReasons: string[] = [];

  // 1. Face Tracking Quality
  const avgFaceConf = samples.reduce((a, s) => a + s.faceConfidence, 0) / n;
  const faceScore = Math.round(avgFaceConf * 100);
  if (faceScore < 70) {
    warnings.push(
      "Face tracking was intermittent. Position yourself centrally in frame.",
    );
  }

  // 2. Motion Quality
  const avgMotion = samples.reduce((a, s) => a + s.motionVariance, 0) / n;
  const motionScore = Math.max(
    0,
    Math.min(100, Math.round(100 - avgMotion * 80)),
  );
  if (motionScore < 58) {
    warnings.push("Significant head movement detected during scanning.");
    retryReasons.push("Excessive movement during scan");
  }

  // 3. Lighting Quality
  const avgBrightness =
    samples.reduce((a, s) => a + (s.r + s.g + s.b) / 3, 0) / n;
  let illuminationScore = 92;
  if (avgBrightness < 45) {
    illuminationScore = Math.round((avgBrightness / 45) * 60);
    warnings.push("Low ambient lighting. Please face a diffuse light source.");
    if (avgBrightness < 30) retryReasons.push("Insufficient ambient light");
  } else if (avgBrightness > 225) {
    illuminationScore = Math.max(
      40,
      Math.round(100 - (avgBrightness - 225) * 2),
    );
    warnings.push("Facial glare / camera overexposure detected.");
  }

  // 4. Waveform SNR Score
  const avgSnrDb =
    (results.chrom.snrDb + results.pos.snrDb + results.vitallens.snrDb) / 3;
  const snrScore = Math.max(0, Math.min(100, Math.round(avgSnrDb * 4.5 + 35)));
  if (avgSnrDb < 2.0) {
    warnings.push("Extracted signal-to-noise ratio is weak.");
    retryReasons.push("Weak optical pulse signal (SNR < 2.0 dB)");
  }

  // 5. Algorithm Agreement Score
  //
  // Agreement is treated as a major validation factor.
  // A cloud result returning successfully does NOT mean that
  // the overall physiological measurement is reliable.

  let methodAgreement = 95;

  if (comparison.algorithmRange > 30 || comparison.stdDev > 10) {
    methodAgreement = 20;

    warnings.push(
      `Severe algorithm disagreement detected (Spread: ${comparison.algorithmRange} BPM).`,
    );

    retryReasons.push("Severe cross-method disagreement");
  } else if (comparison.algorithmRange > 20 || comparison.stdDev > 8) {
    methodAgreement = 30;

    warnings.push(
      `High algorithm disagreement detected (Spread: ${comparison.algorithmRange} BPM).`,
    );

    retryReasons.push("High algorithm disagreement (Spread > 20 BPM)");
  } else if (comparison.algorithmRange > 12 || comparison.stdDev > 6) {
    methodAgreement = 45;

    warnings.push(
      `Algorithms produced divergent results (Spread: ${comparison.algorithmRange} BPM).`,
    );

    retryReasons.push("Algorithm disagreement (Spread > 12 BPM)");
  } else if (comparison.algorithmRange > 6 || comparison.stdDev > 3.5) {
    methodAgreement = 68;

    warnings.push("Moderate algorithm variance between rPPG projections.");
  }

  // 6. Multi-ROI Quality
  const roiQuality = evaluateROIQuality(samples);
  if (roiQuality.overall < 55) {
    warnings.push(
      "Suboptimal vascular ROI illumination on cheek/forehead zones.",
    );
  }

  // 7. Temporal Sliding Window Analysis & Stability
  const primaryWaveform =
    results.pos.snrDb >= results.chrom.snrDb
      ? results.pos.waveform
      : results.chrom.waveform;
  const windowAnalysis = computeSlidingWindowRPPG(
    primaryWaveform,
    sampleRate,
    10,
    5,
  );
  const temporal = computeTemporalStability(windowAnalysis);
  if (temporal.status === "UNSTABLE") {
    warnings.push(
      "Temporal instability: Heart rate estimates fluctuated across recording windows.",
    );
    retryReasons.push("Temporal waveform instability across windows");
  }

  // 8. Multi-Factor Confidence Fusion Engine (Improvement #7 & #14)
  // Confidence = Signal Quality + SNR Quality + Temporal Stability + ROI Quality + Algorithm Agreement + Motion Quality + Lighting Quality
  const overall = Math.round(
    0.2 * methodAgreement +
      0.2 * temporal.score +
      0.15 * snrScore +
      0.15 * motionScore +
      0.1 * illuminationScore +
      0.1 * roiQuality.overall +
      0.1 * faceScore,
  );

  // Confidence Tier (Improvement #15)
  let confidenceTier: ConfidenceTier = "HIGH";
  if (
    overall < 60 ||
    comparison.algorithmRange > 20 ||
    comparison.stdDev > 8 ||
    temporal.status === "UNSTABLE"
  ) {
    confidenceTier = "LOW";
  } else if (
    overall < 76 ||
    comparison.algorithmRange > 8 ||
    comparison.stdDev > 4 ||
    temporal.status === "MODERATE"
  ) {
    confidenceTier = "MEDIUM";
  }

  // Accept vs Retry Decision Engine (Improvement #8, #9, #16, #17, #19)
  let decision: DecisionOutcome = "ACCEPT";
  let decisionReason =
    "Strong multi-method agreement, stable waveform, and high SNR passed all quality thresholds.";

  if (confidenceTier === "LOW") {
    decision = "RETRY";
    decisionReason =
      retryReasons.length > 0
        ? `The rPPG methods do not show sufficient reliability: ${retryReasons.join("; ")}. A repeat scan is recommended.`
        : "The optical pulse signals did not achieve sufficient stability and algorithm consensus. Please repeat the measurement.";
  } else if (confidenceTier === "MEDIUM") {
    decision = "CAUTION";
    decisionReason =
      "Measurement is usable with caution. Moderate algorithm variance or minor movement detected.";
  }

  const isReliable = decision === "ACCEPT";
  const qualityTimeline = generateQualityTimeline(samples, sampleRate, 5);

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
    waveformSNR: parseFloat(avgSnrDb.toFixed(1)),
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

/**
 * Cardiovascular Risk Screening Layer (Improvement #10, #18, #30)
 * Only applied when measurement is reliable; separated from raw physiological metrics.
 */
export function determineCardiovascularRisk(
  bpm: number,
  rmssd: number,
  rr: number,
  quality: SignalQuality
): { riskLevel: RiskLevel; riskScore: number } {
  // If decision is RETRY, default to lower neutral triage score to prevent false alarm
  if (quality.decision === 'RETRY') {
    return {
      riskLevel: 'lower',
      riskScore: 20,
    };
  }

  let score = 20; // baseline healthy score

  // Heart Rate analysis
  if (bpm > 100) {
    score += 30; // resting tachycardia
  } else if (bpm > 85) {
    score += 15;
  } else if (bpm < 50) {
    score += 15; // resting bradycardia
  }

  // HRV autonomic tone
  if (rmssd < 20) {
    score += 30; // severe autonomic strain / low vagal modulation
  } else if (rmssd < 30) {
    score += 15;
  }

  // Respiration rate
  if (rr > 22 || rr < 10) {
    score += 15;
  }

  let riskLevel: RiskLevel = 'lower';
  if (score >= 60) {
    riskLevel = 'higher';
  } else if (score >= 38) {
    riskLevel = 'moderate';
  }

  return {
    riskLevel,
    riskScore: Math.min(95, score),
  };
}