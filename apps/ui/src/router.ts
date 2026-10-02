import { useCallback, useEffect, useState } from 'react';

/** Parses `#/requests` or `#/custom/queue` into path segments. */
export function parseHash(hash: string): string[] {
  return hash
    .replace(/^#\/?/, '')
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
