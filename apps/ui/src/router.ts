import { useCallback, useEffect, useState } from 'react';

/** Parses `#/requests` or `#/custom/queue` into path segments. */
export function parseHash(hash: string): string[] {
  return hash
    .replace(/^#\/?/, '')
    .split('?')[0]!
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

export function hrefFor(...segments: string[]): string {
  return `#/${segments.map(encodeURIComponent).join('/')}`;
}

/** Hash routing keeps the SPA independent of the mount path. */
export function useHashRoute(): { segments: string[]; navigate: (...s: string[]) => void } {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = useCallback((...s: string[]) => {
    window.location.hash = hrefFor(...s);
  }, []);
  return { segments: parseHash(hash), navigate };
}

/** Query parameters after `?` in the hash, e.g. `#/requests?status=5xx`. */
export function parseHashQuery(hash: string): URLSearchParams {
  const i = hash.indexOf('?');
  return new URLSearchParams(i === -1 ? '' : hash.slice(i + 1));
}

/** Rewrites the hash query in place, without adding a history entry. */
export function replaceHashQuery(params: URLSearchParams): void {
  const base = window.location.hash.split('?')[0] ?? '';
  const qs = params.toString();
  const next = `${window.location.pathname}${window.location.search}${base}${qs ? `?${qs}` : ''}`;
  window.history.replaceState(window.history.state, '', next);
}
