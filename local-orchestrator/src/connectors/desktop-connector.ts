/**
 * Desktop Control Connector
 * Allows the AI to execute commands, open apps, read/write files on the user's desktop
 * This is the "hands" of the agent on the local machine
 */
import { execSync } from "child_process";
import fs from "fs/promises";
import path from "path";
import type { IConnector, ConnectorResult, ConnectorScope } from "./base-connector.js";

export class DesktopConnector implements IConnector {
  readonly id = "desktop";
  readonly name = "Desktop Control";
  readonly type = "desktop";

  private scope: ConnectorScope;

  constructor(basePath?: string) {
    this.scope = { basePath: basePath || process.cwd() };
  }

  async isAvailable(): Promise<boolean> { return true; }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  getScope(): ConnectorScope { return this.scope; }

  // ── Tier 1: Read-only ──────────────────────────────────────

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
      const stat = await fs.stat(path.join(this.scope.basePath, filePath));
      return { success: true, data: { size: stat.size, isDirectory: stat.isDirectory(), modified: stat.mtime }, tier: 1, requiresApproval: false, connectorId: this.id };
    } catch (e: any) {
      return { success: false, error: e.message, tier: 1, requiresApproval: false, connectorId: this.id };
    }
  }

  // ── Tier 2: Reversible writes ──────────────────────────────

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
      if (!content.includes(oldContent)) {
        return { success: false, error: "Old content not found in file", tier: 2, requiresApproval: false, connectorId: this.id };
      }
      await fs.writeFile(fullPath, content.replace(oldContent, newContent));
      return { success: true, tier: 2, requiresApproval: false, connectorId: this.id };
    } catch (e: any) {
      return { success: false, error: e.message, tier: 2, requiresApproval: false, connectorId: this.id };
    }
  }

  // ── Desktop Control: Execute Commands ──────────────────────

  async executeCommand(command: string): Promise<ConnectorResult> {
    try {
      const isWindows = process.platform === "win32";
      const output = isWindows
        ? execSync(`cmd /c ${command}`, { encoding: "utf-8", timeout: 30000 })
        : execSync(command, { encoding: "utf-8", timeout: 30000 });
      return { success: true, data: { output }, tier: 2, requiresApproval: false, connectorId: this.id };
    } catch (e: any) {
      return { success: false, error: e.message, tier: 2, requiresApproval: false, connectorId: this.id };
    }
  }

  async openApplication(appName: string): Promise<ConnectorResult> {
    try {
      const isWindows = process.platform === "win32";
      const isMac = process.platform === "darwin";
      if (isWindows) {
        execSync(`cmd /c start "" "${appName}"`, { timeout: 5000 });
      } else if (isMac) {
        execSync(`open -a "${appName}"`, { timeout: 5000 });
      } else {
        execSync(`xdg-open "${appName}"`, { timeout: 5000 });
      }
      return { success: true, data: { opened: appName }, tier: 2, requiresApproval: false, connectorId: this.id };
    } catch (e: any) {
      return { success: false, error: e.message, tier: 2, requiresApproval: false, connectorId: this.id };
    }
  }

  async openFile(filePath: string): Promise<ConnectorResult> {
    try {
      const isWindows = process.platform === "win32";
      const fullPath = path.join(this.scope.basePath, filePath);
      if (isWindows) {
        execSync(`cmd /c start "" "${fullPath}"`, { timeout: 5000 });
      } else if (process.platform === "darwin") {
        execSync(`open "${fullPath}"`, { timeout: 5000 });
      } else {
        execSync(`xdg-open "${fullPath}"`, { timeout: 5000 });
      }
      return { success: true, data: { opened: fullPath }, tier: 2, requiresApproval: false, connectorId: this.id };
    } catch (e: any) {
      return { success: false, error: e.message, tier: 2, requiresApproval: false, connectorId: this.id };
    }
  }
}
