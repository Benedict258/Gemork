import { BaseConnector, type ConnectorConfig, type ConnectorResult } from "../base-connector.js";
import fs from "fs/promises";
import path from "path";

export class FilesystemConnector extends BaseConnector {
  private basePath: string;

  constructor(config: ConnectorConfig, basePath: string) {
    super(config);
    this.basePath = basePath;
  }

  async read(filePath: string): Promise<ConnectorResult> {
    try {
      const fullPath = path.join(this.basePath, filePath);
      const content = await fs.readFile(fullPath, "utf-8");
      return { success: true, data: content, connectorId: this.config.id };
    } catch (e: any) {
      return { success: false, error: e.message, connectorId: this.config.id };
    }
  }

  async write(filePath: string, content: unknown): Promise<ConnectorResult> {
    try {
      const fullPath = path.join(this.basePath, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, String(content), "utf-8");
      return { success: true, connectorId: this.config.id };
    } catch (e: any) {
      return { success: false, error: e.message, connectorId: this.config.id };
    }
  }

  async list(dirPath?: string): Promise<ConnectorResult> {
    try {
      const fullPath = path.join(this.basePath, dirPath || "");
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const items = entries.map((e) => ({
        name: e.name,
        isDirectory: e.isDirectory(),
      }));
      return { success: true, data: items, connectorId: this.config.id };
    } catch (e: any) {
      return { success: false, error: e.message, connectorId: this.config.id };
    }
  }
}
