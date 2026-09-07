/**
 * Minimal resolver so plain `node` can run the TypeScript in src/ directly:
 * maps the `@/…` path alias to src/ and fills in the extensions that Next's
 * bundler normally adds. Node ≥22.18 strips the types itself.
 *
 * Scoped deliberately: it only rewrites imports that originate inside this
 * project's own source, so nothing in node_modules is affected.
 *
 * Used by: node --import ./scripts/ts-loader.mjs scripts/test-derivation.ts
 */
import { registerHooks } from 'node:module';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SRC = new URL('src/', ROOT);
const SCRIPTS = new URL('scripts/', ROOT);
const EXTS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function isFile(url) {
  try {
    return statSync(fileURLToPath(url)).isFile();
  } catch {
    return false;
  }
}

function firstExistingFile(base) {
  for (const ext of EXTS) {
    const candidate = new URL(base.href + ext);
    if (isFile(candidate)) return candidate.href;
  }
  return null;
}

function isOurs(url) {
  return typeof url === 'string' && (url.startsWith(SRC.href) || url.startsWith(SCRIPTS.href));
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL;

    if (isOurs(parent)) {
      let base = null;
      if (specifier.startsWith('@/')) base = new URL(specifier.slice(2), SRC);
      else if (specifier.startsWith('./') || specifier.startsWith('../')) {
        base = new URL(specifier, parent);
      }

      if (base) {
        const url = firstExistingFile(base);
        // No `format`: let Node infer it, which is what enables its
        // built-in TypeScript type stripping for .ts files.
        if (url) return { url, shortCircuit: true };
      }
    }

    return nextResolve(specifier, context);
  },
});
