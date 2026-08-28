import React from 'react';
import { Layers, Activity, Cpu, ShieldCheck, BookOpen, CheckCircle, Sliders, Eye } from 'lucide-react';

export const AlgorithmExplainer: React.FC = () => {
  return (
    <div className="max-w-5xl mx-auto space-y-4 text-slate-200">
      {/* Header */}
      <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 sm:p-5 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#0A0F1E] text-emerald-400 border border-emerald-500/20">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">
              Remote Photoplethysmography (rPPG) Architecture & Theory
            </h2>
            <p className="text-[11px] text-slate-400">
              Technical foundation, mathematical formulation, and multi-method cross-validation
            </p>
          </div>
        </div>
      </div>

      {/* Principle of rPPG */}
      <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 sm:p-5 shadow-lg space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          1. Physical Principles of Non-Contact rPPG
        </h3>
        <p className="text-xs text-slate-300 leading-relaxed">
          During each cardiac cycle, the left ventricle ejects oxygenated blood through the arterial tree into facial capillary beds. Oxygenated hemoglobin (HbO2) has a pronounced optical absorption peak in the green-yellow spectrum (520–580 nm). As capillary blood volume pulsates periodically, the amount of diffuse reflected light from facial skin fluctuates by approximately 0.2%–2.0%—invisible to the human eye, but detectable by standard RGB camera sensors.
        </p>

        <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] text-xs space-y-1.5">
          <span className="font-mono text-emerald-400 font-bold block text-[11px]">Skin Reflection Dichromatic Model:</span>
          <p className="text-slate-300 font-mono text-[11px]">
            C(t) = I(t) · [ u_s · S(t) + u_d · D(t) ] + N(t)
          </p>
          <p className="text-slate-400 text-[10px]">
            Where I(t) represents ambient illumination, u_s is specular (mirror-like) reflection, u_d is diffuse dermal reflection carrying the pulsatile blood volume pulse (BVP), and N(t) represents sensor thermal shot noise and motion artifacts.
          </p>
        </div>
      </div>

      {/* The 4 Implemented Algorithms */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Method 1: G-Channel */}
        <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 shadow-lg space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white">1. G-Channel (Baseline)</span>
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#0A0F1E] text-teal-300 border border-teal-700/50">
              Baseline
            </span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Extracts the raw mean Green intensity across the selected Region of Interest (ROI), applies temporal detrending and zero-phase Butterworth bandpass filtering (0.7–3.8 Hz).
          </p>
          <div className="p-2 rounded bg-[#0A0F1E] font-mono text-[10px] text-teal-300 border border-[#1E293B]">
            S_G(t) = -bandpass( detrend( G_ROI(t) ) )
          </div>
        </div>

        {/* Method 2: CHROM */}
        <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 shadow-lg space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white">2. CHROM (Chrominance Subspace)</span>
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#0A0F1E] text-emerald-300 border border-emerald-700/50">
              de Haan 2013
            </span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Constructs two orthogonal chrominance signals (Xs and Ys) that eliminate specular reflections and linear luminance intensity variations.
          </p>
          <div className="p-2 rounded bg-[#0A0F1E] font-mono text-[10px] text-emerald-300 border border-[#1E293B] space-y-0.5">
            <div>X_s = 3R_n - 2G_n</div>
            <div>Y_s = 1.5R_n + G_n - 1.5B_n</div>
            <div>S_CHROM = X_s - (σ(X_s) / σ(Y_s)) · Y_s</div>
          </div>
        </div>

        {/* Method 3: POS */}
        <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 shadow-lg space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white">3. POS (Plane-Orthogonal-to-Skin)</span>
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#0A0F1E] text-cyan-300 border border-cyan-700/50">
              Wang et al. 2017
            </span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Projects temporally normalized RGB signals onto a two-dimensional subspace orthogonal to the skin tone vector, suppressing head motion artifacts.
          </p>
          <div className="p-2 rounded bg-[#0A0F1E] font-mono text-[10px] text-cyan-300 border border-[#1E293B] space-y-0.5">
            <div>S_1 = G_n - B_n</div>
            <div>S_2 = G_n + B_n - 2R_n</div>
            <div>S_POS = S_1 + 1.2 · S_2</div>
          </div>
        </div>

        {/* Method 4: VitalLens Cloud API & Multi-ROI Model */}
        <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 shadow-lg space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-white">4. VitalLens API &amp; Spatial Ensemble</span>
            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#0A0F1E] text-purple-300 border border-purple-700/50">
              VitalLens Cloud / Local
            </span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Integrates the official VitalLens Cloud rPPG API (api.rouast.com/vitallens-v3) via standardized 40x40 RGB24 video streaming, backed by local multi-ROI spatial fusion.
          </p>
          <div className="p-2 rounded bg-[#0A0F1E] font-mono text-[10px] text-purple-300 border border-[#1E293B]">
            POST https://api.rouast.com/vitallens-v3/file (RGB24 40x40)
          </div>
        </div>
      </div>

      {/* Multi-Factor Confidence Fusion & Decision Engine */}
      <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 sm:p-5 shadow-lg space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          2. Multi-Factor Confidence Fusion &amp; Decision Engine
        </h3>
        <p className="text-xs text-slate-300 leading-relaxed">
          Rather than relying on arbitrary heuristics, CardioVision calculates a fused quality score across 7 orthogonal physical dimensions:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
            <strong className="text-white block font-mono text-xs">1. Cross-Method Agreement (20%)</strong>
            <p className="text-slate-400 text-[10px]">Measures BPM dispersion (σ &amp; range) across G, CHROM, POS, and Multi-ROI methods.</p>
          </div>
          <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
            <strong className="text-white block font-mono text-xs">2. Temporal Window Stability (20%)</strong>
            <p className="text-slate-400 text-[10px]">Evaluates heart rate consistency across overlapping 10-second sliding windows.</p>
          </div>
          <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
            <strong className="text-white block font-mono text-xs">3. Waveform Spectral SNR (15%)</strong>
            <p className="text-slate-400 text-[10px]">Computes the power ratio between the fundamental pulse harmonic and broadband noise floor.</p>
          </div>
          <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
            <strong className="text-white block font-mono text-xs">4. Motion Stillness (15%)</strong>
            <p className="text-slate-400 text-[10px]">Tracks inter-frame centroid displacement and facial landmark drift.</p>
          </div>
          <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
            <strong className="text-white block font-mono text-xs">5. Lighting Uniformity (10%)</strong>
            <p className="text-slate-400 text-[10px]">Monitors ambient luminance levels to prevent underexposure (&lt; 40 Lux) or glare saturation.</p>
          </div>
          <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
            <strong className="text-white block font-mono text-xs">6. Multi-ROI Vascular Quality (10%)</strong>
            <p className="text-slate-400 text-[10px]">Independent brightness and microcapillary visibility scoring on forehead and cheeks.</p>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-[#0A0F1E] border border-emerald-500/30 text-xs flex items-center justify-between">
          <span className="text-slate-300">
            <strong>Decision Engine Tiers:</strong> ACCEPT (High confidence &amp; stability), CAUTION (Moderate variance), or RETRY (Suboptimal optical conditions).
          </span>
        </div>
      </div>

      {/* Adaptive Noise Cancellation (ANC) Low-Light Section */}
      <div className="bg-[#0F172A] border border-cyan-500/30 rounded-xl p-4 sm:p-5 shadow-lg space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            3. Adaptive Noise Cancellation (ANC) in Low-Light Settings
          </h3>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-500/40 font-bold">
            Low-Light Denoising Filter
          </span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          In low ambient lighting conditions (&lt; 85 Lux), webcam image sensors automatically increase analog gain (ISO). This introduces heavy CMOS thermal shot-noise and sensor quantization stepping that can degrade the faint 0.2%–2.0% microvascular pulse amplitude. When ANC is enabled, CardioVision executes an adaptive multi-stage filtering cascade:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
            <strong className="text-cyan-300 block font-mono text-xs">1. Running Median Filter</strong>
            <p className="text-slate-400 text-[10px]">
              A 3-sample sliding median kernel strips single-frame pixel dropouts, fluorescent light flicker, and spike discontinuities.
            </p>
          </div>
          <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
            <strong className="text-cyan-300 block font-mono text-xs">2. 5-Point Savitzky-Golay</strong>
            <p className="text-slate-400 text-[10px]">
              Quadratic polynomial smoothing <code className="text-cyan-200">[-3, 12, 17, 12, -3] / 35</code> reduces high-frequency thermal noise while preserving systolic wave peaks.
            </p>
          </div>
          <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] space-y-1">
            <strong className="text-cyan-300 block font-mono text-xs">3. Forehead Spatial Weighting</strong>
            <p className="text-slate-400 text-[10px]">
              Dynamically boosts weight to the forehead ROI where capillary bed density is highest and shadow gradients are minimal.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
