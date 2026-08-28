import React, { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { History, TrendingDown, TrendingUp, Download, Trash2, Calendar, FileSpreadsheet } from 'lucide-react';
import { ScreeningSessionResult } from '../types';

interface Props {
  history: ScreeningSessionResult[];
  onClearHistory: () => void;
  onSelectSession: (session: ScreeningSessionResult) => void;
}

export const BaselineTrends: React.FC<Props> = ({
  history,
  onClearHistory,
  onSelectSession,
}) => {
  const [selectedMetric, setSelectedMetric] = useState<'hr' | 'hrv' | 'rr'>('hr');

  if (history.length === 0) {
    return (
      <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-6 shadow-lg text-center">
        <div className="w-10 h-10 rounded-xl bg-[#0A0F1E] border border-emerald-500/30 flex items-center justify-center text-emerald-400 mx-auto mb-2.5">
          <History className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-semibold text-white mb-1">No Baseline Sessions Recorded Yet</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto mb-3">
          Complete multiple video scans over several days to establish your personal physiological baseline and observe cardiovascular trends.
        </p>
      </div>
    );
  }

  // Calculate baseline averages
  const avgHR = Math.round(history.reduce((a, b) => a + b.heartRate, 0) / history.length);
  const avgHRV = Math.round(history.reduce((a, b) => a + b.hrv.rmssd, 0) / history.length);
  const avgRR = Math.round(history.reduce((a, b) => a + b.respiratoryRate, 0) / history.length);

  // Prepare chronological chart data
  const chartData = [...history]
    .reverse()
    .map((session, idx) => ({
      index: idx + 1,
      label: `Session ${idx + 1}`,
      date: new Date(session.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      hr: session.heartRate,
      hrv: session.hrv.rmssd,
      rr: session.respiratoryRate,
      quality: session.signalQuality.overall,
      riskLevel: session.riskLevel,
      session,
    }));

  const exportCSV = () => {
    const headers = ['SessionID', 'Date', 'HeartRate_BPM', 'HRV_RMSSD_ms', 'HRV_SDNN_ms', 'RespiratoryRate', 'Quality_Pct', 'RiskLevel'];
    const rows = history.map((s) => [
      s.id,
      `"${s.dateString}"`,
      s.heartRate,
      s.hrv.rmssd,
      s.hrv.sdnn,
      s.respiratoryRate,
      s.signalQuality.overall,
      s.riskLevel,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `cardiovision_baseline_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-[#0F172A] border border-[#1E293B] rounded-xl p-4 sm:p-5 shadow-lg space-y-4">
      {/* Header & Baseline Stat Pills */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-[#1E293B]">
        <div>
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <History className="w-4 h-4 text-emerald-400" />
            Personal Physiological Baseline & Trends
          </h3>
          <p className="text-[11px] text-slate-400">
            Longitudinal multi-session monitoring ({history.length} total recordings)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#0A0F1E] hover:bg-slate-800 text-slate-300 text-xs font-medium border border-[#1E293B] transition"
          >
            <Download className="w-3 h-3" />
            <span>Export CSV</span>
          </button>
          <button
            onClick={onClearHistory}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 text-xs font-medium border border-rose-700/40 transition"
          >
            <Trash2 className="w-3 h-3 text-rose-400" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Baseline KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="bg-[#0A0F1E] border border-[#1E293B] rounded-lg p-3">
          <span className="text-slate-400 uppercase tracking-wider text-[10px] font-semibold">
            Baseline Resting HR
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono text-white">{avgHR}</span>
            <span className="text-slate-400 text-xs">BPM (Mean)</span>
          </div>
        </div>

        <div className="bg-[#0A0F1E] border border-[#1E293B] rounded-lg p-3">
          <span className="text-slate-400 uppercase tracking-wider text-[10px] font-semibold">
            Baseline Autonomic HRV
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono text-emerald-400">{avgHRV}</span>
            <span className="text-slate-400 text-xs">ms RMSSD</span>
          </div>
        </div>

        <div className="bg-[#0A0F1E] border border-[#1E293B] rounded-lg p-3">
          <span className="text-slate-400 uppercase tracking-wider text-[10px] font-semibold">
            Baseline Respiration
          </span>
          <div className="flex items-baseline gap-1.5 mt-1">
            <span className="text-2xl font-bold font-mono text-teal-400">{avgRR}</span>
            <span className="text-slate-400 text-xs">br/min</span>
          </div>
        </div>
      </div>

      {/* Trend Graph Selector */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-300">Trend Projection:</span>
        <div className="flex bg-[#0A0F1E] p-0.5 rounded-lg border border-[#1E293B] text-xs">
          <button
            onClick={() => setSelectedMetric('hr')}
            className={`px-2.5 py-0.5 rounded-md font-medium transition ${
              selectedMetric === 'hr' ? 'bg-emerald-500 text-[#0A0F1E] font-bold shadow-sm' : 'text-slate-400'
            }`}
          >
            Heart Rate (BPM)
          </button>
          <button
            onClick={() => setSelectedMetric('hrv')}
            className={`px-2.5 py-0.5 rounded-md font-medium transition ${
              selectedMetric === 'hrv' ? 'bg-emerald-500 text-[#0A0F1E] font-bold shadow-sm' : 'text-slate-400'
            }`}
          >
            HRV RMSSD (ms)
          </button>
          <button
            onClick={() => setSelectedMetric('rr')}
            className={`px-2.5 py-0.5 rounded-md font-medium transition ${
              selectedMetric === 'rr' ? 'bg-emerald-500 text-[#0A0F1E] font-bold shadow-sm' : 'text-slate-400'
            }`}
          >
            Respiration (RR)
          </button>
        </div>
      </div>

      {/* Longitudinal Chart */}
      <div className="h-56 w-full bg-[#0A0F1E] rounded-lg border border-[#1E293B] p-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <XAxis dataKey="date" stroke="#475569" tick={{ fontSize: 9 }} />
            <YAxis stroke="#475569" tick={{ fontSize: 9 }} domain={['dataMin - 5', 'dataMax + 5']} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0f172a',
                borderColor: '#1e293b',
                borderRadius: '0.5rem',
                fontSize: '11px',
              }}
            />
            {selectedMetric === 'hr' && (
              <>
                <ReferenceLine y={avgHR} stroke="#10b981" strokeDasharray="3 3" label={{ value: `Mean ${avgHR}`, fill: '#10b981', fontSize: 9 }} />
                <Line type="monotone" dataKey="hr" name="Heart Rate (BPM)" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3, fill: '#f43f5e' }} activeDot={{ r: 5 }} />
              </>
            )}
            {selectedMetric === 'hrv' && (
              <>
                <ReferenceLine y={avgHRV} stroke="#10b981" strokeDasharray="3 3" label={{ value: `Mean ${avgHRV}`, fill: '#10b981', fontSize: 9 }} />
                <Line type="monotone" dataKey="hrv" name="HRV RMSSD (ms)" stroke="#10b981" strokeWidth={2} dot={{ r: 3, fill: '#10b981' }} activeDot={{ r: 5 }} />
              </>
            )}
            {selectedMetric === 'rr' && (
              <>
                <ReferenceLine y={avgRR} stroke="#14b8a6" strokeDasharray="3 3" label={{ value: `Mean ${avgRR}`, fill: '#14b8a6', fontSize: 9 }} />
                <Line type="monotone" dataKey="rr" name="Respiratory Rate" stroke="#14b8a6" strokeWidth={2} dot={{ r: 3, fill: '#14b8a6' }} activeDot={{ r: 5 }} />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Session History Table */}
      <div className="overflow-x-auto border border-[#1E293B] rounded-lg">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#0A0F1E] text-slate-400 uppercase text-[10px] font-mono border-b border-[#1E293B]">
            <tr>
              <th className="p-2.5">Session Date & Time</th>
              <th className="p-2.5">HR (BPM)</th>
              <th className="p-2.5">HRV RMSSD</th>
              <th className="p-2.5">Resp Rate</th>
              <th className="p-2.5">Quality</th>
              <th className="p-2.5">Indication</th>
              <th className="p-2.5 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1E293B] text-slate-300">
            {history.map((s) => (
              <tr key={s.id} className="hover:bg-[#0A0F1E]/80 transition">
                <td className="p-2.5 font-mono text-[11px] text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-500" />
                    {s.dateString}
                  </div>
                </td>
                <td className="p-2.5 font-mono font-bold text-white">{s.heartRate} BPM</td>
                <td className="p-2.5 font-mono text-emerald-400">{s.hrv.rmssd} ms</td>
                <td className="p-2.5 font-mono text-teal-400">{s.respiratoryRate} /min</td>
                <td className="p-2.5 font-mono">{s.signalQuality.overall}%</td>
                <td className="p-2.5">
                  <span
                    className={`px-1.5 py-0.2 rounded text-[9px] font-semibold uppercase ${
                      s.riskLevel === 'lower'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-700/50'
                        : s.riskLevel === 'moderate'
                        ? 'bg-amber-950 text-amber-400 border border-amber-700/50'
                        : 'bg-rose-950 text-rose-400 border border-rose-700/50'
                    }`}
                  >
                    {s.riskLevel}
                  </span>
                </td>
                <td className="p-2.5 text-right">
                  <button
                    onClick={() => onSelectSession(s)}
                    className="px-2 py-0.5 rounded bg-[#0A0F1E] hover:bg-slate-800 text-slate-200 border border-[#1E293B] text-[11px] transition"
                  >
                    View Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
