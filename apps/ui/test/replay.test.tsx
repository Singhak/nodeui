import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { diffLines, normalizeForDiff } from '../src/diff';
import { toAutocannon, toFetch } from '../src/snippets';
import { ReplayPanel, textToHeaders } from '../src/views/ReplayPanel';
import type { RequestEntry } from '../src/types';
import { json } from './fixtures';

const entry: RequestEntry = {
  id: 1,
  method: 'POST',
  path: '/orders',
  status: 200,
  durationMs: 12,
  timestampMs: 1,
  ip: '127.0.0.1',
  query: { dry: '1' },
  headers: {
    host: 'localhost:3000',
    'content-type': 'application/json',
    authorization: '[REDACTED]',
  },
  requestBody: '{"qty":1}',
  responseBody: '{"ok":true,"qty":1}',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('diff', () => {
  it('marks added, removed and unchanged lines', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'x' },
      { type: 'same', text: 'c' },
    ]);
  });

  it('treats equal JSON with different spacing as identical', () => {
    const a = normalizeForDiff('{"a":1,"b":[1,2]}');
    const b = normalizeForDiff('{ "a": 1, "b": [1, 2] }');
    expect(diffLines(a, b).every((l) => l.type === 'same')).toBe(true);
  });
});

describe('snippets', () => {
  it('builds a fetch call without redacted credentials', () => {
    const out = toFetch(entry, 'http://localhost:3000');
    expect(out).toContain('await fetch("http://localhost:3000/orders?dry=1"');
    expect(out).toContain('"content-type": "application/json"');
    expect(out).not.toContain('authorization');
    expect(out).not.toContain('"host"');
    expect(out).toContain('body: "{\\"qty\\":1}"');
  });

  it('builds an autocannon command', () => {
    const out = toAutocannon(entry, 'http://localhost:3000');
    expect(out).toContain('npx autocannon -c 10 -d 10');
    expect(out).toContain('-m POST');
    expect(out).toContain("-H 'content-type=application/json'");
    expect(out).toContain('-b \'{"qty":1}\'');
    expect(out).toContain("'http://localhost:3000/orders?dry=1'");
  });
});

describe('snippet quoting', () => {
  it('escapes single quotes so the shell command stays one argument', () => {
    const out = toAutocannon({ ...entry, requestBody: "it's" }, 'http://x');
    expect(out).toContain("-b 'it'\\''s'");
  });
});

describe('ReplayPanel', () => {
  it('parses header text', () => {
    expect(textToHeaders('A: 1\n b :  two:2 \nnonsense\n')).toEqual({ A: '1', b: 'two:2' });
  });

  it('sends the edited request with a fresh nonce and diffs the response', async () => {
    const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/confirmations')) {
        return json({ ok: true, data: { nonce: 'n'.repeat(32), expiresAtMs: 1, ttlMs: 1 } });
      }
      if (url.endsWith('/replay')) {
        expect(init?.headers).toMatchObject({ 'x-nodeui-confirm': 'n'.repeat(32) });
        return json({
          ok: true,
          data: {
            status: 500,
            statusMessage: 'Internal Server Error',
            headers: {},
            durationMs: 30,
            sizeBytes: 20,
            body: '{"ok":false,"qty":1}',
            bodyTruncated: false,
            binary: false,
          },
        });
      }
      return json({ ok: false, error: { code: 'not-found', message: 'nf' } }, 404);
    });
    vi.stubGlobal('fetch', fn);
    render(<ReplayPanel entry={entry} />);
    expect((screen.getByLabelText('Replay headers') as HTMLTextAreaElement).value).toBe(
      'content-type: application/json',
    );
    fireEvent.change(screen.getByLabelText('Replay body'), { target: { value: '{"qty":2}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Response changed')).toBeInTheDocument();
    expect(screen.getByLabelText('Response diff')).toHaveTextContent('"ok": false');
    expect(screen.getByText('(was 200)')).toBeInTheDocument();
    const call = fn.mock.calls.find((c) => String(c[0]).endsWith('/replay'));
    const sent = JSON.parse(String((call?.[1] as RequestInit).body)) as {
      path: string;
      body: string;
      headers: Record<string, string>;
    };
    expect(sent.path).toBe('/orders?dry=1');
    expect(sent.body).toBe('{"qty":2}');
    expect(sent.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('shows the server error when the replay is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith('/confirmations')
          ? json({ ok: true, data: { nonce: 'n'.repeat(32), expiresAtMs: 1, ttlMs: 1 } })
          : json({ ok: false, error: { code: 'no-target', message: 'App address unknown' } }, 400),
      ),
    );
    render(<ReplayPanel entry={entry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('App address unknown'));
  });
});
