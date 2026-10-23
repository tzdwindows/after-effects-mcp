/**
 * Resolves the package root directory (works from both src/ and dist/).
 */
export declare function getPackageRoot(): string;
/**
 * Resolves an available FFmpeg executable path, prioritizing bundled bin/ffmpeg.exe.
 */
export declare function resolveFfmpegPath(): string;
/**
 * Decodes any audio or video file into mono Float32 PCM samples at the specified sample rate.
 */
export declare function decodeAudioToFloat32(audioPath: string, sampleRate?: number): {
    samples: Float32Array;
    sampleRate: number;
    durationSec: number;
};
/**
 * In-place Radix-2 Cooley-Tukey Complex FFT.
 * Length N must be a power of 2.
 */
export declare function fftRadix2(re: Float64Array | Float32Array, im: Float64Array | Float32Array): void;
/**
 * Computes Short-Time Fourier Transform (STFT) magnitude spectrogram.
 * Returns magnitude frames of shape [numFrames][numBins], where numBins = (fftSize >> 1) + 1.
 */
export declare function computeSTFTMagnitude(samples: Float32Array, fftSize?: number, hopSize?: number): {
    magnitudes: Float32Array[];
    numFrames: number;
    numBins: number;
};
/**
 * Computes 80-bin Log-Mel Filterbank features compatible with Kaldi / NeMo CTC ONNX models
 * (16kHz, 25ms POVEY/Hann window = 400 samples, 10ms hop = 160 samples, 512-point FFT, normalized).
 */
export declare function computeKaldiLogMel80(samples: Float32Array, sampleRate?: number, numMelBins?: number): {
    featuresTransposed: Float32Array;
    rawMelFrames: Float32Array[];
    numFrames: number;
    frameShiftSec: number;
};
