import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * Returns a safe backup directory outside After Effects' scanning paths.
 * After Effects scans 'Scripts/ScriptUI Panels' and 'Scripts' at startup,
 * registering any script or backup file as a menu item in Window or File > Scripts.
 * By keeping backups in '~/.ae-mcp/backups', AE's main menu is never polluted.
 */
export function getSafeBackupDir() {
    const backupDir = path.join(os.homedir(), '.ae-mcp', 'backups');
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    return backupDir;
}
/**
 * Detects all installed Adobe After Effects 'ScriptUI Panels' directories.
 */
export function findScriptUIPanelsDirs() {
    const dirs = [];
    if (process.platform === 'win32') {
        // 1. Check registry for active AfterFX.exe
        try {
            const regOutput = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\AfterFX.exe" /ve', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
            const match = regOutput.match(/REG_SZ\s+(.+)/);
            if (match && match[1]) {
                const supportFiles = path.dirname(match[1].trim());
                const panelsDir = path.join(supportFiles, 'Scripts', 'ScriptUI Panels');
                if (fs.existsSync(panelsDir) && !dirs.includes(panelsDir)) {
                    dirs.push(panelsDir);
                }
            }
        }
        catch {
            // ignore
        }
        // 2. Comprehensive check of candidate paths across drives (C, D, E) & versions (2026, 2025, 2024, 2023, 2022)
        const drives = ['C', 'D', 'E'];
        const versions = ['2026', '2025', '2024', '2023', '2022'];
        const candidatePatterns = [
            'Program Files\\Adobe\\Adobe After Effects {ver}\\Support Files\\Scripts\\ScriptUI Panels',
            'AE{ver}\\Adobe After Effects {ver}\\Support Files\\Scripts\\ScriptUI Panels',
            'Adobe\\Adobe After Effects {ver}\\Support Files\\Scripts\\ScriptUI Panels',
        ];
        for (const drive of drives) {
            for (const ver of versions) {
                for (const pattern of candidatePatterns) {
                    const candidatePath = `${drive}:\\${pattern.replace(/\{ver\}/g, ver)}`;
                    if (fs.existsSync(candidatePath) && !dirs.includes(candidatePath)) {
                        dirs.push(candidatePath);
                    }
                }
            }
        }
    }
    else if (process.platform === 'darwin') {
        const macCandidates = [
            '/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels',
            '/Applications/Adobe After Effects 2025/Scripts/ScriptUI Panels',
            '/Applications/Adobe After Effects 2024/Scripts/ScriptUI Panels',
            '/Applications/Adobe After Effects 2023/Scripts/ScriptUI Panels',
            '/Applications/Adobe After Effects 2022/Scripts/ScriptUI Panels',
        ];
        for (const c of macCandidates) {
            if (fs.existsSync(c) && !dirs.includes(c)) {
                dirs.push(c);
            }
        }
    }
    return dirs;
}
/**
 * Checks if a filename is a backup or redundant copy of mcp-bridge-auto.
 * Any such file inside 'ScriptUI Panels' causes After Effects to register
 * extra items in the Window menu, resulting in massive clutter.
 */
export function isBackupOrDuplicateFile(filename) {
    // Never match the official canonical file
    if (filename.toLowerCase() === 'mcp-bridge-auto.jsx') {
        return false;
    }
    const lower = filename.toLowerCase();
    // Check if filename is related to mcp-bridge-auto
    if (lower.includes('mcp-bridge-auto') || lower.includes('mcp_bridge_auto') || lower.includes('mcpbridge')) {
        // Check common backup patterns: .bak, .old, .backup, 副本, copy, (1), etc.
        const backupKeywords = ['bak', 'backup', 'old', 'copy', '副本', '~', 'temp', 'tmp'];
        for (const kw of backupKeywords) {
            if (lower.includes(kw)) {
                return true;
            }
        }
        // Also match duplicates like "mcp-bridge-auto (1).jsx", "mcp-bridge-auto 2.jsx"
        if (/\(\d+\)|\s+\d+/.test(lower)) {
            return true;
        }
        // Any other variant of mcp-bridge-auto is a redundant copy
        return true;
    }
    // Also match generic stray backup files of jsx in panels
    if (lower.endsWith('.jsx.bak') || lower.endsWith('.bak') || lower.endsWith('.old')) {
        return true;
    }
    return false;
}
/**
 * Scans ScriptUI Panels directories and removes any backup or redundant copies
 * of mcp-bridge-auto, moving them safely to ~/.ae-mcp/backups.
 * This directly cleans up the AE Window / Main menu clutter!
 */
export function cleanScriptUIPanelBackups(targetDirs) {
    const dirs = targetDirs || findScriptUIPanelsDirs();
    const safeBackupDir = getSafeBackupDir();
    const cleanedFiles = [];
    for (const dir of dirs) {
        if (!fs.existsSync(dir))
            continue;
        try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                if (isBackupOrDuplicateFile(file)) {
                    const filePath = path.join(dir, file);
                    const stat = fs.statSync(filePath);
                    if (stat.isFile()) {
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const destBackup = path.join(safeBackupDir, `cleaned_${timestamp}_${file}`);
                        try {
                            fs.copyFileSync(filePath, destBackup);
                            fs.unlinkSync(filePath);
                            cleanedFiles.push(filePath);
                        }
                        catch (err) {
                            console.error(`Failed to remove backup file ${filePath}:`, err.message);
                        }
                    }
                }
            }
        }
        catch (err) {
            console.error(`Error reading directory ${dir}:`, err.message);
        }
    }
    return {
        cleanedCount: cleanedFiles.length,
        cleanedFiles,
        safeBackupDir,
    };
}
/**
 * Finds the source mcp-bridge-auto.jsx file across various build and runtime paths.
 */
