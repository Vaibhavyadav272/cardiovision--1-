import React from 'react';
import {
  Heart,
  Activity,
  Wind,
  ShieldCheck,
  CheckCircle,
  AlertTriangle,
  AlertOctagon,
  Cpu,
  RefreshCw,
  Sliders,
} from 'lucide-react';
import { ScreeningSessionResult } from '../types';

interface Props {
  result: ScreeningSessionResult;
}

export const VitalsCardGrid: React.FC<Props> = ({ result }) => {
  const { heartRate, hrv, respiratoryRate, signalQuality, methodComparison, decision, confidenceTier } = result;

  // Heart Rate Status
  let hrStatus = 'Normal Resting';
  let hrColor = 'text-emerald-400 border-emerald-500/30 bg-emerald-950/20';
  if (heartRate > 100) {
    hrStatus = 'Elevated / Tachycardic';
    hrColor = 'text-rose-400 border-rose-500/30 bg-rose-950/20';
  } else if (heartRate < 55) {
    hrStatus = 'Bradycardic (Athletic/Low)';
    hrColor = 'text-cyan-400 border-cyan-500/30 bg-cyan-950/20';
  }

  // HRV status
  let hrvBadge = 'Balanced Autonomic Tone';
  let hrvBadgeColor = 'bg-teal-950 text-teal-300 border-teal-700/50';
  if (hrv.rmssd >= 55) {
    hrvBadge = 'High Parasympathetic Vagal Tone';
    hrvBadgeColor = 'bg-emerald-950 text-emerald-300 border-emerald-700/50';
  } else if (hrv.rmssd <= 25) {
    hrvBadge = 'Sympathetic / Autonomic Strain';
    hrvBadgeColor = 'bg-amber-950 text-amber-300 border-amber-700/50';
  }

  // Quality status
  let qualityBadge = 'High Confidence';
  let qualityColor = 'text-emerald-400';
  if (signalQuality.overall < 60 || confidenceTier === 'LOW') {
    qualityBadge = 'Low Confidence';
    qualityColor = 'text-rose-400';
  } else if (signalQuality.overall < 76 || confidenceTier === 'MEDIUM') {
    qualityBadge = 'Medium Confidence';
    qualityColor = 'text-amber-400';
  }

  // Decision outcome styles
  const isRetry = decision === 'RETRY' || signalQuality.decision === 'RETRY';
  const isCaution = decision === 'CAUTION' || signalQuality.decision === 'CAUTION';

  return (
    <div className="space-y-3">
      {/* Decision Engine Alert / Banner if Caution or Retry */}
      {isRetry && (
        <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-600/60 text-rose-200 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-start gap-2.5">
            <AlertOctagon className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white uppercase tracking-wider text-[11px] bg-rose-900/80 px-2 py-0.5 rounded border border-rose-500/40">
                  Decision: RETRY SCAN
                </span>
                <span className="text-rose-300 font-medium">Measurement Reliability Threshold Not Met</span>
              </div>
              <p className="text-[11px] text-rose-300/90 mt-1">
                {signalQuality.decisionReason || 'The optical pulse signals did not achieve sufficient stability and algorithm consensus. Please repeat the measurement.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {isCaution && !isRetry && (
        <div className="p-3 rounded-xl bg-amber-950/50 border border-amber-600/50 text-amber-200 text-xs flex items-start gap-2.5 shadow-md">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white uppercase tracking-wider text-[10px] bg-amber-900/80 px-2 py-0.5 rounded border border-amber-500/40">
                Decision: CAUTION
              </span>
              <span className="text-amber-300 font-medium">{signalQuality.decisionReason}</span>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 1. Heart Rate Card */}
        <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 shadow-md relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Heart Rate (Consensus)
              </span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-3xl font-bold font-mono text-white tracking-tight">
                  {heartRate}
                </span>
                <span className="text-xs font-medium text-slate-400 font-sans">BPM</span>
              </div>
            </div>
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <Heart className="w-5 h-5 animate-pulse" />
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-[#1E293B] flex items-center justify-between text-xs">
            <span className={`px-2 py-0.5 rounded-md border text-[10px] font-medium ${hrColor}`}>
              {hrStatus}
            </span>
            <span className="text-slate-400 font-mono text-[10px]">
              IBI ~ {hrv.meanIBI}ms
            </span>
          </div>
        </div>

        {/* 2. Heart Rate Variability (HRV) Card */}
        <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 shadow-md relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                HRV (Autonomic Tone)
              </span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-3xl font-bold font-mono text-emerald-400 tracking-tight">
                  {hrv.rmssd}
                </span>
                <span className="text-xs font-medium text-slate-400 font-sans">ms (RMSSD)</span>
              </div>
            </div>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Activity className="w-5 h-5" />
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-[#1E293B] flex flex-col gap-1 text-xs">
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span>SDNN: <strong className="text-slate-200">{hrv.sdnn} ms</strong></span>
              <span>pNN50: <strong className="text-slate-200">{hrv.pnn50}%</strong></span>
            </div>
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-medium border truncate ${hrvBadgeColor}`}>
              {hrvBadge}
            </span>
          </div>
        </div>

        {/* 3. Respiratory Rate Card */}
        <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 shadow-md relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Respiratory Rate
              </span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className="text-3xl font-bold font-mono text-teal-400 tracking-tight">
                  {respiratoryRate}
                </span>
                <span className="text-xs font-medium text-slate-400 font-sans">br/min</span>
              </div>
            </div>
            <div className="p-2 rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/20">
              <Wind className="w-5 h-5" />
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-[#1E293B] flex items-center justify-between text-xs">
            <span className="text-slate-400 text-[10px]">RSA Coupling:</span>
            <span className="text-emerald-400 font-medium font-mono text-[10px]">
              {Math.round(heartRate / respiratoryRate)}:1 Ratio
            </span>
          </div>
        </div>

        {/* 4. Signal Quality & Decision Outcome Card */}
        <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 shadow-md relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Signal Quality &amp; Tier
              </span>
              <div className="flex items-baseline gap-1.5 mt-1">
                <span className={`text-3xl font-bold font-mono tracking-tight ${qualityColor}`}>
                  {signalQuality.overall}%
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#0A0F1E] text-slate-300 border border-[#1E293B]">
                  {confidenceTier || signalQuality.confidenceTier || 'HIGH'}
                </span>
              </div>
            </div>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <ShieldCheck className="w-5 h-5" />
            </div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-[#1E293B] flex items-center justify-between text-xs">
            <div className="flex items-center gap-1">
              <Cpu className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] text-slate-300">Spread:</span>
            </div>
            <span
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono ${
                methodComparison.agreementStatus === 'HIGH'
                  ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-700/50'
                  : methodComparison.agreementStatus === 'MODERATE'
                  ? 'bg-teal-950/60 text-teal-300 border border-teal-700/50'
                  : 'bg-rose-950/60 text-rose-400 border border-rose-700/50'
              }`}
            >
              ±{methodComparison.stdDev} BPM ({methodComparison.algorithmRange || 0} spread)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

