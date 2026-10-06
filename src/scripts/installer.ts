import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { ConfigManager } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function findScriptUIPanelsDirs(): string[] {
  const dirs: string[] = [];

  if (process.platform === 'win32') {
    // 1. Check registry
    try {
      const regOutput = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\AfterFX.exe" /ve',
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
      );
      const match = regOutput.match(/REG_SZ\s+(.+)/);
      if (match && match[1]) {
        const supportFiles = path.dirname(match[1].trim());
        const panelsDir = path.join(supportFiles, 'Scripts', 'ScriptUI Panels');
        if (fs.existsSync(panelsDir) && !dirs.includes(panelsDir)) {
          dirs.push(panelsDir);
        }
      }
    } catch {
      // ignore
    }

    // 2. Check candidate paths
    const candidates = [
      'D:\\AE2026\\Adobe After Effects 2025\\Support Files\\Scripts\\ScriptUI Panels',
      'C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\Scripts\\ScriptUI Panels',
      'C:\\Program Files\\Adobe\\Adobe After Effects 2024\\Support Files\\Scripts\\ScriptUI Panels',
      'C:\\Program Files\\Adobe\\Adobe After Effects 2023\\Support Files\\Scripts\\ScriptUI Panels',
      'C:\\Program Files\\Adobe\\Adobe After Effects 2022\\Support Files\\Scripts\\ScriptUI Panels',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c) && !dirs.includes(c)) {
        dirs.push(c);
      }
    }
  } else if (process.platform === 'darwin') {
    const macCandidates = [
      '/Applications/Adobe After Effects 2025/Scripts/ScriptUI Panels',
      '/Applications/Adobe After Effects 2024/Scripts/ScriptUI Panels',
      '/Applications/Adobe After Effects 2023/Scripts/ScriptUI Panels',
    ];
    for (const c of macCandidates) {
      if (fs.existsSync(c) && !dirs.includes(c)) {
        dirs.push(c);
      }
    }
  }

  return dirs;
}

export function installBridgeScript(customTargetDir?: string): {
  success: boolean;
  installedPaths: string[];
  message: string;
} {
  const sourceScriptPath = path.resolve(__dirname, 'mcp-bridge-auto.jsx');
  const sourceFallbackPath = path.resolve(process.cwd(), 'src', 'scripts', 'mcp-bridge-auto.jsx');
  const actualSource = fs.existsSync(sourceScriptPath) ? sourceScriptPath : sourceFallbackPath;

  if (!fs.existsSync(actualSource)) {
    return {
      success: false,
      installedPaths: [],
      message: `Source script not found at ${actualSource}`,
    };
  }

  const targetDirs = customTargetDir ? [customTargetDir] : findScriptUIPanelsDirs();
  if (targetDirs.length === 0) {
    return {
      success: false,
      installedPaths: [],
      message:
        'No Adobe After Effects "ScriptUI Panels" directory found. Please specify target directory or copy src/scripts/mcp-bridge-auto.jsx manually.',
    };
  }

  const installedPaths: string[] = [];
  for (const dir of targetDirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const dest = path.join(dir, 'mcp-bridge-auto.jsx');
      fs.copyFileSync(actualSource, dest);
      installedPaths.push(dest);
    } catch (err: any) {
      console.error(`Failed to copy to ${dir}:`, err.message);
    }
  }

  return {
    success: installedPaths.length > 0,
    installedPaths,
    message:
      installedPaths.length > 0
        ? `Successfully installed bridge script to: ${installedPaths.join(', ')}`
        : 'Failed to copy bridge script to target directories.',
  };
}

// Allow CLI execution: `node dist/scripts/installer.js`
if (process.argv[1] && process.argv[1].endsWith('installer.js')) {
  console.log('Installing After Effects MCP Bridge...');
  const res = installBridgeScript();
  console.log(res.message);
  if (res.success) {
    console.log('\nNext steps:');
    console.log('1. Launch or switch to Adobe After Effects.');
    console.log('2. In After Effects, go to Window > mcp-bridge-auto.jsx.');
    console.log('3. Ensure "Auto-run commands" is checked.');
    console.log('4. Ensure Preferences > Scripting & Expressions > "Allow Scripts to Write Files and Access Network" is enabled.');
  }
}
