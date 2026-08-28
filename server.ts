import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

// ============================================================
// EXPRESS CONFIGURATION
// ============================================================

app.use(express.json({ limit: "25mb" }));

// ============================================================
// GEMINI CLIENT
// ============================================================

let genAI: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!genAI) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();

    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is missing.");
    }

    genAI = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }

  return genAI;
}

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    app: "CardioVision",
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// VITALLENS STATUS
// ============================================================

app.get("/api/vitallens/status", (_req, res) => {
  const apiKey = process.env.VITALLENS_API_KEY?.trim();

  const configured = Boolean(apiKey && apiKey.length > 0);

  res.json({
    configured,

    endpoint: "https://api.rouast.com/vitallens-v3/file",

    model: "VitalLens-v3-Cloud",

    message: configured
      ? "VitalLens API key is configured."
      : "VITALLENS_API_KEY is not configured. Local rPPG fallback will be used.",
  });
});

// ============================================================
// VITALLENS CLOUD ESTIMATION
// ============================================================

app.post("/api/vitallens/estimate", async (req, res) => {
  try {
    // --------------------------------------------------------
    // 1. API KEY
    // --------------------------------------------------------

    const apiKey = process.env.VITALLENS_API_KEY?.trim();

    if (!apiKey) {
      return res.json({
        success: true,
        apiConnected: false,
        source: "local-fallback",
        message:
          "VITALLENS_API_KEY is not configured. Using local multi-ROI rPPG model.",
      });
    }

    // --------------------------------------------------------
    // 2. REQUEST BODY
    // --------------------------------------------------------

    const { video, fps = 30, process_signals = true } = req.body ?? {};

    if (!video || typeof video !== "string" || video.length < 100) {
      return res.status(400).json({
        success: false,
        apiConnected: false,
        error: "Missing or invalid base64-encoded video payload.",
      });
    }

    // --------------------------------------------------------
    // 3. SAFE FPS
    // --------------------------------------------------------

    const requestedFps = Number(fps);

    const safeFps =
      Number.isFinite(requestedFps) && requestedFps > 0 && requestedFps <= 60
        ? requestedFps
        : 30;

    // --------------------------------------------------------
    // 4. VITALLENS PAYLOAD
    // --------------------------------------------------------

    const payload = {
      video,
      fps: safeFps,
      process_signals: Boolean(process_signals),
    };

    // --------------------------------------------------------
    // 5. VITALLENS ENDPOINT
    // --------------------------------------------------------

    const vitallensUrl = "https://api.rouast.com/vitallens-v3/file";

    console.log("Sending video to VitalLens Cloud...");

    // --------------------------------------------------------
    // 6. TIMEOUT
    // --------------------------------------------------------

    const controller = new AbortController();

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 30000);

    let apiResponse: Response;

    try {
      apiResponse = await fetch(vitallensUrl, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          "x-api-key": apiKey,
        },

        body: JSON.stringify(payload),

        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // --------------------------------------------------------
    // 7. HTTP ERROR
    // --------------------------------------------------------

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text().catch(() => "");

      console.warn(`VitalLens API returned HTTP ${apiResponse.status}`);

      if (errorText) {
        console.warn("VitalLens API error:", errorText.slice(0, 300));
      }

      return res.json({
        success: true,

        apiConnected: false,

        source: "local-fallback",

        httpStatus: apiResponse.status,

        message: `VitalLens Cloud API returned HTTP ${apiResponse.status}. Using local multi-ROI fallback.`,

        apiError: errorText.slice(0, 300),
      });
    }

    // --------------------------------------------------------
    // 8. PARSE JSON
    // --------------------------------------------------------

    const data: any = await apiResponse.json();

    console.log("VitalLens API response received.");

    // --------------------------------------------------------
    // 9. NORMALIZE RESPONSE
    // --------------------------------------------------------

    const primaryResult = Array.isArray(data) ? data[0] : data;

    if (!primaryResult) {
      return res.json({
        success: true,
        apiConnected: false,
        source: "local-fallback",
        message: "VitalLens returned an empty response.",
      });
    }

    // --------------------------------------------------------
    // 10. SUPPORT BOTH `vitals` AND `vital_signs`
    // --------------------------------------------------------

    const vitalSigns =
      primaryResult?.vital_signs ?? primaryResult?.vitals ?? {};

    // ========================================================
    // HEART RATE
    // ========================================================

    const heartRateRaw =
      vitalSigns?.heart_rate ?? primaryResult?.heart_rate ?? null;

    const heartRateValue =
      typeof heartRateRaw === "object" ? heartRateRaw?.value : heartRateRaw;

    const heartRateConfidence =
      typeof heartRateRaw === "object"
        ? heartRateRaw?.confidence
        : primaryResult?.confidence;

    // ========================================================
    // RESPIRATORY RATE
    // ========================================================

    const respiratoryRaw =
      vitalSigns?.respiratory_rate ?? primaryResult?.respiratory_rate ?? null;

    const respiratoryValue =
      typeof respiratoryRaw === "object"
        ? respiratoryRaw?.value
        : respiratoryRaw;

    // ========================================================
    // HRV RMSSD
    // ========================================================

    const hrvRmssdRaw =
      vitalSigns?.hrv_rmssd ??
      vitalSigns?.hrv?.rmssd ??
      primaryResult?.hrv_rmssd ??
      primaryResult?.hrv?.rmssd ??
      null;

    const hrvRmssdValue =
      typeof hrvRmssdRaw === "object" ? hrvRmssdRaw?.value : hrvRmssdRaw;

    // ========================================================
    // HRV SDNN
    // ========================================================

    const hrvSdnnRaw = vitalSigns?.hrv_sdnn ?? primaryResult?.hrv_sdnn ?? null;

    const hrvSdnnValue =
      typeof hrvSdnnRaw === "object" ? hrvSdnnRaw?.value : hrvSdnnRaw;

    // ========================================================
    // PPG WAVEFORM
    // ========================================================

    const ppgRaw =
      vitalSigns?.ppg_waveform ??
      primaryResult?.waveforms?.ppg_waveform ??
      primaryResult?.ppg_waveform ??
      null;

    let ppgWaveform: number[] = [];

    if (Array.isArray(ppgRaw)) {
      ppgWaveform = ppgRaw.map(Number).filter(Number.isFinite);
    } else if (Array.isArray(ppgRaw?.data)) {
      ppgWaveform = ppgRaw.data.map(Number).filter(Number.isFinite);
    }

    // ========================================================
    // RESPIRATORY WAVEFORM
    // ========================================================

    const respiratoryWaveRaw =
      vitalSigns?.respiratory_waveform ??
      primaryResult?.waveforms?.respiratory_waveform ??
      primaryResult?.respiratory_waveform ??
      null;

    let respiratoryWaveform: number[] = [];

    if (Array.isArray(respiratoryWaveRaw)) {
      respiratoryWaveform = respiratoryWaveRaw
        .map(Number)
        .filter(Number.isFinite);
    } else if (Array.isArray(respiratoryWaveRaw?.data)) {
      respiratoryWaveform = respiratoryWaveRaw.data
        .map(Number)
        .filter(Number.isFinite);
    }

    // ========================================================
    // FACE DETECTION
    // ========================================================

    const processingStatus = primaryResult?.processing_status ?? {};

    const faceDetected =
      processingStatus?.face_detected ?? primaryResult?.face_detected ?? true;

    const faceConfidenceRaw =
      processingStatus?.confidence ?? primaryResult?.face_confidence ?? null;

    const faceConfidence = Number(faceConfidenceRaw);

    // ========================================================
    // SIGNAL QUALITY
    // ========================================================

    const signalQualityRaw =
      processingStatus?.signal_quality ?? primaryResult?.signal_quality ?? [];

    const signalQualityWarnings = Array.isArray(signalQualityRaw)
      ? signalQualityRaw.map(String)
      : signalQualityRaw
        ? [String(signalQualityRaw)]
        : [];

    // ========================================================
    // CONVERT NUMBERS
    // ========================================================

    const numericBpm = Number(heartRateValue);

    const numericConfidence = Number(heartRateConfidence);

    const numericRespiratoryRate = Number(respiratoryValue);

    const numericHrvRmssd = Number(hrvRmssdValue);

    const numericHrvSdnn = Number(hrvSdnnValue);

    // ========================================================
    // VALIDATE BPM
    // ========================================================

    const bpm =
      Number.isFinite(numericBpm) && numericBpm >= 30 && numericBpm <= 240
        ? Math.round(numericBpm)
        : null;

    // ========================================================
    // VALIDATE RESPIRATORY RATE
    // ========================================================

    const respiratoryRate =
      Number.isFinite(numericRespiratoryRate) &&
      numericRespiratoryRate >= 4 &&
      numericRespiratoryRate <= 60
        ? Math.round(numericRespiratoryRate)
        : null;

    // ========================================================
    // VALIDATE HRV
    // ========================================================

    const hrvRmssd =
      Number.isFinite(numericHrvRmssd) && numericHrvRmssd >= 0
        ? parseFloat(numericHrvRmssd.toFixed(1))
        : null;

    const hrvSdnn =
      Number.isFinite(numericHrvSdnn) && numericHrvSdnn >= 0
        ? parseFloat(numericHrvSdnn.toFixed(1))
        : null;

    // ========================================================
    // VALIDATE CONFIDENCE
    // ========================================================

    const confidence = Number.isFinite(numericConfidence)
      ? parseFloat(Math.max(0, Math.min(1, numericConfidence)).toFixed(2))
      : null;

    // ========================================================
    // DEBUG OUTPUT
    // ========================================================

    console.log("VitalLens parsed result:", {
      bpm,
      confidence,
      respiratoryRate,
      hrvRmssd,
      hrvSdnn,
      waveformSamples: ppgWaveform.length,
      respiratoryWaveformSamples: respiratoryWaveform.length,
      faceDetected,

      responseSchema: {
        usedVitalSigns: Boolean(primaryResult?.vital_signs),

        usedVitals: Boolean(primaryResult?.vitals),
      },
    });

    // ========================================================
    // RETURN NORMALIZED RESULT
    // ========================================================

    return res.json({
      success: true,

      apiConnected: true,

      source: "vitallens-cloud-api",

      engine: "VitalLens Cloud API",

      bpm,

      confidence,

      respiratoryRate,

      hrvRmssd,

      hrvSdnn,

      waveform: ppgWaveform,

      respiratoryWaveform,

      faceDetected,

      faceConfidence: Number.isFinite(faceConfidence)
        ? parseFloat(faceConfidence.toFixed(2))
        : null,

      signalQualityWarnings,

      responseSchema: {
        usedVitalSigns: Boolean(primaryResult?.vital_signs),

        usedVitals: Boolean(primaryResult?.vitals),
      },

      message: primaryResult?.message ?? "VitalLens inference completed.",

      rawResponse: data,
    });
  } catch (error: any) {
    const errorMessage =
      error?.name === "AbortError"
        ? "VitalLens Cloud API request timed out after 30 seconds."
        : error?.message || "Unknown VitalLens API error.";

    console.error("VitalLens API error:", errorMessage);

    return res.json({
      success: true,

      apiConnected: false,

      source: "local-fallback",

      message: `VitalLens Cloud API request failed: ${errorMessage}. Using local rPPG fallback.`,
    });
  }
});

