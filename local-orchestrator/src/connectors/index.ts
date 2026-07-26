export type { IConnector, ConnectorResult, ConnectorScope } from "./base-connector.js";

export { FilesystemConnector } from "./filesystem-connector.js";
export type { FilesystemConnectorConfig } from "./filesystem-connector.js";

export { ConnectorManager } from "./connector-manager.js";

export { ConnectorBridge } from "./connector-bridge.js";
export type { ConnectorOp, BridgeContext, ConnectorBridgeConfig } from "./connector-bridge.js";
