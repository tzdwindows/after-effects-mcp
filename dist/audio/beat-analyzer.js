import { decodeAudioToFloat32, computeSTFTMagnitude } from './dsp-utils.js';
/**
 * Computes half-wave rectified log-spectral flux within a frequency range [minHz, maxHz].
 */
function computeBandFlux(magnitudes, sampleRate, fftSize, minHz, maxHz, gamma = 15.0) {
    const numFrames = magnitudes.length;
    const numBins = magnitudes[0].length;
    const minBin = Math.max(1, Math.floor((minHz * fftSize) / sampleRate));
    const maxBin = Math.min(numBins - 1, Math.ceil((maxHz * fftSize) / sampleRate));
    const flux = new Float32Array(numFrames);
    if (maxBin < minBin)
        return flux;
    for (let f = 1; f < numFrames; f++) {
        const cur = magnitudes[f];
        const prev = magnitudes[f - 1];
        let sum = 0;
        for (let b = minBin; b <= maxBin; b++) {
            const cLog = Math.log1p(gamma * cur[b]);
            const pLog = Math.log1p(gamma * prev[b]);
            const diff = cLog - pLog;
            if (diff > 0)
                sum += diff;
        }
        flux[f] = sum / (maxBin - minBin + 1);
    }
    // Normalize to [0, 1] using 99.5th percentile to avoid single-spike suppression
    const sorted = Float32Array.from(flux).sort();
    const p995 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.995))] || 1.0;
    for (let f = 0; f < numFrames; f++) {
        flux[f] = Math.min(1.0, flux[f] / p995);
    }
    return flux;
}
/**
 * Adaptive peak picker with local moving average + std threshold and refractory window.
 */
function pickOnsetPeaks(flux, frameShiftSec, band, sensitivity = 0.55, minIntervalSec = 0.08) {
    const numFrames = flux.length;
    const winRadius = Math.max(3, Math.round(0.35 / frameShiftSec)); // ~350ms local context
    const refractoryFrames = Math.max(1, Math.round(minIntervalSec / frameShiftSec));
    // Higher sensitivity -> lower threshold multiplier
    const stdMultiplier = 1.65 - Math.max(0.1, Math.min(1.0, sensitivity)) * 1.1;
    const absFloor = 0.18 - Math.max(0.1, Math.min(1.0, sensitivity)) * 0.1;
    const peaks = [];
    let lastPeakFrame = -refractoryFrames * 2;
    for (let f = 1; f < numFrames - 1; f++) {
        const val = flux[f];
        if (val < absFloor)
            continue;
        // Must be local maximum
        if (val < flux[f - 1] || val < flux[f + 1])
            continue;
        const wStart = Math.max(0, f - winRadius);
        const wEnd = Math.min(numFrames - 1, f + winRadius);
        const count = wEnd - wStart + 1;
        let sum = 0;
        for (let i = wStart; i <= wEnd; i++)
            sum += flux[i];
        const mean = sum / count;
        let varSum = 0;
        for (let i = wStart; i <= wEnd; i++) {
            const d = flux[i] - mean;
            varSum += d * d;
        }
        const std = Math.sqrt(varSum / count);
        const threshold = mean + stdMultiplier * std;
        if (val >= threshold) {
            if (f - lastPeakFrame >= refractoryFrames) {
                peaks.push({
                    time: Number((f * frameShiftSec).toFixed(4)),
                    strength: Number(val.toFixed(3)),
                    band,
                });
                lastPeakFrame = f;
            }
            else if (peaks.length > 0 && val > peaks[peaks.length - 1].strength) {
                // Replace weaker peak inside refractory window with stronger peak
                peaks[peaks.length - 1] = {
                    time: Number((f * frameShiftSec).toFixed(4)),
                    strength: Number(val.toFixed(3)),
                    band,
                };
                lastPeakFrame = f;
            }
        }
    }
    return peaks;
}
/**
 * Estimates BPM and runs Ellis (2007) Dynamic Programming Beat Tracking.
 */