// ============================================================
// DYNAMIC CLINICAL RULE-BASED FALLBACK
// ============================================================

function generateDynamicClinicalAnalysis(data: {
  heartRate: number;

  hrv?: {
    rmssd: number;
    sdnn: number;
    pnn50: number;
    stressIndex: number;
  };

  respiratoryRate: number;

  signalQuality?: {
    overall: number;
    methodAgreement: number;
    motionStability: number;
    illumination: number;
    waveformSNR: number;
  };

  methodComparison?: {
    g: number;
    chrom: number;
    pos: number;
    vitalLens: number;
    agreementPct: number;
  };

  userProfile?: {
    age?: number;
    restingState?: string;
    activity?: string;
  };

  riskLevel?: string;
}) {
  const {
    heartRate,
    hrv,
    respiratoryRate,
    signalQuality,
    methodComparison,
    riskLevel = "LOWER",
  } = data;

  const hr = heartRate || 72;

  const rmssd = hrv?.rmssd || 42;

  const resp = respiratoryRate || 16;

  const agreement =
    signalQuality?.methodAgreement ?? methodComparison?.agreementPct ?? 92;

  const quality = signalQuality?.overall ?? 88;

  // ==========================================================
  // AUTONOMIC TONE
  // ==========================================================

  let rhythmTone = "";

  if (rmssd >= 50) {
    rhythmTone = `Robust parasympathetic vagal tone (RMSSD ${rmssd.toFixed(
      1,
    )} ms) indicating strong autonomic flexibility and healthy physiological recovery capacity.`;
  } else if (rmssd >= 25) {
    rhythmTone = `Balanced autonomic tone (RMSSD ${rmssd.toFixed(
      1,
    )} ms) with typical resting sympathetic-parasympathetic equilibrium.`;
  } else {
    rhythmTone = `Constrained parasympathetic modulation (RMSSD ${rmssd.toFixed(
      1,
    )} ms). This may reflect acute sympathetic arousal, physical fatigue, or stress.`;
  }

  // ==========================================================
  // RESPIRATORY COUPLING
  // ==========================================================

  let respCoupling = "";

  if (resp >= 12 && resp <= 20) {
    respCoupling = `Normopneic resting respiratory frequency (${resp} breaths/min) exhibiting harmonious respiratory sinus arrhythmia with the cardiac cycle.`;
  } else if (resp > 20) {
    respCoupling = `Elevated respiratory rate (${resp} breaths/min). Potential hyperventilation or recent exertion may be modulating heart-rate variability patterns.`;
  } else {
    respCoupling = `Slow, measured respiratory cadence (${resp} breaths/min) characteristic of deep diaphragmatic breathing.`;
  }

  // ==========================================================
  // CLINICAL OVERVIEW
  // ==========================================================

  let clinicalOverview = "";

  if (riskLevel === "HIGHER") {
    clinicalOverview = `Screening indicates atypical resting cardiovascular parameters (HR ${hr} BPM, RMSSD ${rmssd.toFixed(
      0,
    )} ms). Optical pulse signals were detected across multi-channel rPPG but warrant medical correlation.`;
  } else if (riskLevel === "MODERATE") {
    clinicalOverview = `Cardiovascular screening shows borderline resting physiological metrics (HR ${hr} BPM, Resp ${resp} br/min). Vital periodicity is consistent across rPPG methods with moderate autonomic variance.`;
  } else {
    clinicalOverview = `Screening indicates physiological metrics compatible with a resting baseline (HR ${hr} BPM, Resp ${resp} br/min, RMSSD ${rmssd.toFixed(
      0,
    )} ms). Multi-channel rPPG shows detectable pulse periodicity.`;
  }

  // ==========================================================
  // SCREENING INDICATION
  // ==========================================================

  let screeningIndication = "";

  if (riskLevel === "HIGHER") {
    screeningIndication =
      "HIGHER INDICATION: Resting vital parameters fall outside standard reference bounds. This is a non-diagnostic screening indication and should be correlated with clinical measurements.";
  } else if (riskLevel === "MODERATE") {
    screeningIndication =
      "MODERATE INDICATION: Minor physiological deviations detected. Repeat the scan after 10 minutes of quiet rest and review baseline trends.";
  } else {
    screeningIndication =
      "LOWER INDICATION: Measured optical and physiological indices are compatible with a healthy resting baseline.";
  }

  // ==========================================================
  // LIFESTYLE GUIDANCE
  // ==========================================================

  const lifestyleGuidance = [
    rmssd < 30
      ? "Consider 10-15 minutes of slow paced breathing daily as a general relaxation practice."
      : "Maintain regular physical activity and adequate hydration.",

    hr > 85
      ? "Limit caffeine or stimulant intake before future resting scans and maintain consistent sleep."
      : "Prioritize a consistent sleep schedule to support autonomic recovery.",

    "Perform future screenings at consistent times and under similar resting conditions for better longitudinal comparison.",
  ];

  // ==========================================================
  // DOCTOR DISCUSSION POINTS
  // ==========================================================

  const doctorDiscussionPoints = [
    `How does my camera-based heart rate (${hr} BPM) and HRV compare with a clinical ECG or pulse measurement?`,

    "Are there lifestyle or stress-management adjustments that would be appropriate based on my measurements?",

    "Would standard cardiovascular screening be appropriate if I have persistent symptoms or concerns?",
  ];

  // ==========================================================
  // RETURN
  // ==========================================================

  return {
    clinicalOverview,

    cardiacRhythmTone: rhythmTone,

    respiratoryCoupling: respCoupling,

    methodReliability: `Cross-method agreement of ${agreement.toFixed(
      0,
    )}% with an overall signal-quality score of ${quality.toFixed(0)}%.`,

    screeningIndication,

    lifestyleGuidance,

    doctorDiscussionPoints,

    confidenceScore: Math.min(
      95,
      Math.max(70, Math.round((agreement + quality) / 2)),
    ),
  };
}

