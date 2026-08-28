import React, { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceLine,
} from 'recharts';
import { Activity, Layers, BarChart2, Eye, Moon } from 'lucide-react';
import { ScreeningSessionResult, RPPGMethod } from '../types';

interface Props {
  result: ScreeningSessionResult;
}

export const WaveformVisualizer: React.FC<Props> = ({ result }) => {
  const [activeTab, setActiveTab] = useState<'waveforms' | 'spectrum' | 'raw'>('waveforms');
  const [selectedMethod, setSelectedMethod] = useState<RPPGMethod | 'all'>('all');

  const { timeSeries, methodResults, methodComparison, adaptiveNoiseCancellation, lowLightModeActive } = result;

  // Format data for Recharts time-series
  const chartData = timeSeries.time.map((t, idx) => ({
    time: t,
    timeLabel: `${t}s`,
    gWaveform: timeSeries.gWaveform[idx] || 0,
    chromWaveform: timeSeries.chromWaveform[idx] || 0,
    posWaveform: timeSeries.posWaveform[idx] || 0,
    vitalLensWaveform: timeSeries.vitalLensWaveform[idx] || 0,
    rawG: timeSeries.rawG[idx] || 0,
  }));

  // Primary method spectrum (POS or VitalLens)
  const spectrumData = methodResults.pos.spectrum
    .filter((bin) => bin.freq >= 0.2 && bin.freq <= 4.0)
    .map((bin) => ({
      freq: bin.freq,
      freqLabel: `${bin.freq} Hz`,
      power: parseFloat(bin.power.toFixed(4)),
      isCardiacPeak: Math.abs(bin.freq - methodComparison.consensusBpm / 60) <= 0.12,
    }));

  return (
    <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 sm:p-5 shadow-lg space-y-3.5">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 pb-2.5 border-b border-[#1E293B]">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              rPPG Pulse Waveforms & Spectral Density
            </h3>
            {adaptiveNoiseCancellation && (
              <span className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border ${
                lowLightModeActive
                  ? 'bg-cyan-950/80 border-cyan-500/50 text-cyan-300'
                  : 'bg-slate-800/80 border-slate-700 text-slate-300'
              }`}>
                <Moon className="w-2.5 h-2.5 text-cyan-400" />
                {lowLightModeActive ? 'ANC Filter Active' : 'ANC Standby'}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-400">
            Multi-method photoplethysmography waveform reconstruction and peak periodicity
          </p>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex bg-[#0A0F1E] p-0.5 rounded-lg border border-[#1E293B] text-xs">
            <button
              onClick={() => setActiveTab('waveforms')}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                activeTab === 'waveforms'
                  ? 'bg-emerald-500 text-[#0A0F1E] font-bold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-1.5 text-xs">
                <Layers className="w-3 h-3" /> Waveforms
              </span>
            </button>
            <button
              onClick={() => setActiveTab('spectrum')}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                activeTab === 'spectrum'
                  ? 'bg-emerald-500 text-[#0A0F1E] font-bold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-1.5 text-xs">
                <BarChart2 className="w-3 h-3" /> FFT Spectrum
              </span>
            </button>
            <button
              onClick={() => setActiveTab('raw')}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                activeTab === 'raw'
                  ? 'bg-emerald-500 text-[#0A0F1E] font-bold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="flex items-center gap-1.5 text-xs">
                <Eye className="w-3 h-3" /> Raw RGB
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Filter selector for waveforms */}
      {activeTab === 'waveforms' && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs">
          <span className="text-slate-400 text-[10px] font-medium mr-1 uppercase">Filter:</span>
          <button
            onClick={() => setSelectedMethod('all')}
            className={`px-2 py-0.5 rounded text-[11px] border transition ${
              selectedMethod === 'all'
                ? 'bg-slate-800 text-white border-slate-600 font-bold'
                : 'text-slate-400 border-[#1E293B] hover:text-slate-200'
            }`}
          >
            All Methods (Overlay)
          </button>
          <button
            onClick={() => setSelectedMethod('pos')}
            className={`px-2 py-0.5 rounded text-[11px] border transition ${
              selectedMethod === 'pos'
                ? 'bg-cyan-950/80 text-cyan-300 border-cyan-500/50 font-bold'
                : 'text-slate-400 border-[#1E293B] hover:text-slate-200'
            }`}
          >
            POS Algorithm ({methodResults.pos.bpm} BPM)
          </button>
          <button
            onClick={() => setSelectedMethod('chrom')}
            className={`px-2 py-0.5 rounded text-[11px] border transition ${
              selectedMethod === 'chrom'
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50 font-bold'
                : 'text-slate-400 border-[#1E293B] hover:text-slate-200'
            }`}
          >
            CHROM ({methodResults.chrom.bpm} BPM)
          </button>
          <button
            onClick={() => setSelectedMethod('vitallens')}
            className={`px-2 py-0.5 rounded text-[11px] border transition ${
              selectedMethod === 'vitallens'
                ? 'bg-purple-950/80 text-purple-300 border-purple-500/50 font-bold'
                : 'text-slate-400 border-[#1E293B] hover:text-slate-200'
            }`}
          >
            VitalLens Model ({methodResults.vitallens.bpm} BPM)
          </button>
          <button
            onClick={() => setSelectedMethod('g')}
            className={`px-2 py-0.5 rounded text-[11px] border transition ${
              selectedMethod === 'g'
                ? 'bg-teal-950/80 text-teal-300 border-teal-500/50 font-bold'
                : 'text-slate-400 border-[#1E293B] hover:text-slate-200'
            }`}
          >
            G Channel ({methodResults.g.bpm} BPM)
          </button>
        </div>
      )}

      {/* Main Chart Area */}
      <div className="h-60 sm:h-64 w-full bg-[#0A0F1E] rounded-lg border border-[#1E293B] p-2 relative">
        {activeTab === 'waveforms' && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <XAxis dataKey="time" stroke="#475569" tickFormatter={(v) => `${v}s`} tick={{ fontSize: 9 }} />
              <YAxis stroke="#475569" domain={[-3, 3]} tick={{ fontSize: 9 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#1e293b',
                  borderRadius: '0.5rem',
                  fontSize: '11px',
                }}
              />
              <ReferenceLine y={0} stroke="#334155" strokeDasharray="3 3" />

              {(selectedMethod === 'all' || selectedMethod === 'pos') && (
                <Line
                  type="monotone"
                  dataKey="posWaveform"
                  name="POS Plane Orthogonal"
                  stroke="#06b6d4"
                  strokeWidth={selectedMethod === 'pos' ? 2.5 : 1.8}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              {(selectedMethod === 'all' || selectedMethod === 'chrom') && (
                <Line
                  type="monotone"
                  dataKey="chromWaveform"
                  name="CHROM Chrominance"
                  stroke="#10b981"
                  strokeWidth={selectedMethod === 'chrom' ? 2.5 : 1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              {(selectedMethod === 'all' || selectedMethod === 'vitallens') && (
                <Line
                  type="monotone"
                  dataKey="vitalLensWaveform"
                  name="VitalLens Neural"
                  stroke="#a855f7"
                  strokeWidth={selectedMethod === 'vitallens' ? 2.5 : 1.5}
                  strokeDasharray={selectedMethod === 'all' ? '4 4' : undefined}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              {(selectedMethod === 'all' || selectedMethod === 'g') && (
                <Line
                  type="monotone"
                  dataKey="gWaveform"
                  name="G-Channel (Baseline)"
                  stroke="#14b8a6"
                  strokeWidth={selectedMethod === 'g' ? 2.5 : 1}
                  strokeDasharray="2 2"
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}

        {activeTab === 'spectrum' && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spectrumData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="spectrumGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="freq"
                stroke="#475569"
                tickFormatter={(v) => `${v} Hz`}
                tick={{ fontSize: 9 }}
              />
              <YAxis stroke="#475569" tick={{ fontSize: 9 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#1e293b',
                  borderRadius: '0.5rem',
                  fontSize: '11px',
                }}
                formatter={(value: any, name: any, item: any) => [
                  `${value} power (${Math.round(item.payload.freq * 60)} BPM)`,
                  'Spectral PSD',
                ]}
              />
              <ReferenceLine
                x={parseFloat((methodComparison.consensusBpm / 60).toFixed(2))}
                stroke="#f43f5e"
                strokeDasharray="3 3"
                label={{
                  value: `Peak ${methodComparison.consensusBpm} BPM`,
                  fill: '#f43f5e',
                  fontSize: 9,
                }}
              />
              <Area
                type="monotone"
                dataKey="power"
                stroke="#10b981"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#spectrumGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {activeTab === 'raw' && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <XAxis dataKey="time" stroke="#475569" tickFormatter={(v) => `${v}s`} tick={{ fontSize: 9 }} />
              <YAxis stroke="#475569" domain={['dataMin - 5', 'dataMax + 5']} tick={{ fontSize: 9 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  borderColor: '#1e293b',
                  borderRadius: '0.5rem',
                  fontSize: '11px',
                }}
              />
              <Line
                type="monotone"
                dataKey="rawG"
                name="Raw Green ROI Average (8-bit)"
                stroke="#10b981"
                strokeWidth={1.8}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legend & Stats */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 text-[10px] text-slate-400 pt-0.5">
        <div className="flex items-center gap-3.5">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400" /> POS Algorithm
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> CHROM Chrominance
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-purple-400" /> VitalLens Model
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-teal-400" /> G-Channel
          </span>
        </div>
        <div className="font-mono text-slate-300 text-[10px]">
          Duration: {result.durationSec}s | Bandpass: 0.7 - 3.8 Hz (42-228 BPM)
        </div>
      </div>
    </div>
  );
};
