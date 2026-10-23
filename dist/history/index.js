import fs from 'fs';
import path from 'path';
import { ConfigManager } from '../config/index.js';
export class HistoryManager {
    static instance;
    historyFilePath;
    snapshotsDir;
    constructor() {
        const config = ConfigManager.getInstance().getSettings();
        this.historyFilePath = path.join(config.bridgeDir, 'history.json');
        this.snapshotsDir = path.join(config.bridgeDir, 'snapshots');
        this.ensureDirs();
    }
    static getInstance() {
        if (!HistoryManager.instance) {
            HistoryManager.instance = new HistoryManager();
        }
        return HistoryManager.instance;
    }
    ensureDirs() {
        const dir = path.dirname(this.historyFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(this.snapshotsDir)) {
            fs.mkdirSync(this.snapshotsDir, { recursive: true });
        }
    }
    getEntries() {
        if (!fs.existsSync(this.historyFilePath)) {
            return [];
        }
        try {
            const data = fs.readFileSync(this.historyFilePath, 'utf-8');
            return JSON.parse(data);
        }
        catch {
            return [];
        }
    }
    record(entry) {
        const config = ConfigManager.getInstance().getSettings();
        if (!config.autoRecordHistory) {
            return {
                id: 'rec-' + Date.now(),
                timestamp: new Date().toISOString(),
                ...entry,
            };
        }
        const fullEntry = {
            id: 'rec-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
            timestamp: new Date().toISOString(),
            ...entry,
        };
        let entries = this.getEntries();
        entries.unshift(fullEntry);
        // Limit history entries
        if (entries.length > config.maxHistory) {
            const removed = entries.slice(config.maxHistory);
            entries = entries.slice(0, config.maxHistory);
            // Clean up snapshot files of removed entries
            for (const item of removed) {
                if (item.snapshotFile && fs.existsSync(item.snapshotFile)) {
                    try {
                        fs.unlinkSync(item.snapshotFile);
                    }
                    catch {
                        // ignore
                    }
                }
            }
        }
        try {
            fs.writeFileSync(this.historyFilePath, JSON.stringify(entries, null, 2), 'utf-8');
        }
        catch (err) {
            console.error('Failed to write history file', err);
        }
        return fullEntry;
    }
    markRolledBack(id) {
        const entries = this.getEntries();
        const entry = entries.find((e) => e.id === id);
        if (entry) {
            entry.rolledBack = true;
            try {
                fs.writeFileSync(this.historyFilePath, JSON.stringify(entries, null, 2), 'utf-8');
            }
            catch (err) {
                console.error('Failed to update history file', err);
            }
        }
    }
    getLastAction() {
        const entries = this.getEntries();
        return entries.find((e) => !e.rolledBack && e.success);
    }
    getSnapshotsDir() {
        return this.snapshotsDir;
    }
}
