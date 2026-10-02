/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON assertions */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { attachEnv } from '../src/attach';

const dist = join(__dirname, '..', 'dist');
const preload = join(dist, 'preload.cjs').replace(/\\/g, '/');
const built = existsSync(join(dist, 'preload.cjs'));

function script(body: string): string {
  const file = join(mkdtempSync(join(tmpdir(), 'nodeui-attach-')), 'app.js');
  writeFileSync(file, body);
  return file;
}

// Needs `npm run build` (the preload is a built CommonJS file); skipped before it.
describe.skipIf(!built)('nodeui attach (preload)', () => {
  it('serves the console and records requests of an unmodified app', async () => {
    const file = script(
      "require('node:http').createServer((q, r) => r.end('hi')).listen(0, '127.0.0.1');",
    );
    const child = spawn(process.execPath, [file], {
      env: attachEnv({ ...process.env, NODE_ENV: 'development' }, {}, preload),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let out = '';
        const timer = setTimeout(() => reject(new Error(`no console url: ${out}`)), 15000);
        child.stdout.on('data', (d: Buffer) => {
          out += d.toString();
          const m = /console: (http:\/\/127\.0\.0\.1:\d+)\/nodeui\//.exec(out);
          if (m) {
            clearTimeout(timer);
            resolve(m[1] as string);
          }
        });
        child.on('exit', () => reject(new Error(`app exited: ${out}`)));
      });
      expect(await (await fetch(`${url}/hello`)).text()).toBe('hi');
      const requests = (await (await fetch(`${url}/nodeui/api/requests`)).json()) as any;
      expect(requests.data.total).toBe(1);
      expect(requests.data.entries[0]).toMatchObject({
        method: 'GET',
        path: '/hello',
        status: 200,
      });
      expect(await (await fetch(`${url}/nodeui/`)).text()).toContain('<div id="root"></div>');
    } finally {
      child.kill();
    }
  }, 30000);

  it('stays out of the way in production', async () => {
    const file = script("console.log('ready');");
    const out = await new Promise<string>((resolve) => {
      const env = attachEnv({ ...process.env, NODE_ENV: 'production' }, {}, preload);
      delete env.NODEUI_ENABLED;
      const child = spawn(process.execPath, [file], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.on('data', (d: Buffer) => (text += d.toString()));
      child.stderr.on('data', (d: Buffer) => (text += d.toString()));
      child.on('exit', () => resolve(text));
    });
    expect(out).toContain('ready');
    expect(out).toContain('not attached');
  }, 30000);
});
