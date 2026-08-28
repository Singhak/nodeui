#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const PACKAGES = ['core', 'express', 'nestjs'];

const pkgJson = (name) =>
  JSON.parse(readFileSync(resolve(root, 'packages', name, 'package.json'), 'utf8'));

const failures = [];

for (const name of PACKAGES) {
  const pkg = pkgJson(name);
  const fullName = `@singhak/nodeui-${name}`;

  if (pkg.name !== fullName) {
    failures.push(`${fullName}: "name" is "${pkg.name}"`);
  }
  if (!pkg.version) {
    failures.push(`${fullName}: missing "version"`);
  }
  if (!pkg.main || !pkg.types || !pkg.exports) {
    failures.push(`${fullName}: missing "main", "types", or "exports"`);
  }
  if (pkg.files && !pkg.files.includes('dist')) {
    failures.push(`${fullName}: "files" does not include "dist"`);
  }
  for (const out of [pkg.main, pkg.module, pkg.types].filter(Boolean)) {
    if (!out.startsWith('./dist/')) {
      failures.push(`${fullName}: entry "${out}" must point into ./dist/`);
    }
  }
}

const core = pkgJson('core');
for (const name of ['express', 'nestjs']) {
  const adapter = pkgJson(name);
  const dep = adapter.dependencies?.['@singhak/nodeui-core'];
  if (!dep) {
    failures.push(`@singhak/nodeui-${name}: missing dependency on @singhak/nodeui-core`);
  } else if (!dep.includes(core.version)) {
    failures.push(
      `@singhak/nodeui-${name}: dependency "@singhak/nodeui-core": "${dep}" does not match core version "${core.version}"`,
    );
  }
}

const versions = new Set(PACKAGES.map((name) => pkgJson(name).version));
if (versions.size > 1) {
  failures.push(`Packages have diverged in version: ${[...versions].join(', ')}`);
}

if (failures.length > 0) {
  console.error('release:check failed:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `release:check OK — @singhak/nodeui-core, @singhak/nodeui-express, @singhak/nodeui-nestjs all at v${core.version}.`,
);
