/**
 * Desktop Control Connector
 * Uses persistent shell for stateful command execution
 * Agent can control the user's desktop: open apps, run commands, read/write files
 */
import fs from "fs/promises";
import path from "path";
import { PersistentShell } from "../shell/persistent-shell.js";
import type { IConnector, ConnectorResult, ConnectorScope } from "./base-connector.js";

let sharedShell: PersistentShell | null = null;

async function getShell(): Promise<PersistentShell> {
  if (!sharedShell || !sharedShell.isReady()) {
    sharedShell = new PersistentShell();
    await sharedShell.start();
  }
  return sharedShell;
}

export class DesktopConnector implements IConnector {
  readonly id = "desktop";
  readonly name = "Desktop Control";
  readonly type = "desktop";
  private scope: ConnectorScope;

  constructor(basePath?: string) {
    this.scope = { basePath: basePath || process.env.USERPROFILE || process.env.HOME || "." };
  }

  async isAvailable(): Promise<boolean> { return true; }
  async connect(): Promise<void> { await getShell(); }
  async disconnect(): Promise<void> { sharedShell?.stop(); sharedShell = null; }
  getScope(): ConnectorScope { return this.scope; }

  // ── Shell Execution (Tier 2) ──────────────────────────────

  async executeCommand(command: string): Promise<ConnectorResult> {
    try {
      const shell = await getShell();
      const result = await shell.execute(command);
      return {
        success: result.exitCode === 0,
        data: { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
        tier: 2,
        requiresApproval: false,
        connectorId: this.id,
      };
    } catch (e: any) {
      return { success: false, error: e.message, tier: 2, requiresApproval: false, connectorId: this.id };
    }
  }

  async openApplication(appName: string): Promise<ConnectorResult> {
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? `Start-Process "${appName}"` : `open -a "${appName}"`;
    return this.executeCommand(cmd);
  }

  async openFile(filePath: string): Promise<ConnectorResult> {
    const fullPath = path.resolve(this.scope.basePath, filePath);
    const isWindows = process.platform === "win32";
    const cmd = isWindows ? `Start-Process "${fullPath}"` : `open "${fullPath}"`;
    return this.executeCommand(cmd);
  }

  // ── File Operations (Tier 1/2) ────────────────────────────

  async read(filePath: string): Promise<ConnectorResult> {
    try {
      const content = await fs.readFile(path.join(this.scope.basePath, filePath), "utf-8");
      return { success: true, data: content, tier: 1, requiresApproval: false, connectorId: this.id };
    } catch (e: any) {
      return { success: false, error: e.message, tier: 1, requiresApproval: false, connectorId: this.id };
    }
  }

  async list(dirPath?: string): Promise<ConnectorResult> {
    try {
      const entries = await fs.readdir(path.join(this.scope.basePath, dirPath || ""), { withFileTypes: true });
      const items = entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() }));
      return { success: true, data: items, tier: 1, requiresApproval: false, connectorId: this.id };
    } catch (e: any) {
      return { success: false, error: e.message, tier: 1, requiresApproval: false, connectorId: this.id };
    }
  }

  async stat(filePath: string): Promise<ConnectorResult> {
    try {
      const s = await fs.stat(path.join(this.scope.basePath, filePath));
      return { success: true, data: { size: s.size, isDir: s.isDirectory(), modified: s.mtime }, tier: 1, requiresApproval: false, connectorId: this.id };
    } catch (e: any) {
      return { success: false, error: e.message, tier: 1, requiresApproval: false, connectorId: this.id };
    }
  }

  async write(filePath: string, content: string | Buffer): Promise<ConnectorResult> {
    try {
      const fullPath = path.join(this.scope.basePath, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);
      return { success: true, tier: 2, requiresApproval: false, connectorId: this.id };
    } catch (e: any) {
      return { success: false, error: e.message, tier: 2, requiresApproval: false, connectorId: this.id };
    }
  }

  async edit(filePath: string, oldContent: string, newContent: string): Promise<ConnectorResult> {
    try {
      const fullPath = path.join(this.scope.basePath, filePath);
      const content = await fs.readFile(fullPath, "utf-8");
      if (!content.includes(oldContent)) return { success: false, error: "Old content not found", tier: 2, requiresApproval: false, connectorId: this.id };
      await fs.writeFile(fullPath, content.replace(oldContent, newContent));
      return { success: true, tier: 2, requiresApproval: false, connectorId: this.id };
    } catch (e: any) {
      return { success: false, error: e.message, tier: 2, requiresApproval: false, connectorId: this.id };
    }
  }
}
