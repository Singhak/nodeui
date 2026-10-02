import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type {
  ErrorsData,
  HealthData,
  LogsData,
  OutgoingData,
  QueriesData,
  RequestsData,
  RoutesData,
} from '@singhak/nodeui-core';
import pkg from '../package.json';
import { buildDigest } from './digest';
import { fetchPanel, PanelError, type ServiceTarget } from './targets';

const SERVER_INFO = { name: 'nodeui', version: pkg.version };
const DEFAULT_PROTOCOL = '2025-03-26';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

interface Tool {
  name: string;
  description: string;
  properties: Record<string, unknown>;
  run(args: Record<string, unknown>, target: ServiceTarget): Promise<string>;
}

const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const limitOf = (v: unknown): number =>
  Math.min(Math.max(Math.trunc(num(v, DEFAULT_LIMIT)), 1), MAX_LIMIT);
const text = (v: unknown): string => JSON.stringify(v, null, 1);
const optional = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

const limitProp = {
  limit: { type: 'integer', description: `Max items, newest last (default ${DEFAULT_LIMIT}).` },
};

const TOOLS: Tool[] = [
  {
    name: 'nodeui_overview',
    description:
      'START HERE. Prioritised digest of the running app: health, traffic, grouped errors with stack frames, failing and slow requests, slow/N+1 queries, failing outgoing calls.',
    properties: {},
    async run(_args, t) {
      const [health, requests, errors, queries, outgoing] = await Promise.all([
        optional(fetchPanel<HealthData>(t, 'health')),
        optional(fetchPanel<RequestsData>(t, 'requests')),
        optional(fetchPanel<ErrorsData>(t, 'errors')),
        optional(fetchPanel<QueriesData>(t, 'queries')),
        optional(fetchPanel<OutgoingData>(t, 'outgoing')),
      ]);
      return buildDigest({ service: t.name, health, requests, errors, queries, outgoing });
    },
  },
  {
    name: 'nodeui_errors',
    description:
      'Errors grouped by fingerprint with count, first/last seen, full stack and the last linked request id.',
    properties: limitProp,
    async run(args, t) {
      const data = await fetchPanel<ErrorsData>(t, 'errors');
      return text(data.groups.slice(0, limitOf(args.limit)));
    },
  },
  {
    name: 'nodeui_requests',
    description:
      'Recent HTTP requests handled by the app (method, route pattern, status, duration, query/headers when captured). Filter by minimum status or minimum duration.',
    properties: {
      ...limitProp,
      minStatus: { type: 'integer', description: 'Only requests with status >= this (e.g. 500).' },
      minDurationMs: { type: 'number', description: 'Only requests at least this slow.' },
    },
    async run(args, t) {
      const data = await fetchPanel<RequestsData>(t, 'requests');
      const minStatus = num(args.minStatus, 0);
      const minMs = num(args.minDurationMs, 0);
      const rows = data.entries.filter((r) => r.status >= minStatus && r.durationMs >= minMs);
      return text({ summary: data.summary, entries: rows.slice(-limitOf(args.limit)) });
    },
  },
  {
    name: 'nodeui_request',
    description:
      'One request in full: its details plus everything it caused (outgoing HTTP calls, database queries, log lines) joined by request id.',
    properties: { id: { type: 'integer', description: 'Request id, from nodeui_requests.' } },
    async run(args, t) {
      const id = num(args.id, NaN);
      if (!Number.isFinite(id)) throw new PanelError('id is required', 'bad-args');
      const [requests, outgoing, queries, logs] = await Promise.all([
        fetchPanel<RequestsData>(t, 'requests'),
        optional(fetchPanel<OutgoingData>(t, 'outgoing')),
        optional(fetchPanel<QueriesData>(t, 'queries')),
        optional(fetchPanel<LogsData>(t, 'logs')),
      ]);
      const request = requests.entries.find((r) => r.id === id);
      if (!request) throw new PanelError(`request #${id} is not in the recent buffer`, 'not-found');
      return text({
        request,
        outgoing: outgoing?.entries.filter((e) => e.requestId === id) ?? [],
        queries: queries?.entries.filter((e) => e.requestId === id) ?? [],
        logs: logs?.entries.filter((e) => e.requestId === id) ?? [],
      });
    },
  },
  {
    name: 'nodeui_queries',
    description:
      'Database statements (parameters never recorded) with duration, rows, and slow / N+1 flags.',
    properties: {
      ...limitProp,
      onlyProblems: { type: 'boolean', description: 'Only slow, N+1 or failed queries.' },
    },
    async run(args, t) {
      const data = await fetchPanel<QueriesData>(t, 'queries');
      const rows =
        args.onlyProblems === true
          ? data.entries.filter((q) => q.slow || q.nPlusOne || q.error)
          : data.entries;
      return text({
        slowQueryMs: data.slowQueryMs,
        nPlusOneGroups: data.nPlusOneGroups,
        entries: rows.slice(-limitOf(args.limit)),
      });
    },
  },
  {
    name: 'nodeui_outgoing',
    description: 'Outgoing HTTP calls the app made (host/path, status, duration, error).',
    properties: {
      ...limitProp,
      onlyFailed: { type: 'boolean', description: 'Only calls with an error or status >= 500.' },
    },
    async run(args, t) {
      const data = await fetchPanel<OutgoingData>(t, 'outgoing');
      const rows =
        args.onlyFailed === true
          ? data.entries.filter((e) => e.error || (e.status ?? 0) >= 500)
          : data.entries;
      return text(rows.slice(-limitOf(args.limit)));
    },
  },
  {
    name: 'nodeui_logs',
    description: 'Recent application log lines (secrets masked), optionally only warn/error.',
    properties: {
      ...limitProp,
      minLevel: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
    },
    async run(args, t) {
      const order = ['debug', 'info', 'warn', 'error'];
      const min = order.indexOf(typeof args.minLevel === 'string' ? args.minLevel : 'debug');
      const data = await fetchPanel<LogsData>(t, 'logs');
      const rows = data.entries.filter((l) => order.indexOf(l.level) >= Math.max(min, 0));
      return text(rows.slice(-limitOf(args.limit)));
    },
  },
  {
    name: 'nodeui_routes',
    description: 'The registered route table (method, path, handler).',
    properties: {},
    async run(_args, t) {
      return text((await fetchPanel<RoutesData>(t, 'routes')).routes);
    },
  },
];

