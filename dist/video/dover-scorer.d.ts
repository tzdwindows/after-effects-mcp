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
        overallScore: number;
        technicalScore: number;
        aestheticScore: number;
        audioVisualSyncScore?: number;
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
/**
 * Evaluates a video file using the bundled DOVER-Mobile neural network + fine-grained visual & audio-sync diagnostics.
 */
export declare function evaluateVideoWithDOVER(videoPath: string, options?: EvaluateVideoOptions): Promise<DOVERVideoScoreResult>;
