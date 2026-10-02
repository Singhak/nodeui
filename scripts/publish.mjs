#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run');

const PACKAGES = [
  ['@singhak/nodeui-core', 'core'],
  ['@singhak/nodeui-express', 'express'],
  ['@singhak/nodeui-fastify', 'fastify'],
  ['@singhak/nodeui-nestjs', 'nestjs'],
  ['@singhak/nodeui-koa', 'koa'],
  ['@singhak/nodeui-hapi', 'hapi'],
  ['@singhak/nodeui-hono', 'hono'],
  ['@singhak/nodeui-http', 'http'],
];

const version = JSON.parse(
  readFileSync(resolve(root, 'packages', 'core', 'package.json'), 'utf8'),
).version;
if (!readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8').includes(`## [${version}]`)) {
  console.error(`CHANGELOG.md has no "## [${version}]" section. Add release notes first.`);
  process.exit(1);
}

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

const tagCommand = `git tag v${version} && git push origin v${version}`;
console.log(
  `\n${dryRun ? 'Dry run complete' : 'Published'}: @singhak/nodeui-{core,express,fastify,nestjs,koa,hapi,hono,http}@${version}.`,
);
console.log(`CHANGELOG.md has a [${version}] section.`);
console.log(
  dryRun
    ? `Next: merge to master, then run: ${tagCommand} (the release workflow publishes).`
    : `Next: tag the release: ${tagCommand}`,
);
