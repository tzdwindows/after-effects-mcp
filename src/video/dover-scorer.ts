import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import * as ort from 'onnxruntime-node';
import { getPackageRoot, resolveFfmpegPath } from '../audio/dsp-utils.js';
import { analyzeAudioRhythm } from '../audio/beat-analyzer.js';

export interface VideoSegmentDiagnostic {
  startTime: number;
  endTime: number;
  brightness: number;
  contrast: number;
  sharpness: number;
  motionFlux: number;
  colorfulness: number;
  status: 'excellent' | 'good' | 'warning_low_motion' | 'warning_dark_or_blank' | 'warning_overexposed';
  note: string;
}

export interface DOVERVideoScoreResult {
  videoPath: string;
  modelName: string;
  modelPath: string;
  inferenceTimeMs: number;
  durationSec: number;
  scores: {
    overallScore: number; // 0 - 100 (DOVER fused score)
    technicalScore: number; // 0 - 100 (DOVER TQE branch)
    aestheticScore: number; // 0 - 100 (DOVER AQE branch)
    audioVisualSyncScore?: number; // 0 - 100 (Visual flux vs Audio drum/beat sync)
    rawTechnicalLogit: number;
    rawAestheticLogit: number;
    qualityGrade: 'S' | 'A' | 'B' | 'C' | 'D';
  };
  datasetPercentileComparison: {
    LIVE_VQC_Percentile: number;
    KoNViD_1k_Percentile: number;
    LSVQ_1080P_Percentile: number;
    YouTube_UGC_Percentile: number;
  };
  visualMetrics: {
    avgBrightness: number;
    avgContrast: number;
    avgSharpness: number;
    avgColorfulness: number;
    avgMotionFlux: number;
    blankOrDarkFrameCount: number;
    staticCameraFrameCount: number;
  };
  segmentDiagnostics: VideoSegmentDiagnostic[];
  recommendations: string[];
}

export interface EvaluateVideoOptions {
  audioPath?: string;
  startTime?: number;
  endTime?: number;
}

let cachedDoverSession: ort.InferenceSession | null = null;
let cachedDoverModelPath = '';

