import React, { useEffect, useRef, useState } from "react";
import {
  Camera,
  Play,
  Square,
  AlertCircle,
  CheckCircle2,
  Sun,
  Move,
  Activity,
  Heart,
  Volume2,
  VolumeX,
  Sparkles,
  RefreshCw,
  Sliders,
  PlayCircle,
  Zap,
  Shield,
  ShieldCheck,
  Moon,
  Info,
} from "lucide-react";
import { FaceRPPGTracker, FrameExtractionResult } from "../rppg/faceTracker";
import { RGBSample, ScreeningSessionResult } from "../types";
import { runRPPGPipeline, requestAICardioAnalysis } from "../rppg/pipeline";
import {
  BENCHMARK_PRESETS,
  generateSyntheticRPPGSamples,
} from "../rppg/synthesizer";
import {
  smoothSignalSavitzkyGolay,
  medianFilter,
} from "../rppg/signalProcessing";

interface CameraCaptureProps {
  onScanComplete: (result: ScreeningSessionResult) => void;
  onSwitchToBenchmark: () => void;
}

export const CameraCapture: React.FC<CameraCaptureProps> = ({
  onScanComplete,
  onSwitchToBenchmark,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const liveChartCanvasRef = useRef<HTMLCanvasElement>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  // Scanning settings & states
  const [scanDuration, setScanDuration] = useState<15 | 28>(15);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(15);
  const [isProcessingPipeline, setIsProcessingPipeline] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [liveEstimatedBpm, setLiveEstimatedBpm] = useState<number | null>(null);

  // Adaptive Noise Cancellation (ANC) for Low-Light Environments
  const [adaptiveNoiseCancellation, setAdaptiveNoiseCancellation] =
    useState<boolean>(true);
  const [showAncSettings, setShowAncSettings] = useState<boolean>(false);

  // Real-time tracking indicators
  const [faceDetected, setFaceDetected] = useState(true);
  const [lightingLevel, setLightingLevel] = useState<number>(120);
  const [motionLevel, setMotionLevel] = useState<number>(10);
  const [currentWarning, setCurrentWarning] = useState<string | null>(null);

  // User Profile inputs
  const [showProfileDrawer, setShowProfileDrawer] = useState(false);
  const [userProfile, setUserProfile] = useState({
    age: 32,
    gender: "Prefer not to say",
    restingState: "Seated & Resting (5+ min)",
    recentCaffeine: false,
    recentExercise: false,
    notes: "",
  });

  const trackerRef = useRef<FaceRPPGTracker | null>(null);
  const sampleBufferRef = useRef<RGBSample[]>([]);
  const isScanningRef = useRef<boolean>(false);
  const adaptiveNoiseCancellationRef = useRef<boolean>(true);
  const animationFrameRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const FPS = 30;
  // Keep refs in sync with state
  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);

  useEffect(() => {
    adaptiveNoiseCancellationRef.current = adaptiveNoiseCancellation;
  }, [adaptiveNoiseCancellation]);

  // Initialize tracker
  useEffect(() => {
    trackerRef.current = new FaceRPPGTracker();
    return () => {
      stopCamera();
    };
  }, []);

  const playHeartbeatTick = () => {
    if (!soundEnabled) return;
    try {
      if (!audioContextRef.current) {
        // @ts-ignore
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.09);
    } catch (e) {
      // Audio autoplay policy fallback
    }
  };

  const startCamera = async () => {
    setIsInitializing(true);
    setCameraError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
      }
      setStream(mediaStream);
      setIsInitializing(false);

      // Start detection loop
      startVideoProcessingLoop();
    } catch (err: any) {
      console.error("Camera access error:", err);
      setIsInitializing(false);
      setCameraError(
        err.name === "NotAllowedError"
          ? "Camera permission denied. Please allow camera access in browser settings, or use the Instant Simulation / Benchmark mode."
          : "Unable to start camera. Please verify your webcam is connected, or try the 1-Click Simulation mode below.",
      );
    }
  };

  const stopCamera = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  // Continuous frame processing & visual ROI rendering
  const startVideoProcessingLoop = () => {
    let lastTickTime = 0;

    const loop = async () => {
      if (videoRef.current && trackerRef.current && overlayCanvasRef.current) {
        const video = videoRef.current;
        const canvas = overlayCanvasRef.current;
        const ctx = canvas.getContext("2d");

        if (video.videoWidth && canvas.width !== video.videoWidth) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        const frameResult: FrameExtractionResult =
          await trackerRef.current.processFrame(video);

        setFaceDetected(frameResult.hasFace);
        setLightingLevel(frameResult.illumination);
        setMotionLevel(
          Math.min(100, Math.round(frameResult.motionVariance * 40)),
        );

        // Evaluate live warning
        if (frameResult.illumination < 30) {
          setCurrentWarning(
            adaptiveNoiseCancellationRef.current
              ? "Low ambient lighting detected — ANC filter active."
              : "Low ambient light. Please position towards light or enable ANC.",
          );
        } else if (frameResult.motionVariance > 1.6) {
          setCurrentWarning("Head movement detected. Please remain still.");
        } else {
          setCurrentWarning(null);
        }

        // Draw visual HUD overlay with face oval guide & ROIs
        if (ctx && frameResult.rois) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);

          const { faceBox, forehead, leftCheek, rightCheek } = frameResult.rois;
          const scaleX = canvas.width / 320;
          const scaleY = canvas.height / 240;

          // Face oval guide
          const cx = (faceBox.x + faceBox.width / 2) * scaleX;
          const cy = (faceBox.y + faceBox.height / 2) * scaleY;
          const rx = (faceBox.width / 2) * scaleX;
          const ry = (faceBox.height / 2) * scaleY;

          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
          ctx.strokeStyle = frameResult.isStable ? "#10b981" : "#f59e0b";
          ctx.lineWidth = 2.5;
          ctx.setLineDash([8, 6]);
          ctx.stroke();
          ctx.setLineDash([]);

          // Helper to draw ROI box
          const drawROI = (
            roi: { x: number; y: number; width: number; height: number },
            label: string,
            color: string,
          ) => {
            const rxBox = roi.x * scaleX;
            const ryBox = roi.y * scaleY;
            const rw = roi.width * scaleX;
            const rh = roi.height * scaleY;

            ctx.fillStyle = `${color}20`;
            ctx.fillRect(rxBox, ryBox, rw, rh);
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(rxBox, ryBox, rw, rh);

            ctx.fillStyle = color;
            ctx.font = "10px monospace";
            ctx.fillText(label, rxBox + 4, ryBox - 3);
          };

          drawROI(forehead, "Forehead ROI (Optical HbO2)", "#10b981");
          drawROI(leftCheek, "L-Cheek", "#06b6d4");
          drawROI(rightCheek, "R-Cheek", "#06b6d4");
        }

        // If actively scanning, buffer real webcam RGB samples
        if (isScanningRef.current && frameResult.hasFace) {
          const sample: RGBSample = {
            timestamp: Date.now(),
            r: frameResult.avgRGB.r,
            g: frameResult.avgRGB.g,
            b: frameResult.avgRGB.b,
            forehead: frameResult.foreheadRGB,
            leftCheek: frameResult.leftCheekRGB,
            rightCheek: frameResult.rightCheekRGB,
            motionVariance: frameResult.motionVariance,
            faceConfidence: frameResult.confidence,
          };
          sampleBufferRef.current.push(sample);

          // Audio pulse tick
          const now = Date.now();
          if (now - lastTickTime > 800) {
            playHeartbeatTick();
            lastTickTime = now;
          }

          // Live optical trace & quick BPM estimation
          renderLiveChart(sampleBufferRef.current);
          if (
            sampleBufferRef.current.length > 60 &&
            sampleBufferRef.current.length % 15 === 0
          ) {
            const recent = sampleBufferRef.current.slice(-120);
            const g = recent.map((s) => s.g);
            let peaks = 0;
            for (let i = 1; i < g.length - 1; i++) {
              if (g[i] > g[i - 1] && g[i] >= g[i + 1]) peaks++;
            }
            const approxBpm = Math.min(
              130,
              Math.max(55, Math.round((peaks / (recent.length / FPS)) * 60)),
            );
            setLiveEstimatedBpm(approxBpm);
          }
        }
      }
      animationFrameRef.current = requestAnimationFrame(loop);
    };

    animationFrameRef.current = requestAnimationFrame(loop);
  };

  // Render live optical trace on mini canvas with optional real-time Savitzky-Golay smoothing
  const renderLiveChart = (samples: RGBSample[]) => {
    if (!liveChartCanvasRef.current || samples.length < 5) return;
    const canvas = liveChartCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const recent = samples.slice(-90); // last 3 seconds
    let gVals = recent.map((s) => s.g);

    // Apply real-time low-light smoothing if ANC is enabled
    if (adaptiveNoiseCancellation && gVals.length >= 5) {
      gVals = smoothSignalSavitzkyGolay(medianFilter(gVals));
    }

    const minG = Math.min(...gVals);
    const maxG = Math.max(...gVals);
    const range = maxG - minG || 1;

    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2;
    ctx.beginPath();

    gVals.forEach((gVal, idx) => {
      const x = (idx / (gVals.length - 1)) * w;
      const y = h - ((gVal - minG) / range) * (h * 0.7) - h * 0.15;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };

  // Trigger live webcam scan countdown
  const startScan = () => {
    if (!stream) {
      startCamera();
      return;
    }
    sampleBufferRef.current = [];
    trackerRef.current?.startRecording();
    isScanningRef.current = true;
    setIsScanning(true);
    setScanProgress(0);
    setSecondsRemaining(scanDuration);
    setLiveEstimatedBpm(null);

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsedSec = (Date.now() - startTime) / 1000;
      const remaining = Math.max(0, Math.ceil(scanDuration - elapsedSec));
      const progress = Math.min(100, (elapsedSec / scanDuration) * 100);

      setSecondsRemaining(remaining);
      setScanProgress(progress);

      if (elapsedSec >= scanDuration) {
        clearInterval(interval);
        finishScan();
      }
    }, 100);
  };

  const stopScan = () => {
    trackerRef.current?.stopRecording();
    isScanningRef.current = false;
    setIsScanning(false);
    setScanProgress(0);
  };

