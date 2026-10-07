import type { NextConfig } from 'next';

const config: NextConfig = {
  // `engine/` is plain TypeScript outside this package's root and its internal imports
  // carry explicit .ts extensions (Node runs them directly via native type stripping).
  // Turbopack resolves exact paths, so this works without a build step for the engine.
  // The engine is a workspace package of plain TypeScript source with no build step —
  // Node runs it directly via native type stripping, so Next compiles it here instead.
  // Only the pure incentive modules are imported; nothing server-side crosses over.
  transpilePackages: ['@learnloop/engine'],
};

export default config;
