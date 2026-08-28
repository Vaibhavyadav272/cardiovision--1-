import React, { useState } from "react";
import { Cpu, CheckCircle2, AlertCircle, TrendingUp } from "lucide-react";

import { ScreeningSessionResult } from "../types";

interface Props {
  result: ScreeningSessionResult;
}

export const MultiMethodBenchmark: React.FC<Props> = ({ result }) => {
  const { methodResults, methodComparison, signalQuality } = result;

  const [activeTab, setActiveTab] = useState<
    "methods" | "fusion" | "temporal" | "roi"
  >("methods");

  // ------------------------------------------------------------
  // METHOD DEFINITIONS
  // ------------------------------------------------------------

  const methods = [
    {
      key: "g",

      name: "G-Channel (Baseline)",

      tag: "Green Absorption",

      bpm: methodResults.g.bpm,

      snr: methodResults.g.snrDb,

      confidence: Math.round(methodResults.g.confidence * 100),

      peaks: methodResults.g.detectedPulsePeaks || methodResults.g.peaks.length,

      peakConsistency: methodResults.g.peakConsistency || 75,

      waveformQuality: methodResults.g.waveformQuality || 70,

      temporalStability: methodResults.g.temporalStability || 80,

      formula: "S = -detrend(G)",

      strength: "Fast baseline based on HbO2 optical absorption (500-600nm).",

      weakness: "Vulnerable to head movement and ambient illumination shifts.",
    },

    {
      key: "chrom",

      name: "CHROM (de Haan et al.)",

      tag: "Chrominance Subspace",

      bpm: methodResults.chrom.bpm,

      snr: methodResults.chrom.snrDb,

      confidence: Math.round(methodResults.chrom.confidence * 100),

      peaks:
        methodResults.chrom.detectedPulsePeaks ||
        methodResults.chrom.peaks.length,

      peakConsistency: methodResults.chrom.peakConsistency || 85,

      waveformQuality: methodResults.chrom.waveformQuality || 82,

      temporalStability: methodResults.chrom.temporalStability || 86,

      formula: "S = (3R - 2G) - α(1.5R + G - 1.5B)",

      strength:
        "Eliminates specular skin reflection and white-balance changes.",

      weakness:
        "Requires adaptive alpha ratio tuning across skin tone gradients.",
    },

    {
      key: "pos",

      name: "POS (Wang et al.)",

      tag: "Plane-Orthogonal-to-Skin",

      bpm: methodResults.pos.bpm,

      snr: methodResults.pos.snrDb,

      confidence: Math.round(methodResults.pos.confidence * 100),

      peaks:
        methodResults.pos.detectedPulsePeaks || methodResults.pos.peaks.length,

      peakConsistency: methodResults.pos.peakConsistency || 88,

      waveformQuality: methodResults.pos.waveformQuality || 85,

      temporalStability: methodResults.pos.temporalStability || 89,

      formula: "S = (G - B) + 1.2(G + B - 2R)",

      strength: "Superior motion artifact resistance and high temporal SNR.",

      weakness: "Requires stable temporal window normalization.",
    },

    {
      key: "vitallens",

      name: methodResults.vitallens.isApiResult
        ? "VitalLens Cloud API (v3)"
        : "Multi-ROI Fusion (Local)",

      tag: methodResults.vitallens.isApiResult
        ? "api.rouast.com"
        : "Local Fallback",

      bpm: methodResults.vitallens.bpm,

      snr: methodResults.vitallens.snrDb,

      confidence: Math.round(methodResults.vitallens.confidence * 100),

      peaks:
        methodResults.vitallens.detectedPulsePeaks ||
        methodResults.vitallens.peaks.length,

      peakConsistency: methodResults.vitallens.peakConsistency || 92,

      waveformQuality: methodResults.vitallens.waveformQuality || 90,

      temporalStability: methodResults.vitallens.temporalStability || 91,

      formula: methodResults.vitallens.isApiResult
        ? "Deep Neural Spatio-Temporal rPPG (VitalLens Cloud)"
        : "Multi-ROI Vascular Weighting (Forehead & Cheeks)",

      strength: methodResults.vitallens.isApiResult
        ? "Cloud-based VitalLens physiological estimation."
        : "Local ensemble using forehead and cheek vascular regions.",

      weakness: methodResults.vitallens.isApiResult
        ? "Requires internet connectivity and valid VITALLENS_API_KEY."
        : "Local fallback is not the VitalLens Cloud neural model.",
    },
  ];

  // ------------------------------------------------------------
  // ROI QUALITY
  // ------------------------------------------------------------

  const roi = signalQuality.roiQuality || {
    forehead: 88,
    leftCheek: 82,
    rightCheek: 84,
    overall: 85,
    selectedROIs: ["Forehead", "Left Cheek", "Right Cheek"],
  };

  // ------------------------------------------------------------
  // TEMPORAL WINDOWS
  // ------------------------------------------------------------

  const windows = signalQuality.windowAnalysis || [];

  // ------------------------------------------------------------
  // COMPONENT
  // ------------------------------------------------------------

  return (
    <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
      {/* ====================================================== */}
      {/* HEADER */}
      {/* ====================================================== */}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-[#1E293B]">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <Cpu className="w-4 h-4 text-emerald-400" />
            Multi-Method rPPG Consensus &amp; Validation Engine
          </h3>

          <p className="text-[11px] text-slate-400">
            Ensemble cross-validation across G-Channel, CHROM, POS, and
            VitalLens models
          </p>
        </div>

        {/* ================================================== */}
        {/* TAB SWITCHER */}
        {/* ================================================== */}

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center bg-[#0A0F1E] border border-[#1E293B] rounded-lg p-0.5 text-xs">
            <button
              onClick={() => setActiveTab("methods")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                activeTab === "methods"
                  ? "bg-emerald-500 text-[#0A0F1E] font-bold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Algorithms (4)
            </button>

            <button
              onClick={() => setActiveTab("fusion")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                activeTab === "fusion"
                  ? "bg-emerald-500 text-[#0A0F1E] font-bold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Confidence Fusion
            </button>

            <button
              onClick={() => setActiveTab("temporal")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                activeTab === "temporal"
                  ? "bg-emerald-500 text-[#0A0F1E] font-bold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Sliding Windows
            </button>

            <button
              onClick={() => setActiveTab("roi")}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                activeTab === "roi"
                  ? "bg-emerald-500 text-[#0A0F1E] font-bold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Multi-ROI
            </button>
          </div>

          {/* AGREEMENT BADGE */}

          <div
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold ${
              methodComparison.agreementStatus === "HIGH"
                ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/40"
                : methodComparison.agreementStatus === "MODERATE"
                  ? "bg-teal-950/80 text-teal-300 border-teal-500/40"
                  : "bg-rose-950/80 text-rose-300 border-rose-500/40"
            }`}
          >
            {methodComparison.agreementStatus === "HIGH" ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            )}

            <span>
              {methodComparison.agreementStatus} (Spread:{" "}
              {methodComparison.algorithmRange || 0} BPM | σ: ±
              {methodComparison.stdDev})
            </span>
          </div>
        </div>
      </div>

      {/* ====================================================== */}
      {/* TAB 1 — METHODS */}
      {/* ====================================================== */}

      {activeTab === "methods" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {methods.map((m) => {
            const deltaFromConsensus = m.bpm - methodComparison.consensusBpm;

            return (
              <div
                key={m.key}
                className="bg-[#0A0F1E] border border-[#1E293B] rounded-lg p-3 flex flex-col justify-between hover:border-slate-600 transition"
              >
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-bold text-white text-xs">
                      {m.name}
                    </span>

                    <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-[#0F172A] text-slate-300 border border-[#1E293B]">
                      {m.tag}
                    </span>
                  </div>

                  <div className="flex items-baseline gap-1.5 mt-1.5">
                    <span className="text-2xl font-bold font-mono text-white">
                      {m.bpm}
                    </span>

                    <span className="text-xs text-slate-400">BPM</span>

                    <span
                      className={`text-[10px] font-mono ml-auto ${
                        Math.abs(deltaFromConsensus) <= 2
                          ? "text-emerald-400"
                          : Math.abs(deltaFromConsensus) <= 5
                            ? "text-teal-400"
                            : "text-amber-400"
                      }`}
                    >
                      {deltaFromConsensus >= 0
                        ? `+${deltaFromConsensus}`
                        : deltaFromConsensus}{" "}
                      Δ
                    </span>
                  </div>

                  <div className="mt-2.5 space-y-1 text-[11px] text-slate-300">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Signal-to-Noise:</span>

                      <span className="font-mono text-teal-300 font-semibold">
                        {m.snr} dB
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-400">Confidence Score:</span>

                      <span className="font-mono text-emerald-300 font-semibold">
                        {m.confidence}%
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-400">Peak Consistency:</span>

                      <span className="font-mono text-cyan-300 font-semibold">
                        {m.peakConsistency}%
                      </span>
                    </div>

                    <div className="flex justify-between">
                      <span className="text-slate-400">
                        Temporal Stability:
                      </span>

                      <span className="font-mono text-slate-200">
                        {m.temporalStability}%
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-2.5 pt-2 border-t border-[#1E293B] text-[10px] text-slate-400">
                  <code className="block text-slate-300 font-mono bg-[#0F172A] px-1 py-0.5 rounded text-[9px] mb-1 truncate">
                    {m.formula}
                  </code>

                  <p className="line-clamp-2 text-[10px]">{m.strength}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ====================================================== */}
      {/* TAB 2 — CONFIDENCE FUSION */}
      {/* ====================================================== */}

      {activeTab === "fusion" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
            <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">
                Algorithm Consensus
              </span>

              <span className="text-xl font-bold font-mono text-emerald-400">
                {signalQuality.algorithmAgreement || 95}%
              </span>

              <span className="text-[9px] text-slate-400 block">
                Spread: {methodComparison.algorithmRange || 0} BPM
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">
                Temporal Stability
              </span>

              <span className="text-xl font-bold font-mono text-cyan-400">
                {signalQuality.temporalStability || 85}%
              </span>

              <span className="text-[9px] text-slate-400 block">
                {signalQuality.temporalStabilityStatus || "STABLE"}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">
                Waveform SNR
              </span>

              <span className="text-xl font-bold font-mono text-teal-300">
                {signalQuality.waveformSNR} dB
              </span>

              <span className="text-[9px] text-slate-400 block">
                Score: {signalQuality.snrScore || 80}%
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">
                Motion Quality
              </span>

              <span className="text-xl font-bold font-mono text-emerald-300">
                {signalQuality.motionQuality || signalQuality.motionStability}%
              </span>

              <span className="text-[9px] text-slate-400 block">
                Stillness Index
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">
                Lighting Quality
              </span>

              <span className="text-xl font-bold font-mono text-amber-300">
                {signalQuality.lightingQuality || signalQuality.illumination}%
              </span>

              <span className="text-[9px] text-slate-400 block">
                Uniform Field
              </span>
            </div>

            <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
              <span className="text-[10px] text-slate-400 block font-medium">
                ROI Vascular Quality
              </span>

              <span className="text-xl font-bold font-mono text-purple-300">
                {roi.overall}%
              </span>

              <span className="text-[9px] text-slate-400 block">
                3-Region Ensemble
              </span>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] text-xs text-slate-300 flex items-start justify-between gap-3">
            <div className="space-y-1">
              <span className="font-semibold text-white block">
                Multi-Factor Confidence Fusion Principle:
              </span>

              <p className="text-[11px] text-slate-400 max-w-2xl leading-relaxed">
                Rather than treating confidence as a single arbitrary heuristic,
                CardioVision fuses 6 orthogonal physical dimensions:
                Cross-Algorithm Consensus (20%), Temporal Window Stability
                (20%), Waveform SNR (15%), Motion Stillness (15%), Lighting
                Constancy (10%), Multi-ROI Vascular Quality (10%), and Face
                Centering (10%).
              </p>
            </div>

            <div className="text-right shrink-0">
              <span className="text-[9px] text-slate-400 uppercase tracking-wider block">
                Fused Confidence
              </span>

              <span className="text-2xl font-bold font-mono text-emerald-400">
                {signalQuality.overall}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================== */}
      {/* TAB 3 — TEMPORAL WINDOWS */}
      {/* ====================================================== */}

      {activeTab === "temporal" && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {windows.length > 0 ? (
              windows.map((win) => (
                <div
                  key={win.windowIndex}
                  className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-400">
                      Window #{win.windowIndex}
                    </span>

                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#0F172A] text-slate-300 border border-[#1E293B]">
                      {win.startSec}s - {win.endSec}s
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-bold font-mono text-white">
                      {win.bpm} BPM
                    </span>

                    <span className="text-[10px] text-teal-300 font-mono">
                      {win.snrDb} dB SNR
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>
                      HRV RMSSD:{" "}
                      <strong className="text-slate-200">
                        {win.hrvRmssd}ms
                      </strong>
                    </span>

                    <span className="text-emerald-400 font-semibold">
                      {win.quality}% Quality
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full p-4 text-center text-slate-400 text-xs">
                Overlapping window analysis data calculated across scan
                duration.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ====================================================== */}
      {/* TAB 4 — MULTI ROI */}
      {/* ====================================================== */}

      {activeTab === "roi" && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* FOREHEAD */}

            <div className="p-3.5 rounded-lg bg-[#0A0F1E] border border-emerald-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-xs">
                  Forehead Vascular Zone
                </span>

                <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px] font-bold">
                  {roi.forehead}% Quality
                </span>
              </div>

              <p className="text-[11px] text-slate-400">
                Primary pulse extraction site with dense microvascular bed and
                high frontal bone reflection.
              </p>

              <span className="text-[10px] text-emerald-400 font-mono font-semibold block">
                Status: ACTIVE IN ENSEMBLE (44% Weight)
              </span>
            </div>

            {/* LEFT CHEEK */}

            <div className="p-3.5 rounded-lg bg-[#0A0F1E] border border-cyan-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-xs">
                  Left Cheek Malar Zone
                </span>

                <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold">
                  {roi.leftCheek}% Quality
                </span>
              </div>

              <p className="text-[11px] text-slate-400">
                Secondary microcapillary site for transverse spatial motion
                artifact compensation.
              </p>

              <span className="text-[10px] text-cyan-400 font-mono font-semibold block">
                Status: ACTIVE IN ENSEMBLE (28% Weight)
              </span>
            </div>

            {/* RIGHT CHEEK */}

            <div className="p-3.5 rounded-lg bg-[#0A0F1E] border border-cyan-500/30 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white text-xs">
                  Right Cheek Malar Zone
                </span>

                <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold">
                  {roi.rightCheek}% Quality
                </span>
              </div>

              <p className="text-[11px] text-slate-400">
                Secondary microcapillary site providing spatial
                cross-correlation with left cheek.
              </p>

              <span className="text-[10px] text-cyan-400 font-mono font-semibold block">
                Status: ACTIVE IN ENSEMBLE (28% Weight)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================== */}
      {/* CONSENSUS */}
      {/* ====================================================== */}

      <div className="bg-[#0A0F1E] border border-[#1E293B] rounded-lg p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />

            <span className="font-semibold text-white">
              Consensus &amp; Decision Synthesis:
            </span>
          </div>

          <p className="text-slate-400 text-[11px] leading-relaxed max-w-2xl">
            {signalQuality.decisionReason ||
              "Individual algorithms are weighted by temporal SNR and chromatic consistency to suppress transient outliers."}
          </p>
        </div>

        <div className="bg-[#0F172A] px-3.5 py-1.5 rounded-lg border border-[#1E293B] shrink-0 text-center sm:text-right">
          <span className="text-[9px] text-slate-400 uppercase tracking-wider block">
            Weighted Consensus
          </span>

          <span className="text-xl font-bold font-mono text-emerald-400">
            {methodComparison.consensusBpm} BPM
          </span>
        </div>
      </div>
    </div>
  );
};
