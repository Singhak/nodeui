import type { ServerResponse } from 'node:http';

export interface SseStream {
  send(payload: unknown): void;
  heartbeat(): void;
  close(): void;
}

/**
 * Minimal Server-Sent Events writer over a raw HTTP response. Events are
 * emitted as `data: <json>\n\n`; heartbeats as `:ping\n\n`.
 */
export function startSse(res: ServerResponse): SseStream {
  let closed = false;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  return {
    send(payload: unknown): void {
      if (closed || res.destroyed) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    },
    heartbeat(): void {
      if (closed || res.destroyed) return;
      res.write(':ping\n\n');
    },
    close(): void {
      if (closed || res.destroyed) return;
      closed = true;
      res.end();
    },
  };
}
