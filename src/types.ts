export type RPPGMethod = 'g' | 'chrom' | 'pos' | 'vitallens';

export type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW';
export type DecisionOutcome = 'ACCEPT' | 'CAUTION' | 'RETRY';
export type TemporalStabilityStatus = 'STABLE' | 'MODERATE' | 'UNSTABLE';

export interface RGBSample {
  timestamp: number;
  r: number;
  g: number;
  b: number;
  forehead: { r: number; g: number; b: number };
  leftCheek: { r: number; g: number; b: number };
  rightCheek: { r: number; g: number; b: number };
  motionVariance: number;
  faceConfidence: number;
}

export interface MethodResult {
  bpm: number;
  snrDb: number;
  confidence: number;
  waveform: number[];
  peaks: number[];
  detectedPulsePeaks: number;
  peakConsistency: number; // 0-100%
  waveformQuality: number; // 0-100%
  temporalStability: number; // 0-100%
  spectrum: { freq: number; power: number }[];
  description: string;
  isApiResult?: boolean;
  apiModel?: string;
  apiStatusMessage?: string;
}

export interface HRVMetrics {
  rmssd: number; // Root Mean Square of Successive Differences (ms)
  sdnn: number;  // Standard Deviation of NN intervals (ms)
  pnn50: number; // Percentage of successive intervals > 50ms (%)
  meanIBI: number; // Mean Inter-Beat Interval (ms)
  stressIndex: number; // 0-100 Baevsky stress index proxy
  autonomicState: 'Relaxed / Parasympathetic' | 'Balanced' | 'Elevated Stress / Sympathetic';
}

export interface ROIQualityBreakdown {
  forehead: number; // 0-100%
  leftCheek: number; // 0-100%
  rightCheek: number; // 0-100%
  overall: number; // 0-100%
  selectedROIs: string[];
}

export interface QualityTimelineInterval {
  intervalIndex: number;
  startSec: number;
  endSec: number;
  status: 'GOOD' | 'FAIR' | 'POOR';
  qualityScore: number; // 0-100%
  motionScore: number; // 0-100%
  lightingScore: number; // 0-100%
  note?: string;
}

export interface WindowAnalysisPoint {
  windowIndex: number;
  startSec: number;
  endSec: number;
  bpm: number;
  hrvRmssd: number;
  quality: number;
  snrDb: number;
}

export interface SignalQuality {
  overall: number; // 0-100%
  confidenceTier: ConfidenceTier;
  decision: DecisionOutcome;
  decisionReason: string;
  faceConfidence: number; // 0-100%
  roiStability: number; // 0-100%
  roiQuality: ROIQualityBreakdown;
  illumination: number; // 0-100%
  lightingQuality: number; // 0-100%
  motionStability: number; // 0-100%
  motionQuality: number; // 0-100%
  waveformSNR: number; // dB
  snrScore: number; // 0-100%
  temporalStability: number; // 0-100%
  temporalStabilityStatus: TemporalStabilityStatus;
  algorithmAgreement: number; // 0-100%
  algorithmRange: number; // Max - Min BPM
  isReliable: boolean;
  warnings: string[];
  retryReasons: string[];
  qualityTimeline: QualityTimelineInterval[];
  windowAnalysis: WindowAnalysisPoint[];
  adaptiveNoiseCancellation?: boolean;
  lowLightModeActive?: boolean;
}

export interface MethodComparison {
  g: number;
  chrom: number;
  pos: number;
  vitalLens: number;
  consensusBpm: number;
  stdDev: number;
  algorithmRange: number; // Spread (Max BPM - Min BPM)
  minBpm: number;
  maxBpm: number;
  agreementStatus: 'HIGH' | 'MODERATE' | 'LOW';
}

export type RiskLevel = 'lower' | 'moderate' | 'higher';

export interface AICardioAnalysis {
  clinicalOverview: string;
  cardiacRhythmTone: string;
  respiratoryCoupling: string;
  methodReliability: string;
  screeningIndication: string;
  lifestyleGuidance: string[];
  doctorDiscussionPoints: string[];
  confidenceScore: number;
}

export interface ScreeningSessionResult {
  id: string;
  timestamp: number;
  dateString: string;
  durationSec: number;
  heartRate: number; // Consensus BPM
  hrv: HRVMetrics;
  respiratoryRate: number; // breaths/min
  decision: DecisionOutcome;
  confidenceTier: ConfidenceTier;
  signalQuality: SignalQuality;
  methodComparison: MethodComparison;
  methodResults: {
    g: MethodResult;
    chrom: MethodResult;
    pos: MethodResult;
    vitallens: MethodResult;
  };
  timeSeries: {
    time: number[];
    rawG: number[];
    gWaveform: number[];
    chromWaveform: number[];
    posWaveform: number[];
    vitalLensWaveform: number[];
  };
  riskLevel: RiskLevel;
  riskScore: number; // 0-100
  adaptiveNoiseCancellation?: boolean;
  lowLightModeActive?: boolean;
  vitalLensApiStatus?: {
    connected: boolean;
    model?: string;
    message?: string;
  };
  aiAnalysis?: AICardioAnalysis;
  userProfile?: {
    age?: number;
    gender?: string;
    restingState?: string;
    recentCaffeine?: boolean;
    recentExercise?: boolean;
    notes?: string;
  };
}

export interface UserBaseline {
  avgHeartRate: number;
  avgHRV: number;
  avgRR: number;
  avgQuality: number;
  sessionCount: number;
  acceptedSessionCount: number;
  lastUpdated: number;
}

export type AppMode = 'scan' | 'benchmark' | 'history' | 'algorithms' | 'about';

