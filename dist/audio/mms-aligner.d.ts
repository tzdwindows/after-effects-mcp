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
    maxSnapToleranceMs?: number;
    anchorSearchWindowSec?: number;
}
/**
 * Parses a standard .lrc file into LyricInputLine[] with start & end time hints.
 */
export declare function parseLrcContent(lrcContent: string, totalDurationSec?: number): LyricInputLine[];
/**
 * Performs MMS-Align / CTC-Segmentation forced alignment of lyrics/subtitles against an audio file.
 */
export declare function alignLyricsWithMMS(audioPath: string, options?: AlignLyricsOptions): Promise<MMSAlignmentResult>;