function trackBeatsAndBpm(onsetEnv, kickFlux, snareFlux, frameShiftSec, minBpm = 70, maxBpm = 190) {
    const numFrames = onsetEnv.length;
    const minLag = Math.max(2, Math.floor(60.0 / (maxBpm * frameShiftSec)));
    const maxLag = Math.min(Math.floor(numFrames / 2), Math.ceil(60.0 / (minBpm * frameShiftSec)));
    // Zero-mean onset envelope for autocorrelation
    let mean = 0;
    for (let i = 0; i < numFrames; i++)
        mean += onsetEnv[i];
    mean /= Math.max(1, numFrames);
    const centered = new Float32Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
        centered[i] = Math.max(0, onsetEnv[i] - mean * 0.5);
    }
    const acf = new Float64Array(maxLag * 2 + 2);
    for (let lag = minLag; lag <= Math.min(numFrames - 1, maxLag * 2); lag++) {
        let sum = 0;
        const limit = numFrames - lag;
        for (let t = 0; t < limit; t++) {
            sum += centered[t] * centered[t + lag];
        }
        acf[lag] = sum / Math.max(1, limit);
    }
    // Harmonic comb-filter tempogram with perceptual prior around 125 BPM
    let bestLag = Math.round(60.0 / (120.0 * frameShiftSec));
    let bestScore = -1;
    let totalScore = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
        const candidateBpm = 60.0 / (lag * frameShiftSec);
        // Log-Gaussian prior centered at 126 BPM
        const prior = Math.exp(-0.5 * Math.pow(Math.log2(candidateBpm / 126.0) / 0.45, 2));
        const h1 = acf[lag] || 0;
        const h2 = lag * 2 < acf.length ? acf[lag * 2] * 0.5 : 0;
        const hHalf = lag % 2 === 0 ? acf[lag >> 1] * 0.25 : 0;
        const score = (h1 + h2 + hHalf) * prior;
        totalScore += score;
        if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
        }
    }
    // Parabolic interpolation around bestLag for sub-frame BPM accuracy
    let refinedLag = bestLag;
    if (bestLag > minLag && bestLag < maxLag) {
        const yPrev = acf[bestLag - 1];
        const y0 = acf[bestLag];
        const yNext = acf[bestLag + 1];
        const denom = yPrev - 2 * y0 + yNext;
        if (Math.abs(denom) > 1e-9) {
            const delta = (0.5 * (yPrev - yNext)) / denom;
            if (Math.abs(delta) < 1.0) {
                refinedLag = bestLag + delta;
            }
        }
    }
    let rawBpm = 60.0 / (refinedLag * frameShiftSec);
    // If BPM is extremely close to an integer (common in studio tracks like 128, 130, 140), snap within 0.35 BPM
    const nearestIntBpm = Math.round(rawBpm);
    if (Math.abs(rawBpm - nearestIntBpm) <= 0.35) {
        rawBpm = nearestIntBpm;
        refinedLag = 60.0 / (rawBpm * frameShiftSec);
    }
    const bpm = Number(rawBpm.toFixed(2));
    const avgScore = totalScore / Math.max(1, maxLag - minLag + 1);
    const bpmConfidence = Number(Math.min(0.99, Math.max(0.4, bestScore / (avgScore * 2.2 + 1e-9))).toFixed(3));
    // Ellis (2007) Dynamic Programming Beat Tracking
    const period = Math.round(refinedLag);
    const minStep = Math.max(2, Math.round(period * 0.55));
    const maxStep = Math.round(period * 1.85);
    const alpha = 180.0; // Tightness penalty keeping grid faithful to tempo
    const cumScore = new Float64Array(numFrames);
    const backlink = new Int32Array(numFrames).fill(-1);
    for (let t = 0; t < numFrames; t++) {
        const localOnset = onsetEnv[t] + 0.65 * kickFlux[t] + 0.45 * snareFlux[t];
        cumScore[t] = localOnset;
        let maxPrev = -1e9;
        let bestPrev = -1;
        const searchStart = Math.max(0, t - maxStep);
        const searchEnd = t - minStep;
        for (let tau = searchStart; tau <= searchEnd; tau++) {
            const interval = t - tau;
            const logRatio = Math.log(interval / refinedLag);
            const penalty = alpha * logRatio * logRatio;
            const candidate = cumScore[tau] - penalty;
            if (candidate > maxPrev) {
                maxPrev = candidate;
                bestPrev = tau;
            }
        }
        if (bestPrev >= 0 && maxPrev > 0) {
            cumScore[t] = localOnset + maxPrev;
            backlink[t] = bestPrev;
        }
    }
    // Backtrace from the highest cumulative score near the end of the track
    let bestEndFrame = numFrames - 1;
    let bestEndVal = -1e9;
    const tailStart = Math.max(0, numFrames - period * 2);
    for (let t = tailStart; t < numFrames; t++) {
        if (cumScore[t] > bestEndVal) {
            bestEndVal = cumScore[t];
            bestEndFrame = t;
        }
    }
    const rawBeats = [];
    let curr = bestEndFrame;
    while (curr >= 0) {
        rawBeats.push(curr);
        curr = backlink[curr];
    }
    rawBeats.reverse();
    // Extrapolate backward to start and forward to end so full duration has beat grid
    if (rawBeats.length > 0) {
        while (rawBeats[0] - refinedLag >= 0) {
            rawBeats.unshift(Math.round(rawBeats[0] - refinedLag));
        }
        while (rawBeats[rawBeats.length - 1] + refinedLag < numFrames) {
            rawBeats.push(Math.round(rawBeats[rawBeats.length - 1] + refinedLag));
        }
    }
    // Snap each beat within +/- 3 frames (~35ms) to exact local drum transient peak if strong
    const beatFrames = rawBeats.map((bf) => {
        let bestF = bf;
        let bestVal = kickFlux[bf] + snareFlux[bf];
        for (let d = -3; d <= 3; d++) {
            const idx = bf + d;
            if (idx >= 0 && idx < numFrames) {
                const v = kickFlux[idx] + snareFlux[idx];
                if (v > bestVal * 1.15 && v > 0.25) {
                    bestVal = v;
                    bestF = idx;
                }
            }
        }
        return bestF;
    });
    // Determine 4/4 Downbeat Phase (0, 1, 2, or 3) based on Kick on beat 1 + Snare on beats 2 & 4
    const phaseScores = [0, 0, 0, 0];
    for (let i = 0; i < beatFrames.length; i++) {
        const f = beatFrames[i];
        const phase = i % 4;
        // Beat 1 of a bar typically has strong Kick and energy
        phaseScores[phase] += kickFlux[f] * 1.5 + onsetEnv[f] * 0.8;
        // Beats 2 and 4 relative to `phase` have strong Snare backbeat
        const snarePhase1 = (phase + 2) % 4; // if current `i` is beat 3 (2 after phase)
        phaseScores[snarePhase1] += kickFlux[f] * 0.4;
        if (i >= 1) {
            const prevPhase = (i - 1 + 4) % 4;
            phaseScores[prevPhase] += snareFlux[f] * 0.7;
        }
    }
    let downbeatPhase = 0;
    let maxPhaseScore = -1;
    for (let p = 0; p < 4; p++) {
        if (phaseScores[p] > maxPhaseScore) {
            maxPhaseScore = phaseScores[p];
            downbeatPhase = p;
        }
    }
    return {
        bpm,
        bpmConfidence,
        beatFrames,
        downbeatPhase,
    };
}
/**
 * Performs comprehensive audio beat, sub-band drum onset, energy, and structural climax analysis.
 */
