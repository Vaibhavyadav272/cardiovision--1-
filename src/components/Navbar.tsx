import React from 'react';
import { Activity, Camera, Layers, History, BookOpen, ShieldAlert, Cpu } from 'lucide-react';
import { AppMode } from '../types';

interface NavbarProps {
  currentMode: AppMode;
  onSelectMode: (mode: AppMode) => void;
  onOpenDisclaimer: () => void;
  isScanning: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentMode,
  onSelectMode,
  onOpenDisclaimer,
  isScanning,
}) => {
  const navItems: { mode: AppMode; label: string; icon: React.ReactNode }[] = [
    { mode: 'scan', label: 'Live Camera Scan', icon: <Camera className="w-4 h-4" /> },
    { mode: 'benchmark', label: 'Synthetic Benchmarks', icon: <Cpu className="w-4 h-4" /> },
    { mode: 'algorithms', label: 'rPPG Algorithms', icon: <Layers className="w-4 h-4" /> },
    { mode: 'history', label: 'Baseline & History', icon: <History className="w-4 h-4" /> },
    { mode: 'about', label: 'Clinical Tech Docs', icon: <BookOpen className="w-4 h-4" /> },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#0A0F1E]/95 backdrop-blur-md border-b border-[#1E293B]">
      <div className="max-w-7xl mx-auto px-3 sm:px-5 lg:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Brand */}
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => onSelectMode('scan')}>
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center shadow-md shadow-emerald-500/20 text-[#0A0F1E] font-bold">
              <Activity className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold tracking-tight text-white font-mono">
                  CARDIO<span className="text-emerald-400">VISION</span>
                </span>
                <span className="px-1 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-950/60 text-emerald-400 border border-emerald-700/40">
                  rPPG v2.4
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-sans hidden sm:block">
                Facial Video Non-Contact Cardiovascular Screening
              </p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="hidden md:flex items-center gap-1 bg-[#0F172A] p-0.5 rounded-lg border border-[#1E293B]">
            {navItems.map((item) => {
              const active = currentMode === item.mode;
              return (
                <button
                  key={item.mode}
                  disabled={isScanning}
                  onClick={() => onSelectMode(item.mode)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                    active
                      ? 'bg-emerald-500 text-[#0A0F1E] font-bold shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                  } ${isScanning ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenDisclaimer}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium text-amber-300 bg-amber-950/40 hover:bg-amber-900/50 border border-amber-700/40 transition"
            >
              <ShieldAlert className="w-3 h-3 text-amber-400" />
              <span className="hidden sm:inline">Medical Notice</span>
            </button>
          </div>
        </div>

        {/* Mobile Navigation bar */}
        <div className="md:hidden flex items-center justify-between overflow-x-auto py-1.5 border-t border-[#1E293B]/80 scrollbar-none gap-1.5">
          {navItems.map((item) => {
            const active = currentMode === item.mode;
            return (
              <button
                key={item.mode}
                disabled={isScanning}
                onClick={() => onSelectMode(item.mode)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] whitespace-nowrap transition-all ${
                  active
                    ? 'bg-emerald-500 text-[#0A0F1E] font-bold'
                    : 'text-slate-300 bg-[#0F172A] border border-[#1E293B]'
                } ${isScanning ? 'opacity-50' : ''}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
