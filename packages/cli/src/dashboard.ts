import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { createGuard, resolveStaticAsset, uiAssetsDir } from '@singhak/nodeui-core';
import { fetchPanel, type ServiceTarget } from './targets';

export interface DashboardOptions {
  services: ServiceTarget[];
  port?: number;
}

export interface Dashboard {
  server: Server;
  port: number;
  close(): Promise<void>;
}

interface ServiceStatus {
  name: string;
  url: string;
  up: boolean;
  /** Why the service is unreachable or inactive. */
  reason?: string;
  health?: string;
  requests?: number;
  errorRate?: number;
  p95Ms?: number;
  errorGroups?: number;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NodeUI services</title>
<style>
:root{--bg:#0f1115;--fg:#e6e8ee;--card:#181b22;--bd:#2a2f3a;--mut:#8b93a5;--ok:#3ecf8e;--warn:#f5a524;--bad:#f0616d}
@media (prefers-color-scheme:light){:root{--bg:#f6f7f9;--fg:#15171c;--card:#fff;--bd:#dfe3ea;--mut:#5d6578}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px}
h1{font-size:20px;margin:0 0 4px}p.sub{color:var(--mut);margin:0 0 20px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
a.card{display:block;background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:14px;color:inherit;text-decoration:none}
a.card:hover{border-color:var(--mut)}
.name{font-weight:600;font-size:16px;display:flex;align-items:center;gap:8px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--mut)}
.ok{background:var(--ok)}.degraded{background:var(--warn)}.critical,.down{background:var(--bad)}
.url{color:var(--mut);font-size:12px;word-break:break-all;margin:2px 0 10px}
dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:0}dt{color:var(--mut)}dd{margin:0;text-align:right}
.reason{color:var(--bad);font-size:13px}
</style></head><body><main>
<h1>NodeUI services</h1><p class="sub">Local services, refreshed every 3 seconds. Select one to open its console.</p>
<div class="grid" id="grid"></div></main>
<script src="/_dashboard.js"></script></body></html>`;

// Rendered with textContent only: service names, URLs and reasons are never parsed as HTML.
const SCRIPT = `
const grid = document.getElementById('grid');
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function row(dl, k, v) { dl.append(el('dt', '', k), el('dd', '', v)); }
async function refresh() {
  let list;
  try { list = (await (await fetch('api/services')).json()).data; } catch { return; }
  grid.replaceChildren(...list.map((s) => {
    const card = el('a', 'card');
    card.href = 's/' + encodeURIComponent(s.name) + '/';
    const title = el('div', 'name');
    title.append(el('span', 'dot ' + (s.up ? (s.health || 'ok') : 'down')), el('span', '', s.name));
    card.append(title, el('div', 'url', s.url));
    if (!s.up) { card.append(el('div', 'reason', s.reason || 'unreachable')); return card; }
    const dl = el('dl');
    row(dl, 'Health', s.health || 'unknown');
    row(dl, 'Requests', String(s.requests ?? 0));
    row(dl, 'Error rate', ((s.errorRate || 0) * 100).toFixed(1) + '%');
    row(dl, 'p95', (s.p95Ms || 0).toFixed(1) + ' ms');
    row(dl, 'Error groups', String(s.errorGroups ?? 0));
    card.append(dl);
    return card;
  }));
}
refresh(); setInterval(refresh, 3000);
`;

async function status(target: ServiceTarget): Promise<ServiceStatus> {
  const out: ServiceStatus = { name: target.name, url: target.base, up: false };
  try {
    const config = await fetchPanel<{ enabled: boolean; activationReason: string }>(
      target,
      'config',
    );
    if (!config.enabled) {
      out.reason = config.activationReason;
      return out;
    }
    const [health, requests, errors] = await Promise.all([
      fetchPanel<{ status: string }>(target, 'health').catch(() => null),
      fetchPanel<{ total: number; summary: { errorRate: number; p95Ms: number } }>(
        target,
        'requests',
      ).catch(() => null),
      fetchPanel<{ groups: unknown[] }>(target, 'errors').catch(() => null),
    ]);
    out.up = true;
    out.health = health?.status;
    out.requests = requests?.total;
    out.errorRate = requests?.summary.errorRate;
    out.p95Ms = requests?.summary.p95Ms;
    out.errorGroups = errors?.groups.length;
  } catch (err) {
    out.reason = err instanceof Error ? err.message : String(err);
  }
  return out;
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function proxy(
  target: ServiceTarget,
  rest: string,
  search: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const url = new URL(`${target.base}${rest}${search}`);
  const headers: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || HOP_BY_HOP.has(k)) continue;
    // Browser-identifying headers would trip the service's own cross-origin and cookie checks.
    if (k === 'host' || k === 'origin' || k === 'referer' || k === 'cookie') continue;
    headers[k] = v;
  }
  if (target.token) headers.authorization = `Bearer ${target.token}`;
  const client = url.protocol === 'https:' ? https : http;
  const upstream = client.request(url, { method: req.method, headers }, (up) => {
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(up.headers)) {
      if (v === undefined || HOP_BY_HOP.has(k) || k === 'set-cookie') continue;
      out[k] = v;
    }
    res.writeHead(up.statusCode ?? 502, out);
    up.pipe(res);
  });
  upstream.on('error', (err) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    json(res, 502, {
      ok: false,
      error: { code: 'bad-gateway', message: `cannot reach ${target.name}: ${err.message}` },
    });
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}

/**
 * Serves one landing page that lists several NodeUI consoles and proxies each
 * one's console and API under `/s/<name>/`. Loopback-only, like the consoles.
 */
export async function startDashboard(options: DashboardOptions): Promise<Dashboard> {
  const byName = new Map(options.services.map((s) => [s.name, s]));
  if (byName.size !== options.services.length) throw new Error('service names must be unique');
  const guard = createGuard({
    host: '127.0.0.1',
    allowedHosts: [],
    allowedOrigins: [],
    allowedRemoteAddresses: [],
    trustProxy: false,
  });
  const assets = uiAssetsDir();

  const server = http.createServer((req, res) => {
    const verdict = guard(req);
    if (!verdict.ok) {
      json(res, verdict.status, {
        ok: false,
        error: { code: verdict.code, message: verdict.message },
      });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    if (path === '/' && req.method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'",
        'x-content-type-options': 'nosniff',
      });
      res.end(PAGE);
      return;
    }
    if (path === '/_dashboard.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(SCRIPT);
      return;
    }
    if (path === '/api/services') {
      void Promise.all(options.services.map(status)).then((data) =>
        json(res, 200, { ok: true, data }),
      );
      return;
    }

    const match = /^\/s\/([^/]+)(\/.*)?$/.exec(path);
    let target: ServiceTarget | undefined;
    try {
      target = match ? byName.get(decodeURIComponent(match[1] ?? '')) : undefined;
    } catch {
      target = undefined;
    }
    if (!match || !target) {
      json(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown service' } });
      return;
    }
    const rest = match[2];
    if (rest === undefined) {
      res.writeHead(308, { location: `${path}/` });
      res.end();
      return;
    }
    if (rest.startsWith('/api/')) {
      proxy(target, rest, url.search, req, res);
      return;
    }
    const asset = resolveStaticAsset(assets, rest === '/' ? '' : rest);
    if (!asset) {
      json(res, 404, { ok: false, error: { code: 'not-found', message: 'console not built' } });
      return;
    }
    res.writeHead(200, {
      'content-type': asset.contentType,
      'content-length': asset.length,
      'x-content-type-options': 'nosniff',
    });
    asset.content.pipe(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4000, '127.0.0.1', resolve);
  });
  return {
    server,
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
