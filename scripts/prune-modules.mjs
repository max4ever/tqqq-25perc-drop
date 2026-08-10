#!/usr/bin/env node
/**
 * Shrinks node_modules before it is baked into the runtime image.
 *
 * `yahoo-finance2` hard-depends on the MCP server SDK (which drags in hono,
 * ajv, jose, …), but that code only loads from the `yahoo-finance2/mcp` and
 * `yahoo-finance2/bin` entrypoints, which this app never imports. Rather than
 * hard-coding a delete list that rots on the next upgrade, this walks the real
 * dependency graph from the packages we actually import and drops whatever is
 * unreachable.
 *
 * The Docker build runs a smoke test right after this, so an over-eager prune
 * fails the build instead of the container.
 */
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

/** Packages reachable only through entrypoints we never import. */
const EXCLUDED_ROOTS = new Set(['@modelcontextprotocol/sdk']);

/** Files that are never needed at runtime. */
const JUNK_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts', '.map', '.md', '.markdown'];
const JUNK_DIRS = new Set(['test', 'tests', '__tests__', 'docs', 'example', 'examples', '.github']);

const root = resolve(process.argv[2] ?? process.cwd());
const modulesDir = join(root, 'node_modules');

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function listInstalledPackages() {
  const names = [];
  for (const entry of await readdir(modulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;

    if (entry.name.startsWith('@')) {
      for (const scoped of await readdir(join(modulesDir, entry.name), { withFileTypes: true })) {
        if (scoped.isDirectory() || scoped.isSymbolicLink()) names.push(`${entry.name}/${scoped.name}`);
      }
    } else {
      names.push(entry.name);
    }
  }
  return names;
}

async function collectReachable(rootDeps) {
  const reachable = new Set();
  const queue = [...rootDeps];

  while (queue.length > 0) {
    const name = queue.pop();
    if (reachable.has(name) || EXCLUDED_ROOTS.has(name)) continue;

    const manifest = await readJson(join(modulesDir, name, 'package.json'));
    if (!manifest) continue;

    reachable.add(name);
    const deps = { ...manifest.dependencies, ...manifest.optionalDependencies };
    for (const dep of Object.keys(deps)) {
      if (!reachable.has(dep)) queue.push(dep);
    }
  }
  return reachable;
}

async function removeJunk(dir) {
  let freed = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (JUNK_DIRS.has(entry.name.toLowerCase())) {
        freed += await sizeOf(path);
        await rm(path, { recursive: true, force: true });
        continue;
      }
      freed += await removeJunk(path);
    } else if (JUNK_SUFFIXES.some((suffix) => entry.name.toLowerCase().endsWith(suffix))) {
      freed += await sizeOf(path);
      await rm(path, { force: true });
    }
  }
  return freed;
}

async function sizeOf(path) {
  try {
    const info = await stat(path);
    if (!info.isDirectory()) return info.size;
    let total = 0;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      total += await sizeOf(join(path, entry.name));
    }
    return total;
  } catch {
    return 0;
  }
}

const appManifest = await readJson(join(root, 'package.json'));
const reachable = await collectReachable(Object.keys(appManifest?.dependencies ?? {}));
const installed = await listInstalledPackages();

let freed = 0;
const removed = [];
for (const name of installed) {
  if (reachable.has(name)) continue;
  const path = join(modulesDir, name);
  freed += await sizeOf(path);
  await rm(path, { recursive: true, force: true });
  removed.push(name);
}

// The CJS mirror of yahoo-finance2 is dead weight in an ESM-only app.
const cjsMirror = join(modulesDir, 'yahoo-finance2', 'script');
freed += await sizeOf(cjsMirror);
await rm(cjsMirror, { recursive: true, force: true });

freed += await removeJunk(modulesDir);

console.log(
  `pruned ${removed.length} unreachable package(s), freed ${(freed / 1024 / 1024).toFixed(1)} MB`,
);
if (removed.length > 0) console.log(`  ${removed.sort().join(', ')}`);
