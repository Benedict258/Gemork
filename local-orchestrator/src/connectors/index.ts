export type { IConnector, ConnectorResult, ConnectorScope } from "./base-connector.js";

export { FilesystemConnector } from "./filesystem-connector.js";
export type { FilesystemConnectorConfig } from "./filesystem-connector.js";

export { GoogleDriveConnector } from "./google-drive-connector.js";
export type { GoogleDriveConnectorConfig } from "./google-drive-connector.js";

export { SlackConnector } from "./slack-connector.js";
export type { SlackConnectorConfig } from "./slack-connector.js";

export { NotionConnector } from "./notion-connector.js";
export type { NotionConnectorConfig } from "./notion-connector.js";

export { ConnectorManager } from "./connector-manager.js";

export { ConnectorBridge } from "./connector-bridge.js";
export type { ConnectorOp, BridgeContext, ConnectorBridgeConfig } from "./connector-bridge.js";

export {
  loadConnectorConfigs,
  validateRequiredEnvVars,
} from "./connector-config.js";
export type {
  AllConnectorConfigs,
  ConnectorEntryConfig,
  ConnectorAuthConfig,
  ConnectorScopeConfig,
} from "./connector-config.js";
