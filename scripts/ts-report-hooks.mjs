/**
 * ESM resolution hooks so a Node harness can import the TypeScript sources directly.
 *
 * Node strips TypeScript types natively, but it still needs two things the compiler normally
 * supplies: the `@/` alias from tsconfig.json, and an explicit extension on the extension-less
 * relative specifiers this codebase (and Turbopack) writes. Resolving them here means the harness
 * exercises `lib/report` and `lib/data` as they actually are, instead of a parallel copy that
 * could pass while the real code fails.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

const candidates = (base) => [`${base}.ts`, `${base}/index.ts`, base].filter((p) => existsSync(p) && !p.endsWith('/'));

export async function resolve(specifier, context, nextResolve) {
  // A route handler imports `next/server`, which is a valid specifier under Turbopack but not one
  // plain Node's ESM resolver accepts — the package's exports map only lists the file with its
  // extension. Without this, a harness that tries to exercise a real route dies at module
  // resolution instead of at an assertion, and the tempting fix is to test a copy of the route.
  if (specifier === 'next/server') return nextResolve('next/server.js', context);

  if (specifier.startsWith('@/')) {
    const found = candidates(resolvePath(ROOT, specifier.slice(2)))[0];
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }

  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.(ts|tsx|js|mjs|cjs|json|node)$/.test(specifier)) {
    const parent = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : ROOT;
    const found = candidates(resolvePath(parent, specifier))[0];
    if (found) return nextResolve(pathToFileURL(found).href, context);
  }

  return nextResolve(specifier, context);
}
