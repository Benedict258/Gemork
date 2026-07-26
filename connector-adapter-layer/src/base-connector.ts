import { z } from "zod";

export const ConnectorConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["filesystem", "google-drive", "slack", "notion", "gmail", "custom"]),
  enabled: z.boolean().default(true),
  permissions: z.array(z.string()).default([]),
});

export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>;

export interface ConnectorResult {
  success: boolean;
  data?: unknown;
  error?: string;
  connectorId: string;
}

export abstract class BaseConnector {
  protected config: ConnectorConfig;

  constructor(config: ConnectorConfig) {
    this.config = config;
  }

  abstract read(path: string): Promise<ConnectorResult>;
  abstract write(path: string, content: unknown): Promise<ConnectorResult>;
  abstract list(path?: string): Promise<ConnectorResult>;

  getId(): string {
    return this.config.id;
  }

  getName(): string {
    return this.config.name;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }
}
