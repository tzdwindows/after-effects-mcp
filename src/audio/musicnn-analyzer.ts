import fs from 'fs';
import path from 'path';
import * as ort from 'onnxruntime-node';
import {
  decodeAudioToFloat32,
  computeSTFTMagnitude,
  getPackageRoot,
} from './dsp-utils.js';
import { analyzeAudioRhythm } from './beat-analyzer.js';

export interface MusiCNNTagScore {
  id: string;
  zh: string;
  category: 'mood' | 'vocal' | 'instrument' | 'genre' | 'tempo' | 'structure';
  score: number;
}

export interface ArticulatedJointPose {
  torso: number;
  head: number;
  frontArm: number;
  backArm: number;
  frontLeg: number;
  backLeg: number;
  breathingAmp: number;
}

export interface SegmentVisualDirection {
  paletteName: string;
  primaryGlowRGB: [number, number, number];
  secondaryAccentRGB: [number, number, number];
  cameraChoreography: {
    moveType: 'orbital_glide' | 'portal_fly_through' | 'time_reversal_spiral' | 'tear_drop_dive' | 'dolly_zoom_climax' | 'corridor_pullback';
    transitionPortal: 'chrysalis_heart' | 'film_reel_frame' | 'astrolabe_clock' | 'falling_teardrop_world' | 'mobius_infinity_ring' | 'shattering_ice_prism' | 'severed_red_thread' | 'golden_scale_corridor';
    recommendedWorldOffset: [number, number, number];
    dutchTiltDeg: number;
  };
  characterChoreography: {
    actingStyle: string;
    boyPose: ArticulatedJointPose;
    girlPose: ArticulatedJointPose;
  };
}

export interface MusiCNNSegmentResult {
  segmentIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  lyricText?: string;
  dominantMood: string;
  dominantMoodZh: string;
  valence: number; // [-1, 1]
  arousal: number; // [-1, 1]
  tension: number; // [-1, 1]
  energy: number;  // [0, 1]
  topMoodTags: MusiCNNTagScore[];
  topMusicTags: MusiCNNTagScore[];
  aeVisualDirection: SegmentVisualDirection;
}

export interface EmotionalTurningPoint {
  time: number;
  type: 'chorus_eruption' | 'melancholic_plunge' | 'tension_snap' | 'nostalgic_resolution' | 'emotional_shift';
  description: string;
  valenceDelta: number;
  arousalDelta: number;
  recommendedTransition: string;
}

export interface MusiCNNAnalysisResult {
  audioPath: string;
  modelUsed: string;
  poseModelUsed: string;
  durationSec: number;
  bpm: number;
  summary: {
    dominantMood: string;
    dominantMoodZh: string;
    averageValence: number;
    averageArousal: number;
    averageTension: number;
    emotionalQuadrant: 'High-Arousal Positive (Exuberant/Uplifting)' | 'High-Arousal Negative (Dramatic/Heartbreak/Cathartic)' | 'Low-Arousal Positive (Tender/Romantic/Warm)' | 'Low-Arousal Negative (Melancholic/Nostalgic/Lonely)';
    topMoodTags: MusiCNNTagScore[];
    topMusicTags: MusiCNNTagScore[];
  };
  emotionalTurningPoints: EmotionalTurningPoint[];
  segments: MusiCNNSegmentResult[];
}

export interface AnalyzeMusicEmotionOptions {
  startTime?: number;
  endTime?: number;
  windowSec?: number; // Default 3.5s if no LRC provided
  lrcFilePath?: string;
  lyricsText?: string;
  topK?: number; // Default 6
}

interface TagSpec {
  id: string;
  zh: string;
  category: 'mood' | 'vocal' | 'instrument' | 'genre' | 'tempo' | 'structure';
}

let cachedMusicnnSession: ort.InferenceSession | null = null;
let cachedPoseSession: ort.InferenceSession | null = null;
let cachedTagSpecs: TagSpec[] | null = null;

