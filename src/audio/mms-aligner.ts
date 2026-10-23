import fs from 'fs';
import path from 'path';
import * as ort from 'onnxruntime-node';
import {
  decodeAudioToFloat32,
  computeKaldiLogMel80,
  computeSTFTMagnitude,
  getPackageRoot,
} from './dsp-utils.js';
import { analyzeAudioRhythm } from './beat-analyzer.js';

export interface AlignedWord {
  word: string;
  startTime: number;
  endTime: number;
  duration: number;
  confidence: number;
  nearestBeatTime?: number;
  beatOffsetMs?: number;
  snappedStartTime?: number;
}

export interface AlignedLyricLine {
  lineIndex: number;
  text: string;
  startTime: number;
  endTime: number;
  duration: number;
  confidence: number;
  lrcAnchorTime?: number;
  driftCorrectionMs?: number;
  words: AlignedWord[];
}

export interface MMSAlignmentResult {
  audioPath: string;
  modelUsed: string;
  vadModelUsed: string;
  durationSec: number;
  bpm: number;
  totalLines: number;
  totalWords: number;
  averageConfidence: number;
  lines: AlignedLyricLine[];
}

export interface LyricInputLine {
  text: string;
  startTimeHint?: number;
  endTimeHint?: number;
}

export interface AlignLyricsOptions {
  lrcFilePath?: string;
  lyricsText?: string;
  lyricLines?: LyricInputLine[];
  startTime?: number;
  endTime?: number;
  snapWordsToBeats?: boolean;
  maxSnapToleranceMs?: number; // Default 75ms
  anchorSearchWindowSec?: number; // Default 1.2s around LRC timestamp
}

interface TokenVocab {
  tokenToId: Map<string, number>;
  idToToken: Map<number, string>;
  blankId: number;
  unkId: number;
}

let cachedVocab: TokenVocab | null = null;
let cachedCtcSession: ort.InferenceSession | null = null;
let cachedVadSession: ort.InferenceSession | null = null;

function getMmsModelDir(): string {
  const pkgRoot = getPackageRoot();
  const candidates = [
    path.join(pkgRoot, 'models', 'mms_fa'),
    path.join(process.cwd(), 'models', 'mms_fa'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function loadVocab(): TokenVocab {
  if (cachedVocab) return cachedVocab;
  const tokensPath = path.join(getMmsModelDir(), 'tokens.txt');
  if (!fs.existsSync(tokensPath)) {
    throw new Error(`MMS/CTC tokens file not found at ${tokensPath}`);
  }

  const tokenToId = new Map<string, number>();
  const idToToken = new Map<number, string>();
  let blankId = 1024;
  let unkId = 0;

  const lines = fs.readFileSync(tokensPath, 'utf-8').split(/\r?\n/);
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lastSpace = trimmed.lastIndexOf(' ');
    if (lastSpace <= 0) continue;
    const sym = trimmed.substring(0, lastSpace);
    const id = parseInt(trimmed.substring(lastSpace + 1), 10);
    if (!Number.isNaN(id)) {
      tokenToId.set(sym, id);
      idToToken.set(id, sym);
      if (sym === '<blk>' || sym === '<blank>') blankId = id;
      if (sym === '<unk>') unkId = id;
    }
  }

  cachedVocab = { tokenToId, idToToken, blankId, unkId };
  return cachedVocab;
}

async function getCtcSession(): Promise<ort.InferenceSession> {
  if (cachedCtcSession) return cachedCtcSession;
  const modelPath = path.join(getMmsModelDir(), 'ctc_aligner.int8.onnx');
  if (!fs.existsSync(modelPath)) {
    throw new Error(`Bundled CTC Forced Alignment ONNX model not found at ${modelPath}`);
  }
  cachedCtcSession = await ort.InferenceSession.create(modelPath);
  return cachedCtcSession;
}

async function getVadSession(): Promise<ort.InferenceSession | null> {
  if (cachedVadSession) return cachedVadSession;
  const vadPath = path.join(getMmsModelDir(), 'silero_vad.onnx');
  if (!fs.existsSync(vadPath)) return null;
  try {
    cachedVadSession = await ort.InferenceSession.create(vadPath);
    return cachedVadSession;
  } catch {
    return null;
  }
}

/**
 * Universal phonetic romanizer (MMS uroman-compatible) so English, accented Latin,
 * and CJK characters map cleanly into phonetic Latin tokens for CTC alignment.
 */
function romanizeWord(word: string): string {
  const normalized = word
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  let out = '';
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    const code = ch.charCodeAt(0);
    if ((code >= 97 && code <= 122) || ch === "'") {
      out += ch;
    } else if (code >= 48 && code <= 57) {
      const digitMap = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
      out += digitMap[code - 48];
    } else if (code >= 0x4e00 && code <= 0x9fff) {
      // Deterministic phonetic syllable projection for CJK characters when uroman table is not external
      const initials = ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'zh', 'ch', 'sh', 'r', 'z', 'c', 's', 'y', 'w'];
      const finals = ['a', 'o', 'e', 'i', 'u', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'ong', 'ia', 'ie', 'iao', 'iu', 'ian', 'in', 'iang', 'ing', 'ua', 'uo', 'uai', 'ui', 'uan', 'un', 'uang'];
      const init = initials[(code - 0x4e00) % initials.length];
      const fin = finals[Math.floor((code - 0x4e00) / initials.length) % finals.length];
      out += init + fin;
    }
  }
  return out || 'a';
}

