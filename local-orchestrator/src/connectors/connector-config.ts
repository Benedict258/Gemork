export interface ConnectorAuthConfig {
  token?: string;
  apiKey?: string;
  serviceAccountKey?: string;
}

export interface ConnectorScopeConfig {
  folderId?: string;
  channels?: string[];
  databaseId?: string;
  basePath?: string;
}

export interface ConnectorEntryConfig {
  enabled: boolean;
  auth: ConnectorAuthConfig;
  scope: ConnectorScopeConfig;
}

export interface AllConnectorConfigs {
  googleDrive: ConnectorEntryConfig;
  slack: ConnectorEntryConfig;
  notion: ConnectorEntryConfig;
  filesystem: ConnectorEntryConfig;
}

function envBool(name: string): boolean {
  const val = process.env[name];
  if (!val) return false;
  return val === "true" || val === "1" || val === "yes";
}

function envList(name: string): string[] {
  const val = process.env[name];
  if (!val) return [];
  return val
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConnectorConfigs(): AllConnectorConfigs {
  return {
    googleDrive: {
      enabled: envBool("GEMORK_GDRIVE_ENABLED"),
      auth: {
        apiKey: process.env.GEMORK_GDRIVE_API_KEY,
        serviceAccountKey: process.env.GEMORK_GDRIVE_SERVICE_ACCOUNT_KEY,
      },
      scope: {
        folderId: process.env.GEMORK_GDRIVE_FOLDER_ID,
      },
    },
    slack: {
      enabled: envBool("GEMORK_SLACK_ENABLED"),
      auth: {
        token: process.env.GEMORK_SLACK_TOKEN,
      },
      scope: {
        channels: envList("GEMORK_SLACK_CHANNELS"),
      },
    },
    notion: {
      enabled: envBool("GEMORK_NOTION_ENABLED"),
      auth: {
        token: process.env.GEMORK_NOTION_TOKEN,
      },
      scope: {
        databaseId: process.env.GEMORK_NOTION_DATABASE_ID,
      },
    },
    filesystem: {
      enabled: true,
      auth: {},
      scope: {
        basePath: process.env.GEMORK_FS_BASE_PATH,
      },
    },
  };
}

export function validateRequiredEnvVars(): string[] {
  const errors: string[] = [];

  if (envBool("GEMORK_GDRIVE_ENABLED")) {
    if (!process.env.GEMORK_GDRIVE_API_KEY && !process.env.GEMORK_GDRIVE_SERVICE_ACCOUNT_KEY) {
      errors.push("GEMORK_GDRIVE_ENABLED is true but neither GEMORK_GDRIVE_API_KEY nor GEMORK_GDRIVE_SERVICE_ACCOUNT_KEY is set");
    }
  }

  if (envBool("GEMORK_SLACK_ENABLED")) {
    if (!process.env.GEMORK_SLACK_TOKEN) {
      errors.push("GEMORK_SLACK_ENABLED is true but GEMORK_SLACK_TOKEN is not set");
    }
  }

  if (envBool("GEMORK_NOTION_ENABLED")) {
    if (!process.env.GEMORK_NOTION_TOKEN) {
      errors.push("GEMORK_NOTION_ENABLED is true but GEMORK_NOTION_TOKEN is not set");
    }
  }

  return errors;
}
