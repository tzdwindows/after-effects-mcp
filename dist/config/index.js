import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
const HOME_DIR = os.homedir();
const DEFAULT_BRIDGE_DIR = path.join(HOME_DIR, '.ae-mcp');
const CONFIG_FILE = path.join(DEFAULT_BRIDGE_DIR, 'config.json');
const DEFAULT_SETTINGS = {
    autoSave: true,
    autoRecordHistory: true,
    saveMode: 'project',
    maxHistory: 30,
    timeoutMs: 15000,
    bridgeDir: DEFAULT_BRIDGE_DIR,
};
export function detectAfterFXExecutable() {
    if (process.platform === 'win32') {
        try {
            const regOutput = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\AfterFX.exe" /ve', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
            const match = regOutput.match(/REG_SZ\s+(.+)/);
            if (match && match[1] && fs.existsSync(match[1].trim())) {
                return match[1].trim();
            }
        }
        catch {
            // ignore
        }
        const commonPaths = [
            'D:\\AE2026\\Adobe After Effects 2025\\Support Files\\AfterFX.exe',
            'C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\AfterFX.exe',
            'C:\\Program Files\\Adobe\\Adobe After Effects 2024\\Support Files\\AfterFX.exe',
            'C:\\Program Files\\Adobe\\Adobe After Effects 2023\\Support Files\\AfterFX.exe',
            'C:\\Program Files\\Adobe\\Adobe After Effects 2022\\Support Files\\AfterFX.exe',
        ];
        for (const p of commonPaths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
    }
    else if (process.platform === 'darwin') {
        const macPaths = [
            '/Applications/Adobe After Effects 2025/Adobe After Effects 2025.app/Contents/MacOS/After Effects',
            '/Applications/Adobe After Effects 2024/Adobe After Effects 2024.app/Contents/MacOS/After Effects',
            '/Applications/Adobe After Effects 2023/Adobe After Effects 2023.app/Contents/MacOS/After Effects',
        ];
        for (const p of macPaths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
    }
    return undefined;
}
export class ConfigManager {
    static instance;
    settings;
    constructor() {
        this.ensureDirs();
        this.settings = this.loadSettings();
    }
    static getInstance() {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }
    ensureDirs() {
        if (!fs.existsSync(DEFAULT_BRIDGE_DIR)) {
            fs.mkdirSync(DEFAULT_BRIDGE_DIR, { recursive: true });
        }
        const snapshotsDir = path.join(DEFAULT_BRIDGE_DIR, 'snapshots');
        if (!fs.existsSync(snapshotsDir)) {
            fs.mkdirSync(snapshotsDir, { recursive: true });
        }
    }
    loadSettings() {
        let settings = { ...DEFAULT_SETTINGS };
        if (fs.existsSync(CONFIG_FILE)) {
            try {
                const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
                const parsed = JSON.parse(raw);
                settings = { ...settings, ...parsed };
            }
            catch (err) {
                console.error('Failed to parse config file, using defaults', err);
            }
        }
        if (!settings.aeExecutablePath) {
            settings.aeExecutablePath = detectAfterFXExecutable();
        }
        return settings;
    }
    getSettings() {
        return { ...this.settings };
    }
    updateSettings(partial) {
        this.settings = { ...this.settings, ...partial };
        try {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.settings, null, 2), 'utf-8');
        }
        catch (err) {
            console.error('Failed to save config file', err);
        }
        return this.getSettings();
    }
}
