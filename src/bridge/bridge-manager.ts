import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { BridgeCommand, BridgeResult, HeartbeatInfo } from '../types/index.js';
import { ConfigManager } from '../config/index.js';
import { HistoryManager } from '../history/index.js';

const execAsync = promisify(exec);

export class BridgeManager {
  private static instance: BridgeManager;
  private cmdFile: string;
  private resFile: string;
  private heartbeatFile: string;
  private lastExecutedResults: Map<string, BridgeResult> = new Map();

  private constructor() {
    const config = ConfigManager.getInstance().getSettings();
    this.cmdFile = path.join(config.bridgeDir, 'commands.json');
    this.resFile = path.join(config.bridgeDir, 'results.json');
    this.heartbeatFile = path.join(config.bridgeDir, 'heartbeat.json');
    this.ensureFiles();
  }

  public static getInstance(): BridgeManager {
    if (!BridgeManager.instance) {
      BridgeManager.instance = new BridgeManager();
    }
    return BridgeManager.instance;
  }

  private ensureFiles(): void {
    const dir = path.dirname(this.cmdFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  public getBridgeStatus(): {
    connected: boolean;
    heartbeat?: HeartbeatInfo;
    message: string;
  } {
    if (!fs.existsSync(this.heartbeatFile)) {
      return {
        connected: false,
        message: 'No heartbeat found. Make sure Adobe After Effects is running and Window > mcp-bridge-auto.jsx is opened.',
      };
    }

    try {
      const raw = fs.readFileSync(this.heartbeatFile, 'utf-8');
      const info: HeartbeatInfo = JSON.parse(raw);
      const now = Date.now();
      const diffSec = (now - info.timestamp) / 1000;
      const isAlive = diffSec < 15; // Within 15 seconds

      return {
        connected: isAlive,
        heartbeat: info,
        message: isAlive
          ? `Connected to AE ${info.aeVersion || ''} (Project: ${info.activeProject || 'None'})`
          : `Last active ${Math.round(diffSec)}s ago. Bridge panel might be idle or closed.`,
      };
    } catch {
      return {
        connected: false,
        message: 'Failed to read heartbeat file.',
      };
    }
  }

  public async execute(
    action: string,
    script: string,
    description: string,
    params?: any,
    options?: { timeoutMs?: number; skipAutoSave?: boolean }
  ): Promise<any> {
    const config = ConfigManager.getInstance().getSettings();
    const commandId = 'cmd-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    const timeout = options?.timeoutMs || config.timeoutMs;
    const historyManager = HistoryManager.getInstance();

    const snapshotFile = config.autoSave && !options?.skipAutoSave
      ? path.join(historyManager.getSnapshotsDir(), `snapshot_${Date.now()}.aep`)
      : undefined;

    const command: BridgeCommand = {
      id: commandId,
      action,
      timestamp: Date.now(),
      script,
      autoSave: config.autoSave && !options?.skipAutoSave,
      saveMode: config.saveMode,
      undoGroupName: `MCP: ${action}`,
      snapshotPath: snapshotFile,
    };

    // Write command file for the AE bridge panel
    fs.writeFileSync(this.cmdFile, JSON.stringify(command, null, 2), 'utf-8');

    // Poll for results
    const startTime = Date.now();
    let pollInterval = 80;
    let fallbackAttempted = false;

    while (Date.now() - startTime < timeout) {
      if (fs.existsSync(this.resFile)) {
        try {
          const raw = fs.readFileSync(this.resFile, 'utf-8');
          const res: BridgeResult = JSON.parse(raw);
          if (res.id === commandId) {
            this.lastExecutedResults.set(commandId, res);

            // Record history
            historyManager.record({
              action,
              description,
              params,
              snapshotFile: res.snapshotPath || (res.saved ? res.savedPath : undefined),
              success: res.success,
            });

            if (!res.success) {
              throw new Error(res.error || `Command ${action} failed in After Effects.`);
            }

            return {
              success: true,
              action,
              data: res.data,
              autoSaved: res.saved,
              savedPath: res.savedPath,
              snapshotPath: res.snapshotPath,
            };
          }
        } catch (readErr: any) {
          if (readErr.message.includes('failed in After Effects')) {
            throw readErr;
          }
          // File might be mid-write, retry next cycle
        }
      }

      // Auto recovery: check if AE crashed or not connected
      const status = this.getBridgeStatus();
      if (!status.connected && !fallbackAttempted && config.aeExecutablePath && fs.existsSync(config.aeExecutablePath)) {
        fallbackAttempted = true;
        console.error(`[AE Bridge] Detected After Effects disconnection/crash. Auto-relaunching AE via: ${config.aeExecutablePath}...`);
        try {
          await this.launchOrRelaunchAe();
        } catch (relaunchErr) {
          console.error('[AE Bridge] Failed to relaunch AE:', relaunchErr);
        }
      }

      await new Promise((r) => setTimeout(r, pollInterval));
    }

    // Timed out
    const timeoutMsg =
      `Command '${action}' timed out after ${timeout}ms. ` +
      `Please ensure Adobe After Effects is running and the bridge panel is open (Window > mcp-bridge-auto.jsx) with "Auto-run commands" enabled.`;

    historyManager.record({
      action,
      description: description + ' (Timed out)',
      params,
      success: false,
    });

    throw new Error(timeoutMsg);
  }

  public async launchOrRelaunchAe(): Promise<boolean> {
    const config = ConfigManager.getInstance().getSettings();
    if (!config.aeExecutablePath || !fs.existsSync(config.aeExecutablePath)) {
      return false;
    }

    try {
      // First clean up any Adobe Crash Processor or stuck processes
      try {
        await execAsync('taskkill /F /IM "Adobe Crash Processor.exe"');
      } catch {}

      // Check if AfterFX is running
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq AfterFX.exe"');
      if (stdout.includes('AfterFX.exe')) {
        // Process is alive but not sending heartbeat, don't double launch
        return true;
      }

      console.error(`[AE Bridge] Launching After Effects at ${config.aeExecutablePath}...`);
      const launchCmd = `start "" "${config.aeExecutablePath}"`;
      await execAsync(launchCmd, { shell: 'cmd.exe' });
      return true;
    } catch (err) {
      console.error('[AE Bridge] Failed to launch AE executable:', err);
      return false;
    }
  }

  private async runViaCli(command: BridgeCommand): Promise<void> {
    const config = ConfigManager.getInstance().getSettings();
    if (!config.aeExecutablePath || !fs.existsSync(config.aeExecutablePath)) {
      return;
    }

    const tempScriptPath = path.join(config.bridgeDir, `temp_exec_${command.id}.jsx`);
    const escapedScript = command.script;

    const wrapperJsx = `
      #target aftereffects
      (function() {
        var JSON = JSON || {};
        // Embed minimal serializer
        JSON.stringify = function(o) {
          if (o === null) return "null";
          if (typeof o === "undefined") return "undefined";
          if (typeof o === "number" || typeof o === "boolean") return String(o);
          if (typeof o === "string") return '"' + o.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"') + '"';
          if (o instanceof Array) {
            var arr = [];
            for (var i = 0; i < o.length; i++) arr.push(JSON.stringify(o[i]));
            return "[" + arr.join(",") + "]";
          }
          var props = [];
          for (var k in o) {
            if (o.hasOwnProperty(k)) props.push('"' + k + '":' + JSON.stringify(o[k]));
          }
          return "{" + props.join(",") + "}";
        };

        var result = { id: ${JSON.stringify(command.id)}, timestamp: new Date().getTime(), success: false };
        try {
          app.beginUndoGroup(${JSON.stringify(command.undoGroupName || 'MCP Command')});
          result.data = ${escapedScript};
          app.endUndoGroup();
          result.success = true;
          ${command.autoSave ? 'if (app.project.file) { app.project.save(); result.saved = true; result.savedPath = app.project.file.fsName; }' : ''}
        } catch(e) {
          try { app.endUndoGroup(); } catch(ue){}
          result.error = e.toString();
        }

        var resFile = new File(${JSON.stringify(this.resFile.replace(/\\/g, '/'))});
        resFile.open("w");
        resFile.encoding = "UTF-8";
        resFile.write(JSON.stringify(result));
        resFile.close();
      })();
    `;

    fs.writeFileSync(tempScriptPath, wrapperJsx, 'utf-8');

    // Run AfterFX.exe -r
    const cliCmd = `"${config.aeExecutablePath}" -r "${tempScriptPath}"`;
    try {
      await execAsync(cliCmd, { timeout: 15000 });
    } catch {
      // Ignored - AfterFX -r triggers execution in AE
    } finally {
      setTimeout(() => {
        try {
          if (fs.existsSync(tempScriptPath)) fs.unlinkSync(tempScriptPath);
        } catch {}
      }, 5000);
    }
  }

  public async rollback(): Promise<{
    success: boolean;
    rolledBackAction?: string;
    message: string;
  }> {
    const historyManager = HistoryManager.getInstance();
    const lastAction = historyManager.getLastAction();

    if (!lastAction) {
      return {
        success: false,
        message: 'No rollbackable actions found in history log.',
      };
    }

    const undoScript = `(function() {
      try {
        var undoCmd = app.findMenuCommandId("Undo");
        if (undoCmd && undoCmd !== 0) {
          app.executeCommand(undoCmd);
        } else {
          app.executeCommand(16);
        }
        return { success: true, message: "Undone last action in AE" };
      } catch(e) {
        return { success: false, error: e.toString() };
      }
    })()`;

    try {
      const res = await this.execute(
        'rollback',
        undoScript,
        `Rollback action: ${lastAction.action} (${lastAction.id})`,
        { targetActionId: lastAction.id },
        { skipAutoSave: true }
      );

      historyManager.markRolledBack(lastAction.id);

      return {
        success: true,
        rolledBackAction: lastAction.action,
        message: `Successfully rolled back action '${lastAction.action}' (ID: ${lastAction.id}).`,
      };
    } catch (err: any) {
      return {
        success: false,
        rolledBackAction: lastAction.action,
        message: `Rollback failed: ${err.message}`,
      };
    }
  }

  public getLastResult(commandId?: string): BridgeResult | undefined {
    if (commandId) {
      return this.lastExecutedResults.get(commandId);
    }
    if (fs.existsSync(this.resFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.resFile, 'utf-8'));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
