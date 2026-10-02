import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';

export type SortDir = 'asc' | 'desc';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** Presence makes the column sortable. */
  sortValue?: (row: T) => number | string;
  align?: 'left' | 'right';
  /** Extra class on cells (e.g. `mono`, `nowrap`, `truncate`). */
  className?: string;
  /** Fixed width in px for numeric/time columns. */
  width?: number;
  /** Plain-text title for truncated cells. */
  title?: (row: T) => string;
}

export interface SortState {
  key: string;
  dir: SortDir;
}

export function sortRows<T>(rows: T[], columns: Column<T>[], sort: SortState | null): T[] {
  if (!sort) return rows;
  const col = columns.find((c) => c.key === sort.key);
  if (!col?.sortValue) return rows;
  const get = col.sortValue;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((a, b) => {
      const cmp =
        typeof a.v === 'number' && typeof b.v === 'number'
          ? a.v - b.v
          : String(a.v).localeCompare(String(b.v));
      return cmp !== 0 ? cmp * sign : a.i - b.i;
    })
    .map((x) => x.row);
}

/**
 * Accessible table: horizontal scroll wrapper (columns are never clipped),
 * sticky header, sortable headers with `aria-sort`, optional clickable rows.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  defaultSort = null,
  onRowClick,
  rowClass,
  caption,
  maxHeight,
  selectedKey,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  defaultSort?: SortState | null;
  onRowClick?: (row: T) => void;
  rowClass?: (row: T) => string | undefined;
  caption: string;
  maxHeight?: number | string;
  selectedKey?: string | number | null;
}) {
  const [sort, setSort] = useState<SortState | null>(defaultSort);
  const sorted = useMemo(() => sortRows(rows, columns, sort), [rows, columns, sort]);

  const toggle = (col: Column<T>): void => {
    setSort((prev) => {
      if (prev?.key === col.key) return { key: col.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      // numbers and times read best largest/newest first
      return { key: col.key, dir: col.align === 'right' ? 'desc' : 'asc' };
    });
  };

  const onKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRowClick?.(row);
    }
  };

  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => {
              const active = sort?.key === col.key;
              const ariaSort = col.sortValue
                ? active
                  ? sort?.dir === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
                : undefined;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={col.align === 'right' ? 'num' : undefined}
                  style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                >
                  {col.sortValue ? (
                    <button type="button" className="th-btn" onClick={() => toggle(col)}>
                      {col.label}
                      <span className="sort-ind" aria-hidden="true">
                        {active ? (sort?.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const key = rowKey(row);
            const cls = [
              rowClass?.(row),
              onRowClick ? 'row-click' : '',
              selectedKey === key ? 'row-selected' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <tr
                key={key}
                className={cls || undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => onKey(e, row) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={[col.align === 'right' ? 'num' : '', col.className ?? '']
                      .filter(Boolean)
                      .join(' ')}
                    title={col.title?.(row)}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