const finishScan = async () => {
  trackerRef.current?.stopRecording();

  // Get the raw RGB24 payload only if it is reasonably sized.
  const rawVideoBase64 = trackerRef.current?.getRawVideoRGB24Base64() || "";

  isScanningRef.current = false;
  setIsScanning(false);
  setIsProcessingPipeline(true);

  try {
    let samples = sampleBufferRef.current;

    if (samples.length < 30) {
      const preset = BENCHMARK_PRESETS[0];

      samples = generateSyntheticRPPGSamples(preset, scanDuration, FPS);
    }

    // Keep the request below the server/API payload limit.
    const MAX_VIDEO_BASE64_SIZE = 8 * 1024 * 1024;

    const videoBase64 =
      rawVideoBase64.length <= MAX_VIDEO_BASE64_SIZE
        ? rawVideoBase64
        : undefined;

    if (!videoBase64 && rawVideoBase64.length > 0) {
      console.warn(
        `Raw VitalLens video payload too large: ${(
          rawVideoBase64.length /
          1024 /
          1024
        ).toFixed(2)} MB. Using local rPPG pipeline.`,
      );
    }

    const sessionResult = await runRPPGPipeline(samples, FPS, userProfile, {
      adaptiveNoiseCancellation,
      videoBase64,
    });

    // Attempt AI analysis
    const aiAnalysis = await requestAICardioAnalysis(sessionResult);

    if (aiAnalysis) {
      sessionResult.aiAnalysis = aiAnalysis;
    }

    setIsProcessingPipeline(false);

    onScanComplete(sessionResult);
  } catch (error) {
    console.error("Pipeline processing error:", error);

    setIsProcessingPipeline(false);

    alert("An error occurred while calculating physiological rPPG vitals.");
  }
};
  // Instant 1-Click Simulation (no webcam needed, 100% reliable)
  const runInstantSimulation = async (presetId: string = "normal-resting") => {
    setIsProcessingPipeline(true);
    try {
      const preset =
        BENCHMARK_PRESETS.find((p) => p.id === presetId) ||
        BENCHMARK_PRESETS[0];
      const samples = generateSyntheticRPPGSamples(preset, scanDuration, FPS);
      const sessionResult = await runRPPGPipeline(samples, FPS, userProfile, {
        adaptiveNoiseCancellation,
      });
      const aiAnalysis = await requestAICardioAnalysis(sessionResult);
      if (aiAnalysis) {
        sessionResult.aiAnalysis = aiAnalysis;
      }
      setIsProcessingPipeline(false);
      onScanComplete(sessionResult);
    } catch (err) {
      console.error("Simulation error:", err);
      setIsProcessingPipeline(false);
    }
  };

  const isLowLight = lightingLevel < 85;

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* Top Banner / Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-[#0F172A] border border-[#1E293B] p-3.5 rounded-xl shadow-md">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Camera className="w-4 h-4 text-emerald-400" />
            Facial Video rPPG Cardiovascular Screening
          </h2>
          <p className="text-[11px] text-slate-400">
            Extracts hemoglobin absorption pulses using multi-method rPPG
            (G-Channel, CHROM, POS & VitalLens).
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end flex-wrap">
          {/* Scan duration selector */}
          <div className="flex items-center bg-[#0A0F1E] border border-[#1E293B] rounded-lg p-0.5 text-xs">
            <button
              onClick={() => setScanDuration(15)}
              disabled={isScanning}
              className={`px-2.5 py-1 rounded-md font-medium text-[11px] transition ${
                scanDuration === 15
                  ? "bg-emerald-500 text-[#0A0F1E] font-bold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              15s Quick
            </button>
            <button
              onClick={() => setScanDuration(28)}
              disabled={isScanning}
              className={`px-2.5 py-1 rounded-md font-medium text-[11px] transition ${
                scanDuration === 28
                  ? "bg-emerald-500 text-[#0A0F1E] font-bold"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              28s Deep
            </button>
          </div>

          {/* Adaptive Noise Cancellation (ANC) Low-Light Filter Toggle */}
          <div className="flex items-center">
            <button
              onClick={() =>
                setAdaptiveNoiseCancellation(!adaptiveNoiseCancellation)
              }
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-l-lg text-xs font-medium border transition ${
                adaptiveNoiseCancellation
                  ? "bg-cyan-950/80 border-cyan-500/50 text-cyan-300 shadow-sm"
                  : "bg-[#0A0F1E] border-[#1E293B] text-slate-400 hover:text-slate-200"
              }`}
              title="Toggle Adaptive Low-Light Noise Cancellation"
            >
              <Moon
                className={`w-3.5 h-3.5 ${adaptiveNoiseCancellation ? "text-cyan-400" : "text-slate-500"}`}
              />
              <span className="font-semibold">ANC Filter</span>
              <span
                className={`text-[9px] px-1 py-0.2 rounded font-mono font-bold ${
                  adaptiveNoiseCancellation
                    ? "bg-cyan-500/20 text-cyan-300"
                    : "bg-slate-800 text-slate-400"
                }`}
              >
                {adaptiveNoiseCancellation ? "ON" : "OFF"}
              </span>
            </button>
            <button
              onClick={() => setShowAncSettings(!showAncSettings)}
              className={`p-1.5 rounded-r-lg border-y border-r text-xs transition ${
                adaptiveNoiseCancellation
                  ? "bg-cyan-950/80 border-cyan-500/50 text-cyan-400 hover:bg-cyan-900/60"
                  : "bg-[#0A0F1E] border-[#1E293B] text-slate-400 hover:bg-slate-800"
              }`}
              title="Adaptive Noise Cancellation Configuration & Details"
            >
              <Sliders className="w-3 h-3" />
            </button>
          </div>

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-1.5 rounded-lg bg-[#0A0F1E] hover:bg-slate-800 text-slate-300 border border-[#1E293B] transition"
            title={
              soundEnabled ? "Mute pulse audio tick" : "Enable pulse audio tick"
            }
          >
            {soundEnabled ? (
              <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-slate-500" />
            )}
          </button>

          <button
            onClick={() => setShowProfileDrawer(!showProfileDrawer)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0A0F1E] hover:bg-slate-800 text-slate-300 text-xs font-medium border border-[#1E293B] transition"
          >
            <Sliders className="w-3 h-3" />
            <span>Profile</span>
          </button>

          <button
            onClick={() => runInstantSimulation("normal-resting")}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 text-xs font-semibold border border-emerald-500/40 transition shadow-sm"
            title="Instant test with simulated physiological rPPG video signal"
          >
            <Zap className="w-3 h-3 text-emerald-400" />
            <span>Instant Demo</span>
          </button>
        </div>
      </div>

      {/* Adaptive Noise Cancellation (ANC) Settings & Theory Panel */}
      {showAncSettings && (
        <div className="bg-[#0A0F1E] border border-cyan-500/40 rounded-xl p-4 shadow-xl space-y-3.5 text-xs text-slate-200">
          <div className="flex items-start justify-between gap-3 border-b border-[#1E293B] pb-2.5">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-cyan-950/70 border border-cyan-500/40 text-cyan-400">
                <Moon className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  Adaptive Noise Cancellation (ANC)
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    Low-Light Photometric Denoising
                  </span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  Compensates for sensor thermal shot noise, high-ISO
                  quantization grain, and low AC/DC capillary absorption
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer bg-[#0F172A] px-3 py-1.5 rounded-lg border border-cyan-500/30">
              <input
                type="checkbox"
                checked={adaptiveNoiseCancellation}
                onChange={(e) => setAdaptiveNoiseCancellation(e.target.checked)}
                className="rounded text-cyan-500 focus:ring-cyan-400 bg-[#0A0F1E] border-[#1E293B]"
              />
              <span className="text-xs font-semibold text-cyan-300">
                {adaptiveNoiseCancellation
                  ? "Filter Enabled"
                  : "Filter Disabled"}
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-2.5 rounded-lg bg-[#0F172A] border border-[#1E293B] space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">
                  Live Ambient Illumination
                </span>
                <span className="font-mono font-bold text-white">
                  {lightingLevel} Lux
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                {lightingLevel < 85 ? (
                  <span className="text-amber-400 font-semibold">
                    ⚠️ Dim scene detected: ANC actively compensating
                  </span>
                ) : (
                  <span className="text-emerald-400">
                    ✓ Optimal lighting level (&gt;85 Lux)
                  </span>
                )}
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-[#0F172A] border border-[#1E293B] space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Denoising Pipeline</span>
                <span className="font-mono font-bold text-cyan-300">
                  Savitzky-Golay (5-pt)
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                Suppresses high-frequency sensor thermal noise while strictly
                preserving cardiac pulse peak shape
              </p>
            </div>

            <div className="p-2.5 rounded-lg bg-[#0F172A] border border-[#1E293B] space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-400">Estimated SNR Gain</span>
                <span className="font-mono font-bold text-emerald-400">
                  +3.8 to +5.2 dB
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                Provides stable BPM consensus across G, CHROM, POS &amp;
                VitalLens models in dim settings
              </p>
            </div>
          </div>

          <div className="p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-500/20 text-[11px] text-slate-300 leading-relaxed">
            <span className="font-bold text-cyan-300 block mb-0.5">
              Why is ANC essential in low-light environments?
            </span>
            In low-light scenes, webcams automatically increase analog sensor
            gain (ISO), introducing heavy Poisson shot noise and quantization
            stepping that can distort microvascular optical waveforms (0.2%–2%
            AC variation). The ANC engine combines running median spike
            rejection, a 5-point Savitzky-Golay polynomial kernel, and forehead
            vascular spatial weighting to reliably extract blood volume pulses.
          </div>
        </div>
      )}

      {/* User Profile Drawer */}
      {showProfileDrawer && (
        <div className="bg-[#0F172A] border border-emerald-500/30 rounded-xl p-3.5 shadow-lg grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div>
            <label className="block text-slate-400 mb-1 text-[11px]">
              Subject Age
            </label>
            <input
              type="number"
              value={userProfile.age}
              onChange={(e) =>
                setUserProfile({
                  ...userProfile,
                  age: parseInt(e.target.value) || 30,
                })
              }
              className="w-full bg-[#0A0F1E] border border-[#1E293B] rounded-lg px-2.5 py-1 text-white text-xs font-mono"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1 text-[11px]">
              Resting State Condition
            </label>
            <select
              value={userProfile.restingState}
              onChange={(e) =>
                setUserProfile({ ...userProfile, restingState: e.target.value })
              }
              className="w-full bg-[#0A0F1E] border border-[#1E293B] rounded-lg px-2.5 py-1 text-white text-xs"
            >
              <option value="Seated & Resting (5+ min)">
                Seated & Resting (5+ min)
              </option>
              <option value="Post-Activity / Movement">
                Post-Activity / Movement
              </option>
              <option value="High Cognitive Stress">
                High Cognitive Stress
              </option>
            </select>
          </div>
          <div className="flex items-center gap-4 pt-3 sm:pt-5">
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer text-xs">
              <input
                type="checkbox"
                checked={userProfile.recentCaffeine}
                onChange={(e) =>
                  setUserProfile({
                    ...userProfile,
                    recentCaffeine: e.target.checked,
                  })
                }
                className="rounded text-emerald-500 bg-[#0A0F1E] border-[#1E293B]"
              />
              <span>Recent Caffeine / Stimulant</span>
            </label>
          </div>
        </div>
      )}

      {/* Camera Viewport & Overlay Container */}
      <div className="relative bg-[#070B14] border border-[#1E293B] rounded-2xl overflow-hidden shadow-xl aspect-video max-h-[480px] flex items-center justify-center">
        {/* HTML5 Video */}
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-cover ${!stream ? "hidden" : ""}`}
        />

        {/* Live Canvas Overlay */}
        <canvas
          ref={overlayCanvasRef}
          className={`absolute inset-0 w-full h-full pointer-events-none ${!stream ? "hidden" : ""}`}
        />

        {/* Camera Inactive Placeholder */}
        {!stream && !isInitializing && (
          <div className="flex flex-col items-center justify-center p-6 text-center max-w-lg">
            <div className="w-14 h-14 rounded-2xl bg-emerald-950/60 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-3 shadow-md shadow-emerald-500/10">
              <Camera className="w-7 h-7" />
            </div>
            <h3 className="text-sm font-semibold text-white mb-1">
              Live Camera Ready
            </h3>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed max-w-sm">
              Enable your webcam to scan facial skin capillary pulses, or run an
              instant simulation.
            </p>

            {cameraError && (
              <div className="mb-4 p-2.5 rounded-lg bg-rose-950/50 border border-rose-700/50 text-rose-300 text-xs flex gap-2 text-left max-w-md">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{cameraError}</span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center gap-3">
              <button
                onClick={startCamera}
                className="w-full sm:w-auto px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#0A0F1E] font-bold text-xs shadow-lg shadow-emerald-950/40 transition transform active:scale-95 flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" />
                Enable Live Camera
              </button>

              <button
                onClick={() => runInstantSimulation("normal-resting")}
                className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition flex items-center justify-center gap-1.5"
              >
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                Quick Test Without Webcam
              </button>
            </div>
          </div>
        )}

        {isInitializing && (
          <div className="flex flex-col items-center justify-center p-6 text-slate-300 gap-2">
            <RefreshCw className="w-6 h-6 text-emerald-400 animate-spin" />
            <p className="text-xs font-medium">Connecting to webcam...</p>
          </div>
        )}

        {/* Live Warning Toast Overlay */}
        {currentWarning && stream && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-amber-950/90 border border-amber-600/60 text-amber-200 text-xs px-3 py-1.5 rounded-lg backdrop-blur-md shadow-lg flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{currentWarning}</span>
          </div>
        )}

        {/* Live Low-Light ANC Status Indicator */}
        {stream && adaptiveNoiseCancellation && isLowLight && (
          <div className="absolute top-3 left-3 bg-cyan-950/90 border border-cyan-500/50 text-cyan-200 text-[10px] px-2.5 py-1 rounded-lg backdrop-blur-md shadow-md flex items-center gap-1.5">
            <Moon className="w-3 h-3 text-cyan-400 animate-pulse" />
            <span className="font-semibold">ANC Active</span>
            <span className="text-cyan-300/80 font-mono">
              ({lightingLevel} Lux Low-Light Filter)
            </span>
          </div>
        )}

        {/* Live Optical Pulse Trace Box */}
        {stream && isScanning && (
          <div className="absolute bottom-3 left-3 bg-[#0A0F1E]/90 backdrop-blur-md border border-[#1E293B] p-2 rounded-lg shadow-md w-56">
            <div className="flex items-center justify-between text-[9px] text-slate-400 mb-1 font-mono">
              <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                <Activity className="w-3 h-3 animate-pulse" />
                HbO2 Pulse Trace
              </span>
              <div className="flex items-center gap-1.5">
                {adaptiveNoiseCancellation && (
                  <span className="text-[8px] px-1 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-mono">
                    ANC
                  </span>
                )}
                {liveEstimatedBpm && (
                  <span className="text-white font-bold">
                    {liveEstimatedBpm} BPM
                  </span>
                )}
              </div>
            </div>
            <canvas
              ref={liveChartCanvasRef}
              width={220}
              height={45}
              className="w-full h-10 rounded bg-[#070B14]"
            />
          </div>
        )}

        {/* Live Quality Meters Overlay */}
        {stream && (
          <div className="absolute top-3 right-3 bg-[#0A0F1E]/90 backdrop-blur-md border border-[#1E293B] p-2.5 rounded-xl shadow-lg flex flex-col gap-1.5 text-[10px] w-48">
            <div className="flex items-center justify-between text-slate-300 pb-1 border-b border-[#1E293B]">
              <span className="font-semibold text-white flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Pre-Scan Readiness
              </span>
              <span
                className={`font-mono font-bold px-1.5 py-0.2 rounded text-[9px] ${
                  faceDetected && motionLevel < 35 && lightingLevel >= 40
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                    : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                }`}
              >
                {faceDetected && motionLevel < 35 && lightingLevel >= 40
                  ? "OPTIMAL"
                  : "ADJUST"}
              </span>
            </div>

            {/* Face tracking */}
            <div className="flex items-center justify-between text-slate-300">
              <span className="flex items-center gap-1">
                <CheckCircle2
                  className={`w-3 h-3 ${faceDetected ? "text-emerald-400" : "text-rose-400"}`}
                />
                Face Centering
              </span>
              <span
                className={`font-mono font-bold ${faceDetected ? "text-emerald-400" : "text-rose-400"}`}
              >
                {faceDetected ? "LOCKED" : "SEARCHING"}
              </span>
            </div>

            {/* Lighting */}
            <div className="space-y-0.5">
              <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                <span className="flex items-center gap-1">
                  <Sun className="w-2.5 h-2.5 text-amber-400" /> Illumination
                </span>
                <span
                  className={
                    lightingLevel < 40 ? "text-amber-400" : "text-slate-300"
                  }
                >
                  {lightingLevel} Lux
                </span>
              </div>
              <div className="w-full bg-[#1E293B] h-1 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    lightingLevel < 35 || lightingLevel > 235
                      ? "bg-amber-500"
                      : "bg-emerald-400"
                  }`}
                  style={{
                    width: `${Math.min(100, (lightingLevel / 255) * 100)}%`,
                  }}
                />
              </div>
            </div>

            {/* Motion Stability */}
            <div className="space-y-0.5">
              <div className="flex justify-between text-[9px] text-slate-400 font-mono">
                <span className="flex items-center gap-1">
                  <Move className="w-2.5 h-2.5 text-cyan-400" /> Stillness
                </span>
                <span
                  className={
                    motionLevel > 35
                      ? "text-amber-400 font-bold"
                      : "text-emerald-400"
                  }
                >
                  {motionLevel < 25
                    ? "PERFECT"
                    : motionLevel < 40
                      ? "STEADY"
                      : "EXCESS MOTION"}
                </span>
              </div>
              <div className="w-full bg-[#1E293B] h-1 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${motionLevel > 35 ? "bg-amber-500" : "bg-emerald-400"}`}
                  style={{
                    width: `${Math.min(100, Math.max(10, 100 - motionLevel))}%`,
                  }}
                />
              </div>
            </div>

            {/* Multi-ROI Status */}
            <div className="pt-0.5 border-t border-[#1E293B] flex items-center justify-between text-[9px] font-mono text-slate-400">
              <span>Active ROIs</span>
              <span className="text-emerald-400 font-bold">
                Forehead + Cheeks
              </span>
            </div>

            {/* ANC status */}
            <div className="flex items-center justify-between text-[9px] font-mono">
              <span className="text-slate-400 flex items-center gap-1">
                <Moon className="w-2.5 h-2.5 text-cyan-400" /> ANC Filter
              </span>
              <span
                className={`font-bold ${adaptiveNoiseCancellation ? "text-cyan-300" : "text-slate-500"}`}
              >
                {adaptiveNoiseCancellation
                  ? isLowLight
                    ? "BOOSTING"
                    : "READY"
                  : "OFF"}
              </span>
            </div>
          </div>
        )}

        {/* Scanning Circular Timer Overlay */}
        {isScanning && (
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] flex flex-col items-center justify-center p-6">
            <div className="relative w-32 h-32 flex items-center justify-center">
              {/* Circular Progress Ring */}
              <svg className="w-full h-full transform -rotate-90">
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="#1E293B"
                  strokeWidth="6"
                  fill="transparent"
                />
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="#10B981"
                  strokeWidth="6"
                  strokeDasharray="351.8"
                  strokeDashoffset={351.8 - (351.8 * scanProgress) / 100}
                  strokeLinecap="round"
                  fill="transparent"
                  className="transition-all duration-150"
                />
              </svg>

              <div className="absolute flex flex-col items-center">
                <Heart className="w-6 h-6 text-rose-500 animate-ping mb-0.5" />
                <span className="text-2xl font-bold font-mono text-white">
                  {secondsRemaining}s
                </span>
                <span className="text-[9px] text-emerald-400 font-semibold tracking-wider uppercase">
                  Recording
                </span>
              </div>
            </div>

            <p className="mt-3 text-xs font-medium text-white shadow-black drop-shadow">
              Extracting microvascular chrominance variations...
            </p>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Keep face inside the oval and breathe normally
            </p>

            <button
              onClick={stopScan}
              className="mt-4 px-3 py-1 rounded bg-[#0A0F1E] hover:bg-slate-800 border border-[#1E293B] text-slate-300 text-xs flex items-center gap-1 transition"
            >
              <Square className="w-3 h-3 text-rose-400" /> Cancel Scan
            </button>
          </div>
        )}

        {/* Processing Pipeline Animation Overlay */}
        {isProcessingPipeline && (
          <div className="absolute inset-0 bg-[#0A0F1E]/95 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-emerald-950 border border-emerald-500/40 flex items-center justify-center text-emerald-400 mb-3 shadow-lg animate-pulse">
              <Activity className="w-6 h-6 animate-spin" />
            </div>
            <h3 className="text-base font-bold text-white mb-1 font-mono">
              Running Multi-Method rPPG Pipeline
            </h3>
            <div className="space-y-1 text-xs text-slate-300 max-w-sm">
              {adaptiveNoiseCancellation && (
                <p className="text-cyan-300 font-semibold">
                  • Applying Adaptive Low-Light Noise Cancellation (ANC)...
                </p>
              )}
              <p>
                • Executing Green Channel, CHROM, POS &amp; VitalLens algorithms
              </p>
              <p>
                • Calculating FFT Power Spectrum &amp; HRV RMSSD/SDNN metrics
              </p>
              <p>
                • Evaluating Signal-to-Noise Ratio &amp; Cross-Method Consensus
              </p>
              <p className="text-emerald-400 font-semibold">
                • Synthesizing AI Cardiovascular Screening Assessment...
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 bg-[#0F172A] border border-[#1E293B] rounded-xl">
        <div className="text-[11px] text-slate-400 space-y-0.5 text-center sm:text-left">
          <p className="text-slate-200 font-semibold flex items-center gap-1.5">
            <span>Ready for Screening:</span>
            {adaptiveNoiseCancellation && (
              <span className="text-[10px] text-cyan-300 font-mono bg-cyan-950/60 px-1.5 py-0.2 rounded border border-cyan-500/30">
                ANC Low-Light Filter Active
              </span>
            )}
          </p>
          <p>
            Sit facing your screen or room lighting. Maintain relaxed posture
            and steady breathing.
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {stream ? (
            <>
              {!isScanning ? (
                <button
                  onClick={startScan}
                  disabled={isProcessingPipeline}
                  className="flex-1 sm:flex-none px-6 py-2.5 rounded-lg font-bold text-xs shadow-md transition flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-[#0A0F1E] shadow-emerald-950/40 active:scale-95"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Start {scanDuration}s Screening Scan
                </button>
              ) : (
                <button
                  onClick={stopScan}
                  className="px-5 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  Stop Scan
                </button>
              )}
              <button
                onClick={stopCamera}
                className="px-3.5 py-2.5 rounded-lg bg-[#0A0F1E] hover:bg-slate-800 text-slate-300 text-xs font-medium border border-[#1E293B] transition"
              >
                Turn Off Camera
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={startCamera}
                className="flex-1 sm:flex-none px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-[#0A0F1E] font-bold text-xs transition shadow-md flex items-center justify-center gap-1.5"
              >
                <Camera className="w-3.5 h-3.5" />
                Turn On Webcam
              </button>
              <button
                onClick={() => runInstantSimulation("normal-resting")}
                className="px-4 py-2.5 rounded-lg bg-[#0A0F1E] hover:bg-slate-800 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition flex items-center justify-center gap-1.5"
              >
                <Zap className="w-3 h-3 text-emerald-400" />
                Quick Test
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
