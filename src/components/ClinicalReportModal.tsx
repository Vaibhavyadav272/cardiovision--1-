import React from 'react';
import { X, Printer, Download, Activity, Heart, ShieldCheck, Stethoscope, AlertTriangle } from 'lucide-react';
import { ScreeningSessionResult } from '../types';

interface Props {
  result: ScreeningSessionResult;
  onClose: () => void;
}

export const ClinicalReportModal: React.FC<Props> = ({ result, onClose }) => {
  const {
    id,
    dateString,
    durationSec,
    heartRate,
    hrv,
    respiratoryRate,
    signalQuality,
    methodComparison,
    methodResults,
    riskLevel,
    riskScore,
    aiAnalysis,
    userProfile,
  } = result;

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(result, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `cardiovision_report_${id}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#0F172A] border border-[#1E293B] rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-5 sm:p-6 shadow-2xl text-slate-200 print:bg-white print:text-black print:p-0 print:border-none print:shadow-none">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#1E293B] print:border-black print:pb-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 text-[#0A0F1E] flex items-center justify-center font-bold">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white print:text-black">
                CardioVision Cardiovascular Screening Report
              </h2>
              <p className="text-[10px] text-slate-400 print:text-slate-600 font-mono">
                Session ID: {id} | {dateString} ({durationSec}s Capture)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 print:hidden">
            <button
              onClick={handlePrint}
              className="p-1.5 rounded-md bg-[#0A0F1E] hover:bg-slate-800 text-slate-300 border border-[#1E293B] transition"
              title="Print Report"
            >
              <Printer className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleDownloadJSON}
              className="p-1.5 rounded-md bg-[#0A0F1E] hover:bg-slate-800 text-slate-300 border border-[#1E293B] transition"
              title="Download JSON Export"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md bg-[#0A0F1E] hover:bg-slate-800 text-slate-300 border border-[#1E293B] transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Report Content */}
        <div className="py-4 space-y-4 text-xs">
          {/* Subject & Metadata Banner */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] print:bg-slate-100 print:border-slate-300">
            <div>
              <span className="text-slate-400 print:text-slate-600 block text-[9px] uppercase font-mono">Subject Age</span>
              <strong className="text-white print:text-black">{userProfile?.age || 'Unspecified'} yrs</strong>
            </div>
            <div>
              <span className="text-slate-400 print:text-slate-600 block text-[9px] uppercase font-mono">Decision / Tier</span>
              <strong className="text-emerald-400 print:text-emerald-700">
                {result.decision || signalQuality.decision || 'ACCEPT'} ({result.confidenceTier || signalQuality.confidenceTier || 'HIGH'})
              </strong>
            </div>
            <div>
              <span className="text-slate-400 print:text-slate-600 block text-[9px] uppercase font-mono">Signal Quality &amp; SNR</span>
              <strong className="text-emerald-400 print:text-emerald-700">{signalQuality.overall}% ({signalQuality.waveformSNR} dB)</strong>
            </div>
            <div>
              <span className="text-slate-400 print:text-slate-600 block text-[9px] uppercase font-mono">Consensus Spread</span>
              <strong className="text-emerald-400 print:text-emerald-700">
                {methodComparison.agreementStatus} (±{methodComparison.stdDev} BPM | {methodComparison.algorithmRange || 0} spread)
              </strong>
            </div>
          </div>

          {/* Primary Physiological Metrics */}
          <div>
            <h3 className="font-bold text-white print:text-black uppercase tracking-wider text-[10px] mb-2 flex items-center gap-1.5">
              <Heart className="w-3.5 h-3.5 text-rose-400 print:text-rose-600" />
              1. Measured Cardiovascular & Autonomic Vitals
            </h3>
            <div className="grid grid-cols-3 gap-2.5 text-center">
              <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] print:border-slate-300">
                <span className="text-slate-400 print:text-slate-600 block text-[10px]">Heart Rate (Consensus)</span>
                <span className="text-xl font-bold font-mono text-white print:text-black">{heartRate} BPM</span>
              </div>
              <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] print:border-slate-300">
                <span className="text-slate-400 print:text-slate-600 block text-[10px]">HRV RMSSD</span>
                <span className="text-xl font-bold font-mono text-emerald-400 print:text-emerald-700">{hrv.rmssd} ms</span>
                <span className="text-[9px] text-slate-500 block font-mono">SDNN: {hrv.sdnn} ms | pNN50: {hrv.pnn50}%</span>
              </div>
              <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] print:border-slate-300">
                <span className="text-slate-400 print:text-slate-600 block text-[10px]">Respiratory Rate</span>
                <span className="text-xl font-bold font-mono text-teal-400 print:text-teal-700">{respiratoryRate} br/min</span>
              </div>
            </div>
          </div>

          {/* Multi-Method Table */}
          <div>
            <h3 className="font-bold text-white print:text-black uppercase tracking-wider text-[10px] mb-2 flex items-center gap-1.5">
              <Stethoscope className="w-3.5 h-3.5 text-emerald-400 print:text-emerald-600" />
              2. Multi-Method rPPG Cross-Validation Breakdown
            </h3>
            <table className="w-full text-left border border-[#1E293B] print:border-slate-300 rounded-lg overflow-hidden text-xs">
              <thead className="bg-[#0A0F1E] print:bg-slate-100 text-slate-400 print:text-slate-700 text-[9px] uppercase font-mono">
                <tr>
                  <th className="p-2">Algorithm</th>
                  <th className="p-2">BPM</th>
                  <th className="p-2">SNR (dB)</th>
                  <th className="p-2">Confidence</th>
                  <th className="p-2">Peaks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E293B] print:divide-slate-300 text-slate-300 print:text-black">
                <tr>
                  <td className="p-2 font-medium">G-Channel Baseline</td>
                  <td className="p-2 font-mono">{methodResults.g.bpm} BPM</td>
                  <td className="p-2 font-mono">{methodResults.g.snrDb} dB</td>
                  <td className="p-2 font-mono">{Math.round(methodResults.g.confidence * 100)}%</td>
                  <td className="p-2 font-mono">{methodResults.g.peaks.length}</td>
                </tr>
                <tr>
                  <td className="p-2 font-medium">CHROM (Chrominance Subspace)</td>
                  <td className="p-2 font-mono">{methodResults.chrom.bpm} BPM</td>
                  <td className="p-2 font-mono">{methodResults.chrom.snrDb} dB</td>
                  <td className="p-2 font-mono">{Math.round(methodResults.chrom.confidence * 100)}%</td>
                  <td className="p-2 font-mono">{methodResults.chrom.peaks.length}</td>
                </tr>
                <tr>
                  <td className="p-2 font-medium">POS (Plane-Orthogonal-to-Skin)</td>
                  <td className="p-2 font-mono">{methodResults.pos.bpm} BPM</td>
                  <td className="p-2 font-mono">{methodResults.pos.snrDb} dB</td>
                  <td className="p-2 font-mono">{Math.round(methodResults.pos.confidence * 100)}%</td>
                  <td className="p-2 font-mono">{methodResults.pos.peaks.length}</td>
                </tr>
                <tr>
                  <td className="p-2 font-medium">VitalLens Neural Model</td>
                  <td className="p-2 font-mono">{methodResults.vitallens.bpm} BPM</td>
                  <td className="p-2 font-mono">{methodResults.vitallens.snrDb} dB</td>
                  <td className="p-2 font-mono">{Math.round(methodResults.vitallens.confidence * 100)}%</td>
                  <td className="p-2 font-mono">{methodResults.vitallens.peaks.length}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Cardiovascular Screening Classification */}
          <div className="p-3.5 rounded-lg bg-[#0A0F1E] border border-[#1E293B] print:bg-slate-50 print:border-slate-300">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-bold text-white print:text-black uppercase text-[10px] font-mono">
                Screening Indication:
              </span>
              <span
                className={`px-2 py-0.2 rounded text-[10px] font-bold uppercase ${
                  riskLevel === 'lower'
                    ? 'bg-emerald-950 text-emerald-400 print:text-emerald-700'
                    : riskLevel === 'moderate'
                    ? 'bg-amber-950 text-amber-400 print:text-amber-700'
                    : 'bg-rose-950 text-rose-400 print:text-rose-700'
                }`}
              >
                {riskLevel} Indication (Score: {riskScore}/100)
              </span>
            </div>
            <p className="text-slate-300 print:text-slate-700 leading-relaxed text-[11px]">
              {aiAnalysis?.clinicalOverview ||
                'Vitals fall within normal resting physiological bounds for camera screening.'}
            </p>
          </div>

          {/* Doctor Discussion Guide */}
          {aiAnalysis?.doctorDiscussionPoints && (
            <div className="space-y-1.5">
              <h4 className="font-bold text-white print:text-black uppercase text-[10px] font-mono">
                Physician Consultation Points:
              </h4>
              <ul className="list-disc pl-4 space-y-0.5 text-slate-300 print:text-slate-700 text-[10px]">
                {aiAnalysis.doctorDiscussionPoints.map((pt, i) => (
                  <li key={i}>{pt}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Medical Disclaimer in report */}
          <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/40 text-amber-300 print:text-black print:border-slate-400 text-[10px] leading-relaxed">
            <strong>RESEARCH & TRIAGE DISCLAIMER:</strong> CardioVision is a non-diagnostic preliminary screening tool using remote photoplethysmography. Measurements should be verified by a qualified healthcare professional using standard clinical equipment before making medical decisions.
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-[#1E293B] print:hidden flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md bg-[#0A0F1E] hover:bg-slate-800 text-white text-xs font-medium border border-[#1E293B] transition"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
};