// ============================================================
// GEMINI ANALYSIS HELPER
// ============================================================

async function generateCardioAnalysisWithGemini(
  prompt: string,
  fallbackData: any,
): Promise<any> {
  const modelsToTry = [
    "gemini-3.7-flash",
    "gemini-flash-latest",
    "gemini-3.1-flash-lite",
  ];

  try {
    const ai = getGeminiClient();

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,

          contents: prompt,

          config: {
            responseMimeType: "application/json",

            systemInstruction:
              "You are a plain-language explainer for a non-diagnostic rPPG wellness screening tool. " +
              "You are NOT a clinician and must not present yourself as one. " +
              "A rule-based scoring algorithm already computed the screening category. " +
              "Your job is only to explain the supplied measurements and category. " +
              "Do not diagnose diseases or invent clinical conclusions. " +
              "Always maintain non-diagnostic boundaries.",
          },
        });

        const text = response.text?.trim() || "";

        if (text) {
          try {
            const parsed = JSON.parse(text);

            if (parsed && parsed.clinicalOverview) {
              return parsed;
            }
          } catch (parseError) {
            console.warn(`JSON parse error on model ${modelName}:`, parseError);
          }
        }
      } catch (apiError: any) {
        console.warn(
          `Gemini API attempt on model ${modelName} failed:`,
          apiError?.message || apiError,
        );

        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
  } catch (error: any) {
    console.warn("Gemini unavailable:", error?.message || error);
  }

  // ==========================================================
  // FALLBACK
  // ==========================================================

  return generateDynamicClinicalAnalysis(fallbackData);
}

