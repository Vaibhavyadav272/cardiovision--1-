import { RGBSample, ScreeningSessionResult, AICardioAnalysis } from "../types";

import {
  processGMethod,
  processChromMethod,
  processPosMethod,
  processMultiROIFusionMethod,
  evaluateMethodComparison,
  evaluateSignalQuality,
  determineCardiovascularRisk,
} from "./algorithms";

import {
  calculateHRV,
  estimateRespiratoryRate,
  applyAdaptiveLowLightDenoising,
} from "./signalProcessing";

/**
 * Maximum Base64 payload we allow to be sent to the VitalLens proxy.
 *
 * VitalLens Cloud currently rejects requests that become too large.
 * We intentionally leave headroom below the 10 MB HTTP limit.
 */
const MAX_VITALLENS_BASE64_LENGTH = 8 * 1024 * 1024;

/**
 * Execute the complete Multi-Method rPPG Screening Pipeline
 */
export async function runRPPGPipeline(
  samples: RGBSample[],
  fps: number = 30,
  userProfile?: any,
  options?: {
    adaptiveNoiseCancellation?: boolean;
    videoBase64?: string;
  },
): Promise<ScreeningSessionResult> {
  const durationSec = parseFloat((samples.length / fps).toFixed(1));

  const enableANC = options?.adaptiveNoiseCancellation ?? true;

  // ------------------------------------------------------------
  // 0. Adaptive Low-Light Noise Cancellation
  // ------------------------------------------------------------

  let workingSamples = samples;
  let isLowLight = false;
  let ambientLux = 120;

  if (enableANC) {
    const ancResult = applyAdaptiveLowLightDenoising(samples, fps);

    workingSamples = ancResult.cleanedSamples;
    isLowLight = ancResult.lowLightDetected;
    ambientLux = ancResult.avgLux;
  }

  // ------------------------------------------------------------
  // 1. Green Channel
  // ------------------------------------------------------------

  const gResult = processGMethod(workingSamples, fps);

  // ------------------------------------------------------------
  // 2. CHROM
  // ------------------------------------------------------------

  const chromResult = processChromMethod(workingSamples, fps);

  // ------------------------------------------------------------
  // 3. POS
  // ------------------------------------------------------------

  const posResult = processPosMethod(workingSamples, fps);

  // ------------------------------------------------------------
  // 4. Multi-ROI Fusion
  // ------------------------------------------------------------

  const multiROIFusionResult = processMultiROIFusionMethod(
    workingSamples,
    fps,
    chromResult,
    posResult,
  );

  // ------------------------------------------------------------
  // 5. VitalLens Cloud
  // ------------------------------------------------------------

  /*
   * IMPORTANT:
   *
   * VitalLens starts with the local Multi-ROI result.
   *
   * If the Cloud API successfully responds, we replace the
   * VitalLens result with the cloud result.
   *
   * If the payload is too large, we DO NOT send it.
   * The application continues using the local model.
   */

  let vitalLensResult = {
    ...multiROIFusionResult,

    isApiResult: false,

    apiModel: undefined,

    apiStatusMessage: "VitalLens Cloud API unavailable.",

    description: "Local Multi-ROI spatial consensus fallback.",
  };

  let vitalLensApiStatus = {
    connected: false,

    model: "VitalLens-v3-Cloud",

    message: "VitalLens Cloud API inference not available.",
  };

  const videoBase64 = options?.videoBase64?.trim() || "";

  // Only attempt the API when a payload actually exists.
  if (videoBase64.length > 500) {
    // ----------------------------------------------------------
    // Protect against oversized requests
    // ----------------------------------------------------------

    if (videoBase64.length > MAX_VITALLENS_BASE64_LENGTH) {
      console.warn(
        `VitalLens payload too large: ` +
          `${(videoBase64.length / 1024 / 1024).toFixed(2)} MB. ` +
          `Maximum allowed locally is ` +
          `${(MAX_VITALLENS_BASE64_LENGTH / 1024 / 1024).toFixed(2)} MB. ` +
          `Using local Multi-ROI fallback.`,
      );

      vitalLensApiStatus = {
        connected: false,

        model: "VitalLens-v3-Cloud",

        message:
          `VitalLens video payload is too large ` +
          `(${(videoBase64.length / 1024 / 1024).toFixed(2)} MB). ` +
          `Using local Multi-ROI fallback.`,
      };
    } else {
      // --------------------------------------------------------
      // Safe payload → send to our server proxy
      // --------------------------------------------------------

      try {
        console.log(
          `Sending VitalLens payload: ` +
            `${(videoBase64.length / 1024 / 1024).toFixed(2)} MB`,
        );

        const apiRes = await fetch("/api/vitallens/estimate", {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            video: videoBase64,

            fps: Number(fps) || 30,

            process_signals: true,
          }),
        });

        // ------------------------------------------------------
        // Parse server response
        // ------------------------------------------------------

        let apiData: any = null;

        try {
          apiData = await apiRes.json();
        } catch {
          apiData = null;
        }

        if (
          apiRes.ok &&
          apiData?.success &&
          apiData?.apiConnected &&
          apiData?.bpm &&
          apiData?.faceDetected !== false
        ) {
          vitalLensApiStatus = {
            connected: true,

            model: apiData.engine || "VitalLens-v3-Cloud",

            message: "Live VitalLens Cloud API inference active.",
          };

          vitalLensResult = {
            ...multiROIFusionResult,

            bpm: Math.round(Number(apiData.bpm)),

            snrDb:
              typeof apiData.snrDb === "number"
                ? apiData.snrDb
                : multiROIFusionResult.snrDb,

            confidence:
              typeof apiData.confidence === "number"
                ? apiData.confidence
                : multiROIFusionResult.confidence,

            isApiResult: true,

            apiModel: apiData.engine || "VitalLens-v3-Cloud",

            apiStatusMessage: "Verified inference from VitalLens Cloud API.",

            description: "VitalLens Cloud API neural inference.",
          };
        } else {
          const status = apiRes.status;

          const message =
            apiData?.message || `VitalLens API request failed (${status}).`;

          console.warn("VitalLens API:", message);

          vitalLensApiStatus = {
            connected: false,

            model: "VitalLens-v3-Cloud",

            message: `${message} Using local Multi-ROI fallback.`,
          };
        }
      } catch (err) {
        console.warn("VitalLens API request failed:", err);

        vitalLensApiStatus = {
          connected: false,

          model: "VitalLens-v3-Cloud",

          message:
            "VitalLens Cloud API request failed. Using local Multi-ROI fallback.",
        };
      }
    }
  }

  // ------------------------------------------------------------
  // 6. Cross-Method Agreement
  // ------------------------------------------------------------

  const methodResults = {
    g: gResult,

    chrom: chromResult,

    pos: posResult,

    vitallens: vitalLensResult,
  };

  const methodComparison = evaluateMethodComparison(methodResults);

  // ------------------------------------------------------------
  // 7. Signal Quality
  // ------------------------------------------------------------

  const signalQuality = evaluateSignalQuality(
    workingSamples,
    methodComparison,
    methodResults,
    fps,
  );

  signalQuality.adaptiveNoiseCancellation = enableANC;

  signalQuality.lowLightModeActive = isLowLight;

  if (enableANC && isLowLight) {
    signalQuality.warnings = signalQuality.warnings.filter(
      (w) => !w.toLowerCase().includes("low illumination"),
    );

    signalQuality.warnings.push(
      `Adaptive Noise Cancellation Active: ` +
        `Low ambient lighting (${ambientLux} Lux) ` +
        `compensated with 5-point spatial-temporal ` +
        `shot-noise filtration.`,
    );
  }

  // ------------------------------------------------------------
  // 8. HRV
  // ------------------------------------------------------------

  const primaryWaveform =
    posResult.snrDb >= chromResult.snrDb ? posResult : chromResult;

  const hrv = calculateHRV(primaryWaveform.peaks, fps);

  // ------------------------------------------------------------
  // 9. Respiratory Rate
  // ------------------------------------------------------------

  const respiratoryRate = estimateRespiratoryRate(
    primaryWaveform.waveform,
    fps,
    methodComparison.consensusBpm,
  );

  // ------------------------------------------------------------
  // 10. Cardiovascular Risk Screening
  // ------------------------------------------------------------

  const { riskLevel, riskScore } = determineCardiovascularRisk(
    methodComparison.consensusBpm,
    hrv.rmssd,
    respiratoryRate,
    signalQuality,
  );

  // ------------------------------------------------------------
  // 11. Time-Series Data
  // ------------------------------------------------------------

  const step = Math.max(1, Math.floor(workingSamples.length / 300));

  const timeSeries = {
    time: [] as number[],

    rawG: [] as number[],

    gWaveform: [] as number[],

    chromWaveform: [] as number[],

    posWaveform: [] as number[],

    vitalLensWaveform: [] as number[],
  };

  for (let i = 0; i < workingSamples.length; i += step) {
    timeSeries.time.push(parseFloat((i / fps).toFixed(2)));

    timeSeries.rawG.push(parseFloat(workingSamples[i].g.toFixed(2)));

    timeSeries.gWaveform.push(
      parseFloat((gResult.waveform[i] || 0).toFixed(3)),
    );

    timeSeries.chromWaveform.push(
      parseFloat((chromResult.waveform[i] || 0).toFixed(3)),
    );

    timeSeries.posWaveform.push(
      parseFloat((posResult.waveform[i] || 0).toFixed(3)),
    );

    timeSeries.vitalLensWaveform.push(
      parseFloat((vitalLensResult.waveform[i] || 0).toFixed(3)),
    );
  }

  // ------------------------------------------------------------
  // 12. Session Result
  // ------------------------------------------------------------

  const id = `cv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

  const now = new Date();

  const sessionResult: ScreeningSessionResult = {
    id,

    timestamp: now.getTime(),

    dateString: now.toLocaleString(),

    durationSec,

    heartRate: methodComparison.consensusBpm,

    hrv,

    respiratoryRate,

    decision: signalQuality.decision,

    confidenceTier: signalQuality.confidenceTier,

    signalQuality,

    methodComparison,

    methodResults,

    timeSeries,

    riskLevel,

    riskScore,

    adaptiveNoiseCancellation: enableANC,

    lowLightModeActive: isLowLight,

    vitalLensApiStatus,

    userProfile,
  };

  return sessionResult;
}

/**
 * Request Gemini AI Clinical Screening Interpretation
 */
export async function requestAICardioAnalysis(
  result: ScreeningSessionResult,
  baseline?: any,
): Promise<AICardioAnalysis | null> {
  try {
    const response = await fetch("/api/cardiovision/analyze", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        heartRate: result.heartRate,

        hrv: result.hrv,

        respiratoryRate: result.respiratoryRate,

        signalQuality: result.signalQuality,

        methodComparison: result.methodComparison,

        userProfile: result.userProfile,

        baselineComparison: baseline,

        riskLevel: result.riskLevel,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI analysis HTTP error ${response.status}`);
    }

    const data = await response.json();

    return data.analysis || null;
  } catch (error) {
    console.error("Failed to obtain AI analysis:", error);

    return null;
  }
}
