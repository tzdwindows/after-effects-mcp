import { AIConfig } from '../types/index.js';
export declare class AIService {
    private static instance;
    private configFilePath;
    private requestFilePath;
    private responseFilePath;
    private config;
    private isProcessingQueue;
    private constructor();
    static getInstance(): AIService;
    private loadConfig;
    getConfig(): AIConfig;
    updateConfig(partial: Partial<AIConfig>): AIConfig;
    fetchModels(override?: Partial<AIConfig>): Promise<string[]>;
    modifyLayerWithAI(params: {
        prompt: string;
        layerInfo: any;
        imagePath?: string;
        configOverride?: Partial<AIConfig>;
    }): Promise<{
        script: string;
        explanation: string;
    }>;
    private startQueueWatcher;
    private checkAndProcessQueue;
}
