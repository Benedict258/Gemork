export class LLMError extends Error {
  public readonly code: LLMErrorCode;
  public readonly recoverable: boolean;

  constructor(code: LLMErrorCode, message: string, opts?: { recoverable?: boolean }) {
    super(message);
    this.name = "LLMError";
    this.code = code;
    this.recoverable = opts?.recoverable ?? true;
  }
}

export type LLMErrorCode =
  | "PROVIDER_UNREACHABLE"
  | "MODEL_NOT_FOUND"
  | "PARSE_FAILED"
  | "TIMEOUT"
  | "EMPTY_RESPONSE"
  | "NETWORK_ERROR";

export class LLMTimeoutError extends LLMError {
  constructor(timeoutMs: number) {
    super("TIMEOUT", `LLM request timed out after ${timeoutMs}ms`, { recoverable: true });
    this.name = "LLMTimeoutError";
  }
}

export class LLMModelNotFoundError extends LLMError {
  constructor(model: string, availableModels: string[]) {
    const list = availableModels.length > 0 ? ` Available: ${availableModels.join(", ")}` : " No models found — is Ollama running?";
    super("MODEL_NOT_FOUND", `Model "${model}" not found.${list}`, { recoverable: false });
    this.name = "LLMModelNotFoundError";
  }
}

export class LLMProviderUnreachableError extends LLMError {
  constructor(baseUrl: string) {
    super("PROVIDER_UNREACHABLE", `LLM provider unreachable at ${baseUrl}. Is Ollama running?`, { recoverable: true });
    this.name = "LLMProviderUnreachableError";
  }
}