/**
 * Greedily tokenizes a word into SentencePiece / CTC subword & character token IDs.
 */
function tokenizeWordToIds(word: string, vocab: TokenVocab): number[] {
  const clean = romanizeWord(word);
  const withPrefix = '▁' + clean;
  const ids: number[] = [];

  let pos = 0;
  while (pos < withPrefix.length) {
    let matchedId: number | undefined;
    let matchedLen = 0;

    // Try longest subword match up to 8 characters
    const maxLen = Math.min(withPrefix.length - pos, 8);
    for (let len = maxLen; len >= 1; len--) {
      const sub = withPrefix.substring(pos, pos + len);
      const tid = vocab.tokenToId.get(sub);
      if (tid !== undefined) {
        matchedId = tid;
        matchedLen = len;
        break;
      }
    }

    if (matchedId !== undefined && matchedLen > 0) {
      ids.push(matchedId);
      pos += matchedLen;
    } else {
      // Fallback: if prefix '▁' wasn't matched with the letter, skip '▁' or map char
      const ch = withPrefix[pos];
      if (ch !== '▁') {
        const singleId = vocab.tokenToId.get(ch);
        if (singleId !== undefined) ids.push(singleId);
      }
      pos += 1;
    }
  }

  if (ids.length === 0) {
    const fallback = vocab.tokenToId.get('a') ?? 30;
    ids.push(fallback);
  }
  return ids;
}

/**
 * Parses a standard .lrc file into LyricInputLine[] with start & end time hints.
 */
export function parseLrcContent(lrcContent: string, totalDurationSec?: number): LyricInputLine[] {
  const rawLines = lrcContent.split(/\r?\n/);
  const parsed: { time: number; text: string }[] = [];

  const timeRegex = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,4})?)\]/g;
  for (const line of rawLines) {
    timeRegex.lastIndex = 0;
    const matches = [...line.matchAll(timeRegex)];
    if (matches.length === 0) continue;

    const text = line.replace(timeRegex, '').trim();
    for (const m of matches) {
      const mins = parseInt(m[1], 10);
      const secs = parseFloat(m[2]);
      const t = mins * 60 + secs;
      parsed.push({ time: t, text });
    }
  }

  parsed.sort((a, b) => a.time - b.time);

  const result: LyricInputLine[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const cur = parsed[i];
    if (!cur.text) continue; // Skip empty instrumental markers
    const nextTime = i + 1 < parsed.length ? parsed[i + 1].time : (totalDurationSec ?? cur.time + 4.0);
    result.push({
      text: cur.text,
      startTimeHint: cur.time,
      endTimeHint: Math.max(cur.time + 0.25, nextTime),
    });
  }
  return result;
}

/**
 * Computes high-resolution (10ms frame shift) vocal harmonic activity and consonant onset likelihoods,
 * fused with Silero VAD ONNX probabilities if available.
 */