export function analyzeAudioRhythm(audioPath, options = {}) {
    const sampleRate = 22050;
    const fftSize = 2048;
    const hopSize = 256; // 11.61ms per frame
    const frameShiftSec = hopSize / sampleRate;
    const decoded = decodeAudioToFloat32(audioPath, sampleRate);
    let samples = decoded.samples;
    const startOffsetSec = Math.max(0, options.startTime || 0);
    const endOffsetSec = options.endTime && options.endTime > startOffsetSec
        ? Math.min(decoded.durationSec, options.endTime)
        : decoded.durationSec;
    if (startOffsetSec > 0 || endOffsetSec < decoded.durationSec) {
        const sIdx = Math.floor(startOffsetSec * sampleRate);
        const eIdx = Math.min(samples.length, Math.ceil(endOffsetSec * sampleRate));
        samples = samples.subarray(sIdx, eIdx);
    }
    const { magnitudes, numFrames } = computeSTFTMagnitude(samples, fftSize, hopSize);
    // Sub-band spectral flux
    const kickFlux = computeBandFlux(magnitudes, sampleRate, fftSize, 20, 150, 20.0);
    const snareFlux = computeBandFlux(magnitudes, sampleRate, fftSize, 150, 2500, 15.0);
    const hihatFlux = computeBandFlux(magnitudes, sampleRate, fftSize, 2500, 10500, 12.0);
    const fullFlux = computeBandFlux(magnitudes, sampleRate, fftSize, 30, 9000, 15.0);
    const sensitivity = options.sensitivity ?? 0.55;
    const kickOnsets = pickOnsetPeaks(kickFlux, frameShiftSec, 'kick', sensitivity, 0.09).map((o) => ({
        ...o,
        time: Number((o.time + startOffsetSec).toFixed(4)),
    }));
    const snareOnsets = pickOnsetPeaks(snareFlux, frameShiftSec, 'snare', sensitivity, 0.085).map((o) => ({
        ...o,
        time: Number((o.time + startOffsetSec).toFixed(4)),
    }));
    const hihatOnsets = pickOnsetPeaks(hihatFlux, frameShiftSec, 'hihat', sensitivity * 0.9, 0.055).map((o) => ({
        ...o,
        time: Number((o.time + startOffsetSec).toFixed(4)),
    }));
    const { bpm, bpmConfidence, beatFrames, downbeatPhase } = trackBeatsAndBpm(fullFlux, kickFlux, snareFlux, frameShiftSec, options.minBpm ?? 70, options.maxBpm ?? 190);
    const beats = [];
    const downbeats = [];
    for (let i = 0; i < beatFrames.length; i++) {
        const f = beatFrames[i];
        const time = Number((f * frameShiftSec + startOffsetSec).toFixed(4));
        const relIdx = i - downbeatPhase;
        const barIndex = Math.floor(relIdx / 4) + 1;
        const beatInBar = (((relIdx % 4) + 4) % 4) + 1;
        const isDownbeat = beatInBar === 1;
        const kVal = kickFlux[f];
        const sVal = snareFlux[f];
        const hVal = hihatFlux[f];
        let dominantDrum = 'none';
        const maxDrum = Math.max(kVal, sVal, hVal);
        if (maxDrum > 0.18) {
            if (kVal === maxDrum)
                dominantDrum = 'kick';
            else if (sVal === maxDrum)
                dominantDrum = 'snare';
            else
                dominantDrum = 'hihat';
        }
        const strength = Number(Math.min(1.0, (fullFlux[f] * 0.5 + maxDrum * 0.5)).toFixed(3));
        beats.push({
            time,
            beatIndex: i + 1,
            barIndex,
            beatInBar,
            isDownbeat,
            strength,
            dominantDrum,
        });
        if (isDownbeat) {
            downbeats.push(time);
        }
    }
    // Extract major impact points (strongest combined kick/snare/downbeat hits for camera shakes & VFX flashes)
    const majorImpacts = [];
    let lastImpactTime = -1;
    for (let f = 1; f < numFrames - 1; f++) {
        const combined = kickFlux[f] * 0.55 + snareFlux[f] * 0.45;
        if (combined >= 0.48 &&
            combined >= kickFlux[f - 1] * 0.55 + snareFlux[f - 1] * 0.45 &&
            combined >= kickFlux[f + 1] * 0.55 + snareFlux[f + 1] * 0.45) {
            const t = Number((f * frameShiftSec + startOffsetSec).toFixed(4));
            if (t - lastImpactTime >= 0.22) {
                majorImpacts.push({
                    time: t,
                    strength: Number(Math.min(1.0, combined).toFixed(3)),
                    type: kickFlux[f] >= snareFlux[f] ? 'heavy_kick_impact' : 'snare_clap_impact',
                });
                lastImpactTime = t;
            }
        }
    }
    // Compute 100ms RMS & Flux Energy Envelope and Structural Sections
    const envStepSec = 0.1;
    const envStepSamples = Math.round(envStepSec * sampleRate);
    const numEnvSteps = Math.max(1, Math.ceil(samples.length / envStepSamples));
    const energyEnvelope = [];
    let maxRms = 1e-6;
    const rawRms = new Float32Array(numEnvSteps);
    for (let i = 0; i < numEnvSteps; i++) {
        const s = i * envStepSamples;
        const e = Math.min(samples.length, s + envStepSamples);
        let sq = 0;
        for (let j = s; j < e; j++)
            sq += samples[j] * samples[j];
        const rms = Math.sqrt(sq / Math.max(1, e - s));
        rawRms[i] = rms;
        if (rms > maxRms)
            maxRms = rms;
    }
    for (let i = 0; i < numEnvSteps; i++) {
        const t = Number((i * envStepSec + startOffsetSec).toFixed(2));
        const fStart = Math.floor((i * envStepSec) / frameShiftSec);
        const fEnd = Math.min(numFrames - 1, Math.ceil(((i + 1) * envStepSec) / frameShiftSec));
        let avgFlux = 0;
        for (let f = fStart; f <= fEnd; f++)
            avgFlux += fullFlux[f];
        avgFlux /= Math.max(1, fEnd - fStart + 1);
        energyEnvelope.push({
            time: t,
            rms: Number((rawRms[i] / maxRms).toFixed(3)),
            onsetFlux: Number(avgFlux.toFixed(3)),
        });
    }
    // Segment into structural sections ( ~4-bar chunks or energy shifts )
    const barSec = (60.0 / bpm) * 4.0;
    const sectionLenSec = Math.max(3.5, barSec * 2);
    const sections = [];
    const analyzedDuration = endOffsetSec - startOffsetSec;
    const numSecs = Math.max(1, Math.round(analyzedDuration / sectionLenSec));
    // Find overall energy distribution across sections
    const secEnergies = [];
    for (let s = 0; s < numSecs; s++) {
        const st = startOffsetSec + (s * analyzedDuration) / numSecs;
        const et = startOffsetSec + ((s + 1) * analyzedDuration) / numSecs;
        const slice = energyEnvelope.filter((e) => e.time >= st && e.time <= et);
        let avg = 0;
        let peak = 0;
        for (const item of slice) {
            const score = item.rms * 0.65 + item.onsetFlux * 0.35;
            avg += score;
            if (score > peak)
                peak = score;
        }
        avg /= Math.max(1, slice.length);
        secEnergies.push({ start: Number(st.toFixed(3)), end: Number(et.toFixed(3)), avg, peak });
    }
    const maxSecAvg = Math.max(...secEnergies.map((x) => x.avg), 0.01);
    for (let s = 0; s < secEnergies.length; s++) {
        const cur = secEnergies[s];
        const rel = cur.avg / maxSecAvg;
        let label = 'verse_groove';
        let style = 'Smooth 3D tracking dolly with subtle beat-synced Z-zoom pulses';
        if (s === 0 && rel < 0.78) {
            label = 'intro';
            style = 'Atmospheric slow push-in, depth-of-field rack focus, gentle floating particles';
        }
        else if (rel >= 0.82) {
            label = 'climax_drop';
            style = 'High-energy 3D whip-pans, aggressive FOV punch on every kick/downbeat, chromatic aberration + glow burst';
        }
        else if (s + 1 < secEnergies.length && secEnergies[s + 1].avg / maxSecAvg >= 0.82) {
            label = 'buildup';
            style = 'Accelerating Z-axis pull-back / tension riser, Dutch roll tilt building toward drop impact';
        }
        else if (s === secEnergies.length - 1 && rel < 0.75) {
            label = 'outro';
            style = 'Decelerating crane pullback with warm glow decay';
        }
        sections.push({
            label,
            startTime: cur.start,
            endTime: cur.end,
            avgEnergy: Number(cur.avg.toFixed(3)),
            peakEnergy: Number(cur.peak.toFixed(3)),
            recommendedCameraStyle: style,
        });
    }
    const beatIntervalSec = Number((60.0 / bpm).toFixed(4));
    return {
        audioPath,
        durationSec: Number(decoded.durationSec.toFixed(3)),
        bpm,
        bpmConfidence,
        beatIntervalSec,
        barIntervalSec: Number((beatIntervalSec * 4).toFixed(4)),
        counts: {
            totalBeats: beats.length,
            totalBars: downbeats.length,
            kickCount: kickOnsets.length,
            snareCount: snareOnsets.length,
            hihatCount: hihatOnsets.length,
            majorImpactCount: majorImpacts.length,
        },
        beats,
        downbeats,
        drumOnsets: {
            kick: kickOnsets,
            snare: snareOnsets,
            hihat: hihatOnsets,
            majorImpacts,
        },
        sections,
        energyEnvelope,
    };
}
