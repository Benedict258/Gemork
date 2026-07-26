export interface LLMConfig {
  provider: "ollama" | "llamacpp";
  model: string;
  baseUrl: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface GemmaModelInfo {
  tag: string;
  sizeBytes: number;
  quantization: string;
  parameterCount: string;
  minRamGB: number;
}

export const GEMMA_MODELS: Record<string, GemmaModelInfo> = {
  "gemma4:latest": {
    tag: "gemma4:latest",
    sizeBytes: 9_600_000_000,
    quantization: "Q4_K_M",
    parameterCount: "12B",
    minRamGB: 8,
  },
  "gemma4:2b": {
    tag: "gemma4:2b",
    sizeBytes: 1_600_000_000,
    quantization: "Q4_0",
    parameterCount: "2B",
    minRamGB: 4,
  },
  "gemma4:9b": {
    tag: "gemma4:9b",
    sizeBytes: 5_800_000_000,
    quantization: "Q4_K_M",
    parameterCount: "9B",
    minRamGB: 8,
  },
  "gemma4:27b": {
    tag: "gemma4:27b",
    sizeBytes: 16_000_000_000,
    quantization: "Q4_K_M",
    parameterCount: "27B",
    minRamGB: 20,
  },
};

const DEFAULTS: Record<LLMConfig["provider"], LLMConfig> = {
  ollama: {
    provider: "ollama",
    model: "gemma4:latest",
    baseUrl: "http://localhost:11434",
    temperature: 0.3,
    topP: 0.9,
    maxTokens: 2048,
    timeoutMs: 120_000,
  },
  llamacpp: {
    provider: "llamacpp",
    model: "gemma-4",
    baseUrl: "http://localhost:8080",
    temperature: 0.3,
    topP: 0.9,
    maxTokens: 2048,
    timeoutMs: 120_000,
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
  const envTopP = process.env.GEMORK_LLM_TOP_P;
  const envMax = process.env.GEMORK_LLM_MAX_TOKENS;
  const envTimeout = process.env.GEMORK_LLM_TIMEOUT_MS;

  if (envModel) base.model = envModel;
  if (envUrl) base.baseUrl = envUrl;
  if (envTemp) base.temperature = parseFloat(envTemp);
  if (envTopP) base.topP = parseFloat(envTopP);
  if (envMax) base.maxTokens = parseInt(envMax, 10);
  if (envTimeout) base.timeoutMs = parseInt(envTimeout, 10);

  return { ...base, ...overrides };
}

/**
 * Resolve which Gemma 4 model tag to use based on available hardware.
 * Prefers the largest model that fits in available RAM.
 */
export function resolveGemmaModel(availableRamGB?: number): string {
  if (!availableRamGB) return DEFAULTS.ollama.model;

  const candidates = Object.values(GEMMA_MODELS)
    .filter((m) => m.minRamGB <= availableRamGB)
    .sort((a, b) => b.sizeBytes - a.sizeBytes);

  return candidates.length > 0 ? candidates[0].tag : "gemma4:latest";
}
