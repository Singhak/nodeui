import { describe, expect, it } from 'vitest';
import {
  isLoopbackAddress,
  maskSecrets,
  resolveActivation,
  SECRET_KEY_PATTERN,
} from '../src/safety';

describe('resolveActivation', () => {
  it('is inactive (fail-closed) in production with no flag', () => {
    const result = resolveActivation({ NODE_ENV: 'production' });
    expect(result.active).toBe(false);
    expect(result.reason).toContain('fail-closed');
  });

  it('is active when NODEUI_ENABLED=true even in production', () => {
    const result = resolveActivation({ NODE_ENV: 'production', NODEUI_ENABLED: 'true' });
    expect(result.active).toBe(true);
    expect(result.reason).toContain('NODEUI_ENABLED');
  });

  it('is active in development NODE_ENV', () => {
    const result = resolveActivation({ NODE_ENV: 'development' });
    expect(result.active).toBe(true);
    expect(result.reason).toContain('NODE_ENV');
  });

  it('is active when NODE_ENV is unset', () => {
    const result = resolveActivation({});
    expect(result.active).toBe(true);
  });

  it('is inactive when NODEUI_ENABLED=false even in production', () => {
    const result = resolveActivation({ NODE_ENV: 'production', NODEUI_ENABLED: 'false' });
    expect(result.active).toBe(false);
    expect(result.reason).toContain('NODEUI_ENABLED');
  });

  it('allows NODEUI_ENABLED=false to force-disable outside production', () => {
    const result = resolveActivation({ NODE_ENV: 'development', NODEUI_ENABLED: 'false' });
    expect(result.active).toBe(false);
    expect(result.reason).toContain('NODEUI_ENABLED');
  });
});

describe('isLoopbackAddress', () => {
  it.each(['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1', 'localhost'])(
    'accepts %s',
    (address) => {
      expect(isLoopbackAddress(address)).toBe(true);
    },
  );

  it.each(['10.0.0.1', '192.168.1.5', '172.16.0.1', '::ffff:10.0.0.1', '203.0.113.7', undefined])(
    'rejects %s',
    (address) => {
      expect(isLoopbackAddress(address)).toBe(false);
    },
  );
});

describe('maskSecrets', () => {
  it('masks matching keys at the top level', () => {
    const out = maskSecrets({ API_TOKEN: 'abc', name: 'nodeui' });
    expect(out).toEqual({ API_TOKEN: '[REDACTED]', name: 'nodeui' });
  });

  it('masks nested objects and arrays recursively', () => {
    const out = maskSecrets({
      app: { connection: { password: 'hunter2', host: 'db.local' } },
      credentials: ['a', 'b'],
      items: [{ secret_key: 'x' }],
    });
    expect(out).toEqual({
      app: { connection: { password: '[REDACTED]', host: 'db.local' } },
      credentials: '[REDACTED]',
      items: [{ secret_key: '[REDACTED]' }],
    });
  });

  it('masks partial matches like apiKey and accessKeyId', () => {
    const out = maskSecrets({ apiKey: 'k', accessKeyId: 'a', accessKeySecret: 's' });
    expect(out).toEqual({
      apiKey: '[REDACTED]',
      accessKeyId: '[REDACTED]',
      accessKeySecret: '[REDACTED]',
    });
  });

  it('leaves primitive and non-matching values untouched', () => {
    const out = maskSecrets({ count: 3, ok: true, nested: null, list: [1, 2] });
    expect(out).toEqual({ count: 3, ok: true, nested: null, list: [1, 2] });
  });

  it('does not mutate the input', () => {
    const input = { token: 'abc', inner: { secret: 'xyz' } };
    const out = maskSecrets(input);
    expect(out).toEqual({ token: '[REDACTED]', inner: { secret: '[REDACTED]' } });
    expect(input).toEqual({ token: 'abc', inner: { secret: 'xyz' } });
  });

  it('masks EnvEntry values whose variable name matches the pattern', () => {
    const out = maskSecrets({
      environment: [
        { key: 'API_TOKEN', value: 'supersecret' },
        { key: 'NODE_ENV', value: 'development' },
      ],
    });
    expect(out).toEqual({
      environment: [
        { key: 'API_TOKEN', value: '[REDACTED]' },
        { key: 'NODE_ENV', value: 'development' },
      ],
    });
  });

  it('exposes the documented pattern', () => {
    expect('PASSWORD').toMatch(SECRET_KEY_PATTERN);
    expect('accessKeyId').toMatch(SECRET_KEY_PATTERN);
    expect('username').not.toMatch(SECRET_KEY_PATTERN);
  });

  it('redacts conservatively (substring match) to avoid leaking camelCase keys', () => {
    // `apiKey`, `accessKeyId`, `accessKeySecret` are common real config keys;
    // substring matching ensures they are never leaked even though it also
    // redacts rarer keys that merely contain a secret term (e.g. `hockey`).
    for (const key of ['apiKey', 'accessKeyId', 'accessKeySecret', 'hockey', 'monkey']) {
      const out = maskSecrets({ [key]: 'v' });
      expect(out[key]).toBe('[REDACTED]');
    }
  });
});
