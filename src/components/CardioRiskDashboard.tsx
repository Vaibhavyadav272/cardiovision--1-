import React, { useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  RefreshCw,
  Stethoscope,
  HeartHandshake,
  CheckCircle2,
  FileText,
  HelpCircle,
} from 'lucide-react';
import { ScreeningSessionResult } from '../types';
import { requestAICardioAnalysis } from '../rppg/pipeline';

interface Props {
  result: ScreeningSessionResult;
  onOpenReport: () => void;
  onUpdateAnalysis: (analysis: any) => void;
}

export const CardioRiskDashboard: React.FC<Props> = ({
  result,
  onOpenReport,
  onUpdateAnalysis,
}) => {
  const [isRefreshingAI, setIsRefreshingAI] = useState(false);
  const { riskLevel, riskScore, heartRate, hrv, respiratoryRate, signalQuality, aiAnalysis } = result;

  const handleRefreshAI = async () => {
    setIsRefreshingAI(true);
    try {
      const newAnalysis = await requestAICardioAnalysis(result);
      if (newAnalysis) {
        onUpdateAnalysis(newAnalysis);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsRefreshingAI(false);
    }
  };

  // Risk Badge & Visual configuration
  let badgeTitle = 'LOWER INDICATION';
  let badgeColor = 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40';
  let gaugeColor = 'bg-emerald-400';
  let icon = <ShieldCheck className="w-6 h-6 text-emerald-400" />;
  let explanation =
    'Measured vitals (resting heart rate, HRV autonomic modulation, and respiration) are consistent with expected reference ranges for non-contact video screening.';

  if (riskLevel === 'higher') {
    badgeTitle = 'HIGHER INDICATION';
    badgeColor = 'bg-rose-950/80 text-rose-300 border-rose-500/40';
    gaugeColor = 'bg-rose-500';
    icon = <ShieldAlert className="w-6 h-6 text-rose-400" />;
    explanation =
      'One or more physiological vitals (e.g. resting tachycardia, reduced HRV autonomic tone) deviate from typical baseline parameters. Clinical in-person evaluation is recommended.';
  } else if (riskLevel === 'moderate') {
    badgeTitle = 'MODERATE INDICATION';
    badgeColor = 'bg-amber-950/80 text-amber-300 border-amber-500/40';
    gaugeColor = 'bg-amber-400';
    icon = <AlertTriangle className="w-6 h-6 text-amber-400" />;
    explanation =
      'Vitals show slight physiological elevation or moderate autonomic stress. Repeated scans and baseline tracking are advised.';
  }

  return (
    <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
      {/* Screening Indicator Banner */}
      <div className={`p-4 rounded-xl border ${badgeColor} flex flex-col md:flex-row items-start md:items-center justify-between gap-3.5`}>
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-lg bg-[#0A0F1E] border border-[#1E293B] shrink-0">
            {icon}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-slate-400">
                Cardiovascular Screening Indicator
              </span>
              <span className="px-1.5 py-0.2 rounded text-[10px] font-bold font-mono uppercase">
                {badgeTitle}
              </span>
            </div>
            <p className="text-xs text-slate-200 mt-1 leading-relaxed max-w-2xl">
              {explanation}
            </p>
          </div>
        </div>

        {/* Risk Gauge */}
        <div className="bg-[#0A0F1E] p-3 rounded-lg border border-[#1E293B] shrink-0 w-full md:w-52">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-400 text-[11px]">Physiological Load:</span>
            <span className="font-bold font-mono text-white text-[11px]">{riskScore} / 100</span>
          </div>
          <div className="w-full bg-[#1E293B] h-1.5 rounded-full overflow-hidden mb-1.5">
            <div
              className={`h-full ${gaugeColor} transition-all duration-500`}
              style={{ width: `${riskScore}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-slate-500 font-mono">
            <span>0 (Low)</span>
            <span>50</span>
            <span>100 (High)</span>
          </div>
        </div>
      </div>

      {/* Gemini AI Clinical Triage & Physiological Interpretation */}
      <div className="bg-[#0A0F1E] border border-[#1E293B] rounded-xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pb-2.5 border-b border-[#1E293B]">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div>
              <h4 className="text-xs font-semibold text-white">
                Gemini AI Clinical Screening Synthesis
              </h4>
              <p className="text-[10px] text-slate-400">
                Automated multi-method physiological reasoning & triage guidance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRefreshAI}
              disabled={isRefreshingAI}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#0F172A] hover:bg-slate-800 text-slate-300 text-[11px] font-medium border border-[#1E293B] transition"
            >
              <RefreshCw className={`w-3 h-3 ${isRefreshingAI ? 'animate-spin text-emerald-400' : ''}`} />
              <span>{isRefreshingAI ? 'Analyzing...' : 'Refresh AI'}</span>
            </button>
            <button
              onClick={onOpenReport}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-[#0A0F1E] text-[11px] font-bold shadow-sm transition"
            >
              <FileText className="w-3 h-3" />
              <span>Full Clinical Report</span>
            </button>
          </div>
        </div>

        {aiAnalysis ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {/* Overview & Autonomic Assessment */}
            <div className="space-y-2.5 bg-[#0F172A] p-3.5 rounded-lg border border-[#1E293B]">
              <div>
                <h5 className="font-semibold text-slate-200 flex items-center gap-1.5 mb-1 text-[11px]">
                  <Stethoscope className="w-3 h-3 text-emerald-400" />
                  Physiological Overview
                </h5>
                <p className="text-slate-300 text-[11px] leading-relaxed">{aiAnalysis.clinicalOverview}</p>
              </div>

              <div>
                <h5 className="font-semibold text-slate-200 mb-0.5 text-[11px] text-teal-300">
                  Autonomic Nervous System & HRV Tone
                </h5>
                <p className="text-slate-300 text-[11px] leading-relaxed">{aiAnalysis.cardiacRhythmTone}</p>
              </div>

              <div>
                <h5 className="font-semibold text-slate-200 mb-0.5 text-[11px] text-emerald-300">
                  Cardiorespiratory Coupling (RSA)
                </h5>
                <p className="text-slate-300 text-[11px] leading-relaxed">{aiAnalysis.respiratoryCoupling}</p>
              </div>
            </div>

            {/* Lifestyle & Doctor Discussion Guide */}
            <div className="space-y-2.5 bg-[#0F172A] p-3.5 rounded-lg border border-[#1E293B] flex flex-col justify-between">
              <div>
                <h5 className="font-semibold text-slate-200 flex items-center gap-1.5 mb-1.5 text-[11px]">
                  <HeartHandshake className="w-3 h-3 text-emerald-400" />
                  Evidence-Based Wellness Guidance
                </h5>
                <ul className="space-y-1 text-slate-300 text-[11px]">
                  {aiAnalysis.lifestyleGuidance?.map((tip, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-2 border-t border-[#1E293B]">
                <h5 className="font-semibold text-slate-200 flex items-center gap-1 mb-1 text-[11px]">
                  <HelpCircle className="w-3 h-3 text-emerald-400" />
                  Suggested Questions for Your Physician
                </h5>
                <ul className="space-y-0.5 text-slate-300 text-[10px]">
                  {aiAnalysis.doctorDiscussionPoints?.map((q, idx) => (
                    <li key={idx} className="flex items-start gap-1">
                      <span className="text-emerald-400 font-bold">•</span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-4 text-center text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-1.5 text-emerald-400" />
            <p className="text-xs">Generating AI screening assessment...</p>
          </div>
        )}
      </div>
    </div>
  );
};
