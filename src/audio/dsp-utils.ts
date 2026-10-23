import fs from 'fs';
import path from 'path';
import { spawnSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolves the package root directory (works from both src/ and dist/).
 */
export function getPackageRoot(): string {
  // __dirname is either <root>/src/audio or <root>/dist/audio
  const candidate = path.resolve(__dirname, '..', '..');
  if (fs.existsSync(path.join(candidate, 'package.json'))) {
    return candidate;
  }
  return process.cwd();
}

/**
 * Resolves an available FFmpeg executable path, prioritizing bundled bin/ffmpeg.exe.
 */
export function resolveFfmpegPath(): string {
  const pkgRoot = getPackageRoot();
  const ext = process.platform === 'win32' ? '.exe' : '';

  const candidates = [
    path.join(pkgRoot, 'bin', `ffmpeg${ext}`),
    path.join(process.cwd(), 'bin', `ffmpeg${ext}`),
    'D:\\RVC1006Nvidia\\ffmpeg.exe',
    'D:\\win-pyvideotrans-v3.97\\ffmpeg\\ffmpeg.exe',
    'D:\\RVC-beta0717\\ffmpeg.exe',
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  // Try system PATH
  try {
    const cmd = process.platform === 'win32' ? 'where.exe ffmpeg' : 'which ffmpeg';
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim()
      .split(/\r?\n/)[0];
    if (out && fs.existsSync(out)) {
      return out;
    }
  } catch {
    // ignore
  }

  return 'ffmpeg';
}

/**
 * Decodes any audio or video file into mono Float32 PCM samples at the specified sample rate.
 */
export function decodeAudioToFloat32(
  audioPath: string,
  sampleRate = 22050
): { samples: Float32Array; sampleRate: number; durationSec: number } {
  const absPath = path.resolve(audioPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Audio file not found: ${absPath}`);
  }

  // If it's an uncompressed 16-bit/32-bit PCM WAV and ffmpeg fails, we can also parse WAV,
  // but first use FFmpeg for universal codec support (.mp3, .wav, .flac, .m4a, .aac, .mp4, .mov).
  const ffmpegBin = resolveFfmpegPath();
  const proc = spawnSync(
    ffmpegBin,
    [
      '-v',
      'error',
      '-i',
      absPath,
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      'f32le',
      'pipe:1',
    ],
    {
      maxBuffer: 256 * 1024 * 1024, // Up to 256MB raw float32 PCM (~30 mins audio)
    }
  );

  if (proc.error) {
    throw new Error(`FFmpeg execution failed (${ffmpegBin}): ${proc.error.message}`);
  }
  if (proc.status !== 0 && (!proc.stdout || proc.stdout.length === 0)) {
    const stderr = proc.stderr ? proc.stderr.toString('utf-8') : 'Unknown error';
    throw new Error(`FFmpeg failed to decode "${absPath}": ${stderr}`);
  }

  const buf = proc.stdout;
  const numSamples = Math.floor(buf.byteLength / 4);
  const samples = new Float32Array(numSamples);
  // Copy safely into aligned Float32Array
  for (let i = 0; i < numSamples; i++) {
    samples[i] = buf.readFloatLE(i * 4);
  }

  return {
    samples,
    sampleRate,
    durationSec: numSamples / sampleRate,
  };
}

/**
 * In-place Radix-2 Cooley-Tukey Complex FFT.
 * Length N must be a power of 2.
 */
export function fftRadix2(re: Float64Array | Float32Array, im: Float64Array | Float32Array): void {
  const n = re.length;
  if ((n & (n - 1)) !== 0) {
    throw new Error(`FFT length must be power of 2, got ${n}`);
  }

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  // Butterfly updates
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(angle);
    const wlenIm = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wRe = 1.0;
      let wIm = 0.0;
      for (let k = 0; k < halfLen; k++) {
        const uIdx = i + k;
        const vIdx = i + k + halfLen;
        const vRe = re[vIdx] * wRe - im[vIdx] * wIm;
        const vIm = re[vIdx] * wIm + im[vIdx] * wRe;

        re[vIdx] = re[uIdx] - vRe;
        im[vIdx] = im[uIdx] - vIm;
        re[uIdx] += vRe;
        im[uIdx] += vIm;

        const nextWRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nextWRe;
      }
    }
  }
}

/**
 * Computes Short-Time Fourier Transform (STFT) magnitude spectrogram.
 * Returns magnitude frames of shape [numFrames][numBins], where numBins = (fftSize >> 1) + 1.
 */
export function computeSTFTMagnitude(
  samples: Float32Array,
  fftSize = 2048,
  hopSize = 256
): {
  magnitudes: Float32Array[];
  numFrames: number;
  numBins: number;
} {
  const numBins = (fftSize >> 1) + 1;
  const numFrames = Math.max(1, Math.floor((samples.length - fftSize) / hopSize) + 1);

  // Precompute Hann window
  const window = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
  }

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const magnitudes: Float32Array[] = new Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      re[i] = idx < samples.length ? samples[idx] * window[i] : 0;
      im[i] = 0;
    }

    fftRadix2(re, im);

    const mag = new Float32Array(numBins);
    for (let b = 0; b < numBins; b++) {
      mag[b] = Math.hypot(re[b], im[b]);
    }
    magnitudes[f] = mag;
  }

  return { magnitudes, numFrames, numBins };
}

function hzToMel(hz: number): number {
  return 1127.0 * Math.log(1.0 + hz / 700.0);
}

function melToHz(mel: number): number {
  return 700.0 * (Math.exp(mel / 1127.0) - 1.0);
}

/**
 * Computes 80-bin Log-Mel Filterbank features compatible with Kaldi / NeMo CTC ONNX models
 * (16kHz, 25ms POVEY/Hann window = 400 samples, 10ms hop = 160 samples, 512-point FFT, normalized).
 */
export function computeKaldiLogMel80(
  samples: Float32Array,
  sampleRate = 16000,
  numMelBins = 80
): {
  featuresTransposed: Float32Array; // Shape (1, 80, T)
  rawMelFrames: Float32Array[]; // Shape [T][80] before z-norm
  numFrames: number;
  frameShiftSec: number;
} {
  const winLen = Math.round(0.025 * sampleRate); // 400 at 16kHz
  const hopLen = Math.round(0.01 * sampleRate); // 160 at 16kHz (10ms)
  const fftSize = 512;
  const numFftBins = (fftSize >> 1) + 1; // 257

  const numFrames = Math.max(1, Math.floor((samples.length - winLen) / hopLen) + 1);

  // Povey window: (0.5 - 0.5 * cos(2*pi*n/(N-1)))^0.85
  const window = new Float32Array(winLen);
  for (let i = 0; i < winLen; i++) {
    window[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (winLen - 1)), 0.85);
  }

  // Build Mel triangular filterbank [numMelBins][numFftBins]
  const lowFreq = 20.0;
  const highFreq = sampleRate / 2.0;
  const lowMel = hzToMel(lowFreq);
  const highMel = hzToMel(highFreq);

  const melPoints = new Float32Array(numMelBins + 2);
  const binFreqs = new Float32Array(numFftBins);
  for (let b = 0; b < numFftBins; b++) {
    binFreqs[b] = (b * sampleRate) / fftSize;
  }
  for (let m = 0; m < numMelBins + 2; m++) {
    melPoints[m] = melToHz(lowMel + ((highMel - lowMel) * m) / (numMelBins + 1));
  }

  const filterbank: Float32Array[] = new Array(numMelBins);
  for (let m = 0; m < numMelBins; m++) {
    const fb = new Float32Array(numFftBins);
    const fLeft = melPoints[m];
    const fCenter = melPoints[m + 1];
    const fRight = melPoints[m + 2];
    for (let b = 0; b < numFftBins; b++) {
      const freq = binFreqs[b];
      if (freq >= fLeft && freq <= fCenter && fCenter > fLeft) {
        fb[b] = (freq - fLeft) / (fCenter - fLeft);
      } else if (freq > fCenter && freq <= fRight && fRight > fCenter) {
        fb[b] = (fRight - freq) / (fRight - fCenter);
      }
    }
    filterbank[m] = fb;
  }

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const powerSpec = new Float32Array(numFftBins);
  const rawMelFrames: Float32Array[] = new Array(numFrames);

  const preemph = 0.97;

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopLen;
    re.fill(0);
    im.fill(0);

    // DC offset removal + pre-emphasis + windowing
    let meanVal = 0;
    for (let i = 0; i < winLen; i++) {
      const idx = Math.min(samples.length - 1, Math.max(0, start + i));
      meanVal += samples[idx] * 32768.0;
    }
    meanVal /= winLen;

    for (let i = 0; i < winLen; i++) {
      const idx = Math.min(samples.length - 1, Math.max(0, start + i));
      const prevIdx = Math.min(samples.length - 1, Math.max(0, start + i - 1));
      const cur = samples[idx] * 32768.0 - meanVal;
      const prev = samples[prevIdx] * 32768.0 - meanVal;
      re[i] = (cur - preemph * prev) * window[i];
    }

    fftRadix2(re, im);

    for (let b = 0; b < numFftBins; b++) {
      powerSpec[b] = re[b] * re[b] + im[b] * im[b];
    }

    const melVec = new Float32Array(numMelBins);
    for (let m = 0; m < numMelBins; m++) {
      const fb = filterbank[m];
      let sum = 0;
      for (let b = 0; b < numFftBins; b++) {
        sum += powerSpec[b] * fb[b];
      }
      melVec[m] = Math.log(Math.max(sum, 1e-10));
    }
    rawMelFrames[f] = melVec;
  }

  // Per-feature mean and std normalization across time -> transposed to (1, 80, T)
  const featuresTransposed = new Float32Array(numMelBins * numFrames);
  for (let m = 0; m < numMelBins; m++) {
    let mean = 0;
    for (let f = 0; f < numFrames; f++) {
      mean += rawMelFrames[f][m];
    }
    mean /= numFrames;

    let variance = 0;
    for (let f = 0; f < numFrames; f++) {
      const d = rawMelFrames[f][m] - mean;
      variance += d * d;
    }
    const std = Math.sqrt(variance / numFrames) + 1e-5;

    const rowOffset = m * numFrames;
    for (let f = 0; f < numFrames; f++) {
      featuresTransposed[rowOffset + f] = (rawMelFrames[f][m] - mean) / std;
    }
  }

  return {
    featuresTransposed,
    rawMelFrames,
    numFrames,
    frameShiftSec: hopLen / sampleRate,
  };
}
