import { HistoryEntry } from '../types/index.js';
export declare class HistoryManager {
    private static instance;
    private historyFilePath;
    private snapshotsDir;
    private constructor();
    static getInstance(): HistoryManager;
    private ensureDirs;
    getEntries(): HistoryEntry[];
    record(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): HistoryEntry;
    markRolledBack(id: string): void;
    getLastAction(): HistoryEntry | undefined;
    getSnapshotsDir(): string;
}
