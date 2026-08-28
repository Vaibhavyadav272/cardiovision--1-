export interface FaceROI {
  forehead: { x: number; y: number; width: number; height: number };
  leftCheek: { x: number; y: number; width: number; height: number };
  rightCheek: { x: number; y: number; width: number; height: number };
  faceBox: { x: number; y: number; width: number; height: number };
}

export interface FrameExtractionResult {
  hasFace: boolean;
  confidence: number;
  rois: FaceROI | null;
  avgRGB: { r: number; g: number; b: number };
  foreheadRGB: { r: number; g: number; b: number };
  leftCheekRGB: { r: number; g: number; b: number };
  rightCheekRGB: { r: number; g: number; b: number };
  motionVariance: number;
  illumination: number;
  isStable: boolean;
}

export class FaceRPPGTracker {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private crop40Canvas: HTMLCanvasElement;
  private crop40Ctx: CanvasRenderingContext2D;
  private prevFaceBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;
  private smoothedFaceBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;
  private rawFramesBuffer: Uint8Array[] = [];
  private isRecordingFrames: boolean = false;
  private readonly maxRawFrames = 900;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 320;
    this.canvas.height = 240;
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true })!;

    // 40x40 standardized canvas for VitalLens API raw RGB24 input
    this.crop40Canvas = document.createElement("canvas");
    this.crop40Canvas.width = 40;
    this.crop40Canvas.height = 40;
    this.crop40Ctx = this.crop40Canvas.getContext("2d", {
      willReadFrequently: true,
    })!;
  }

  /**
   * Start recording standardized 40x40 RGB24 video frames for VitalLens API
   */
  public startRecording(): void {
    this.rawFramesBuffer = [];
    this.isRecordingFrames = true;
  }

  /**
   * Stop recording frames
   */
  public stopRecording(): void {
    this.isRecordingFrames = false;
  }

  /**
   * Convert accumulated raw RGB24 frames to base64 string matching VitalLens API spec
   */
  public getRawVideoRGB24Base64(): string {
    if (this.rawFramesBuffer.length === 0) return "";
    const frameByteSize = 40 * 40 * 3;
    const totalBytes = this.rawFramesBuffer.length * frameByteSize;
    const combined = new Uint8Array(totalBytes);

    for (let i = 0; i < this.rawFramesBuffer.length; i++) {
      combined.set(this.rawFramesBuffer[i], i * frameByteSize);
    }

    // Binary to Base64 conversion
    let binary = "";
    const len = combined.byteLength;
    const chunkSize = 0x8000; // 32KB chunks to avoid stack limits
    for (let i = 0; i < len; i += chunkSize) {
      const chunk = combined.subarray(i, Math.min(i + chunkSize, len));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary);
  }

  /**
   * Process a single video frame, locate face & ROIs, and extract skin RGB channels
   */
  public async processFrame(
    video: HTMLVideoElement,
  ): Promise<FrameExtractionResult> {
    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      return this.getFallbackResult();
    }

    const width = this.canvas.width;
    const height = this.canvas.height;
    this.ctx.drawImage(video, 0, 0, width, height);

    const imageData = this.ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    let detectedBox = this.detectFaceBox(data, width, height);

    // Default centered face oval box if skin detector is uncertain
    const defaultCenterBox = {
      x: Math.round(width * 0.25),
      y: Math.round(height * 0.15),
      width: Math.round(width * 0.5),
      height: Math.round(height * 0.65),
    };

    let faceBox = detectedBox || defaultCenterBox;

    // Temporal smoothing to prevent jitter
    if (!this.smoothedFaceBox) {
      this.smoothedFaceBox = { ...faceBox };
    } else {
      this.smoothedFaceBox = {
        x: Math.round(0.8 * this.smoothedFaceBox.x + 0.2 * faceBox.x),
        y: Math.round(0.8 * this.smoothedFaceBox.y + 0.2 * faceBox.y),
        width: Math.round(
          0.8 * this.smoothedFaceBox.width + 0.2 * faceBox.width,
        ),
        height: Math.round(
          0.8 * this.smoothedFaceBox.height + 0.2 * faceBox.height,
        ),
      };
    }
    faceBox = this.smoothedFaceBox;

    // If recording is enabled, crop face and save 40x40 RGB24 bytes for VitalLens
    if (this.isRecordingFrames && detectedBox) {
      try {
        this.crop40Ctx.drawImage(
          this.canvas,
          faceBox.x,
          faceBox.y,
          faceBox.width,
          faceBox.height,
          0,
          0,
          40,
          40,
        );
        const cropData = this.crop40Ctx.getImageData(0, 0, 40, 40).data;
        const rgb24 = new Uint8Array(40 * 40 * 3);
        let dst = 0;
        for (let src = 0; src < cropData.length; src += 4) {
          rgb24[dst++] = cropData[src]; // R
          rgb24[dst++] = cropData[src + 1]; // G
          rgb24[dst++] = cropData[src + 2]; // B
        }
        if (this.rawFramesBuffer.length < this.maxRawFrames) {
          this.rawFramesBuffer.push(rgb24);
        }
      } catch (err) {
        // Ignore frame crop errors
      }
    }

    // Motion variance calculation
    let motionVariance = 0;
    if (this.prevFaceBox) {
      const dx = faceBox.x - this.prevFaceBox.x;
      const dy = faceBox.y - this.prevFaceBox.y;
      const dw = faceBox.width - this.prevFaceBox.width;
      const dh = faceBox.height - this.prevFaceBox.height;
      motionVariance = Math.sqrt(dx * dx + dy * dy + dw * dw + dh * dh) / 10;
    }
    this.prevFaceBox = { ...faceBox };

    // Subdivide into Forehead, Left Cheek, and Right Cheek ROIs
    const rois: FaceROI = {
      faceBox,
      forehead: {
        x: Math.round(faceBox.x + faceBox.width * 0.22),
        y: Math.round(faceBox.y + faceBox.height * 0.1),
        width: Math.round(faceBox.width * 0.56),
        height: Math.round(faceBox.height * 0.2),
      },
      leftCheek: {
        x: Math.round(faceBox.x + faceBox.width * 0.12),
        y: Math.round(faceBox.y + faceBox.height * 0.44),
        width: Math.round(faceBox.width * 0.28),
        height: Math.round(faceBox.height * 0.24),
      },
      rightCheek: {
        x: Math.round(faceBox.x + faceBox.width * 0.6),
        y: Math.round(faceBox.y + faceBox.height * 0.44),
        width: Math.round(faceBox.width * 0.28),
        height: Math.round(faceBox.height * 0.24),
      },
    };

    // Extract average RGB from each skin region with adaptive fallbacks
    const foreheadRGB = this.sampleROISkin(data, width, height, rois.forehead);
    const leftCheekRGB = this.sampleROISkin(
      data,
      width,
      height,
      rois.leftCheek,
    );
    const rightCheekRGB = this.sampleROISkin(
      data,
      width,
      height,
      rois.rightCheek,
    );

    // Weighted composite RGB (forehead + cheeks)
    const avgRGB = {
      r: 0.46 * foreheadRGB.r + 0.27 * leftCheekRGB.r + 0.27 * rightCheekRGB.r,
      g: 0.46 * foreheadRGB.g + 0.27 * leftCheekRGB.g + 0.27 * rightCheekRGB.g,
      b: 0.46 * foreheadRGB.b + 0.27 * leftCheekRGB.b + 0.27 * rightCheekRGB.b,
    };

    const illumination = Math.round((avgRGB.r + avgRGB.g + avgRGB.b) / 3);
    const confidence = detectedBox ? 0.95 : 0;
    const isStable =
      motionVariance < 1.4 && illumination >= 30 && illumination <= 245;

    return {
      hasFace: detectedBox !== null,
      confidence,
      rois,
      avgRGB,
      foreheadRGB: { r: foreheadRGB.r, g: foreheadRGB.g, b: foreheadRGB.b },
      leftCheekRGB: { r: leftCheekRGB.r, g: leftCheekRGB.g, b: leftCheekRGB.b },
      rightCheekRGB: {
        r: rightCheekRGB.r,
        g: rightCheekRGB.g,
        b: rightCheekRGB.b,
      },
      motionVariance: parseFloat(motionVariance.toFixed(2)),
      illumination,
      isStable,
    };
  }

  /**
   * Sample skin pixels within a bounding box ROI, supporting diverse skin tones (Fitzpatrick I-VI)
   */
  private sampleROISkin(
    data: Uint8ClampedArray,
    imgWidth: number,
    imgHeight: number,
    roi: { x: number; y: number; width: number; height: number },
  ): { r: number; g: number; b: number; pixelCount: number } {
    let sumR = 0,
      sumG = 0,
      sumB = 0,
      count = 0;
    let allSumR = 0,
      allSumG = 0,
      allSumB = 0,
      allCount = 0;

    const startX = Math.max(0, roi.x);
    const endX = Math.min(imgWidth, roi.x + roi.width);
    const startY = Math.max(0, roi.y);
    const endY = Math.min(imgHeight, roi.y + roi.height);

    for (let y = startY; y < endY; y += 2) {
      for (let x = startX; x < endX; x += 2) {
        const idx = (y * imgWidth + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        allSumR += r;
        allSumG += g;
        allSumB += b;
        allCount++;

        // Broad skin chromaticity check (supports wide range of human skin pigmentation)
        const isSkin =
          r > 30 &&
          g > 20 &&
          b > 15 &&
          r >= b &&
          r >= g * 0.75 &&
          Math.max(r, g, b) - Math.min(r, g, b) > 8;

        if (isSkin) {
          sumR += r;
          sumG += g;
          sumB += b;
          count++;
        }
      }
    }

    if (count < 10) {
      if (allCount > 0) {
        return {
          r: allSumR / allCount,
          g: allSumG / allCount,
          b: allSumB / allCount,
          pixelCount: allCount,
        };
      }
      return { r: 155, g: 120, b: 100, pixelCount: 1 };
    }

    return {
      r: sumR / count,
      g: sumG / count,
      b: sumB / count,
      pixelCount: count,
    };
  }

  /**
   * Detect Face Box using skin-chroma density clustering
   */
  private detectFaceBox(
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ): { x: number; y: number; width: number; height: number } | null {
    let minX = width,
      maxX = 0,
      minY = height,
      maxY = 0;
    let skinCount = 0;

    const xMinScan = Math.floor(width * 0.15);
    const xMaxScan = Math.floor(width * 0.85);
    const yMinScan = Math.floor(height * 0.1);
    const yMaxScan = Math.floor(height * 0.9);

    for (let y = yMinScan; y < yMaxScan; y += 4) {
      for (let x = xMinScan; x < xMaxScan; x += 4) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        if (r > 35 && g > 22 && b > 18 && r >= b && r - b >= 4) {
          skinCount++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (skinCount < 30 || maxX <= minX || maxY <= minY) {
      return null;
    }

    const faceWidth = Math.max(90, maxX - minX);
    const faceHeight = Math.max(110, maxY - minY);

    return {
      x: Math.max(0, minX),
      y: Math.max(0, minY),
      width: Math.min(width - minX, faceWidth),
      height: Math.min(height - minY, faceHeight),
    };
  }

  private getFallbackResult(): FrameExtractionResult {
    return {
      hasFace: false,
      confidence: 0,
      rois: null,
      avgRGB: { r: 150, g: 120, b: 100 },
      foreheadRGB: { r: 150, g: 120, b: 100 },
      leftCheekRGB: { r: 150, g: 120, b: 100 },
      rightCheekRGB: { r: 150, g: 120, b: 100 },
      motionVariance: 0,
      illumination: 120,
      isStable: true,
    };
  }
}

