import { readFileSync } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const staticDir = resolve(root, '..', '..', 'packages', 'core', 'static');

const failures = [];
const indexHtml = resolve(staticDir, 'index.html');
if (!existsSync(indexHtml)) {
  failures.push(`Missing ${indexHtml}`);
} else {
  const html = readFileSync(indexHtml, 'utf8');
  if (!/<div id="root">/.test(html)) failures.push('index.html lacks #root element');
  if (!/<script type="module"[^>]+src="\.\/assets\/.+\.js"/.test(html)) {
    failures.push('index.html lacks a module script referencing ./assets/*.js');
  }
}

const assetsDir = resolve(staticDir, 'assets');
if (!existsSync(assetsDir)) {
  failures.push(`Missing ${assetsDir}`);
} else {
  const js = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
  if (js.length === 0) failures.push('No JS bundle emitted into assets/');
}

if (failures.length > 0) {
  console.error('UI build verification failed:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('UI build verified: static index.html + assets bundle present.');
