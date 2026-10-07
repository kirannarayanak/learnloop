/**
 * Provider construction.
 *
 * The pipeline asks for a generator and a verifier; this decides what it gets. The one
 * invariant enforced here is that they are different families — a model cannot
 * independently verify its own output (docs/09-model-strategy.md).
 */

import { assertVerifierIndependence, assertPricesConfigured, routing } from './routing.ts';
import { FakeProvider } from './fake.ts';
import { GeminiProvider } from './gemini.ts';
import { ClaudeProvider } from './claude.ts';
import type { Family, Provider } from './types.ts';

export interface ProviderPair {
  generator: Provider;
  verifier: Provider;
}

function build(family: Family, log: (msg: string) => void): Provider {
  switch (family) {
    case 'gemini':
      return new GeminiProvider({ log });
    case 'claude':
      return new ClaudeProvider({ log });
    case 'open':
    case 'local':
      throw new Error(
        `no adapter yet for family '${family}'. Open-model drafting is a wave-2 move and ` +
          `needs an eval set first, or "we switched models" and "we quietly made the ` +
          `content worse" are indistinguishable (docs/09-model-strategy.md).`,
      );
  }
}

/**
 * Real providers, from the routing table.
 *
 * Throws if keys are missing — deliberately at construction rather than on first call, so
 * a long batch run fails in the first second rather than after generating half a path.
 */
export function realProviders(log: (msg: string) => void = console.warn): ProviderPair {
  assertVerifierIndependence();
  assertPricesConfigured(routing, log);

  return {
    generator: build(routing.draft.family, log),
    verifier: build(routing.verify.family, log),
  };
}

/**
 * Deterministic providers for tests and for seeding the app without keys.
 *
 * Proves the plumbing, the gate, the cache and the cost accounting. Says nothing about
 * content quality — that is what the eval set is for.
 */
export function fakeProviders(options: { goldenForSlug?: string } = {}): ProviderPair {
  return {
    generator: new FakeProvider({ family: 'gemini', ...options }),
    verifier: new FakeProvider({ family: 'claude' }),
  };
}

/** True when the environment has what the real providers need. */
export function hasRealCredentials(): boolean {
  const gemini = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  const anthropic = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
  return (
    gemini !== undefined && gemini !== '' && anthropic !== undefined && anthropic !== ''
  );
}

export { FakeProvider, GeminiProvider, ClaudeProvider };
