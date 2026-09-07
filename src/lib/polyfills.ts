/**
 * Runtime shims for the Node globals that @solana/web3.js, @ton/core and
 * ripple-binary-codec still expect.
 *
 * IMPORTANT: every module that transitively imports a chain SDK must list
 * `import '@/lib/polyfills';` as its FIRST import. ES module evaluation follows
 * import order within a file, so this guarantees `Buffer` exists on `globalThis`
 * before any SDK module body runs.
 */
import { Buffer } from 'buffer';

type MutableGlobal = {
  Buffer?: typeof Buffer;
  global?: typeof globalThis;
  process?: unknown;
};

const g = globalThis as unknown as MutableGlobal;

if (typeof g.Buffer === 'undefined') g.Buffer = Buffer;
if (typeof g.global === 'undefined') g.global = globalThis;
if (typeof g.process === 'undefined') {
  g.process = {
    env: {} as Record<string, string | undefined>,
    version: 'v22.0.0',
    browser: true,
    nextTick: (fn: () => void) => queueMicrotask(fn),
  };
}

export {};
