#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

const PACKAGES = [
  ['@nodeui/core', 'core'],
  ['@nodeui/express', 'express'],
  ['@nodeui/nestjs', 'nestjs'],
];

function run(args) {
  console.log(`\n$ ${args.join(' ')}`);
  if (dryRun) {
    console.log('(dry run — skipped)');
    return;
  }
  execFileSync('npm', args, { cwd: root, stdio: 'inherit' });
}

console.log(`Publishing NodeUI${dryRun ? ' (dry run)' : ''} in dependency order:`);

run(['run', 'build']);

for (const [name] of PACKAGES) {
  run(['publish', '--workspace', name, '--access', 'public', '--tag', 'latest']);
}

console.log('\nPublished: @nodeui/core, @nodeui/express, @nodeui/nestjs.');
console.log('Remember to update the root CHANGELOG.md and tag the release.');
