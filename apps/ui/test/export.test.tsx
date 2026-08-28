import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadCsv, downloadJson, toCsv } from '../src/export';

describe('toCsv', () => {
  it('emits a header row and quoted values', () => {
    const rows = [
      { method: 'GET', path: '/a', status: 200 },
      { method: 'POST', path: '/b', status: 500 },
    ];
    expect(toCsv(rows)).toBe('method,path,status\nGET,/a,200\nPOST,/b,500\n');
  });

  it('quotes fields containing commas, quotes, or newlines', () => {
    const csv = toCsv([{ note: 'hello, "world"\nnext' }]);
    expect(csv).toContain('"hello, ""world""\nnext"');
  });
});

describe('download helpers', () => {
  const original = {
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  };

  afterEach(() => {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
    vi.restoreAllMocks();
  });

  it('downloadJson builds a blob and clicks an anchor', () => {
    const click = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({
      click,
      set href(_v: string) {},
    } as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as unknown as Node);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as unknown as Node);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    downloadJson('nodeui-health', { status: 'ok' });
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
  });

  it('downloadCsv converts rows to CSV', () => {
    const click = vi.fn();
    vi.spyOn(document, 'createElement').mockReturnValue({
      click,
      set href(_v: string) {},
    } as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as unknown as Node);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as unknown as Node);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    downloadCsv('nodeui-requests', [{ method: 'GET', path: '/a', status: 200 }]);
    expect(click).toHaveBeenCalled();
  });
});
