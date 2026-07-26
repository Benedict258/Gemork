import type { StepTier } from "../orchestrator/plan.js";

export interface ConnectorResult {
  success: boolean;
  data?: unknown;
  error?: string;
  tier: StepTier;
  requiresApproval: boolean;
}

export interface ConnectorScope {
  basePath: string;
  allowedPaths?: string[];
  excludedPaths?: string[];
}

export interface IConnector {
  id: string;
  name: string;
  type: string;

  isAvailable(): Promise<boolean>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;

  // Tier 1 — Read-only
  read(path: string): Promise<ConnectorResult>;
  list(path?: string): Promise<ConnectorResult>;
  stat(path: string): Promise<ConnectorResult>;

  // Tier 2 — Reversible writes
  write(path: string, content: string | Buffer): Promise<ConnectorResult>;
  edit(path: string, oldContent: string, newContent: string): Promise<ConnectorResult>;
  mkdir(path: string): Promise<ConnectorResult>;
  move(src: string, dest: string): Promise<ConnectorResult>;
  copy(src: string, dest: string): Promise<ConnectorResult>;

  // Tier 3 — Critical
  delete(path: string): Promise<ConnectorResult>;

  // Scope
  getScope(): ConnectorScope;
}