export function findSourceScriptPath() {
    const candidates = [
        path.resolve(__dirname, 'mcp-bridge-auto.jsx'),
        path.resolve(__dirname, '..', '..', 'src', 'scripts', 'mcp-bridge-auto.jsx'),
        path.resolve(process.cwd(), 'src', 'scripts', 'mcp-bridge-auto.jsx'),
        path.resolve(process.cwd(), 'dist', 'scripts', 'mcp-bridge-auto.jsx'),
        path.resolve(process.cwd(), 'mcp-bridge-auto.jsx'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) {
            return c;
        }
    }
    return null;
}
/**
 * Installs the mcp-bridge-auto.jsx script into After Effects ScriptUI Panels.
 * 1. Cleans up any existing backup files from ScriptUI Panels so AE menus stay clean.
 * 2. If an existing mcp-bridge-auto.jsx is present, backs it up to ~/.ae-mcp/backups (NEVER in ScriptUI Panels).
 * 3. Copies the latest mcp-bridge-auto.jsx into ScriptUI Panels.
 */
export function installBridgeScript(customTargetDir) {
    const actualSource = findSourceScriptPath();
    if (!actualSource) {
        return {
            success: false,
            installedPaths: [],
            cleanedBackups: [],
            safeBackupDir: getSafeBackupDir(),
            message: `Source script 'mcp-bridge-auto.jsx' not found. Please ensure it is present in 'dist/scripts/', 'src/scripts/', or project root.`,
        };
    }
    const targetDirs = customTargetDir ? [customTargetDir] : findScriptUIPanelsDirs();
    if (targetDirs.length === 0) {
        return {
            success: false,
            installedPaths: [],
            cleanedBackups: [],
            safeBackupDir: getSafeBackupDir(),
            message: 'No Adobe After Effects "ScriptUI Panels" directory found. Please specify target directory or copy mcp-bridge-auto.jsx manually.',
        };
    }
    // Step 1: Clean up any old backups from ScriptUI Panels to prevent AE menu clutter
    const cleanResult = cleanScriptUIPanelBackups(targetDirs);
    const safeBackupDir = cleanResult.safeBackupDir;
    const installedPaths = [];
    for (const dir of targetDirs) {
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const dest = path.join(dir, 'mcp-bridge-auto.jsx');
            // Step 2: If existing file is present and differs, save backup to ~/.ae-mcp/backups/ ONLY
            if (fs.existsSync(dest)) {
                try {
                    const existingContent = fs.readFileSync(dest, 'utf-8');
                    const newContent = fs.readFileSync(actualSource, 'utf-8');
                    if (existingContent !== newContent) {
                        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                        const safeBackupPath = path.join(safeBackupDir, `mcp-bridge-auto_pre_update_${timestamp}.jsx`);
                        fs.copyFileSync(dest, safeBackupPath);
                    }
                }
                catch {
                    // ignore backup read failure
                }
            }
            // Step 3: Copy new file
            fs.copyFileSync(actualSource, dest);
            installedPaths.push(dest);
        }
        catch (err) {
            console.error(`Failed to copy to ${dir}:`, err.message);
        }
    }
    const cleanedMsg = cleanResult.cleanedCount > 0
        ? `\nCleaned ${cleanResult.cleanedCount} old backup file(s) from AE menus (moved to ${safeBackupDir})`
        : '';
    return {
        success: installedPaths.length > 0,
        installedPaths,
        cleanedBackups: cleanResult.cleanedFiles,
        safeBackupDir,
        message: installedPaths.length > 0
            ? `Successfully installed bridge script to: ${installedPaths.join(', ')}${cleanedMsg}`
            : 'Failed to copy bridge script to target directories.',
    };
}
// Allow CLI execution: `node dist/scripts/installer.js` or `npm run install-bridge`
if (process.argv[1] && (process.argv[1].endsWith('installer.js') || process.argv[1].endsWith('installer.ts'))) {
    const isCleanOnly = process.argv.includes('--clean') || process.argv.includes('--clean-backups');
    if (isCleanOnly) {
        console.log('Cleaning backup files from After Effects ScriptUI Panels...');
        const cleanRes = cleanScriptUIPanelBackups();
        console.log(`Cleaned ${cleanRes.cleanedCount} backup file(s).`);
        if (cleanRes.cleanedFiles.length > 0) {
            console.log('Moved to safe backup folder:', cleanRes.safeBackupDir);
            cleanRes.cleanedFiles.forEach(f => console.log(' - ' + f));
        }
    }
    else {
        console.log('Installing After Effects MCP Bridge (with Automatic Menu Backup Cleanup)...');
        const res = installBridgeScript();
        console.log(res.message);
        if (res.success) {
            console.log('\nNext steps:');
            console.log('1. Launch or switch to Adobe After Effects.');
            console.log('2. In After Effects, go to Window > mcp-bridge-auto.jsx (No duplicate menu clutter!).');
            console.log('3. Ensure "Auto-run commands" is checked.');
            console.log('4. Ensure Preferences > Scripting & Expressions > "Allow Scripts to Write Files and Access Network" is enabled.');
        }
    }
}
