export type LogLevel = "error" | "warn" | "info" | "debug";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  context?: Record<string, unknown>;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function resolveLevel(): LogLevel {
  const env = (process.env.GEMORK_LOG_LEVEL ?? "info").toLowerCase();
  if (env in LEVEL_PRIORITY) return env as LogLevel;
  return "info";
}

let currentLevel: LogLevel = resolveLevel();

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] <= LEVEL_PRIORITY[currentLevel];
}

function formatEntry(entry: LogEntry): string {
  return JSON.stringify(entry);
}

export function createLogger(module: string) {
  return {
    error(message: string, context?: Record<string, unknown>): void {
      if (!shouldLog("error")) return;
      const entry: LogEntry = { timestamp: new Date().toISOString(), level: "error", module, message, context };
      process.stderr.write(formatEntry(entry) + "\n");
    },

    warn(message: string, context?: Record<string, unknown>): void {
      if (!shouldLog("warn")) return;
      const entry: LogEntry = { timestamp: new Date().toISOString(), level: "warn", module, message, context };
      process.stdout.write(formatEntry(entry) + "\n");
    },

    info(message: string, context?: Record<string, unknown>): void {
      if (!shouldLog("info")) return;
      const entry: LogEntry = { timestamp: new Date().toISOString(), level: "info", module, message, context };
      process.stdout.write(formatEntry(entry) + "\n");
    },

    debug(message: string, context?: Record<string, unknown>): void {
      if (!shouldLog("debug")) return;
      const entry: LogEntry = { timestamp: new Date().toISOString(), level: "debug", module, message, context };
      process.stdout.write(formatEntry(entry) + "\n");
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
