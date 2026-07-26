// ─── Base Error ─────────────────────────────────────────────

export class GemorkError extends Error {
  public readonly code: string;
  public readonly module: string;
  public readonly recoverable: boolean;
  public readonly context?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    opts?: { module?: string; recoverable?: boolean; context?: Record<string, unknown>; cause?: Error },
  ) {
    super(message, { cause: opts?.cause });
    this.name = "GemorkError";
    this.code = code;
    this.module = opts?.module ?? "unknown";
    this.recoverable = opts?.recoverable ?? true;
    this.context = opts?.context;
  }
}

// ─── LLM Errors ─────────────────────────────────────────────

export type LLMErrorCode = "LLM_UNAVAILABLE" | "LLM_PARSE_FAILED" | "LLM_TIMEOUT" | "LLM_EMPTY_RESPONSE";

export class LLMError extends GemorkError {
  public readonly llmCode: LLMErrorCode;

  constructor(llmCode: LLMErrorCode, message: string, opts?: { recoverable?: boolean; cause?: Error }) {
    super(llmCode, message, { module: "llm", recoverable: opts?.recoverable ?? true, cause: opts?.cause });
    this.name = "LLMError";
    this.llmCode = llmCode;
  }
}

// ─── Connector Errors ───────────────────────────────────────

export type ConnectorErrorCode =
  | "CONNECTOR_API_FAILURE"
  | "CONNECTOR_AUTH_EXPIRED"
  | "CONNECTOR_RATE_LIMITED"
  | "CONNECTOR_NOT_FOUND";

export class ConnectorError extends GemorkError {
  public readonly connectorCode: ConnectorErrorCode;
  public readonly connectorId: string;

  constructor(
    connectorCode: ConnectorErrorCode,
    connectorId: string,
    message: string,
    opts?: { recoverable?: boolean; cause?: Error },
  ) {
    super(connectorCode, message, {
      module: "connector",
      recoverable: opts?.recoverable ?? true,
      context: { connectorId },
      cause: opts?.cause,
    });
    this.name = "ConnectorError";
    this.connectorCode = connectorCode;
    this.connectorId = connectorId;
  }
}

// ─── Guardrail Errors ───────────────────────────────────────

export type GuardrailErrorCode = "GUARDRAIL_PERMISSION_DENIED" | "GUARDRAIL_APPROVAL_TIMEOUT";

export class GuardrailError extends GemorkError {
  public readonly guardrailCode: GuardrailErrorCode;

  constructor(guardrailCode: GuardrailErrorCode, message: string, opts?: { recoverable?: boolean; cause?: Error }) {
    super(guardrailCode, message, { module: "guardrails", recoverable: opts?.recoverable ?? false, cause: opts?.cause });
    this.name = "GuardrailError";
    this.guardrailCode = guardrailCode;
  }
}

// ─── Storage Errors ─────────────────────────────────────────

export type StorageErrorCode = "STORAGE_DISK_FULL" | "STORAGE_PERMISSION_DENIED" | "STORAGE_CORRUPTION";

export class StorageError extends GemorkError {
  public readonly storageCode: StorageErrorCode;

  constructor(storageCode: StorageErrorCode, message: string, opts?: { recoverable?: boolean; cause?: Error }) {
    super(storageCode, message, { module: "storage", recoverable: opts?.recoverable ?? true, cause: opts?.cause });
    this.name = "StorageError";
    this.storageCode = storageCode;
  }
}

// ─── Snapshot Errors ────────────────────────────────────────

export type SnapshotErrorCode = "SNAPSHOT_BACKUP_FAILED" | "SNAPSHOT_RESTORE_FAILED";

export class SnapshotError extends GemorkError {
  public readonly snapshotCode: SnapshotErrorCode;

  constructor(snapshotCode: SnapshotErrorCode, message: string, opts?: { recoverable?: boolean; cause?: Error }) {
    super(snapshotCode, message, { module: "snapshot", recoverable: opts?.recoverable ?? true, cause: opts?.cause });
    this.name = "SnapshotError";
    this.snapshotCode = snapshotCode;
  }
}

// ─── Type Guards ────────────────────────────────────────────

export function isGemorkError(err: unknown): err is GemorkError {
  return err instanceof GemorkError;
}

export function isLLMError(err: unknown): err is LLMError {
  return err instanceof LLMError;
}

export function isConnectorError(err: unknown): err is ConnectorError {
  return err instanceof ConnectorError;
}

export function isGuardrailError(err: unknown): err is GuardrailError {
  return err instanceof GuardrailError;
}

export function isStorageError(err: unknown): err is StorageError {
  return err instanceof StorageError;
}

export function isSnapshotError(err: unknown): err is SnapshotError {
  return err instanceof SnapshotError;
}
