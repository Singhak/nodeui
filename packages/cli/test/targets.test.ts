import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/cli';
import { attachEnv } from '../src/attach';
import { parseTarget } from '../src/targets';

describe('parseTarget', () => {
  it('defaults the console path and derives a name', () => {
    expect(parseTarget('127.0.0.1:3000')).toEqual({
      name: '127.0.0.1-3000',
      base: 'http://127.0.0.1:3000/nodeui',
      token: undefined,
    });
  });

  it('accepts name=url, custom paths and a token', () => {
    expect(parseTarget('api=http://localhost:3000/dev/?token=s3')).toEqual({
      name: 'api',
      base: 'http://localhost:3000/dev',
      token: 's3',
    });
  });

  it('rejects bad names and non-http URLs', () => {
    expect(() => parseTarget('a b=http://x:1')).toThrow(/invalid service name/);
    expect(() => parseTarget('api=ftp://x:1')).toThrow(/http/);
  });
});

describe('parseArgs', () => {
  it('splits flags, positionals and the command after --', () => {
    expect(
      parseArgs(['--token', 't', '--bodies', 'x', '--', 'node', 'a.js', '--port', '1']),
    ).toEqual({
      flags: { token: 't', bodies: true },
      positional: ['x'],
      rest: ['node', 'a.js', '--port', '1'],
    });
  });

  it('requires a value for value flags', () => {
    expect(() => parseArgs(['--token'])).toThrow(/needs a value/);
  });
});

describe('attachEnv', () => {
  it('appends the preload to NODE_OPTIONS and maps flags to NODEUI_* variables', () => {
    const env = attachEnv(
      { NODE_OPTIONS: '--max-old-space-size=512' },
      { path: '/dev', token: 't', bodies: true, force: true },
      'C:/x y/preload.cjs',
    );
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=512 --require "C:/x y/preload.cjs"');
    expect(env).toMatchObject({
      NODEUI_PATH: '/dev',
      NODEUI_TOKEN: 't',
      NODEUI_CAPTURE_BODIES: 'true',
      NODEUI_ENABLED: 'true',
    });
  });
});
