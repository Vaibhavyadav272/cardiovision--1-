import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { DisclaimerBanner } from './components/DisclaimerBanner';
import { CameraCapture } from './components/CameraCapture';
import { VitalsCardGrid } from './components/VitalsCardGrid';
import { WaveformVisualizer } from './components/WaveformVisualizer';
import { MultiMethodBenchmark } from './components/MultiMethodBenchmark';
import { CardioRiskDashboard } from './components/CardioRiskDashboard';
import { BaselineTrends } from './components/BaselineTrends';
import { BenchmarkPresetsView } from './components/BenchmarkPresetsView';
import { AlgorithmExplainer } from './components/AlgorithmExplainer';
import { ClinicalReportModal } from './components/ClinicalReportModal';
import { AppMode, ScreeningSessionResult } from './types';
import { BENCHMARK_PRESETS, generateSyntheticRPPGSamples } from './rppg/synthesizer';
import { runRPPGPipeline, requestAICardioAnalysis } from './rppg/pipeline';
import { Camera, Sparkles, Activity, ShieldCheck, Cpu, History } from 'lucide-react';

export function App() {
  const [currentMode, setCurrentMode] = useState<AppMode>('scan');
  const [currentResult, setCurrentResult] = useState<ScreeningSessionResult | null>(null);
  const [history, setHistory] = useState<ScreeningSessionResult[]>([]);
  const [showDisclaimerModal, setShowDisclaimerModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  // Load history on initial mount and seed with a baseline if empty
  useEffect(() => {
    try {
      const stored = localStorage.getItem('cardiovision_history');
      if (stored) {
        setHistory(JSON.parse(stored));
      } else {
        // Seed an initial demo baseline session
        seedInitialDemoSession();
      }
    } catch (e) {
      console.error('Failed to load history:', e);
    }
  }, []);

  const seedInitialDemoSession = async () => {
    try {
      const preset = BENCHMARK_PRESETS[0]; // Normal Resting Adult (72 BPM)
      const samples = generateSyntheticRPPGSamples(preset, 28, 30);
      const result = await runRPPGPipeline(samples, 30, {
        age: 34,
        restingState: 'Seated & Resting (Baseline)',
      });
      // Attach initial analysis
      result.aiAnalysis = {
        clinicalOverview:
          'Resting cardiovascular vitals indicate balanced chronotropic rhythm with optimal microvascular perfusion across tested facial regions.',
        cardiacRhythmTone:
          'HRV RMSSD of 42ms demonstrates healthy parasympathetic vagal modulation and normal sinus variability.',
        respiratoryCoupling:
          '14 breaths/min with synchronous respiratory sinus arrhythmia (RSA) ~5:1 ratio.',
        screeningIndication:
          'Lower Indication: Physiological metrics are consistent with healthy resting norms.',
        methodReliability:
          'High Agreement across POS, CHROM, and VitalLens models (std dev < 1.5 BPM).',
        lifestyleGuidance: [
          'Maintain regular aerobic physical activity (150 min/week).',
          'Continue adequate hydration and standard sleep hygiene.',
          'Re-screen at the same time of day for reliable baseline tracking.',
        ],
        doctorDiscussionPoints: [
          'Review resting heart rate consistency during annual physical.',
          'Discuss autonomic recovery profile after endurance exercise.',
        ],
        confidenceScore: 0.94,
      };

      setCurrentResult(result);
      const initialHistory = [result];
      setHistory(initialHistory);
      localStorage.setItem('cardiovision_history', JSON.stringify(initialHistory));
    } catch (e) {
      console.error('Initial seed error:', e);
    }
  };

  const saveSession = (result: ScreeningSessionResult) => {
    setCurrentResult(result);
    setHistory((prev) => {
      const updated = [result, ...prev.slice(0, 49)];
      try {
        localStorage.setItem('cardiovision_history', JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to save session to local storage:', err);
      }
      return updated;
    });
  };

  const handleClearHistory = () => {
    if (confirm('Are you sure you want to clear your baseline scan history?')) {
      setHistory([]);
      localStorage.removeItem('cardiovision_history');
    }
  };

  const handleSelectHistorySession = (session: ScreeningSessionResult) => {
    setCurrentResult(session);
    setCurrentMode('scan');
  };

  return (
    <div className="min-h-screen bg-[#0A0F1E] text-slate-200 font-sans flex flex-col selection:bg-emerald-500 selection:text-[#0A0F1E]">
      {/* Top Medical Disclaimer Bar */}
      <DisclaimerBanner variant="banner" />

      {/* Main Navbar */}
      <Navbar
        currentMode={currentMode}
        onSelectMode={(mode) => setCurrentMode(mode)}
        onOpenDisclaimer={() => setShowDisclaimerModal(true)}
        isScanning={isScanning}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-5 lg:px-6 py-4 sm:py-5 space-y-5">
        {/* Mode 1: Live Camera Scan */}
        {currentMode === 'scan' && (
          <div className="space-y-5">
            {/* Camera Viewport Component */}
            <CameraCapture
              onScanComplete={(result) => {
                saveSession(result);
              }}
              onSwitchToBenchmark={() => setCurrentMode('benchmark')}
            />

            {/* Results Section for Latest Completed Scan */}
            {currentResult && (
              <div className="space-y-4 pt-3 border-t border-[#1E293B]">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <Activity className="w-4 h-4 text-emerald-400" />
                      Screening Session Results
                    </h2>
                    <p className="text-[11px] text-slate-400 font-mono">
                      Session {currentResult.id} • {currentResult.dateString} ({currentResult.durationSec}s)
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowReportModal(true)}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[#0A0F1E] font-bold text-xs transition shadow-md shadow-emerald-950/40"
                    >
                      Export Clinical Report
                    </button>
                  </div>
                </div>

                {/* Vitals Summary Cards */}
                <VitalsCardGrid result={currentResult} />

                {/* Cardio Screening & AI Synthesis */}
                <CardioRiskDashboard
                  result={currentResult}
                  onOpenReport={() => setShowReportModal(true)}
                  onUpdateAnalysis={(analysis) => {
                    if (currentResult) {
                      const updated = { ...currentResult, aiAnalysis: analysis };
                      setCurrentResult(updated);
                      setHistory((prev) =>
                        prev.map((s) => (s.id === currentResult.id ? updated : s))
                      );
                    }
                  }}
                />

                {/* Multi-Method Comparison */}
                <MultiMethodBenchmark result={currentResult} />

                {/* Pulse Waveforms & Spectrum */}
                <WaveformVisualizer result={currentResult} />
              </div>
            )}
          </div>
        )}

        {/* Mode 2: Synthetic Benchmark Presets */}
        {currentMode === 'benchmark' && (
          <div className="space-y-5">
            <BenchmarkPresetsView
              onRunPreset={(result) => {
                saveSession(result);
                setCurrentMode('scan');
              }}
            />
          </div>
        )}

        {/* Mode 3: Algorithms Deep Dive */}
        {currentMode === 'algorithms' && <AlgorithmExplainer />}

        {/* Mode 4: Baseline & History */}
        {currentMode === 'history' && (
          <BaselineTrends
            history={history}
            onClearHistory={handleClearHistory}
            onSelectSession={handleSelectHistorySession}
          />
        )}

        {/* Mode 5: About & Clinical Documentation */}
        {currentMode === 'about' && (
          <div className="max-w-4xl mx-auto space-y-5">
            <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-5 shadow-lg space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                About CardioVision Project
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                CardioVision is an advanced research and triage prototype created to demonstrate camera-based cardiovascular screening using multi-method remote photoplethysmography (rPPG). By combining classic optical signal processing (G-Channel, CHROM, POS) with spatio-temporal neural estimation (VitalLens) and Gemini 3.7 Flash clinical interpretation, the platform enables accessible, non-contact physiological screening from any standard smartphone or webcam.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] text-xs space-y-1">
                  <strong className="text-emerald-400 block font-mono">Camera-Only Operation:</strong>
                  <p className="text-slate-400 text-[11px]">
                    No specialized sensors, electrodes, or wearables required. Real-time client-side face and ROI tracking.
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-[#0A0F1E] border border-[#1E293B] text-xs space-y-1">
                  <strong className="text-teal-400 block font-mono">Consensus Validation:</strong>
                  <p className="text-slate-400 text-[11px]">
                    Ensemble agreement checks protect against motion artifacts, illumination shifts, and sensor noise.
                  </p>
                </div>
              </div>
            </div>
            <AlgorithmExplainer />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1E293B] bg-[#070B14] py-4 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2.5">
          <p className="text-[11px]">
            CardioVision • High-Density Multi-Method rPPG Physiological Screening System
          </p>
          <button
            onClick={() => setShowDisclaimerModal(true)}
            className="text-amber-400/80 hover:text-amber-300 transition underline underline-offset-2 text-[11px]"
          >
            Clinical & FDA Disclaimer Notice
          </button>
        </div>
      </footer>

      {/* Disclaimer Modal */}
      {showDisclaimerModal && (
        <DisclaimerBanner
          variant="modal"
          onClose={() => setShowDisclaimerModal(false)}
        />
      )}

      {/* Full Clinical Report Modal */}
      {showReportModal && currentResult && (
        <ClinicalReportModal
          result={currentResult}
          onClose={() => setShowReportModal(false)}
        />
      )}
    </div>
  );
}

export default App;
