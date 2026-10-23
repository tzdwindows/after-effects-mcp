import { BridgeResult, HeartbeatInfo } from '../types/index.js';
export declare class BridgeManager {
    private static instance;
    private cmdFile;
    private resFile;
    private heartbeatFile;
    private lastExecutedResults;
    private constructor();
    static getInstance(): BridgeManager;
    private ensureFiles;
    getBridgeStatus(): {
        connected: boolean;
        heartbeat?: HeartbeatInfo;
        message: string;
    };
    execute(action: string, script: string, description: string, params?: any, options?: {
        timeoutMs?: number;
        skipAutoSave?: boolean;
    }): Promise<any>;
    launchOrRelaunchAe(): Promise<boolean>;
    private runViaCli;
    rollback(): Promise<{
        success: boolean;
        rolledBackAction?: string;
        message: string;
    }>;
    getLastResult(commandId?: string): BridgeResult | undefined;
}
