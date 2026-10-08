// Module boundaries, checked in CI:
// 1. Outside a module, only its public surface is imported (`@7sebeti/modules/<name>`).
//    `@7sebeti/modules/<name>/schema` is reserved for packages/db, which aggregates tables.
// 2. Inside a module, relative imports stay in the module (or go to ../shared).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const modulesDir = join(root, 'packages/modules');
const schemaAggregator = join(root, 'packages/db/src/schema.ts');

function* tsFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* tsFiles(path);
    else if (/\.tsx?$/.test(entry)) yield path;
  }
}

const importRe = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const errors = [];

for (const base of ['apps', 'packages']) {
  for (const file of tsFiles(join(root, base))) {
    const source = readFileSync(file, 'utf8');
    const inModule = file.startsWith(modulesDir + sep) ? relative(modulesDir, file).split(sep)[0] : null;
    for (const match of source.matchAll(importRe)) {
      const spec = match[1] ?? match[2];
      const rel = relative(root, file);
      const deep = spec.match(/^@7sebeti\/modules\/([^/]+)\/(.+)$/);
      if (deep && !(deep[2] === 'schema' && file === schemaAggregator)) {
        errors.push(`${rel}: "${spec}" — import the module's public surface "@7sebeti/modules/${deep[1]}"`);
      }
      if (inModule && inModule !== 'shared' && spec.startsWith('.')) {
        const target = relative(modulesDir, resolve(dirname(file), spec)).split(sep)[0];
        if (target !== inModule && target !== 'shared') {
          errors.push(`${rel}: "${spec}" reaches into module "${target}" — use "@7sebeti/modules/${target}"`);
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`Module boundary violations:\n${errors.map((e) => `  ${e}`).join('\n')}`);
  process.exit(1);
}
console.log('module boundaries ok');
