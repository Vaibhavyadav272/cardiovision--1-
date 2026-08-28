import React, { useState } from 'react';
import { AlertTriangle, ShieldCheck, X, Info } from 'lucide-react';

interface Props {
  variant?: 'banner' | 'modal';
  onClose?: () => void;
}

export const DisclaimerBanner: React.FC<Props> = ({ variant = 'banner', onClose }) => {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed && variant === 'banner') return null;

  if (variant === 'modal') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl max-w-lg w-full p-5 shadow-2xl text-slate-200">
          <div className="flex items-center justify-between pb-3 border-b border-[#1E293B]">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-base font-semibold text-white">Medical & Research Disclaimer</h3>
            </div>
            {onClose && (
              <button
                onClick={onClose}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="space-y-3 py-3 text-xs text-slate-300 leading-relaxed">
            <p>
              <strong className="text-white">CardioVision</strong> is an experimental AI-assisted remote photoplethysmography (rPPG) screening and triage exploration system.
            </p>
            <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-700/40 text-amber-200 text-xs flex gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong>Not a Diagnostic Medical Device:</strong> This application is not cleared or approved by the FDA or any medical authority. It must NOT be used as a substitute for clinical electrocardiograms (ECG), pulse oximeters, blood pressure cuffs, or physician evaluation.
              </div>
            </div>
            <p>
              Measurement accuracy is dependent on ambient lighting, subject motion, camera exposure, and facial skin perfusion. Never alter or discontinue prescription medications or treatment plans based on these readings.
            </p>
            <p className="text-[11px] text-slate-400">
              If you experience chest pain, shortness of breath, dizziness, or palpitations, immediately consult a qualified healthcare provider or emergency medical services.
            </p>
          </div>

          <div className="pt-3 border-t border-[#1E293B] flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[#0A0F1E] text-xs font-bold transition shadow"
            >
              I Understand & Acknowledge
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#0A0F1E] border-b border-amber-500/30 px-3.5 py-1.5 text-xs text-amber-300 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 max-w-6xl mx-auto">
        <Info className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="text-[11px]">
          <strong>Research & Screening Prototype:</strong> CardioVision non-contact rPPG estimates are for preliminary triage and monitoring only. Not for diagnostic use.
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="p-0.5 text-amber-400 hover:text-amber-200 transition shrink-0"
        title="Dismiss notice"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};
