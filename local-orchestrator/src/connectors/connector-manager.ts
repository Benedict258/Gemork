import type { IConnector } from "./base-connector.js";

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
}
