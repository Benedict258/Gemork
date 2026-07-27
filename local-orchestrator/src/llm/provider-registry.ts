import type { LLMProvider } from "./provider.js";

export type ProviderFactory = () => LLMProvider;

const registry = new Map<string, ProviderFactory>();

export function registerProvider(name: string, factory: ProviderFactory): void {
  registry.set(name, factory);
}

export function getProvider(name: string): LLMProvider {
  const factory = registry.get(name);
  if (!factory) {
    const available = listProviders().join(", ");
    throw new Error(`Unknown LLM provider "${name}". Available: ${available}`);
  }
  return factory();
}

export function listProviders(): string[] {
  return Array.from(registry.keys());
}

export function hasProvider(name: string): boolean {
  return registry.has(name);
}