export interface McpOptions {
  services: ServiceTarget[];
  input?: Readable;
  output?: Writable;
}

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function toolDefinitions(multi: boolean): unknown[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description + ' Read-only.',
    inputSchema: {
      type: 'object',
      properties: multi
        ? { service: { type: 'string', description: 'Service name.' }, ...t.properties }
        : t.properties,
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }));
}

/**
 * A Model Context Protocol server over stdio (newline-delimited JSON-RPC)
 * exposing the console's data to AI agents. All tools are read-only; it never
 * triggers heap snapshots or any confirmation-gated action, and what it
 * returns is the already-masked REST data.
 */
export function serveMcp(options: McpOptions): { done: Promise<void> } {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const services = options.services;
  const multi = services.length > 1;
  const send = (msg: unknown): void => {
    output.write(`${JSON.stringify(msg)}\n`);
  };
  const reply = (id: RpcRequest['id'], result: unknown): void =>
    send({ jsonrpc: '2.0', id, result });
  const fail = (id: RpcRequest['id'], code: number, message: string): void =>
    send({ jsonrpc: '2.0', id, error: { code, message } });

  async function call(params: Record<string, unknown> | undefined): Promise<unknown> {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return { isError: true, content: [{ type: 'text', text: 'unknown tool' }] };
    const args = (params?.arguments ?? {}) as Record<string, unknown>;
    const wanted = typeof args.service === 'string' ? args.service : undefined;
    const target = wanted
      ? services.find((s) => s.name === wanted)
      : multi
        ? undefined
        : services[0];
    try {
      if (!target) {
        throw new PanelError(
          `specify "service": one of ${services.map((s) => s.name).join(', ')}`,
          'bad-args',
        );
      }
      return { content: [{ type: 'text', text: await tool.run(args, target) }] };
    } catch (err) {
      return {
        isError: true,
        content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
      };
    }
  }

  async function handle(req: RpcRequest): Promise<void> {
    const isNotification = req.id === undefined;
    switch (req.method) {
      case 'initialize':
        reply(req.id, {
          protocolVersion:
            typeof req.params?.protocolVersion === 'string'
              ? req.params.protocolVersion
              : DEFAULT_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions:
            'Read-only view of a running Node app. Call nodeui_overview first, then drill into errors, requests, queries.',
        });
        // Lazy panels (outgoing calls, queries) only start recording once read.
        for (const s of services) {
          void Promise.all([
            optional(fetchPanel(s, 'outgoing')),
            optional(fetchPanel(s, 'queries')),
          ]);
        }
        return;
      case 'ping':
        reply(req.id, {});
        return;
      case 'tools/list':
        reply(req.id, { tools: toolDefinitions(multi) });
        return;
      case 'tools/call':
        reply(req.id, await call(req.params));
        return;
      default:
        if (!isNotification) fail(req.id, -32601, `method not found: ${req.method}`);
    }
  }

  const rl = createInterface({ input });
  const pending = new Set<Promise<void>>();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let req: RpcRequest;
    try {
      req = JSON.parse(line) as RpcRequest;
    } catch {
      fail(null, -32700, 'parse error');
      return;
    }
    const p = handle(req)
      .catch((err: unknown) => {
        if (req.id !== undefined)
          fail(req.id, -32603, err instanceof Error ? err.message : 'error');
      })
      .finally(() => pending.delete(p));
    pending.add(p);
  });
  const done = new Promise<void>((resolve) => {
    rl.on('close', () => {
      void Promise.all(pending).then(() => resolve());
    });
  });
  return { done };
}
