export { BaseConnector, ConnectorConfigSchema, type ConnectorConfig, type ConnectorResult } from "./base-connector.js";
export { FilesystemConnector } from "./connectors/filesystem.js";
export { GoogleDriveConnector } from "./connectors/google-drive.js";

import { type ConnectorConfig, type ConnectorResult, BaseConnector } from "./base-connector.js";

export class ConnectorRegistry {
  private connectors: Map<string, BaseConnector> = new Map();

  register(connector: BaseConnector): void {
    this.connectors.set(connector.getId(), connector);
  }

  get(id: string): BaseConnector | undefined {
    return this.connectors.get(id);
  }

  getAll(): BaseConnector[] {
    return Array.from(this.connectors.values());
  }

  getEnabled(): BaseConnector[] {
    return this.getAll().filter((c) => c.isEnabled());
  }
}
