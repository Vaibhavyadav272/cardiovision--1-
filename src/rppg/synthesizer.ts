import { RGBSample } from '../types';

export interface BenchmarkPreset {
  id: string;
  name: string;
  targetBpm: number;
  targetHRV: number; // RMSSD
  targetRR: number;
  noiseLevel: number; // 0 to 1
  description: string;
  category: 'Healthy Resting' | 'Athletic' | 'Autonomic Stress' | 'Motion Artifact' | 'Tachycardia';
}

export const BENCHMARK_PRESETS: BenchmarkPreset[] = [
  {
    id: 'normal-resting',
    name: 'Normal Resting Adult (72 BPM)',
    targetBpm: 72,
    targetHRV: 46,
    targetRR: 15,
    noiseLevel: 0.05,
    description: 'High signal quality, stable lighting, healthy resting vagal tone with regular RSA.',
    category: 'Healthy Resting',
  },
  {
    id: 'athletic-bradycardia',
    name: 'Endurance Athlete (54 BPM)',
    targetBpm: 54,
    targetHRV: 68,
    targetRR: 12,
    noiseLevel: 0.04,
    description: 'High parasympathetic vagal modulation, long IBI periods, high RMSSD.',
    category: 'Athletic',
  },
  {
    id: 'mild-stress',
    name: 'Autonomic Strain / Elevated Stress (94 BPM)',
    targetBpm: 94,
    targetHRV: 24,
    targetRR: 20,
    noiseLevel: 0.12,
    description: 'Sympathetic dominance, reduced heart rate variability, elevated respiratory rate.',
    category: 'Autonomic Stress',
  },
  {
    id: 'tachycardia-rest',
    name: 'Resting Tachycardia (108 BPM)',
    targetBpm: 108,
    targetHRV: 18,
    targetRR: 22,
    noiseLevel: 0.15,
    description: 'Elevated cardiac rate exceeding resting clinical norm (100 BPM threshold).',
    category: 'Tachycardia',
  },
  {
    id: 'motion-corrupted',
    name: 'Subject Motion & Artifact Test (78 BPM with Noise)',
    targetBpm: 78,
    targetHRV: 35,
    targetRR: 16,
    noiseLevel: 0.65,
    description: 'Simulates intermittent head motion and luminance shifts to test multi-method POS/CHROM resilience.',
    category: 'Motion Artifact',
  },
];

/**
 * Generate synthetic realistic rPPG time-series RGB samples for a given benchmark
 */
export function generateSyntheticRPPGSamples(
  preset: BenchmarkPreset,
  durationSec: number = 28,
  sampleRate: number = 30
): RGBSample[] {
  const totalFrames = durationSec * sampleRate;
  const samples: RGBSample[] = [];

  const baseFreq = preset.targetBpm / 60; // Hz
  const respFreq = preset.targetRR / 60; // Hz
  const baseR = 175;
  const baseG = 132;
  const baseB = 108;

  let currentIBI = 1 / baseFreq;
  let phase = 0;
  let respPhase = 0;

  const now = Date.now();

  for (let i = 0; i < totalFrames; i++) {
    const t = i / sampleRate;

    // Respiration baseline modulation
    respPhase = 2 * Math.PI * respFreq * t;
    const respModulation = Math.sin(respPhase) * 0.015;

    // Heart rate variability (Respiratory Sinus Arrhythmia)
    const rsaEffect = Math.sin(respPhase) * (preset.targetHRV / 800);
    const instantFreq = baseFreq * (1 + rsaEffect);

    phase += 2 * Math.PI * instantFreq * (1 / sampleRate);

    // Primary systolic pulse + secondary dicrotic notch
    const pulseWave =
      Math.sin(phase) +
      0.35 * Math.sin(2 * phase + 0.6) +
      0.15 * Math.sin(3 * phase + 1.2);

    // Optical pulse amplitude: Green channel absorbs most strongly (~1.2%), Red (~0.4%), Blue (~0.2%)
    const gMod = pulseWave * 0.018 + respModulation;
    const rMod = pulseWave * 0.007 + respModulation * 0.8;
    const bMod = pulseWave * 0.004 + respModulation * 0.5;

    // Motion noise
    const isMotionSpike = preset.noiseLevel > 0.4 && (i % 90 > 75);
    const noise = (Math.random() - 0.5) * preset.noiseLevel * (isMotionSpike ? 6.0 : 1.0);

    const gVal = baseG * (1 - gMod + noise * 0.02);
    const rVal = baseR * (1 - rMod + noise * 0.015);
    const bVal = baseB * (1 - bMod + noise * 0.018);

    const forehead = {
      r: rVal + (Math.random() - 0.5) * 2,
      g: gVal * 1.02 + (Math.random() - 0.5) * 2,
      b: bVal + (Math.random() - 0.5) * 2,
    };

    const leftCheek = {
      r: rVal * 0.98 + (Math.random() - 0.5) * 2,
      g: gVal * 0.99 + (Math.random() - 0.5) * 2,
      b: bVal * 0.98 + (Math.random() - 0.5) * 2,
    };

    const rightCheek = {
      r: rVal * 0.99 + (Math.random() - 0.5) * 2,
      g: gVal * 1.01 + (Math.random() - 0.5) * 2,
      b: bVal * 0.99 + (Math.random() - 0.5) * 2,
    };

    const motionVariance = isMotionSpike ? 1.8 : preset.noiseLevel * 0.6;
    const faceConfidence = isMotionSpike ? 0.65 : 0.96;

    samples.push({
      timestamp: now + i * (1000 / sampleRate),
      r: rVal,
      g: gVal,
      b: bVal,
      forehead,
      leftCheek,
      rightCheek,
      motionVariance,
      faceConfidence,
    });
  }

  return samples;
}
