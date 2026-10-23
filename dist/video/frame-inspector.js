import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import * as ort from "onnxruntime-node";
import { resolveFfmpegPath } from "../audio/dsp-utils.js";
const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
function getFastSalModelPath() {
    const candidates = [
        path.resolve(__dirname, "../../models/visual_aesthetic/fastsal_nima_lite.onnx"),
        path.resolve(process.cwd(), "models/visual_aesthetic/fastsal_nima_lite.onnx"),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p))
            return p;
    }
    return candidates[0];
}
let cachedFastSalSession = null;
async function getFastSalSession() {
    if (cachedFastSalSession)
        return cachedFastSalSession;
    const modelPath = getFastSalModelPath();
    if (!fs.existsSync(modelPath)) {
        throw new Error(`FastSal-NIMA-Lite ONNX model not found at ${modelPath}`);
    }
    cachedFastSalSession = await ort.InferenceSession.create(modelPath, {
        executionProviders: ["cpu"],
    });
    return cachedFastSalSession;
}
/**
 * Decodes an image file to raw RGB24 bytes at target width x height using FFmpeg.
 */
async function decodeImageToRGB(imagePath, width, height) {
    const tmpRaw = path.join(os.tmpdir(), `ae_mcp_rgb_${width}x${height}_${Date.now()}_${Math.random().toString(36).slice(2)}.raw`);
    const ffmpegBin = resolveFfmpegPath();
    try {
        await execFileAsync(ffmpegBin, [
            "-y",
            "-v",
            "error",
            "-i",
            imagePath,
            "-vf",
            `scale=${width}:${height}:flags=bilinear`,
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            tmpRaw,
        ], { timeout: 15000, maxBuffer: 16 * 1024 * 1024 });
        const buf = fs.readFileSync(tmpRaw);
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    finally {
        if (fs.existsSync(tmpRaw)) {
            try {
                fs.unlinkSync(tmpRaw);
            }
            catch {
                // ignore cleanup error
            }
        }
    }
}
/**
 * Scans a higher-resolution (256x144) RGB buffer for straight horizontal/vertical
 * abrupt luminance cliffs inside the interior of the frame — the telltale signature
 * of a 3D Solid or Shape Layer with Glow/Saber being clipped at its layer boundary.
 */
function detectInteriorBoxGlowClipping(rgb, width, height) {
    const lum = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
        const r = rgb[i * 3] / 255.0;
        const g = rgb[i * 3 + 1] / 255.0;
        const b = rgb[i * 3 + 2] / 255.0;
        lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    let suspiciousInteriorLines = 0;
    const marginX = Math.floor(width * 0.06);
    const marginY = Math.floor(height * 0.06);
    // Check vertical straight luminance cliffs inside frame interior
    for (let x = marginX; x < width - marginX; x++) {
        let cliffPixels = 0;
        for (let y = marginY; y < height - marginY; y++) {
            const lLeft = lum[y * width + (x - 1)];
            const lRight = lum[y * width + (x + 1)];
            const diff = Math.abs(lLeft - lRight);
            const darker = Math.min(lLeft, lRight);
            const brighter = Math.max(lLeft, lRight);
            // Glow clipping signature: one side is near background dark (<0.12), adjacent side has mid-glow (>0.22)
            if (diff > 0.14 && darker < 0.12 && brighter > 0.22) {
                cliffPixels++;
            }
        }
        if (cliffPixels > height * 0.22) {
            suspiciousInteriorLines++;
        }
    }
    // Check horizontal straight luminance cliffs inside frame interior (excluding subtitle band y in 0.84..0.96)
    for (let y = marginY; y < Math.floor(height * 0.80); y++) {
        let cliffPixels = 0;
        for (let x = marginX; x < width - marginX; x++) {
            const lUp = lum[(y - 1) * width + x];
            const lDown = lum[(y + 1) * width + x];
            const diff = Math.abs(lUp - lDown);
            const darker = Math.min(lUp, lDown);
            const brighter = Math.max(lUp, lDown);
            if (diff > 0.14 && darker < 0.12 && brighter > 0.22) {
                cliffPixels++;
            }
        }
        if (cliffPixels > width * 0.22) {
            suspiciousInteriorLines++;
        }
    }
    // Check subtitle zone (bottom 82%..95% height, middle 25%..75% width) for excessive background clutter
    let subSum = 0;
    let subCount = 0;
    const yStart = Math.floor(height * 0.82);
    const yEnd = Math.floor(height * 0.94);
    const xStart = Math.floor(width * 0.25);
    const xEnd = Math.floor(width * 0.75);
    for (let y = yStart; y < yEnd; y++) {
        for (let x = xStart; x < xEnd; x++) {
            subSum += lum[y * width + x];
            subCount++;
        }
    }
    return {
        hardBoxEdgeRatio: Math.min(1.0, suspiciousInteriorLines / 6.0),
        subtitleZoneBrightness: subCount > 0 ? subSum / subCount : 0,
    };
}
/**
 * Inspects a rendered frame using `fastsal_nima_lite.onnx` + geometric boundary cliff detection.
 */
export async function inspectFrameWithFastSalNIMA(imagePath) {
    if (!fs.existsSync(imagePath)) {
        throw new Error(`Image file not found: ${imagePath}`);
    }
    const [rgb64, rgbHi, session] = await Promise.all([
        decodeImageToRGB(imagePath, 64, 64),
        decodeImageToRGB(imagePath, 256, 144),
        getFastSalSession(),
    ]);
    // Convert 64x64 RGB24 to NCHW float32 [1, 3, 64, 64]
    const chw = new Float32Array(3 * 64 * 64);
    const planeSize = 64 * 64;
    for (let i = 0; i < planeSize; i++) {
        chw[i] = rgb64[i * 3] / 255.0;
        chw[planeSize + i] = rgb64[i * 3 + 1] / 255.0;
        chw[2 * planeSize + i] = rgb64[i * 3 + 2] / 255.0;
    }
    const inputTensor = new ort.Tensor("float32", chw, [1, 3, 64, 64]);
    const inName = session.inputNames[0] || "image_patch";
    const out = await session.run({ [inName]: inputTensor });
    const salTensor = out.saliency_map || out[session.outputNames[0]];
    const metTensor = out.aesthetic_metrics || out[session.outputNames[1]];
    const salData = salTensor.data;
    const metricsData = metTensor.data;
    // Compute center of mass of 16x16 saliency map
    let totalWeight = 1e-6;
    let sumX = 0;
    let sumY = 0;
    for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
            const w = Math.max(0, salData[y * 16 + x]);
            totalWeight += w;
            sumX += (x + 0.5) / 16.0 * w;
            sumY += (y + 0.5) / 16.0 * w;
        }
    }
    const cx = Number((sumX / totalWeight).toFixed(3));
    const cy = Number((sumY / totalWeight).toFixed(3));
    const { hardBoxEdgeRatio, subtitleZoneBrightness } = detectInteriorBoxGlowClipping(rgbHi, 256, 144);
    const rawAesthetic = metricsData[0];
    const rawClip = metricsData[1];
    const rawOcc = metricsData[2];
    const rawBalance = metricsData[3];
    const glowClippingRisk = Number(Math.min(1.0, 0.45 * rawClip + 0.55 * hardBoxEdgeRatio).toFixed(3));
    const subtitleOcclusionRisk = Number(Math.min(1.0, 0.5 * rawOcc + (subtitleZoneBrightness > 0.36 ? 0.45 : subtitleZoneBrightness)).toFixed(3));
    const framingBalanceScore = Number(rawBalance.toFixed(3));
    const aestheticScore10 = Number(Math.max(1.0, Math.min(10.0, (rawAesthetic * 8.5 + 1.5) * (1 - 0.25 * glowClippingRisk))).toFixed(2));
    const horizLabel = cx < 0.4 ? "left-third" : cx > 0.6 ? "right-third" : "center";
    const vertLabel = cy < 0.4 ? "upper" : cy > 0.65 ? "lower" : "mid";
    const dominantRegion = `${vertLabel}-${horizLabel}`;
    const recommendations = [];
    if (glowClippingRisk >= 0.45) {
        recommendations.push("Detected hard rectangular glow/Saber cutoff inside the 3D viewport. Run `fixLayerGlowAndBoundsClipping` or expand 3D Saber solid dimensions to >= 3840x3840 and add `ADBE Grow Bounds` (250px) before `ADBE Glow2`.");
    }
    if (subtitleOcclusionRisk >= 0.52) {
        recommendations.push("High brightness/saliency detected in the bottom subtitle safe-zone (Y: 82%~94%). Raise hero 3D focal point Y by -50px or lower subtitle anchor to avoid overlapping characters.");
    }
    if (Math.abs(cx - 0.5) < 0.04 && Math.abs(cy - 0.5) < 0.04) {
        recommendations.push("Visual saliency is dead-centered. Consider offsetting camera Point of Interest or using Dutch roll / rule-of-thirds placement for stronger cinematic tension.");
    }
    if (recommendations.length === 0) {
        recommendations.push("Frame passes unclipped glow, subtitle safe-zone, and aesthetic saliency checks.");
    }
    return {
        imagePath,
        model: "FastSal-NIMA-Lite (fastsal_nima_lite.onnx)",
        aestheticScore10,
        glowClippingRisk,
        glowClippingDetected: glowClippingRisk >= 0.45,
        subtitleOcclusionRisk,
        subtitleOcclusionDetected: subtitleOcclusionRisk >= 0.52,
        framingBalanceScore,
        saliencyCenterNormalized: { x: cx, y: cy },
        dominantRegion,
        hardBoxEdgeRatio: Number(hardBoxEdgeRatio.toFixed(3)),
        recommendations,
    };
}