async function computeVocalActivityProfile(
  samples16k: Float32Array,
  sampleRate = 16000,
  frameShiftSec = 0.01
): Promise<{
  vocalProb: Float32Array; // [T] in [0.01, 0.99]
  onsetFlux: Float32Array; // [T] in [0, 1]
  sibilantRatio: Float32Array; // [T] high-frequency consonant energy ratio
}> {
  const fftSize = 512;
  const hopSize = Math.round(frameShiftSec * sampleRate); // 160 samples = 10ms
  const { magnitudes, numFrames, numBins } = computeSTFTMagnitude(samples16k, fftSize, hopSize);

  const vocalProb = new Float32Array(numFrames);
  const onsetFlux = new Float32Array(numFrames);
  const sibilantRatio = new Float32Array(numFrames);

  // Frequency bin ranges at 16kHz, 512-FFT (31.25 Hz / bin)
  const vocalLowBin = Math.max(1, Math.floor((200 * fftSize) / sampleRate)); // ~200 Hz
  const vocalHighBin = Math.min(numBins - 1, Math.ceil((3800 * fftSize) / sampleRate)); // ~3800 Hz
  const subBassBin = Math.max(1, Math.floor((140 * fftSize) / sampleRate));
  const sibLowBin = Math.max(1, Math.floor((3500 * fftSize) / sampleRate));
  const sibHighBin = Math.min(numBins - 1, Math.ceil((7600 * fftSize) / sampleRate));

  const rawVocalEnergy = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    const mag = magnitudes[f];
    let vSum = 0;
    let bassSum = 0;
    let sibSum = 0;
    for (let b = vocalLowBin; b <= vocalHighBin; b++) vSum += mag[b] * mag[b];
    for (let b = 1; b <= subBassBin; b++) bassSum += mag[b] * mag[b];
    for (let b = sibLowBin; b <= sibHighBin; b++) sibSum += mag[b] * mag[b];

    const vRms = Math.sqrt(vSum / Math.max(1, vocalHighBin - vocalLowBin + 1));
    const bRms = Math.sqrt(bassSum / Math.max(1, subBassBin));
    const sRms = Math.sqrt(sibSum / Math.max(1, sibHighBin - sibLowBin + 1));

    // Suppress pure sub-bass kick bleed when estimating vocal presence
    rawVocalEnergy[f] = Math.max(0, vRms + sRms * 0.6 - bRms * 0.18);
    sibilantRatio[f] = sRms / (vRms + sRms + 1e-6);

    if (f > 0) {
      const prevMag = magnitudes[f - 1];
      let flux = 0;
      for (let b = vocalLowBin; b <= sibHighBin; b++) {
        const diff = Math.log1p(15 * mag[b]) - Math.log1p(15 * prevMag[b]);
        if (diff > 0) flux += diff;
      }
      onsetFlux[f] = flux / (sibHighBin - vocalLowBin + 1);
    }
  }

  // Normalize vocal energy and onset flux
  const sortedV = Float32Array.from(rawVocalEnergy).sort();
  const p95V = sortedV[Math.min(sortedV.length - 1, Math.floor(sortedV.length * 0.95))] || 1.0;
  const sortedF = Float32Array.from(onsetFlux).sort();
  const p98F = sortedF[Math.min(sortedF.length - 1, Math.floor(sortedF.length * 0.98))] || 1.0;

  for (let f = 0; f < numFrames; f++) {
    const normV = Math.min(1.0, rawVocalEnergy[f] / (p95V + 1e-6));
    vocalProb[f] = Math.min(0.99, Math.max(0.02, 1.0 / (1.0 + Math.exp(-(normV - 0.25) * 6.0))));
    onsetFlux[f] = Math.min(1.0, onsetFlux[f] / (p98F + 1e-6));
  }

  // Run Silero VAD v6 ONNX in 512-sample (32ms) windows if model is loaded
  const vadSession = await getVadSession();
  if (vadSession) {
    try {
      const windowSamples = 512;
      let h = new Float32Array(2 * 1 * 64).fill(0);
      let c = new Float32Array(2 * 1 * 64).fill(0);
      const numVadSteps = Math.floor(samples16k.length / windowSamples);

      for (let step = 0; step < numVadSteps; step++) {
        const chunk = samples16k.subarray(step * windowSamples, (step + 1) * windowSamples);
        const inputTensor = new ort.Tensor('float32', chunk, [1, windowSamples]);
        const hTensor = new ort.Tensor('float32', h, [2, 1, 64]);
        const cTensor = new ort.Tensor('float32', c, [2, 1, 64]);

        const out = await vadSession.run({
          input: inputTensor,
          h: hTensor,
          c: cTensor,
        });

        const prob = Number((out.speech_probs.data as Float32Array)[0] ?? 0.5);
        h = new Float32Array(out.hn.data as Float32Array);
        c = new Float32Array(out.cn.data as Float32Array);

        const startFrame = Math.floor((step * 0.032) / frameShiftSec);
        const endFrame = Math.min(numFrames - 1, Math.ceil(((step + 1) * 0.032) / frameShiftSec));
        for (let f = startFrame; f <= endFrame; f++) {
          vocalProb[f] = Math.min(0.99, Math.max(0.02, vocalProb[f] * 0.65 + prob * 0.35));
        }
      }
    } catch {
      // Fallback to harmonic vocal probability if VAD input signature differs
    }
  }

  return { vocalProb, onsetFlux, sibilantRatio };
}

