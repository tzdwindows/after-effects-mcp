/**
 * Returns a safe backup directory outside After Effects' scanning paths.
 * After Effects scans 'Scripts/ScriptUI Panels' and 'Scripts' at startup,
 * registering any script or backup file as a menu item in Window or File > Scripts.
 * By keeping backups in '~/.ae-mcp/backups', AE's main menu is never polluted.
 */
export declare function getSafeBackupDir(): string;
/**
 * Detects all installed Adobe After Effects 'ScriptUI Panels' directories.
 */
export declare function findScriptUIPanelsDirs(): string[];
/**
 * Checks if a filename is a backup or redundant copy of mcp-bridge-auto.
 * Any such file inside 'ScriptUI Panels' causes After Effects to register
 * extra items in the Window menu, resulting in massive clutter.
 */
export declare function isBackupOrDuplicateFile(filename: string): boolean;
/**
 * Scans ScriptUI Panels directories and removes any backup or redundant copies
 * of mcp-bridge-auto, moving them safely to ~/.ae-mcp/backups.
 * This directly cleans up the AE Window / Main menu clutter!
 */
export declare function cleanScriptUIPanelBackups(targetDirs?: string[]): {
    cleanedCount: number;
    cleanedFiles: string[];
    safeBackupDir: string;
};
/**
 * Finds the source mcp-bridge-auto.jsx file across various build and runtime paths.
 */
export declare function findSourceScriptPath(): string | null;
/**
 * Installs the mcp-bridge-auto.jsx script into After Effects ScriptUI Panels.
 * 1. Cleans up any existing backup files from ScriptUI Panels so AE menus stay clean.
 * 2. If an existing mcp-bridge-auto.jsx is present, backs it up to ~/.ae-mcp/backups (NEVER in ScriptUI Panels).
 * 3. Copies the latest mcp-bridge-auto.jsx into ScriptUI Panels.
 */
export declare function installBridgeScript(customTargetDir?: string): {
    success: boolean;
    installedPaths: string[];
    cleanedBackups: string[];
    safeBackupDir: string;
    message: string;
};
