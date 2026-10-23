import { MCPSettings } from '../types/index.js';
export declare function detectAfterFXExecutable(): string | undefined;
export declare class ConfigManager {
    private static instance;
    private settings;
    private constructor();
    static getInstance(): ConfigManager;
    private ensureDirs;
    private loadSettings;
    getSettings(): MCPSettings;
    updateSettings(partial: Partial<MCPSettings>): MCPSettings;
}
