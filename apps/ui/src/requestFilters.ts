export interface RequestFilters {
  classes: ReadonlySet<string>;
  method: string;
  query: string;
  /** Hide requests faster than this many milliseconds. */
  minMs: number;
}

export const EMPTY_FILTERS: RequestFilters = {
  classes: new Set(),
  method: 'all',
  query: '',
  minMs: 0,
};

const CLASS_PATTERN = /^[2-5]xx$/;

/** Serializes the active filters (defaults are omitted) so views can be shared as links. */
export function filtersToParams(f: RequestFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.classes.size > 0) p.set('status', [...f.classes].sort().join(','));
  if (f.method !== 'all') p.set('method', f.method);
  if (f.query.trim() !== '') p.set('q', f.query.trim());
  if (f.minMs > 0) p.set('min', String(f.minMs));
  return p;
}

export function paramsToFilters(p: URLSearchParams): RequestFilters {
  const classes = new Set((p.get('status') ?? '').split(',').filter((c) => CLASS_PATTERN.test(c)));
  const min = Number(p.get('min'));
  return {
    classes,
    method: /^[A-Za-z]{1,12}$/.test(p.get('method') ?? '') ? (p.get('method') as string) : 'all',
    query: (p.get('q') ?? '').slice(0, 200),
    minMs: Number.isFinite(min) && min > 0 ? Math.min(min, 3_600_000) : 0,
  };
}

export interface SavedView {
  name: string;
  /** Query string produced by {@link filtersToParams}. */
  params: string;
}

const STORAGE_KEY = 'nodeui.requestViews';
const MAX_VIEWS = 20;

export function loadViews(): SavedView[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (v): v is SavedView =>
          typeof v === 'object' &&
          v !== null &&
          typeof (v as SavedView).name === 'string' &&
          typeof (v as SavedView).params === 'string',
      )
      .slice(0, MAX_VIEWS);
  } catch {
    return [];
  }
}

/** Adds or replaces a view by name; returns the new list. */
export function saveView(views: SavedView[], view: SavedView): SavedView[] {
  const next = [view, ...views.filter((v) => v.name !== view.name)].slice(0, MAX_VIEWS);
  persist(next);
  return next;
}

export function deleteView(views: SavedView[], name: string): SavedView[] {
  const next = views.filter((v) => v.name !== name);
  persist(next);
  return next;
}

function persist(views: SavedView[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch {
    // private mode or blocked storage: views simply do not persist
  }
}
