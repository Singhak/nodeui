import { describe, expect, it } from 'vitest';
import { startSse } from '../src/sse';

describe('startSse', () => {
  it('writes data events and heartbeats, and closes', () => {
    const chunks: string[] = [];
    const res = {
      writeHead: () => res,
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
      end: () => undefined,
    } as unknown as import('node:http').ServerResponse;

    const sse = startSse(res);
    sse.send({ panel: 'health', ok: true });
    sse.heartbeat();
    sse.close();
    expect(chunks.join('')).toContain('data: {"panel":"health","ok":true}\n\n');
    expect(chunks.join('')).toContain(':ping\n\n');
  });

  it('is a no-op after close', () => {
    const chunks: string[] = [];
    const res = {
      writeHead: () => res,
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
      end: () => undefined,
    } as unknown as import('node:http').ServerResponse;

    const sse = startSse(res);
    sse.close();
    sse.send({ x: 1 });
    sse.heartbeat();
    expect(chunks).toHaveLength(0);
  });
});
