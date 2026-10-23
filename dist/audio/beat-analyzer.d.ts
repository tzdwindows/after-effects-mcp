export interface DrumOnset {
    time: number;
    strength: number;
    band: 'kick' | 'snare' | 'hihat';
}
export interface BeatEvent {
    time: number;
    beatIndex: number;
    barIndex: number;
    beatInBar: number;
    isDownbeat: boolean;
    strength: number;
    dominantDrum: 'kick' | 'snare' | 'hihat' | 'none';
}
export interface AudioSection {
    label: 'intro' | 'buildup' | 'climax_drop' | 'verse_groove' | 'outro';
    startTime: number;
    endTime: number;
    avgEnergy: number;
    peakEnergy: number;
    recommendedCameraStyle: string;
}
export interface AudioRhythmAnalysisResult {
    audioPath: string;
    durationSec: number;
    bpm: number;
    bpmConfidence: number;
    beatIntervalSec: number;
    barIntervalSec: number;
    counts: {
        totalBeats: number;
        totalBars: number;
        kickCount: number;
        snareCount: number;
        hihatCount: number;
        majorImpactCount: number;
    };
    beats: BeatEvent[];
    downbeats: number[];
    drumOnsets: {
        kick: DrumOnset[];
        snare: DrumOnset[];
        hihat: DrumOnset[];
        majorImpacts: {
            time: number;
            strength: number;
            type: string;
        }[];
    };
    sections: AudioSection[];
    energyEnvelope: {
        time: number;
        rms: number;
        onsetFlux: number;
    }[];
}
export interface AnalyzeAudioOptions {
    startTime?: number;
    endTime?: number;
    minBpm?: number;
    maxBpm?: number;
    sensitivity?: number;
}
/**
 * Performs comprehensive audio beat, sub-band drum onset, energy, and structural climax analysis.
 */
export declare function analyzeAudioRhythm(audioPath: string, options?: AnalyzeAudioOptions): AudioRhythmAnalysisResult;
