#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

const PACKAGES = [
  ['@singhak/nodeui-core', 'core'],
  ['@singhak/nodeui-express', 'express'],
  ['@singhak/nodeui-nestjs', 'nestjs'],
];

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args) {
  console.log(`\n$ ${args.join(' ')}`);
  if (dryRun) {
    console.log('(dry run — skipped)');
    return;
  }
  execFileSync(npmCmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
}

console.log(`Publishing NodeUI${dryRun ? ' (dry run)' : ''} in dependency order:`);

run(['run', 'build']);

for (const [name] of PACKAGES) {
  run(['publish', '--workspace', name, '--access', 'public', '--tag', 'latest']);
}

console.log('\nPublished: @singhak/nodeui-core, @singhak/nodeui-express, @singhak/nodeui-nestjs.');
console.log('Remember to update the root CHANGELOG.md and tag the release.');
