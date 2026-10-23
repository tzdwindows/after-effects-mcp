export interface FrameInspectionResult {
    imagePath: string;
    model: string;
    aestheticScore10: number;
    glowClippingRisk: number;
    glowClippingDetected: boolean;
    subtitleOcclusionRisk: number;
    subtitleOcclusionDetected: boolean;
    framingBalanceScore: number;
    saliencyCenterNormalized: {
        x: number;
        y: number;
    };
    dominantRegion: string;
    hardBoxEdgeRatio: number;
    recommendations: string[];
}
/**
 * Inspects a rendered frame using `fastsal_nima_lite.onnx` + geometric boundary cliff detection.
 */
export declare function inspectFrameWithFastSalNIMA(imagePath: string): Promise<FrameInspectionResult>;
