import React, { useState } from 'react';
import { Cpu, Play, CheckCircle, RefreshCw, Layers, ShieldCheck, AlertTriangle } from 'lucide-react';
import { BENCHMARK_PRESETS, BenchmarkPreset, generateSyntheticRPPGSamples } from '../rppg/synthesizer';
import { runRPPGPipeline, requestAICardioAnalysis } from '../rppg/pipeline';
import { ScreeningSessionResult } from '../types';

interface Props {
  onRunPreset: (result: ScreeningSessionResult) => void;
}

export const BenchmarkPresetsView: React.FC<Props> = ({ onRunPreset }) => {
  const [selectedPreset, setSelectedPreset] = useState<BenchmarkPreset>(BENCHMARK_PRESETS[0]);
  const [isRunning, setIsRunning] = useState(false);
  const [durationSec, setDurationSec] = useState(28);

  const handleExecute = async (preset: BenchmarkPreset) => {
    setSelectedPreset(preset);
    setIsRunning(true);
    try {
      // Generate synthetic optical samples
      const samples = generateSyntheticRPPGSamples(preset, durationSec, 30);
      // Run complete multi-method pipeline
      const result = await runRPPGPipeline(samples, 30, {
        age: 35,
        restingState: preset.category,
      });

      // Request AI analysis
      const aiAnalysis = await requestAICardioAnalysis(result);
      if (aiAnalysis) {
        result.aiAnalysis = aiAnalysis;
      }

      setIsRunning(false);
      onRunPreset(result);
    } catch (e) {
      console.error(e);
      setIsRunning(false);
      alert('Error running benchmark simulation.');
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 sm:p-5 shadow-lg">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-[#1E293B]">
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-400" />
              Standardized rPPG Physiological Benchmark Suite
            </h3>
            <p className="text-[11px] text-slate-400">
              Evaluate and stress-test G, CHROM, POS, and VitalLens against controlled physiological waveforms & noise models
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 text-[11px]">Duration:</span>
            <select
              value={durationSec}
              onChange={(e) => setDurationSec(parseInt(e.target.value))}
              className="bg-[#0A0F1E] border border-[#1E293B] rounded px-2 py-0.5 text-white text-xs font-mono"
            >
              <option value={15}>15 seconds</option>
              <option value={28}>28 seconds (Standard)</option>
              <option value={45}>45 seconds (Extended)</option>
            </select>
          </div>
        </div>

        {/* Presets Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
          {BENCHMARK_PRESETS.map((preset) => {
            const isSelected = selectedPreset.id === preset.id;
            return (
              <div
                key={preset.id}
                className={`p-3.5 rounded-lg border transition flex flex-col justify-between cursor-pointer ${
                  isSelected
                    ? 'bg-[#0A0F1E] border-emerald-500/70 shadow-md ring-1 ring-emerald-500/40'
                    : 'bg-[#0A0F1E] border-[#1E293B] hover:border-slate-600'
                }`}
                onClick={() => setSelectedPreset(preset)}
              >
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="font-bold text-white text-xs">{preset.name}</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-semibold uppercase bg-[#0F172A] text-slate-300 border border-[#1E293B]">
                      {preset.category}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed mb-3 line-clamp-2">
                    {preset.description}
                  </p>

                  <div className="grid grid-cols-3 gap-1.5 p-2 rounded bg-[#0F172A] border border-[#1E293B] text-[10px] text-center mb-3">
                    <div>
                      <span className="text-slate-500 block text-[8px] uppercase font-mono">Target HR</span>
                      <strong className="text-white font-mono">{preset.targetBpm} BPM</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[8px] uppercase font-mono">Target HRV</span>
                      <strong className="text-emerald-400 font-mono">{preset.targetHRV} ms</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[8px] uppercase font-mono">Noise</span>
                      <strong className="text-amber-400 font-mono">{Math.round(preset.noiseLevel * 100)}%</strong>
                    </div>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExecute(preset);
                  }}
                  disabled={isRunning}
                  className="w-full py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-[#0A0F1E] font-bold text-xs shadow transition flex items-center justify-center gap-1.5"
                >
                  {isRunning && selectedPreset.id === preset.id ? (
                    <>
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      Processing Pipeline...
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3 fill-current" />
                      Run Benchmark Pipeline
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