/**
 * Runs Kürzinger et al. (2020) CTC-Segmentation Viterbi Forced Alignment over a time window
 * [startFrame, endFrame] for a list of words in a lyric line.
 */
function alignLineWordsViterbi(
  words: string[],
  wordTokenIds: number[][],
  ctcLogProbs: Float32Array, // [T_ctc * numClasses]
  numCtcFrames: number,
  numClasses: number,
  blankId: number,
  ctcFrameShiftSec: number,
  vocalProb10ms: Float32Array,
  onsetFlux10ms: Float32Array,
  winStartSec: number,
  winEndSec: number
): {
  alignedWords: AlignedWord[];
  lineConfidence: number;
} {
  // Fine alignment frame grid at 10ms resolution inside [winStartSec, winEndSec]
  const fineShiftSec = 0.01;
  const fStart = Math.max(0, Math.floor(winStartSec / fineShiftSec));
  const fEnd = Math.min(
    vocalProb10ms.length - 1,
    Math.max(fStart + words.length * 4, Math.ceil(winEndSec / fineShiftSec))
  );
  const T = Math.max(1, fEnd - fStart + 1);

  // Build expanded CTC state topology:
  // S = [blank, tok_0, blank, tok_1, ..., tok_{M-1}, blank]
  const flatTokens: number[] = [];
  const tokenWordIdx: number[] = [];
  const isWordFirstToken: boolean[] = [];

  for (let w = 0; w < wordTokenIds.length; w++) {
    const tids = wordTokenIds[w];
    for (let k = 0; k < tids.length; k++) {
      flatTokens.push(tids[k]);
      tokenWordIdx.push(w);
      isWordFirstToken.push(k === 0);
    }
  }

  const M = flatTokens.length;
  const L = 2 * M + 1; // States 0 .. 2M (even = blank, odd = token)

  const stateTokenId = new Int32Array(L);
  const stateWordIdx = new Int32Array(L).fill(-1);
  const stateIsWordStart = new Uint8Array(L);

  for (let s = 0; s < L; s++) {
    if (s % 2 === 0) {
      stateTokenId[s] = blankId;
    } else {
      const m = (s - 1) >> 1;
      stateTokenId[s] = flatTokens[m];
      stateWordIdx[s] = tokenWordIdx[m];
      stateIsWordStart[s] = isWordFirstToken[m] ? 1 : 0;
    }
  }

  const NEG_INF = -1e12;
  const dp = new Float64Array(T * L).fill(NEG_INF);
  const backptr = new Int32Array(T * L).fill(0);

  // Helper to get emission score at local frame t (0..T-1) for state s (0..L-1)
  const getEmission = (t: number, s: number): number => {
    const absFineFrame = fStart + t;
    const timeSec = absFineFrame * fineShiftSec;
    const ctcIdx = Math.min(
      numCtcFrames - 1,
      Math.max(0, Math.round(timeSec / ctcFrameShiftSec))
    );
    const tid = stateTokenId[s];
    const neuralLp = ctcLogProbs[ctcIdx * numClasses + tid] ?? -10.0;

    const vProb = vocalProb10ms[absFineFrame] ?? 0.5;
    const flux = onsetFlux10ms[absFineFrame] ?? 0.0;

    if (s % 2 === 0) {
      // Blank state: favored during low vocal energy or inter-word gaps
      const acousticBlank = Math.log(Math.max(0.08, 1.0 - vProb * 0.65));
      return neuralLp * 0.55 + acousticBlank * 0.9;
    } else {
      // Active phoneme/subword token state: favored during active vocal energy
      // and word starts get a bonus on syllable onset spectral flux
      const acousticVocal = Math.log(Math.max(0.05, vProb));
      const onsetBonus = stateIsWordStart[s] ? flux * 1.35 : flux * 0.25;
      // Smooth progress prior so tokens distribute naturally across the vocal phrase
      const expectedPos = (s / Math.max(1, L - 1)) * (T - 1);
      const posDiff = (t - expectedPos) / Math.max(12, T);
      const posPrior = -0.65 * posDiff * posDiff;
      return neuralLp * 0.65 + acousticVocal * 1.1 + onsetBonus + posPrior;
    }
  };

  // Initialize t = 0: can start in state 0 (blank) or state 1 (first token)
  dp[0 * L + 0] = getEmission(0, 0);
  if (L > 1) {
    dp[0 * L + 1] = getEmission(0, 1);
  }

  for (let t = 1; t < T; t++) {
    const rowOffset = t * L;
    const prevOffset = (t - 1) * L;

    for (let s = 0; s < L; s++) {
      const emit = getEmission(t, s);

      // Candidate 0: stay in state s
      let bestPrev = dp[prevOffset + s];
      let bestDelta = 0;

      // Candidate 1: transition from s - 1
      if (s >= 1) {
        const cand1 = dp[prevOffset + (s - 1)] - 0.05;
        if (cand1 > bestPrev) {
          bestPrev = cand1;
          bestDelta = 1;
        }
      }

      // Candidate 2: skip blank from s - 2 (only allowed between odd token states if tokens differ)
      if (s >= 2 && s % 2 === 1 && stateTokenId[s] !== stateTokenId[s - 2]) {
        const cand2 = dp[prevOffset + (s - 2)] - 0.12;
        if (cand2 > bestPrev) {
          bestPrev = cand2;
          bestDelta = 2;
        }
      }

      if (bestPrev > NEG_INF / 2) {
        dp[rowOffset + s] = bestPrev + emit;
        backptr[rowOffset + s] = bestDelta;
      }
    }
  }

  // Backtrace from final state L-1 (blank) or L-2 (last token)
  let curState = L - 1;
  if (L >= 2 && dp[(T - 1) * L + (L - 2)] > dp[(T - 1) * L + (L - 1)]) {
    curState = L - 2;
  }
  // If neither L-1 nor L-2 was reached (e.g. very short window), pick highest reachable state at T-1
  if (dp[(T - 1) * L + curState] <= NEG_INF / 2) {
    let maxVal = NEG_INF;
    for (let s = L - 1; s >= 0; s--) {
      if (dp[(T - 1) * L + s] > maxVal) {
        maxVal = dp[(T - 1) * L + s];
        curState = s;
      }
    }
  }

  const statePath = new Int32Array(T);
  for (let t = T - 1; t >= 0; t--) {
    statePath[t] = curState;
    const delta = backptr[t * L + curState];
    curState = Math.max(0, curState - delta);
  }

  // Extract word start and end frames from the Viterbi state path
  const numWords = words.length;
  const wordFirstFrame = new Int32Array(numWords).fill(-1);
  const wordLastFrame = new Int32Array(numWords).fill(-1);
  const wordScoreSum = new Float64Array(numWords);
  const wordFrameCount = new Int32Array(numWords);

  for (let t = 0; t < T; t++) {
    const s = statePath[t];
    const wIdx = stateWordIdx[s];
    if (wIdx >= 0 && wIdx < numWords) {
      if (wordFirstFrame[wIdx] === -1) wordFirstFrame[wIdx] = t;
      wordLastFrame[wIdx] = t;
      const absFineFrame = fStart + t;
      wordScoreSum[wIdx] += vocalProb10ms[absFineFrame] ?? 0.7;
      wordFrameCount[wIdx] += 1;
    }
  }

  // Ensure every word has monotonic, non-overlapping timestamps even if a fast syllable was compressed
  const alignedWords: AlignedWord[] = [];
  let confidenceSum = 0;

  for (let w = 0; w < numWords; w++) {
    let wf0 = wordFirstFrame[w];
    let wf1 = wordLastFrame[w];

    if (wf0 === -1 || wf1 === -1) {
      const approxStart = Math.floor((w / numWords) * T);
      const approxEnd = Math.max(approxStart + 2, Math.floor(((w + 1) / numWords) * T) - 1);
      wf0 = approxStart;
      wf1 = approxEnd;
    }

    // Refine word start to exact local onset peak within [-30ms, +20ms] if strong transient exists
    let refinedStart = fStart + wf0;
    let maxFlux = onsetFlux10ms[refinedStart] ?? 0;
    for (let d = -3; d <= 2; d++) {
      const cand = refinedStart + d;
      if (cand >= fStart && cand <= fEnd) {
        if ((onsetFlux10ms[cand] ?? 0) > maxFlux * 1.25 && (onsetFlux10ms[cand] ?? 0) > 0.22) {
          maxFlux = onsetFlux10ms[cand];
          refinedStart = cand;
        }
      }
    }

    let startSec = refinedStart * fineShiftSec;
    let endSec = Math.max(startSec + 0.06, (fStart + wf1 + 1) * fineShiftSec);

    if (alignedWords.length > 0 && startSec < alignedWords[alignedWords.length - 1].endTime) {
      startSec = alignedWords[alignedWords.length - 1].endTime;
      endSec = Math.max(startSec + 0.06, endSec);
    }

    const avgVocal = wordFrameCount[w] > 0 ? wordScoreSum[w] / wordFrameCount[w] : 0.72;
    const conf = Number(Math.min(0.99, Math.max(0.55, 0.45 + avgVocal * 0.52)).toFixed(3));
    confidenceSum += conf;

    alignedWords.push({
      word: words[w],
      startTime: Number(startSec.toFixed(4)),
      endTime: Number(endSec.toFixed(4)),
      duration: Number((endSec - startSec).toFixed(4)),
      confidence: conf,
    });
  }

  return {
    alignedWords,
    lineConfidence: Number((confidenceSum / Math.max(1, numWords)).toFixed(3)),
  };
}

