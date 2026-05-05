import type { ProviderAdapter } from "./types.js";

/**
 * Registry of provider adapters.
 *
 * Pattern: Registry + self-registration (Open/Closed principle).
 *
 * Adding a new provider:
 *   1. Create src/providers/foo.ts implementing ProviderAdapter
 *   2. Call registry.register(new FooAdapter()) at the bottom of the file
 *   3. Add `import "./foo.js"` to src/providers/index.ts
 *
 * No other file in the codebase needs to change.
 */
class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Provider "${adapter.id}" is already registered`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  /**
   * Lookup by URL slug. Returns undefined if not registered.
   */
  resolve(providerId: string): ProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  /**
   * Try every registered adapter in turn.
   * Used as a fallback when the URL slug is unknown but we want a best-effort
   * normalization (rare in practice — kept here for completeness).
   */
  detect(payload: unknown): ProviderAdapter | undefined {
    for (const adapter of this.adapters.values()) {
      if (adapter.canHandle(payload)) {
        return adapter;
      }
    }
    return undefined;
  }

  list(): ProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  has(providerId: string): boolean {
    return this.adapters.has(providerId);
  }

  /**
   * Test helper. Don't call from production code.
   */
  clear(): void {
    this.adapters.clear();
  }
}

// Singleton — module-scoped so all adapters register against the same instance.
export const registry = new ProviderRegistry();
