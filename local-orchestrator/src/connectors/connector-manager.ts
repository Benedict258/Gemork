import type { IConnector } from "./base-connector.js";
import { GoogleDriveConnector } from "./google-drive-connector.js";
import { SlackConnector } from "./slack-connector.js";
import { NotionConnector } from "./notion-connector.js";
import { FilesystemConnector } from "./filesystem-connector.js";
import { loadConnectorConfigs, validateRequiredEnvVars } from "./connector-config.js";
import { SnapshotService } from "../storage/snapshot-service.js";

interface ConnectorRegistration {
  connector: IConnector;
  approved: boolean;
  connectedAt?: Date;
}

export class ConnectorManager {
  private registry = new Map<string, ConnectorRegistration>();
  private sessionApproved = new Set<string>();

  registerConnector(connector: IConnector): void {
    if (this.registry.has(connector.id)) {
      throw new Error(`Connector '${connector.id}' is already registered`);
    }
    this.registry.set(connector.id, {
      connector,
      approved: false,
    });
  }

  unregisterConnector(id: string): void {
    this.registry.delete(id);
    this.sessionApproved.delete(id);
  }

  getConnector(id: string): IConnector | undefined {
    return this.registry.get(id)?.connector;
  }

  listConnectors(): IConnector[] {
    return Array.from(this.registry.values()).map((r) => r.connector);
  }

  async connectAll(): Promise<void> {
    for (const reg of this.registry.values()) {
      if (!reg.connectedAt) {
        await reg.connector.connect();
        reg.connectedAt = new Date();
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const reg of this.registry.values()) {
      if (reg.connectedAt) {
        await reg.connector.disconnect();
        reg.connectedAt = undefined;
      }
    }
  }

  isConnectorApproved(connectorId: string): boolean {
    const reg = this.registry.get(connectorId);
    if (!reg) return false;
    return reg.approved || this.sessionApproved.has(connectorId);
  }

  approveConnector(connectorId: string): void {
    const reg = this.registry.get(connectorId);
    if (!reg) {
      throw new Error(`Connector '${connectorId}' is not registered`);
    }
    reg.approved = true;
    this.sessionApproved.add(connectorId);
  }

  resetSessionApprovals(): void {
    this.sessionApproved.clear();
    for (const reg of this.registry.values()) {
      reg.approved = false;
    }
  }

  hasConnector(id: string): boolean {
    return this.registry.has(id);
  }

  async autoRegisterFromEnv(projectId: string): Promise<string[]> {
    const errors = validateRequiredEnvVars();
    if (errors.length > 0) {
      for (const err of errors) {
        console.warn(`[ConnectorManager] Config warning: ${err}`);
      }
    }

    const configs = loadConnectorConfigs();
    const snapshotService = new SnapshotService();
    const registered: string[] = [];

    if (configs.filesystem.enabled && configs.filesystem.scope.basePath) {
      try {
        const connector = new FilesystemConnector({
          basePath: configs.filesystem.scope.basePath,
          projectId,
          snapshotService,
        });
        this.registerConnector(connector);
        registered.push("filesystem");
      } catch (err) {
        console.warn(`[ConnectorManager] Skipping filesystem: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (configs.googleDrive.enabled) {
      try {
        const connector = new GoogleDriveConnector({
          apiKey: configs.googleDrive.auth.apiKey,
          serviceAccountKey: configs.googleDrive.auth.serviceAccountKey,
          folderId: configs.googleDrive.scope.folderId,
          projectId,
          snapshotService,
        });
        this.registerConnector(connector);
        registered.push("google-drive");
      } catch (err) {
        console.warn(`[ConnectorManager] Skipping google-drive: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (configs.slack.enabled && configs.slack.auth.token) {
      try {
        const connector = new SlackConnector({
          token: configs.slack.auth.token,
          channels: configs.slack.scope.channels,
          projectId,
          snapshotService,
        });
        this.registerConnector(connector);
        registered.push("slack");
      } catch (err) {
        console.warn(`[ConnectorManager] Skipping slack: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (configs.notion.enabled && configs.notion.auth.token) {
      try {
        const connector = new NotionConnector({
          token: configs.notion.auth.token,
          databaseId: configs.notion.scope.databaseId,
          projectId,
          snapshotService,
        });
        this.registerConnector(connector);
        registered.push("notion");
      } catch (err) {
        console.warn(`[ConnectorManager] Skipping notion: ${err instanceof Error ? err.message : err}`);
      }
    }

    return registered;
  }
}