function resolveMusicnnDir(): string {
  const pkgRoot = getPackageRoot();
  const candidates = [
    path.join(pkgRoot, 'models', 'musicnn'),
    path.join(process.cwd(), 'models', 'musicnn'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function resolvePoseModelPath(): string {
  const pkgRoot = getPackageRoot();
  const candidates = [
    path.join(pkgRoot, 'models', 'character_pose', 'audio_lyric_pose_net.onnx'),
    path.join(process.cwd(), 'models', 'character_pose', 'audio_lyric_pose_net.onnx'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

async function getMusicnnResources(): Promise<{
  musicnnSession: ort.InferenceSession;
  poseSession: ort.InferenceSession;
  tagSpecs: TagSpec[];
  musicnnPath: string;
  posePath: string;
}> {
  const dir = resolveMusicnnDir();
  const musicnnPath = path.join(dir, 'musicnn_mood_va.onnx');
  const labelsPath = path.join(dir, 'labels.json');
  const posePath = resolvePoseModelPath();

  if (!fs.existsSync(musicnnPath)) {
    throw new Error(`Bundled MusiCNN ONNX model not found at ${musicnnPath}`);
  }
  if (!cachedMusicnnSession) {
    cachedMusicnnSession = await ort.InferenceSession.create(musicnnPath);
  }
  if (!cachedPoseSession && fs.existsSync(posePath)) {
    cachedPoseSession = await ort.InferenceSession.create(posePath);
  }
  if (!cachedTagSpecs) {
    const raw = JSON.parse(fs.readFileSync(labelsPath, 'utf-8'));
    cachedTagSpecs = raw.tags as TagSpec[];
  }
  return {
    musicnnSession: cachedMusicnnSession,
    poseSession: cachedPoseSession!,
    tagSpecs: cachedTagSpecs,
    musicnnPath,
    posePath,
  };
}

function hzToMel(hz: number): number {
  return 1127.0 * Math.log(1.0 + hz / 700.0);
}

function melToHz(mel: number): number {
  return 700.0 * (Math.exp(mel / 1127.0) - 1.0);
}

/**
 * Extracts a [96 x 64] Log-Mel patch and a 32-dim calibrated acoustic descriptor vector
 * from a segment of mono 16kHz PCM audio.
 */
function extractMusiCNNFeatures(
  samples: Float32Array,
  sampleRate: number,
  bpm: number
): { melPatch: Float32Array; dspFeatures: Float32Array; rmsEnergy: number } {
  const fftSize = 512;
  const hopSize = Math.max(64, Math.floor((samples.length - fftSize) / 64));
  const { magnitudes, numFrames, numBins } = computeSTFTMagnitude(samples, fftSize, hopSize);

  const numMel = 96;
  const targetFrames = 64;
  const lowMel = hzToMel(30);
  const highMel = hzToMel(sampleRate / 2);
  const melPts = new Float32Array(numMel + 2);
  for (let m = 0; m < numMel + 2; m++) {
    melPts[m] = melToHz(lowMel + ((highMel - lowMel) * m) / (numMel + 1));
  }
  const binHz = sampleRate / fftSize;

  const melPatch = new Float32Array(numMel * targetFrames);
  let totalRms = 0;
  for (let i = 0; i < samples.length; i++) {
    totalRms += samples[i] * samples[i];
  }
  const rmsEnergy = Math.min(1.0, Math.sqrt(totalRms / Math.max(1, samples.length)) * 4.2);

  let zcrCount = 0;
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) {
      zcrCount++;
    }
  }
  const zcrNorm = Math.min(1.0, (zcrCount / Math.max(1, samples.length)) * 8.0);

  let lowE = 0, midE = 0, highE = 0;
  let centroidSum = 0, flatnessSum = 0, fluxSum = 0, vocalSum = 0;
  const frameEnergies: number[] = [];
  const chroma = new Float32Array(12);

  for (let tf = 0; tf < targetFrames; tf++) {
    const fIdx = Math.min(numFrames - 1, Math.floor((tf * numFrames) / targetFrames));
    const mag = magnitudes[fIdx];
    const prevMag = fIdx > 0 ? magnitudes[fIdx - 1] : mag;

    let fTotal = 1e-9;
    let fWeightedFreq = 0;
    let logSum = 0;
    let fFlux = 0;

    for (let b = 1; b < numBins; b++) {
      const freq = b * binHz;
      const val = mag[b];
      const pwr = val * val;
      fTotal += pwr;
      fWeightedFreq += freq * pwr;
      logSum += Math.log(Math.max(val, 1e-7));

      const diff = val - prevMag[b];
      if (diff > 0) fFlux += diff;

      if (freq < 250) lowE += pwr;
      else if (freq < 3200) midE += pwr;
      else highE += pwr;

      if (freq >= 280 && freq <= 3400) {
        vocalSum += pwr;
      }

      // Accumulate pitch class chroma (65Hz - 2000Hz)
      if (freq >= 65 && freq <= 2000) {
        const midi = 69 + 12 * Math.log2(freq / 440.0);
        const pc = ((Math.round(midi) % 12) + 12) % 12;
        chroma[pc] += pwr;
      }
    }

    frameEnergies.push(Math.sqrt(fTotal / numBins));
    centroidSum += (fWeightedFreq / fTotal) / (sampleRate / 2);
    const geomMean = Math.exp(logSum / Math.max(1, numBins - 1));
    const arithMean = Math.sqrt(fTotal / Math.max(1, numBins - 1));
    flatnessSum += Math.min(1.0, geomMean / Math.max(arithMean, 1e-7));
    fluxSum += fFlux / numBins;

    // Populate Mel column tf
    for (let m = 0; m < numMel; m++) {
      const fL = melPts[m], fC = melPts[m + 1], fR = melPts[m + 2];
      let mSum = 0;
      const bStart = Math.max(0, Math.floor(fL / binHz));
      const bEnd = Math.min(numBins - 1, Math.ceil(fR / binHz));
      for (let b = bStart; b <= bEnd; b++) {
        const freq = b * binHz;
        const w = freq <= fC
          ? (freq - fL) / Math.max(1e-5, fC - fL)
          : (fR - freq) / Math.max(1e-5, fR - fC);
        if (w > 0) mSum += mag[b] * mag[b] * w;
      }
      // Normalized log-mel in [0, 1]
      const db = 10 * Math.log10(Math.max(mSum, 1e-10));
      melPatch[m * targetFrames + tf] = Math.max(0, Math.min(1, (db + 80) / 80));
    }
  }

  const totalBand = lowE + midE + highE + 1e-9;
  const lowRatio = lowE / totalBand;
  const midRatio = midE / totalBand;
  const highRatio = highE / totalBand;
  const centroidNorm = Math.min(1.0, (centroidSum / targetFrames) * 2.2);
  const flatnessNorm = Math.min(1.0, (flatnessSum / targetFrames) * 2.5);
  const fluxNorm = Math.min(1.0, (fluxSum / targetFrames) * 3.5);
  const tempoNorm = Math.max(0, Math.min(1, (bpm - 60) / 120));

  // Sustain vs dynamic range
  let meanFE = 0, maxFE = 1e-6;
  for (const e of frameEnergies) {
    meanFE += e;
    if (e > maxFE) maxFE = e;
  }
  meanFE /= frameEnergies.length;
  const sustainRatio = Math.min(1.0, meanFE / maxFE);
  const dynamicRange = Math.min(1.0, 1.0 - sustainRatio * 0.7);
  const pulseClarity = Math.min(1.0, fluxNorm * 0.7 + (1 - sustainRatio) * 0.5);

  // Normalize Chroma & estimate Major vs Minor harmonicity + Tension
  let chromaSum = 1e-9;
  for (let c = 0; c < 12; c++) chromaSum += chroma[c];
  for (let c = 0; c < 12; c++) chroma[c] /= chromaSum;

  // Correlate against all 12 Major and 12 Minor Krumhansl-Schmuckler triad templates
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  let bestMajor = 0, bestMinor = 0;
  for (let root = 0; root < 12; root++) {
    let majScore = 0, minScore = 0;
    for (let i = 0; i < 12; i++) {
      const pc = (root + i) % 12;
      majScore += chroma[pc] * majorProfile[i];
      minScore += chroma[pc] * minorProfile[i];
    }
    if (majScore > bestMajor) bestMajor = majScore;
    if (minScore > bestMinor) bestMinor = minScore;
  }
  const modeTotal = bestMajor + bestMinor + 1e-6;
  const minorLikelihood = Math.min(1.0, Math.max(0.0, (bestMinor / modeTotal - 0.42) * 5.0));
  const majorLikelihood = Math.min(1.0, Math.max(0.0, (bestMajor / modeTotal - 0.42) * 5.0));

  // Harmonic tension (semitone/tritone intervals)
  let dissonance = 0;
  for (let c = 0; c < 12; c++) {
    dissonance += chroma[c] * chroma[(c + 1) % 12] * 2.5; // minor 2nd
    dissonance += chroma[c] * chroma[(c + 6) % 12] * 2.0; // tritone
  }
  const harmonicTension = Math.min(1.0, dissonance * 4.5 + highRatio * 0.4);
  const vocalPresence = Math.min(1.0, (vocalSum / totalBand) * 1.25);

  // Energy slope (crescendo > 0 vs decrescendo < 0)
  const firstHalf = frameEnergies.slice(0, 32).reduce((a, b) => a + b, 0) / 32;
  const secondHalf = frameEnergies.slice(32).reduce((a, b) => a + b, 0) / 32;
  const energySlope = Math.max(-1, Math.min(1, (secondHalf - firstHalf) / Math.max(meanFE, 1e-4)));

  const dspFeatures = new Float32Array(32);
  dspFeatures[0] = rmsEnergy;
  dspFeatures[1] = lowRatio;
  dspFeatures[2] = midRatio;
  dspFeatures[3] = highRatio;
  dspFeatures[4] = centroidNorm;
  dspFeatures[5] = flatnessNorm;
  dspFeatures[6] = fluxNorm;
  dspFeatures[7] = zcrNorm;
  dspFeatures[8] = tempoNorm;
  dspFeatures[9] = pulseClarity;
  dspFeatures[10] = sustainRatio;
  dspFeatures[11] = dynamicRange;
  dspFeatures[12] = minorLikelihood;
  dspFeatures[13] = majorLikelihood;
  dspFeatures[14] = harmonicTension;
  dspFeatures[15] = vocalPresence;
  for (let c = 0; c < 12; c++) dspFeatures[16 + c] = chroma[c];
  dspFeatures[28] = energySlope;
  dspFeatures[29] = Math.abs(energySlope);
  dspFeatures[30] = rmsEnergy * vocalPresence;
  dspFeatures[31] = minorLikelihood * sustainRatio;

  return { melPatch, dspFeatures, rmsEnergy };
}

/**
 * Parses LRC file or text into timed segments if provided.
 */
function parseLyricSegments(
  lrcFilePath?: string,
  lyricsText?: string,
  startOffset = 0,
  maxDur = 60
): { startTime: number; endTime: number; text: string }[] {
  let raw = '';
  if (lrcFilePath && fs.existsSync(lrcFilePath)) {
    raw = fs.readFileSync(lrcFilePath, 'utf-8');
  } else if (lyricsText) {
    raw = lyricsText;
  }
  if (!raw.trim()) return [];

  const parsed: { time: number; text: string }[] = [];
  const regex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/;
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(regex);
    if (m) {
      const mins = parseInt(m[1], 10);
      const secs = parseInt(m[2], 10);
      const ms = m[3] ? parseFloat('0.' + m[3]) : 0;
      const t = mins * 60 + secs + ms - startOffset;
      const txt = m[4].trim();
      if (txt && !txt.startsWith('作词') && !txt.startsWith('作曲') && !txt.startsWith('编曲')) {
        parsed.push({ time: t, text: txt });
      }
    }
  }

  const filtered = parsed.filter((p) => p.time >= -0.5 && p.time <= maxDur + 0.5);
  const segs: { startTime: number; endTime: number; text: string }[] = [];
  for (let i = 0; i < filtered.length; i++) {
    const t0 = Math.max(0, filtered[i].time);
    const t1 = i + 1 < filtered.length ? Math.min(maxDur, filtered[i + 1].time) : maxDur;
    if (t1 - t0 > 0.2) {
      segs.push({ startTime: Number(t0.toFixed(2)), endTime: Number(t1.toFixed(2)), text: filtered[i].text });
    }
  }
  return segs;
}

/**
 * Computes lyric semantic affect weights so character choreography and visual metaphors
 * reflect both the acoustic emotion AND the poetic meaning of the lyrics.
 */
function extractLyricAffectVector(lyricText = ''): {
  sadness: number;
  yearning: number;
  vow: number;
  estrangement: number;
  severance: number;
  remembrance: number;
  isTearDrop: boolean;
} {
  const t = lyricText;
  const sadness = /红着眼|泪|痛|怪|遗憾|哭|伤/.test(t) ? 1.0 : 0.2;
  const yearning = /羽化|成仙|情|追|再见|渴望/.test(t) ? 1.0 : 0.2;
  const vow = /永远|一起|誓言|匆促|排练|濡沫/.test(t) ? 1.0 : 0.1;
  const estrangement = /冰释|前嫌|反悔|冷|谣言/.test(t) ? 1.0 : 0.1;
  const severance = /无挂|无牵|甘心|断|亏欠/.test(t) ? 1.0 : 0.1;
  const remembrance = /怀缅|眷恋|岁月|那年|过去/.test(t) ? 1.0 : 0.2;
  const isTearDrop = /红着脸|红着眼|泪/.test(t);
  return { sadness, yearning, vow, estrangement, severance, remembrance, isTearDrop };
}

export async function analyzeMusicEmotionWithMusiCNN(
  audioPath: string,
  options: AnalyzeMusicEmotionOptions = {}
): Promise<MusiCNNAnalysisResult> {
  const { musicnnSession, poseSession, tagSpecs, musicnnPath, posePath } = await getMusicnnResources();

  const decoded = decodeAudioToFloat32(audioPath, 16000);
  const fullSr = decoded.sampleRate;
  const sTime = options.startTime ?? 0;
  const eTime = options.endTime ?? decoded.durationSec;
  const clipDur = Math.max(0.5, eTime - sTime);

  const sSample = Math.max(0, Math.floor(sTime * fullSr));
  const eSample = Math.min(decoded.samples.length, Math.floor(eTime * fullSr));
  const clipSamples = decoded.samples.subarray(sSample, eSample);

  const rhythm = analyzeAudioRhythm(audioPath, { startTime: sTime, endTime: eTime });
  const bpm = rhythm.bpm || 86;

  // Determine analysis windows: either LRC-aligned chapters or sliding windowSec (default 3.5s)
  let timeWindows = parseLyricSegments(options.lrcFilePath, options.lyricsText, sTime, clipDur);
  if (timeWindows.length === 0) {
    const winSec = options.windowSec ?? 3.5;
    for (let t = 0; t < clipDur; t += winSec) {
      const tEnd = Math.min(clipDur, t + winSec);
      if (tEnd - t >= 0.8) {
        timeWindows.push({ startTime: Number(t.toFixed(2)), endTime: Number(tEnd.toFixed(2)), text: '' });
      }
    }
  }

  const topK = options.topK ?? 6;
  const segments: MusiCNNSegmentResult[] = [];
  const globalTagAccum = new Float64Array(tagSpecs.length);
  let valenceSum = 0, arousalSum = 0, tensionSum = 0;

  const portalCycle: SegmentVisualDirection['cameraChoreography']['transitionPortal'][] = [
    'chrysalis_heart',
    'film_reel_frame',
    'astrolabe_clock',
    'falling_teardrop_world',
    'mobius_infinity_ring',
    'shattering_ice_prism',
    'severed_red_thread',
    'golden_scale_corridor',
  ];

  for (let idx = 0; idx < timeWindows.length; idx++) {
    const w = timeWindows[idx];
    const ws = Math.max(0, Math.floor(w.startTime * fullSr));
    const we = Math.min(clipSamples.length, Math.floor(w.endTime * fullSr));
    const segSamples = we - ws >= 512 ? clipSamples.subarray(ws, we) : clipSamples;

    const { melPatch, dspFeatures, rmsEnergy } = extractMusiCNNFeatures(segSamples, fullSr, bpm);

    const out = await musicnnSession.run({
      mel_patch: new ort.Tensor('float32', melPatch, [1, 1, 96, 64]),
      dsp_features: new ort.Tensor('float32', dspFeatures, [1, 32]),
    });

    const probs = out.tag_probs.data as Float32Array;
    const va = out.valence_arousal.data as Float32Array;

    const lyrAffect = extractLyricAffectVector(w.text);
    // Fuse acoustic VA with lyric semantic affect when lyrics are present
    const valence = Number(Math.max(-1, Math.min(1, va[0] - lyrAffect.sadness * 0.18 + lyrAffect.vow * 0.12)).toFixed(3));
    const arousal = Number(Math.max(-1, Math.min(1, va[1] + rmsEnergy * 0.25 + lyrAffect.severance * 0.15)).toFixed(3));
    const tension = Number(Math.max(-1, Math.min(1, va[2] + lyrAffect.estrangement * 0.2 + lyrAffect.severance * 0.2)).toFixed(3));

    valenceSum += valence;
    arousalSum += arousal;
    tensionSum += tension;

    const moodList: MusiCNNTagScore[] = [];
    const musicList: MusiCNNTagScore[] = [];

    for (let t = 0; t < tagSpecs.length; t++) {
      let p = probs[t];
      // Boost tag relevance with lyric affect if available
      if (tagSpecs[t].id === 'heartbreak' && (lyrAffect.sadness > 0.5 || lyrAffect.severance > 0.5)) p = Math.min(0.99, p + 0.18);
      if (tagSpecs[t].id === 'nostalgic' && lyrAffect.remembrance > 0.5) p = Math.min(0.99, p + 0.16);
      if (tagSpecs[t].id === 'ethereal' && /羽化|成仙/.test(w.text)) p = Math.min(0.99, p + 0.22);
      if (tagSpecs[t].id === 'romantic' && lyrAffect.vow > 0.5) p = Math.min(0.99, p + 0.15);

      globalTagAccum[t] += p;
      const item: MusiCNNTagScore = {
        id: tagSpecs[t].id,
        zh: tagSpecs[t].zh,
        category: tagSpecs[t].category,
        score: Number(p.toFixed(3)),
      };
      if (tagSpecs[t].category === 'mood') moodList.push(item);
      else musicList.push(item);
    }

    moodList.sort((a, b) => b.score - a.score);
    musicList.sort((a, b) => b.score - a.score);

    // Run AudioLyricPoseNet ONNX model to generate non-repetitive Boy & Girl 7-joint acting poses!
    const sceneNorm = idx / Math.max(1, timeWindows.length - 1);
    const isClimax = arousal > 0.35 ? 1.0 : 0.0;
    const isOutro = sceneNorm > 0.82 ? 1.0 : 0.0;

    const makeContext = (isGirlFlag: number) =>
      new Float32Array([
        valence,
        arousal,
        tension,
        rmsEnergy,
        dspFeatures[15],
        dspFeatures[8],
        isClimax,
        isOutro,
        sceneNorm,
        isGirlFlag,
        lyrAffect.sadness,
        lyrAffect.yearning,
        lyrAffect.vow,
        lyrAffect.estrangement,
        lyrAffect.severance,
        lyrAffect.remembrance,
      ]);

    const boyPoseOut = await poseSession.run({
      context_vec: new ort.Tensor('float32', makeContext(0.0), [1, 16]),
    });
    const girlPoseOut = await poseSession.run({
      context_vec: new ort.Tensor('float32', makeContext(1.0), [1, 16]),
    });

    const bp = boyPoseOut.joint_angles.data as Float32Array;
    const gp = girlPoseOut.joint_angles.data as Float32Array;

    const toPose = (arr: Float32Array): ArticulatedJointPose => ({
      torso: Number(arr[0].toFixed(1)),
      head: Number(arr[1].toFixed(1)),
      frontArm: Number(arr[2].toFixed(1)),
      backArm: Number(arr[3].toFixed(1)),
      frontLeg: Number(arr[4].toFixed(1)),
      backLeg: Number(arr[5].toFixed(1)),
      breathingAmp: Number(Math.max(3, arr[6]).toFixed(1)),
    });

    // Determine palette, portal & camera move from valence/arousal + lyric narrative
    let paletteName = 'Amber-Gold Nostalgic Memory';
    let primaryGlowRGB: [number, number, number] = [1.0, 0.82, 0.42];
    let secondaryAccentRGB: [number, number, number] = [0.95, 0.65, 0.80];
    let moveType: SegmentVisualDirection['cameraChoreography']['moveType'] = 'orbital_glide';
    let transitionPortal = portalCycle[idx % portalCycle.length];
    let actingStyle = 'yearning_reach_and_counter_gaze';

    if (/红着脸/.test(w.text) || (lyrAffect.isTearDrop && idx > 0 && /红着眼/.test(timeWindows[idx - 1]?.text || ''))) {
      paletteName = 'Blush-Crimson Crystal Teardrop & Inner Gold World';
      primaryGlowRGB = [1.0, 0.32, 0.54];
      secondaryAccentRGB = [1.0, 0.84, 0.44];
      moveType = 'tear_drop_dive';
      transitionPortal = 'falling_teardrop_world';
      actingStyle = 'teardrop_forehead_embrace';
    } else if (/红着眼/.test(w.text)) {
      paletteName = 'Crimson Gaze & Pupil Reflection';
      primaryGlowRGB = [1.0, 0.14, 0.26];
      secondaryAccentRGB = [1.0, 0.55, 0.65];
      moveType = 'dolly_zoom_climax';
      transitionPortal = 'falling_teardrop_world';
      actingStyle = 'pupil_upward_gaze';
    } else if (/冰释|前嫌/.test(w.text) || (valence < -0.15 && tension > 0.25)) {
      paletteName = 'Glacial Cyan Ice Prism';
      primaryGlowRGB = [0.32, 0.92, 1.0];
      secondaryAccentRGB = [0.55, 0.94, 1.0];
      moveType = 'portal_fly_through';
      transitionPortal = 'shattering_ice_prism';
      actingStyle = 'ice_wall_estrangement_back_to_ice';
    } else if (/无挂|无牵/.test(w.text)) {
      paletteName = 'Severed Fate Crimson Thread';
      primaryGlowRGB = [1.0, 0.16, 0.28];
      secondaryAccentRGB = [1.0, 0.42, 0.52];
      moveType = 'dolly_zoom_climax';
      transitionPortal = 'severed_red_thread';
      actingStyle = 'severed_thread_recoil_and_bow';
    } else if (/亏欠|怀缅/.test(w.text) || isOutro > 0.5) {
      paletteName = 'Golden Scale of Debt & Neon-Rose Remembrance Corridor';
      primaryGlowRGB = [1.0, 0.80, 0.36];
      secondaryAccentRGB = [0.96, 0.58, 0.80];
      moveType = /怀缅/.test(w.text) ? 'corridor_pullback' : 'orbital_glide';
      transitionPortal = 'golden_scale_corridor';
      actingStyle = 'scale_of_debt_kneel_and_reach_down';
    } else if (/反悔|岁月/.test(w.text)) {
      paletteName = 'Turquoise-Gold Reversing Astrolabe';
      primaryGlowRGB = [0.35, 0.95, 0.90];
      secondaryAccentRGB = [1.0, 0.85, 0.48];
      moveType = 'time_reversal_spiral';
      transitionPortal = 'astrolabe_clock';
      actingStyle = 'back_to_back_regret_and_180_turn';
    } else if (/羽化|成仙/.test(w.text)) {
      paletteName = ' Bioluminescent Cyan Chrysalis & Rose Heart';
      primaryGlowRGB = [0.38, 0.90, 1.0];
      secondaryAccentRGB = [1.0, 0.38, 0.58];
      moveType = 'portal_fly_through';
      transitionPortal = 'chrysalis_heart';
      actingStyle = 'running_lunge_reach_and_metamorphosis_flight';
    }

    const worldX = 960 + Math.round(Math.sin(idx * 1.3) * 320);
    const worldY = idx >= 4 ? 1750 : 420;
    const worldZ = idx * 1050;

    segments.push({
      segmentIndex: idx + 1,
      startTime: w.startTime,
      endTime: w.endTime,
      duration: Number((w.endTime - w.startTime).toFixed(2)),
      lyricText: w.text || undefined,
      dominantMood: moodList[0].id,
      dominantMoodZh: moodList[0].zh,
      valence,
      arousal,
      tension,
      energy: Number(rmsEnergy.toFixed(3)),
      topMoodTags: moodList.slice(0, topK),
      topMusicTags: musicList.slice(0, topK),
      aeVisualDirection: {
        paletteName,
        primaryGlowRGB,
        secondaryAccentRGB,
        cameraChoreography: {
          moveType,
          transitionPortal,
          recommendedWorldOffset: [worldX, worldY, worldZ],
          dutchTiltDeg: Number((Math.sin(idx * 1.7) * 5).toFixed(1)),
        },
        characterChoreography: {
          actingStyle,
          boyPose: toPose(bp),
          girlPose: toPose(gp),
        },
      },
    });
  }

  // Detect emotional turning points across segments
  const emotionalTurningPoints: EmotionalTurningPoint[] = [];
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1];
    const curr = segments[i];
    const vDelta = Number((curr.valence - prev.valence).toFixed(3));
    const aDelta = Number((curr.arousal - prev.arousal).toFixed(3));

    if (
      Math.abs(aDelta) >= 0.14 ||
      Math.abs(vDelta) >= 0.14 ||
      curr.aeVisualDirection.cameraChoreography.moveType === 'tear_drop_dive' ||
      curr.aeVisualDirection.cameraChoreography.transitionPortal === 'severed_red_thread'
    ) {
      let type: EmotionalTurningPoint['type'] = 'emotional_shift';
      let recommendedTransition = '3D Z-Portal Match-Cut Fly-Through';
      if (curr.aeVisualDirection.cameraChoreography.moveType === 'tear_drop_dive') {
        type = 'melancholic_plunge';
        recommendedTransition = 'Vertical Camera Dive Following Falling Tear + Refracted Inner World Fly-Through';
      } else if (aDelta >= 0.14) {
        type = 'chorus_eruption';
        recommendedTransition = 'Rapid Dolly-In into Crimson Eye / High-Energy Saber Bloom';
      } else if (curr.aeVisualDirection.cameraChoreography.transitionPortal === 'severed_red_thread') {
        type = 'tension_snap';
        recommendedTransition = 'Red Thread Snap Recoil + Dutch Tilt Shockwave';
      } else if (curr.aeVisualDirection.cameraChoreography.moveType === 'corridor_pullback') {
        type = 'nostalgic_resolution';
        recommendedTransition = 'Multi-Plane 3D Memory Corridor Pull-Back';
      }

      emotionalTurningPoints.push({
        time: curr.startTime,
        type,
        description: `${prev.dominantMoodZh}(${prev.dominantMood}) -> ${curr.dominantMoodZh}(${curr.dominantMood})${curr.lyricText ? ` 「${curr.lyricText}」` : ''}`,
        valenceDelta: vDelta,
        arousalDelta: aDelta,
        recommendedTransition,
      });
    }
  }

  const nSeg = Math.max(1, segments.length);
  const avgValence = Number((valenceSum / nSeg).toFixed(3));
  const avgArousal = Number((arousalSum / nSeg).toFixed(3));
  const avgTension = Number((tensionSum / nSeg).toFixed(3));

  const globalMoods: MusiCNNTagScore[] = [];
  const globalMusic: MusiCNNTagScore[] = [];
  for (let t = 0; t < tagSpecs.length; t++) {
    const item: MusiCNNTagScore = {
      id: tagSpecs[t].id,
      zh: tagSpecs[t].zh,
      category: tagSpecs[t].category,
      score: Number((globalTagAccum[t] / nSeg).toFixed(3)),
    };
    if (tagSpecs[t].category === 'mood') globalMoods.push(item);
    else globalMusic.push(item);
  }
  globalMoods.sort((a, b) => b.score - a.score);
  globalMusic.sort((a, b) => b.score - a.score);

  let emotionalQuadrant: MusiCNNAnalysisResult['summary']['emotionalQuadrant'];
  if (avgArousal >= 0 && avgValence >= 0) {
    emotionalQuadrant = 'High-Arousal Positive (Exuberant/Uplifting)';
  } else if (avgArousal >= 0 && avgValence < 0) {
    emotionalQuadrant = 'High-Arousal Negative (Dramatic/Heartbreak/Cathartic)';
  } else if (avgArousal < 0 && avgValence >= 0) {
    emotionalQuadrant = 'Low-Arousal Positive (Tender/Romantic/Warm)';
  } else {
    emotionalQuadrant = 'Low-Arousal Negative (Melancholic/Nostalgic/Lonely)';
  }

  return {
    audioPath: path.resolve(audioPath),
    modelUsed: path.basename(musicnnPath),
    poseModelUsed: path.basename(posePath),
    durationSec: Number(clipDur.toFixed(2)),
    bpm,
    summary: {
      dominantMood: globalMoods[0].id,
      dominantMoodZh: globalMoods[0].zh,
      averageValence: avgValence,
      averageArousal: avgArousal,
      averageTension: avgTension,
      emotionalQuadrant,
      topMoodTags: globalMoods.slice(0, topK),
      topMusicTags: globalMusic.slice(0, topK),
    },
    emotionalTurningPoints,
    segments,
  };
}
