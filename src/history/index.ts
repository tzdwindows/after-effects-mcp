import fs from 'fs';
import path from 'path';
import { HistoryEntry } from '../types/index.js';
import { ConfigManager } from '../config/index.js';

export class HistoryManager {
  private static instance: HistoryManager;
  private historyFilePath: string;
  private snapshotsDir: string;

  private constructor() {
    const config = ConfigManager.getInstance().getSettings();
    this.historyFilePath = path.join(config.bridgeDir, 'history.json');
    this.snapshotsDir = path.join(config.bridgeDir, 'snapshots');
    this.ensureDirs();
  }

  public static getInstance(): HistoryManager {
    if (!HistoryManager.instance) {
      HistoryManager.instance = new HistoryManager();
    }
    return HistoryManager.instance;
  }

  private ensureDirs(): void {
    const dir = path.dirname(this.historyFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.snapshotsDir)) {
      fs.mkdirSync(this.snapshotsDir, { recursive: true });
    }
  }

  public getEntries(): HistoryEntry[] {
    if (!fs.existsSync(this.historyFilePath)) {
      return [];
    }
    try {
      const data = fs.readFileSync(this.historyFilePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  public record(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): HistoryEntry {
    const config = ConfigManager.getInstance().getSettings();
    if (!config.autoRecordHistory) {
      return {
        id: 'rec-' + Date.now(),
        timestamp: new Date().toISOString(),
        ...entry,
      };
    }

    const fullEntry: HistoryEntry = {
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
          } catch {
            // ignore
          }
        }
      }
    }

    try {
      fs.writeFileSync(this.historyFilePath, JSON.stringify(entries, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to write history file', err);
    }

    return fullEntry;
  }

  public markRolledBack(id: string): void {
    const entries = this.getEntries();
    const entry = entries.find((e) => e.id === id);
    if (entry) {
      entry.rolledBack = true;
      try {
        fs.writeFileSync(this.historyFilePath, JSON.stringify(entries, null, 2), 'utf-8');
      } catch (err) {
        console.error('Failed to update history file', err);
      }
    }
  }

  public getLastAction(): HistoryEntry | undefined {
    const entries = this.getEntries();
    return entries.find((e) => !e.rolledBack && e.success);
  }

  public getSnapshotsDir(): string {
    return this.snapshotsDir;
  }
}
