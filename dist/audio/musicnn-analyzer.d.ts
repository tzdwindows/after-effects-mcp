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
    valence: number;
    arousal: number;
    tension: number;
    energy: number;
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
    windowSec?: number;
    lrcFilePath?: string;
    lyricsText?: string;
    topK?: number;
}
export declare function analyzeMusicEmotionWithMusiCNN(audioPath: string, options?: AnalyzeMusicEmotionOptions): Promise<MusiCNNAnalysisResult>;
