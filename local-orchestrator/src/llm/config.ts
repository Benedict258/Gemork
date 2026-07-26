export interface LLMConfig {
  provider: "ollama" | "llamacpp";
  model: string;
  baseUrl: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

const DEFAULTS: Record<LLMConfig["provider"], LLMConfig> = {
  ollama: {
    provider: "ollama",
    model: "gemma2:latest",
    baseUrl: "http://localhost:11434",
    temperature: 0.7,
    maxTokens: 2048,
    timeoutMs: 30_000,
  },
  llamacpp: {
    provider: "llamacpp",
    model: "gemma-4",
    baseUrl: "http://localhost:8080",
    temperature: 0.7,
    maxTokens: 2048,
    timeoutMs: 30_000,
  },
};

export function loadLLMConfig(overrides?: Partial<LLMConfig>): LLMConfig {
  const provider = (overrides?.provider
    ?? process.env.GEMORK_LLM_PROVIDER
    ?? "ollama") as LLMConfig["provider"];

  const base = { ...DEFAULTS[provider] };

  const envModel = process.env.GEMORK_LLM_MODEL;
  const envUrl = process.env.GEMORK_LLM_BASE_URL;
  const envTemp = process.env.GEMORK_LLM_TEMPERATURE;
  const envMax = process.env.GEMORK_LLM_MAX_TOKENS;
  const envTimeout = process.env.GEMORK_LLM_TIMEOUT_MS;

  if (envModel) base.model = envModel;
  if (envUrl) base.baseUrl = envUrl;
  if (envTemp) base.temperature = parseFloat(envTemp);
  if (envMax) base.maxTokens = parseInt(envMax, 10);
  if (envTimeout) base.timeoutMs = parseInt(envTimeout, 10);

  return { ...base, ...overrides };
}