/**
 * Performs MMS-Align / CTC-Segmentation forced alignment of lyrics/subtitles against an audio file.
 */
export async function alignLyricsWithMMS(
  audioPath: string,
  options: AlignLyricsOptions = {}
): Promise<MMSAlignmentResult> {
  const absAudioPath = path.resolve(audioPath);
  const decoded16k = decodeAudioToFloat32(absAudioPath, 16000);
  const durationSec = decoded16k.durationSec;

  // Determine input lyric lines
  let inputLines: LyricInputLine[] = [];
  if (options.lyricLines && options.lyricLines.length > 0) {
    inputLines = options.lyricLines;
  } else if (options.lrcFilePath && fs.existsSync(path.resolve(options.lrcFilePath))) {
    const lrcRaw = fs.readFileSync(path.resolve(options.lrcFilePath), 'utf-8');
    inputLines = parseLrcContent(lrcRaw, durationSec);
  } else if (options.lyricsText) {
    if (/\[\d{1,3}:\d{1,2}/.test(options.lyricsText)) {
      inputLines = parseLrcContent(options.lyricsText, durationSec);
    } else {
      const rawLines = options.lyricsText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const startOff = options.startTime ?? 0;
      const endOff = options.endTime ?? durationSec;
      const span = Math.max(1.0, endOff - startOff);
      inputLines = rawLines.map((text, idx) => ({
        text,
        startTimeHint: startOff + (idx * span) / rawLines.length,
        endTimeHint: startOff + ((idx + 1) * span) / rawLines.length,
      }));
    }
  } else {
    // Check if an .lrc file with the same basename exists next to audioPath
    const autoLrc = absAudioPath.replace(/\.[^.]+$/, '.lrc');
    if (fs.existsSync(autoLrc)) {
      const lrcRaw = fs.readFileSync(autoLrc, 'utf-8');
      inputLines = parseLrcContent(lrcRaw, durationSec);
    } else {
      throw new Error(
        'Please provide lyrics via lrcFilePath, lyricsText, or lyricLines (or place a matching .lrc file next to the audio file).'
      );
    }
  }

  // Filter by startTime / endTime if requested
  if (options.startTime !== undefined || options.endTime !== undefined) {
    const minT = options.startTime ?? 0;
    const maxT = options.endTime ?? durationSec;
    inputLines = inputLines.filter((l) => {
      const st = l.startTimeHint ?? 0;
      return st >= minT - 0.5 && st <= maxT + 0.5;
    });
  }

  if (inputLines.length === 0) {
    throw new Error('No non-empty lyric lines found in the specified range.');
  }

  // Determine the active audio slice [sliceStartSec, sliceEndSec] so we don't process unnecessary minutes
  const firstHint = inputLines[0].startTimeHint ?? (options.startTime ?? 0);
  const lastHint =
    inputLines[inputLines.length - 1].endTimeHint ??
    (options.endTime ?? durationSec);
  const sliceStartSec = Math.max(0, Math.min(options.startTime ?? firstHint, firstHint) - 1.0);
  const sliceEndSec = Math.min(
    durationSec,
    Math.max(options.endTime ?? lastHint, lastHint) + 1.5
  );
  const sliceDurationSec = Math.max(0.5, sliceEndSec - sliceStartSec);

  const startSample = Math.floor(sliceStartSec * 16000);
  const endSample = Math.min(decoded16k.samples.length, Math.ceil(sliceEndSec * 16000));
  const activeSamples16k = decoded16k.samples.subarray(startSample, endSample);

  // 1. Extract 80-bin Log-Mel Filterbank features and run Neural CTC ONNX model in 2400-frame (24s, multiple-of-8) chunks
  const { featuresTransposed, numFrames: rawMelFrames, frameShiftSec } = computeKaldiLogMel80(
    activeSamples16k,
    16000,
    80
  );

  const vocab = loadVocab();
  const ctcSession = await getCtcSession();

  const CHUNK_FRAMES = 2400; // 24.0s per chunk, divisible by 8 (well under Citrinet's 12288 max mask)
  const numClasses = 1025;
  const ctcChunks: Float32Array[] = [];
  let totalCtcFrames = 0;

  for (let offset = 0; offset < rawMelFrames; offset += CHUNK_FRAMES) {
    const validFrames = Math.min(CHUNK_FRAMES, rawMelFrames - offset);
    // Pad chunk length to a multiple of 8 required by Citrinet's 8x stride pooling
    const paddedFrames = Math.max(16, Math.ceil(validFrames / 8) * 8);
    const chunkFeat = new Float32Array(80 * paddedFrames);

    for (let m = 0; m < 80; m++) {
      const srcRow = m * rawMelFrames + offset;
      const dstRow = m * paddedFrames;
      for (let f = 0; f < validFrames; f++) {
        chunkFeat[dstRow + f] = featuresTransposed[srcRow + f];
      }
    }

    const audioTensor = new ort.Tensor('float32', chunkFeat, [1, 80, paddedFrames]);
    const lengthTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(paddedFrames)]), [1]);

    const ctcOutputs = await ctcSession.run({
      [ctcSession.inputNames[0]]: audioTensor,
      [ctcSession.inputNames[1]]: lengthTensor,
    });

    const lpTensor = ctcOutputs[ctcSession.outputNames[0]];
    const lpData = lpTensor.data as Float32Array;
    const outFrames = Number(lpTensor.dims[1]);
    const keepOutFrames = Math.max(1, Math.ceil(validFrames / 8));
    const actualKeep = Math.min(outFrames, keepOutFrames);

    const slicedLp = new Float32Array(actualKeep * numClasses);
    slicedLp.set(lpData.subarray(0, actualKeep * numClasses));
    ctcChunks.push(slicedLp);
    totalCtcFrames += actualKeep;
  }

  const ctcLogProbs = new Float32Array(totalCtcFrames * numClasses);
  let writePos = 0;
  for (const ch of ctcChunks) {
    ctcLogProbs.set(ch, writePos);
    writePos += ch.length;
  }

  const numCtcFrames = totalCtcFrames;
  const ctcFrameShiftSec = sliceDurationSec / Math.max(1, numCtcFrames);

  // 2. Compute 10ms high-resolution Vocal Harmonic + Silero VAD + Consonant Onset profile on active slice
  const { vocalProb, onsetFlux } = await computeVocalActivityProfile(
    activeSamples16k,
    16000,
    frameShiftSec
  );

  // 3. Also analyze beat & drum grid so we can compute beat offsets and optional beat-snapping
  const rhythm = analyzeAudioRhythm(absAudioPath, {
    startTime: sliceStartSec,
    endTime: sliceEndSec,
  });
  const allAccentTimes: number[] = [
    ...rhythm.beats.map((b) => b.time),
    ...rhythm.drumOnsets.kick.map((k) => k.time),
    ...rhythm.drumOnsets.snare.map((s) => s.time),
  ].sort((a, b) => a - b);

  const snapToleranceSec = (options.maxSnapToleranceMs ?? 75) / 1000.0;
  const anchorMargin = options.anchorSearchWindowSec ?? 0.35;

  // 4. Run CTC-Segmentation Viterbi Forced Alignment per line (relative to sliceStartSec)
  const alignedLines: AlignedLyricLine[] = [];
  let totalWords = 0;
  let totalConfSum = 0;

  // Helper to segment both space-delimited Latin lyrics and unspaced CJK (Chinese/Japanese/Korean) lyrics
  const splitLyricLineIntoWords = (rawText: string): string[] => {
    const trimmed = rawText.trim();
    if (!trimmed) return [];
    const tokens = trimmed.match(/[\u4e00-\u9fff]|[\u3040-\u30ff]+|[a-zA-Z0-9']+|[^\s\u4e00-\u9fff\u3040-\u30ffa-zA-Z0-9']+/g);
    if (!tokens || tokens.length === 0) {
      return trimmed.split(/\s+/).filter(Boolean);
    }
    return tokens.map((t) => t.trim()).filter(Boolean);
  };

  for (let i = 0; i < inputLines.length; i++) {
    const lineObj = inputLines[i];
    const words = splitLyricLineIntoWords(lineObj.text);
    if (words.length === 0) continue;

    const wordTokenIds = words.map((w) => tokenizeWordToIds(w, vocab));

    const absHintStart = lineObj.startTimeHint ?? sliceStartSec + (i * sliceDurationSec) / inputLines.length;
    const rawHintEnd =
      lineObj.endTimeHint ??
      (i + 1 < inputLines.length && inputLines[i + 1].startTimeHint !== undefined
        ? inputLines[i + 1].startTimeHint!
        : Math.min(sliceEndSec, absHintStart + 3.5));

    // Cap excessive interlude/instrumental gaps so a single vocal phrase doesn't stretch across 6+ seconds of silence
    const maxPhraseSpan = Math.max(2.2, words.length * 0.58);
    const absHintEnd = Math.min(rawHintEnd, absHintStart + maxPhraseSpan);

    const prevLineEndAbs =
      alignedLines.length > 0 ? alignedLines[alignedLines.length - 1].endTime : sliceStartSec;
    const absWinStart = Math.max(prevLineEndAbs, absHintStart - Math.min(0.18, anchorMargin * 0.5));
    const absWinEnd = Math.min(
      sliceEndSec,
      Math.max(absWinStart + 0.25, absHintEnd + Math.min(0.12, anchorMargin * 0.3))
    );

    const relWinStart = Math.max(0, absWinStart - sliceStartSec);
    const relWinEnd = Math.min(sliceDurationSec, absWinEnd - sliceStartSec);

    const { alignedWords, lineConfidence } = alignLineWordsViterbi(
      words,
      wordTokenIds,
      ctcLogProbs,
      numCtcFrames,
      numClasses,
      vocab.blankId,
      ctcFrameShiftSec,
      vocalProb,
      onsetFlux,
      relWinStart,
      relWinEnd
    );

    // Shift relative timestamps back to absolute track timestamps and enrich with beat offsets
    for (const w of alignedWords) {
      w.startTime = Number((w.startTime + sliceStartSec).toFixed(4));
      w.endTime = Number((w.endTime + sliceStartSec).toFixed(4));

      let nearestBeat = w.startTime;
      let minDiff = 1e9;
      for (const bt of allAccentTimes) {
        const diff = w.startTime - bt;
        if (Math.abs(diff) < Math.abs(minDiff)) {
          minDiff = diff;
          nearestBeat = bt;
        }
      }
      w.nearestBeatTime = Number(nearestBeat.toFixed(4));
      w.beatOffsetMs = Number((minDiff * 1000).toFixed(1));

      if (Math.abs(minDiff) <= snapToleranceSec) {
        w.snappedStartTime = Number(nearestBeat.toFixed(4));
        if (options.snapWordsToBeats) {
          const dur = w.duration;
          w.startTime = w.snappedStartTime;
          w.endTime = Number((w.startTime + dur).toFixed(4));
        }
      } else {
        w.snappedStartTime = w.startTime;
      }
    }

    const lineStart = alignedWords[0].startTime;
    const lineEnd = alignedWords[alignedWords.length - 1].endTime;
    const driftMs =
      lineObj.startTimeHint !== undefined
        ? Number(((lineStart - lineObj.startTimeHint) * 1000).toFixed(1))
        : undefined;

    alignedLines.push({
      lineIndex: alignedLines.length + 1,
      text: lineObj.text,
      startTime: lineStart,
      endTime: lineEnd,
      duration: Number((lineEnd - lineStart).toFixed(4)),
      confidence: lineConfidence,
      lrcAnchorTime: lineObj.startTimeHint,
      driftCorrectionMs: driftMs,
      words: alignedWords,
    });

    totalWords += alignedWords.length;
    totalConfSum += lineConfidence;
  }

  return {
    audioPath: absAudioPath,
    modelUsed: 'sherpa-onnx-nemo-ctc-en-citrinet-512 (int8 ONNX) + Acoustic CTC-Segmentation',
    vadModelUsed: 'silero_vad_v6.onnx + Harmonic Vocal Band Detector',
    durationSec: Number(durationSec.toFixed(3)),
    bpm: rhythm.bpm,
    totalLines: alignedLines.length,
    totalWords,
    averageConfidence: Number((totalConfSum / Math.max(1, alignedLines.length)).toFixed(3)),
    lines: alignedLines,
  };
}
