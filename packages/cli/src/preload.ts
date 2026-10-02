/**
 * Loaded into the target app with `node --require`. It wraps `emit` on
 * `http.Server` / `https.Server` so every request is recorded and the console
 * is served on the app's own port, with no change to the app's code.
 * Configuration comes from `NODEUI_*` environment variables.
 */
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { createNodeUI, runInRequestContext } from '@singhak/nodeui-core';

const GUARD = Symbol.for('nodeui.cli.preload');
const globals = globalThis as { [GUARD]?: boolean };

if (!globals[GUARD]) {
  globals[GUARD] = true;
  try {
    install();
  } catch (err) {
    // Never stop the app because the console could not start.
    console.warn(`[nodeui] attach failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

type Emit = (this: unknown, event: string | symbol, ...args: unknown[]) => boolean;

function install(): void {
  const ui = createNodeUI();
  if (!ui.active) {
    console.warn(`[nodeui] not attached (${ui.activationReason}).`);
    return;
  }
  const prefix = ui.config.path;
  const recorder = ui.middleware();
  const announced = new WeakSet<object>();
  const token = process.env.NODEUI_TOKEN;

  const underPrefix = (url: string | undefined): boolean => {
    let path = url ?? '/';
    try {
      path = new URL(path, 'http://localhost').pathname;
    } catch {
      // keep the raw value
    }
    return path === prefix || path.startsWith(`${prefix}/`);
  };

  for (const proto of [http.Server.prototype, https.Server.prototype]) {
    const original = proto.emit as unknown as Emit;
    proto.emit = function patched(this: http.Server, event: string | symbol, ...args: unknown[]) {
      if (event === 'request') {
        const [req, res] = args as [http.IncomingMessage, http.ServerResponse];
        if (underPrefix(req.url)) {
          void ui.handle(req, res);
          return true;
        }
        recorder(req, res, () => undefined);
        return runInRequestContext(req, () => original.call(this, event, ...args));
      }
      if (event === 'listening' && !announced.has(this)) {
        announced.add(this);
        const addr = this.address() as AddressInfo | string | null;
        if (addr && typeof addr === 'object') {
          const scheme = this instanceof https.Server ? 'https' : 'http';
          const query = token ? `?token=${encodeURIComponent(token)}` : '';
          const line = `[nodeui] console: ${scheme}://127.0.0.1:${addr.port}${prefix}/${query}`;
          process.stdout.write(`${line}\n`);
        }
      }
      return original.call(this, event, ...args);
    } as typeof proto.emit;
  }
}