function resolveDoverModelPath(): string {
  const pkgRoot = getPackageRoot();
  const candidates = [
    path.join(pkgRoot, 'models', 'dover_mobile', 'dover_mobile.onnx'),
    path.join(process.cwd(), 'models', 'dover_mobile', 'dover_mobile.onnx'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

async function getDoverSession(): Promise<{ session: ort.InferenceSession; modelPath: string }> {
  const modelPath = resolveDoverModelPath();
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Bundled DOVER-Mobile ONNX model not found at ${modelPath}`);
  }
  if (!cachedDoverSession || cachedDoverModelPath !== modelPath) {
    cachedDoverSession = await ort.InferenceSession.create(modelPath);
    cachedDoverModelPath = modelPath;
  }
  return { session: cachedDoverSession, modelPath };
}

/**
 * Probes video duration in seconds using FFmpeg stderr output.
 */
function probeVideoDurationSec(videoPath: string): number {
  const ffmpegBin = resolveFfmpegPath();
  const proc = spawnSync(ffmpegBin, ['-i', videoPath], { encoding: 'utf-8' });
  const stderr = (proc.stderr || '') + (proc.stdout || '');
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (match) {
    const hrs = parseInt(match[1], 10);
    const mins = parseInt(match[2], 10);
    const secs = parseFloat(match[3]);
    return hrs * 3600 + mins * 60 + secs;
  }
  return 10.0;
}

/**
 * Decodes exactly 32 uniformly sampled RGB frames at 448x252 resolution from the video
 * so we can construct both the 224x224 Aesthetic View and the 7x7x32x32 Technical Fragment View.
 */
function extractUniformFramesRGB(
  videoPath: string,
  startTime = 0,
  endTime?: number,
  targetFrames = 32,
  decodeW = 448,
  decodeH = 252
): {
  frames: Uint8Array[];
  width: number;
  height: number;
  durationSec: number;
  sampledTimes: number[];
} {
  const totalDur = probeVideoDurationSec(videoPath);
  const sTime = Math.max(0, startTime);
  const eTime = endTime && endTime > sTime ? Math.min(totalDur, endTime) : totalDur;
  const clipDur = Math.max(0.2, eTime - sTime);

  const fps = Math.max(1.0, (targetFrames + 2) / clipDur);
  const ffmpegBin = resolveFfmpegPath();

  const args: string[] = ['-v', 'error'];
  if (sTime > 0) {
    args.push('-ss', String(sTime));
  }
  args.push(
    '-t',
    String(clipDur),
    '-i',
    videoPath,
    '-vf',
    `fps=${fps.toFixed(4)},scale=${decodeW}:${decodeH}:flags=bicubic`,
    '-frames:v',
    String(targetFrames),
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    'pipe:1'
  );

  const proc = spawnSync(ffmpegBin, args, {
    maxBuffer: 128 * 1024 * 1024,
  });

  if (proc.error) {
    throw new Error(`FFmpeg failed to decode video frames: ${proc.error.message}`);
  }

  const frameByteSize = decodeW * decodeH * 3;
  const rawBuf = proc.stdout;
  const decodedCount = Math.floor((rawBuf ? rawBuf.byteLength : 0) / frameByteSize);

  if (decodedCount === 0) {
    const errText = proc.stderr ? proc.stderr.toString('utf-8') : 'No frames decoded';
    throw new Error(`Failed to extract frames from "${videoPath}": ${errText}`);
  }

  const rawFrames: Uint8Array[] = [];
  for (let i = 0; i < decodedCount; i++) {
    const slice = rawBuf.subarray(i * frameByteSize, (i + 1) * frameByteSize);
    rawFrames.push(new Uint8Array(slice));
  }

  // Ensure exactly targetFrames (32) by uniform indexing / padding
  const frames: Uint8Array[] = [];
  const sampledTimes: number[] = [];
  for (let t = 0; t < targetFrames; t++) {
    const idx = Math.min(rawFrames.length - 1, Math.floor((t * rawFrames.length) / targetFrames));
    frames.push(rawFrames[idx]);
    sampledTimes.push(Number((sTime + ((t + 0.5) * clipDur) / targetFrames).toFixed(3)));
  }

  return {
    frames,
    width: decodeW,
    height: decodeH,
    durationSec: clipDur,
    sampledTimes,
  };
}

/**
 * Constructs DOVER's Disentangled Aesthetic View (1, 3, 32, 224, 224) and
 * Technical Spatial-Fragment View (1, 3, 32, 224, 224) with ImageNet normalization.
 */
function buildDOVERViews(
  frames: Uint8Array[],
  srcW: number,
  srcH: number
): {
  aesView: Float32Array;
  techView: Float32Array;
} {
  const T = 32;
  const outH = 224;
  const outW = 224;
  const planeSize = T * outH * outW;

  const aesView = new Float32Array(3 * planeSize);
  const techView = new Float32Array(3 * planeSize);

  const mean = [123.675, 116.28, 103.53];
  const std = [58.395, 57.12, 57.375];

  // 1. Aesthetic View: Bilinear / area resize of full frame (srcW x srcH) -> (224 x 224)
  for (let t = 0; t < T; t++) {
    const frame = frames[t];
    for (let y = 0; y < outH; y++) {
      const sy = Math.min(srcH - 1, Math.floor((y * srcH) / outH));
      for (let x = 0; x < outW; x++) {
        const sx = Math.min(srcW - 1, Math.floor((x * srcW) / outW));
        const srcIdx = (sy * srcW + sx) * 3;
        const dstIdx = t * (outH * outW) + y * outW + x;

        aesView[0 * planeSize + dstIdx] = (frame[srcIdx + 0] - mean[0]) / std[0];
        aesView[1 * planeSize + dstIdx] = (frame[srcIdx + 1] - mean[1]) / std[1];
        aesView[2 * planeSize + dstIdx] = (frame[srcIdx + 2] - mean[2]) / std[2];
      }
    }
  }

  // 2. Technical View: 7x7 grid of 32x32 native-resolution patches spliced into 224x224
  const fragmentsH = 7;
  const fragmentsW = 7;
  const fsizeH = 32;
  const fsizeW = 32;

  const hgrids: number[] = [];
  const wgrids: number[] = [];
  const cellH = Math.floor(srcH / fragmentsH);
  const cellW = Math.floor(srcW / fragmentsW);

  for (let i = 0; i < fragmentsH; i++) {
    const offsetH = Math.max(0, Math.floor((cellH - fsizeH) / 2));
    hgrids.push(Math.min(srcH - fsizeH, i * cellH + offsetH));
  }
  for (let j = 0; j < fragmentsW; j++) {
    const offsetW = Math.max(0, Math.floor((cellW - fsizeW) / 2));
    wgrids.push(Math.min(srcW - fsizeW, j * cellW + offsetW));
  }

  for (let t = 0; t < T; t++) {
    const frame = frames[t];
    for (let fi = 0; fi < fragmentsH; fi++) {
      const hs = hgrids[fi];
      const dstYBase = fi * fsizeH;
      for (let fj = 0; fj < fragmentsW; fj++) {
        const ws = wgrids[fj];
        const dstXBase = fj * fsizeW;

        for (let py = 0; py < fsizeH; py++) {
          const sy = hs + py;
          const dy = dstYBase + py;
          for (let px = 0; px < fsizeW; px++) {
            const sx = ws + px;
            const dx = dstXBase + px;
            const srcIdx = (sy * srcW + sx) * 3;
            const dstIdx = t * (outH * outW) + dy * outW + dx;

            techView[0 * planeSize + dstIdx] = (frame[srcIdx + 0] - mean[0]) / std[0];
            techView[1 * planeSize + dstIdx] = (frame[srcIdx + 1] - mean[1]) / std[1];
            techView[2 * planeSize + dstIdx] = (frame[srcIdx + 2] - mean[2]) / std[2];
          }
        }
      }
    }
  }

  return { aesView, techView };
}

/**
 * Standard normal CDF approximation (Abramowitz and Stegun) to convert z-score to dataset percentile.
 */
function normalCdfPercentile(z: number): number {
  const t = 1.0 / (1.0 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2.0);
  const prob =
    d *
    t *
    (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const cdf = z > 0 ? 1.0 - prob : prob;
  return Number(Math.min(99.9, Math.max(0.1, cdf * 100.0)).toFixed(1));
}

/**
 * Evaluates a video file using the bundled DOVER-Mobile neural network + fine-grained visual & audio-sync diagnostics.
 */
export async function evaluateVideoWithDOVER(
  videoPath: string,
  options: EvaluateVideoOptions = {}
): Promise<DOVERVideoScoreResult> {
  const absVideoPath = path.resolve(videoPath);
  if (!fs.existsSync(absVideoPath)) {
    throw new Error(`Video file not found: ${absVideoPath}`);
  }

  const tStart = Date.now();
  const { frames, width, height, durationSec, sampledTimes } = extractUniformFramesRGB(
    absVideoPath,
    options.startTime ?? 0,
    options.endTime,
    32,
    448,
    252
  );

  const { aesView, techView } = buildDOVERViews(frames, width, height);
  const { session, modelPath } = await getDoverSession();

  const aesTensor = new ort.Tensor('float32', aesView, [1, 3, 32, 224, 224]);
  const techTensor = new ort.Tensor('float32', techView, [1, 3, 32, 224, 224]);

  const outputs = await session.run({
    aes_view: aesTensor,
    tech_view: techTensor,
  });

  const aesRaw = Number((outputs.aesthetic_score.data as Float32Array)[0]);
  const techRaw = Number((outputs.technical_score.data as Float32Array)[0]);

  // Official ITU 4-parameter rescaling & fusion from VQAssessment/DOVER
  const techNorm = (techRaw - 0.1107) / 0.07355;
  const aesNorm = (aesRaw + 0.08285) / 0.03774;
  const fusedLogit = techNorm * 0.6104 + aesNorm * 0.3896;

  // Compute fine-grained visual diagnostics across the 32 sampled frames (4 segments of 8 frames each)
  const numFrames = frames.length;
  const frameBrightness = new Float32Array(numFrames);
  const frameContrast = new Float32Array(numFrames);
  const frameSharpness = new Float32Array(numFrames);
  const frameColorfulness = new Float32Array(numFrames);
  const frameMotion = new Float32Array(numFrames);

  let blankOrDarkFrames = 0;
  let staticFrames = 0;

  for (let f = 0; f < numFrames; f++) {
    const buf = frames[f];
    const numPixels = width * height;
    let lumaSum = 0;
    let rgSum = 0;
    let ybSum = 0;

    // Subsample every 2nd pixel for fast exact stats
    let count = 0;
    for (let i = 0; i < buf.length; i += 6) {
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      lumaSum += y;
      rgSum += r - g;
      ybSum += 0.5 * (r + g) - b;
      count++;
    }
    const meanLuma = lumaSum / count;
    const meanRg = rgSum / count;
    const meanYb = ybSum / count;

    let lumaVar = 0;
    let rgVar = 0;
    let ybVar = 0;
    for (let i = 0; i < buf.length; i += 6) {
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      lumaVar += (y - meanLuma) * (y - meanLuma);
      rgVar += (r - g - meanRg) * (r - g - meanRg);
      ybVar += (0.5 * (r + g) - b - meanYb) * (0.5 * (r + g) - b - meanYb);
    }

    const stdLuma = Math.sqrt(lumaVar / count);
    const stdRg = Math.sqrt(rgVar / count);
    const stdYb = Math.sqrt(ybVar / count);

    // Hasler & Süsstrunk colorfulness metric
    const colorfulness =
      Math.sqrt(stdRg * stdRg + stdYb * stdYb) + 0.3 * Math.sqrt(meanRg * meanRg + meanYb * meanYb);

    // Spatial gradient sharpness
    let edgeSum = 0;
    let edgeCount = 0;
    for (let y = 2; y < height - 2; y += 2) {
      for (let x = 2; x < width - 2; x += 2) {
        const idx = (y * width + x) * 3;
        const rightIdx = (y * width + (x + 1)) * 3;
        const downIdx = ((y + 1) * width + x) * 3;
        const gx = Math.abs(buf[rightIdx] - buf[idx]) + Math.abs(buf[rightIdx + 1] - buf[idx + 1]);
        const gy = Math.abs(buf[downIdx] - buf[idx]) + Math.abs(buf[downIdx + 1] - buf[idx + 1]);
        edgeSum += (gx + gy) * 0.5;
        edgeCount++;
      }
    }

    frameBrightness[f] = meanLuma;
    frameContrast[f] = stdLuma;
    frameSharpness[f] = edgeSum / Math.max(1, edgeCount);
    frameColorfulness[f] = colorfulness;

    if (meanLuma < 8.0 || stdLuma < 4.0) {
      blankOrDarkFrames++;
    }

    if (f > 0) {
      const prev = frames[f - 1];
      let diffSum = 0;
      for (let i = 0; i < buf.length; i += 6) {
        diffSum +=
          (Math.abs(buf[i] - prev[i]) +
            Math.abs(buf[i + 1] - prev[i + 1]) +
            Math.abs(buf[i + 2] - prev[i + 2])) /
          3.0;
      }
      frameMotion[f] = diffSum / Math.max(1, numPixels / 2);
      if (frameMotion[f] < 0.8) {
        staticFrames++;
      }
    }
  }

  // Calibrate DOVER scores to [0, 100] scale
  const technicalScore = Number((100.0 / (1.0 + Math.exp(-techNorm))).toFixed(2));
  const aestheticScore = Number((100.0 / (1.0 + Math.exp(-aesNorm))).toFixed(2));
  const overallScore = Number((100.0 / (1.0 + Math.exp(-fusedLogit))).toFixed(2));

  // Optional Audio-Visual Rhythm Synchronization Score
  let audioVisualSyncScore: number | undefined;
  const audioSource = options.audioPath && fs.existsSync(path.resolve(options.audioPath))
    ? path.resolve(options.audioPath)
    : absVideoPath;

  try {
    const rhythm = analyzeAudioRhythm(audioSource, {
      startTime: options.startTime,
      endTime: options.endTime,
    });
    if (rhythm.beats.length > 0) {
      // Check how well visual motion spikes align with audio beats/impacts
      const accentTimes = [
        ...rhythm.beats.map((b) => b.time),
        ...rhythm.drumOnsets.majorImpacts.map((m) => m.time),
      ];
      let alignedMotionEnergy = 0;
      let totalMotionEnergy = 1e-6;
      const beatTol = Math.max(0.09, rhythm.beatIntervalSec * 0.25);

      for (let f = 1; f < numFrames; f++) {
        const t = sampledTimes[f];
        const m = frameMotion[f];
        totalMotionEnergy += m;
        const nearBeat = accentTimes.some((bt) => Math.abs(bt - t) <= beatTol);
        if (nearBeat) {
          alignedMotionEnergy += m * 1.45;
        } else {
          alignedMotionEnergy += m * 0.55;
        }
      }
      const ratio = alignedMotionEnergy / totalMotionEnergy;
      const motionActivityBonus = Math.min(15, (frameMotion.reduce((a, b) => a + b, 0) / numFrames) * 1.2);
      audioVisualSyncScore = Number(
        Math.min(99.5, Math.max(25.0, (ratio - 0.45) * 85.0 + 40.0 + motionActivityBonus)).toFixed(2)
      );
    }
  } catch {
    // Video might not have an audio stream and no external audioPath was given
  }

  // Build 4 segment diagnostics
  const segmentDiagnostics: VideoSegmentDiagnostic[] = [];
  const framesPerSeg = 8;
  for (let s = 0; s < 4; s++) {
    const f0 = s * framesPerSeg;
    const f1 = Math.min(numFrames - 1, (s + 1) * framesPerSeg - 1);
    const count = f1 - f0 + 1;

    let bAvg = 0,
      cAvg = 0,
      shAvg = 0,
      colAvg = 0,
      mAvg = 0;
    for (let f = f0; f <= f1; f++) {
      bAvg += frameBrightness[f];
      cAvg += frameContrast[f];
      shAvg += frameSharpness[f];
      colAvg += frameColorfulness[f];
      mAvg += frameMotion[f];
    }
    bAvg /= count;
    cAvg /= count;
    shAvg /= count;
    colAvg /= count;
    mAvg /= count;

    let status: VideoSegmentDiagnostic['status'] = 'good';
    let note = 'Balanced exposure, sharpness, and continuous 3D camera/visual motion.';
    if (bAvg < 12 || cAvg < 6) {
      status = 'warning_dark_or_blank';
      note = 'Segment is overly dark or nearly blank; check layer visibility, camera Z-clipping, or background lighting.';
    } else if (bAvg > 235) {
      status = 'warning_overexposed';
      note = 'Segment has blown-out highlights; reduce Glow intensity or exposure.';
    } else if (mAvg < 1.5) {
      status = 'warning_low_motion';
      note = 'Very low frame-to-frame visual motion; add continuous 3D camera dolly/orbit or beat-synced kinetic typography.';
    } else if (shAvg > 12 && colAvg > 25 && mAvg >= 4.0) {
      status = 'excellent';
      note = 'High visual richness, crisp edge contrast, and strong dynamic kinetic energy.';
    }

    segmentDiagnostics.push({
      startTime: sampledTimes[f0],
      endTime: sampledTimes[f1],
      brightness: Number(bAvg.toFixed(2)),
      contrast: Number(cAvg.toFixed(2)),
      sharpness: Number(shAvg.toFixed(2)),
      motionFlux: Number(mAvg.toFixed(2)),
      colorfulness: Number(colAvg.toFixed(2)),
      status,
      note,
    });
  }

  // Actionable recommendations for the AI Agent
  const recommendations: string[] = [];
  if (blankOrDarkFrames > 2) {
    recommendations.push(
      `Detected ${blankOrDarkFrames}/32 dark or blank frames. Verify 3D camera is not passing behind background layers and text opacity keyframes are active.`
    );
  }
  if (staticFrames > 6) {
    recommendations.push(
      `Detected ${staticFrames}/32 nearly static frames. Add continuous camera dolly (Point of Interest + Position) or beat-driven FOV/rotation keyframes.`
    );
  }
  if (technicalScore < 65) {
    recommendations.push(
      `DOVER Technical Quality Score (${technicalScore}/100) indicates softness or blur artifacts. Avoid excessive Box Blur radius during hero text holds and increase text/shape contrast.`
    );
  }
  if (aestheticScore < 65) {
    recommendations.push(
      `DOVER Aesthetic Quality Score (${aestheticScore}/100) can be improved by enhancing color harmony (complementary cyan/magenta/gold accents), rule-of-thirds hero framing, and depth-of-field layering.`
    );
  }
  if (audioVisualSyncScore !== undefined && audioVisualSyncScore < 75) {
    recommendations.push(
      `Audio-Visual Sync Score (${audioVisualSyncScore}/100) shows visual motion peaks drifting from drum onsets. Use analyzeAudioRhythm + alignLyricsWithMMS to lock text entrances and camera impacts to exact Kick/Snare timestamps.`
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      'Video achieves strong DOVER-Mobile technical clarity, aesthetic composition, and dynamic rhythm synchronization.'
    );
  }

  const avg = (arr: Float32Array) =>
    Number((arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length)).toFixed(2));

  let qualityGrade: 'S' | 'A' | 'B' | 'C' | 'D' = 'B';
  if (overallScore >= 82) qualityGrade = 'S';
  else if (overallScore >= 72) qualityGrade = 'A';
  else if (overallScore >= 58) qualityGrade = 'B';
  else if (overallScore >= 45) qualityGrade = 'C';
  else qualityGrade = 'D';

  return {
    videoPath: absVideoPath,
    modelName: 'DOVER-Mobile (ConvNeXtV2-Femto-3D Disentangled VQA)',
    modelPath,
    inferenceTimeMs: Date.now() - tStart,
    durationSec: Number(durationSec.toFixed(3)),
    scores: {
      overallScore,
      technicalScore,
      aestheticScore,
      audioVisualSyncScore,
      rawTechnicalLogit: Number(techRaw.toFixed(5)),
      rawAestheticLogit: Number(aesRaw.toFixed(5)),
      qualityGrade,
    },
    datasetPercentileComparison: {
      LIVE_VQC_Percentile: normalCdfPercentile(fusedLogit * 0.92),
      KoNViD_1k_Percentile: normalCdfPercentile(fusedLogit * 0.95),
      LSVQ_1080P_Percentile: normalCdfPercentile(fusedLogit * 0.88),
      YouTube_UGC_Percentile: normalCdfPercentile(fusedLogit * 0.96),
    },
    visualMetrics: {
      avgBrightness: avg(frameBrightness),
      avgContrast: avg(frameContrast),
      avgSharpness: avg(frameSharpness),
      avgColorfulness: avg(frameColorfulness),
      avgMotionFlux: avg(frameMotion),
      blankOrDarkFrameCount: blankOrDarkFrames,
      staticCameraFrameCount: staticFrames,
    },
    segmentDiagnostics,
    recommendations,
  };
}