// ============================================================
// CARDIOVISION AI ANALYSIS ENDPOINT
// ============================================================

app.post("/api/cardiovision/analyze", async (req, res) => {
  try {
    const {
      heartRate,
      hrv,
      respiratoryRate,
      signalQuality,
      methodComparison,
      userProfile,
      baselineComparison,
      riskLevel,
    } = req.body;

    const prompt = `
You are a clinical physiological analysis assistant for CardioVision,
an AI-based non-contact cardiovascular risk screening system using
remote photoplethysmography (rPPG).

This is a NON-DIAGNOSTIC screening system.

Analyze the following screening session data:

- Measured Heart Rate:
  ${heartRate} BPM

- Method Heart Rates:
  G=${methodComparison?.g ?? "N/A"} BPM
  CHROM=${methodComparison?.chrom ?? "N/A"} BPM
  POS=${methodComparison?.pos ?? "N/A"} BPM
  VitalLens=${methodComparison?.vitalLens ?? "N/A"} BPM

- Method Agreement:
  ${signalQuality?.methodAgreement ?? "N/A"}%

- HRV RMSSD:
  ${hrv?.rmssd ?? "N/A"} ms

- HRV SDNN:
  ${hrv?.sdnn ?? "N/A"} ms

- Respiratory Rate:
  ${respiratoryRate} breaths/min

- Signal Quality:
  ${signalQuality?.overall ?? "N/A"}%

- Motion Stability:
  ${signalQuality?.motionStability ?? "N/A"}%

- Lighting:
  ${signalQuality?.illumination ?? "N/A"}%

- Waveform SNR:
  ${signalQuality?.waveformSNR ?? "N/A"} dB

- Screening Category:
  ${riskLevel ?? "N/A"}

- User Profile:
  Age=${userProfile?.age ?? "Not specified"}
  Activity=${userProfile?.activity ?? "General"}
  Resting State=${userProfile?.restingState ?? "Resting"}

- Baseline Comparison:
  ${
    baselineComparison
      ? JSON.stringify(baselineComparison)
      : "First baseline reading"
  }

Return strictly valid JSON with this structure:

{
  "clinicalOverview": "2-3 sentences explaining the supplied physiological findings without diagnosing disease.",
  "cardiacRhythmTone": "Explanation of HRV and resting heart rate.",
  "respiratoryCoupling": "Explanation of respiratory rate.",
  "methodReliability": "Explanation of agreement between the rPPG methods.",
  "screeningIndication": "Explanation of the supplied screening category.",
  "lifestyleGuidance": [
    "tip 1",
    "tip 2",
    "tip 3"
  ],
  "doctorDiscussionPoints": [
    "question 1",
    "question 2",
    "question 3"
  ],
  "confidenceScore": 85
}

IMPORTANT:
Do not diagnose diseases.
Do not claim that camera-based rPPG replaces ECG,
blood pressure measurement, or clinical testing.
Keep the response non-diagnostic.
`;

    const analysis = generateDynamicClinicalAnalysis(req.body);

    return res.json({
      success: true,
      analysis,
    });

    return res.json({
      success: true,
      analysis,
    });
  } catch (error: any) {
    console.error("CardioVision analysis endpoint error:", error);

    const fallbackAnalysis = generateDynamicClinicalAnalysis(req.body);

    return res.json({
      success: true,
      analysis: fallbackAnalysis,
      fallback: true,
    });
  }
});

