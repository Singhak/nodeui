import { createReadStream, existsSync, statSync } from 'node:fs';
import type { Readable } from 'node:stream';
import { join, resolve, sep } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

export interface StaticAsset {
  content: Readable;
  contentType: string;
  length: number;
}

/**
 * Resolves a URL path to a file inside `rootDir`, serving `index.html` for
 * directories and falling back to `index.html` for unknown paths (SPA).
 * Returns null when the path would escape `rootDir`.
 */
export function resolveStaticAsset(rootDir: string, urlPath: string): StaticAsset | null {
  const relative = urlPath === '' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const candidate = resolve(rootDir, relative);
  const rootWithSep = rootDir.endsWith(sep) ? rootDir : rootDir + sep;
  if (candidate !== rootDir && !candidate.startsWith(rootWithSep)) {
    return null;
  }

  let file = candidate;
  if (existsSync(file) && statSync(file).isDirectory()) {
    file = join(file, 'index.html');
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    file = join(rootDir, 'index.html');
  }
  if (!existsSync(file)) {
    return null;
  }

  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  const stat = statSync(file);
  return {
    content: createReadStream(file),
    contentType: MIME_TYPES[ext] ?? 'application/octet-stream',
    length: stat.size,
  };
}