// ============================================================
// START SERVER
// ============================================================

async function startServer() {
  try {
    // ----------------------------------------------------------
    // DEVELOPMENT
    // ----------------------------------------------------------

    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
        },

        appType: "spa",
      });

      // Vite serves the React application
      app.use(vite.middlewares);
    }

    // ----------------------------------------------------------
    // PRODUCTION
    // ----------------------------------------------------------
    else {
      const distPath = path.join(process.cwd(), "dist");

      app.use(express.static(distPath));

      // SPA fallback without relying on
      // Express wildcard-route syntax.
      app.use((req, res, next) => {
        if (req.method !== "GET") {
          return next();
        }

        if (req.path.startsWith("/api/")) {
          return next();
        }

        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    // ----------------------------------------------------------
    // START LISTENER
    // ----------------------------------------------------------

    app.listen(PORT, "0.0.0.0", () => {
      console.log("================================================");

      console.log(`CardioVision Server running on http://localhost:${PORT}`);

      console.log(`Health: http://localhost:${PORT}/api/health`);

      console.log(`VitalLens: http://localhost:${PORT}/api/vitallens/status`);

      console.log("================================================");
    });
  } catch (error) {
    console.error("Failed to start CardioVision server:", error);

    process.exit(1);
  }
}

// ============================================================
// BOOT
// ============================================================

startServer();
