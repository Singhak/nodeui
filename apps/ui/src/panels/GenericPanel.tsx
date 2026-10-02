import type { ReactNode } from 'react';
import { getPanel } from '../api';
import { useLivePanel } from '../hooks';
import type { PanelId } from '../types';
import { Panel, PanelError, PanelLoading } from './Panel';

type Obj = Record<string, unknown>;

function isPlainObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/** A non-empty array of objects whose values are all scalars. */
export function isFlatObjectArray(value: unknown): value is Obj[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((row) => isPlainObject(row) && Object.values(row).every(isScalar))
  );
}

function cell(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function renderValue(value: unknown): ReactNode {
  if (isScalar(value)) return cell(value);
  return <pre className="generic-pre">{JSON.stringify(value, null, 2)}</pre>;
}

export function GenericData({ data }: { data: unknown }) {
  if (isFlatObjectArray(data)) {
    const headers = [...new Set(data.flatMap((row) => Object.keys(row)))];
    return (
      <table className="table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>
              {headers.map((h) => (
                <td key={h} className="mono">
                  {cell(row[h])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <p className="muted">No data.</p>;
    return <pre className="generic-pre">{JSON.stringify(data, null, 2)}</pre>;
  }
  if (isPlainObject(data)) {
    const keys = Object.keys(data);
    if (keys.length === 0) return <p className="muted">No data.</p>;
    return (
      <dl className="kv">
        {keys.map((key) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{renderValue(data[key])}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <p className="mono">{cell(data)}</p>;
}

export function GenericPanel({
  id,
  title,
  intervalMs,
}: {
  id: PanelId;
  title: string;
  intervalMs: number;
}) {
  const { data, error } = useLivePanel<unknown>(
    id,
    () => getPanel<unknown>(`/${encodeURIComponent(id)}`),
    intervalMs,
  );

  return (
    <Panel
      title={title}
      exportName={`nodeui-${id}`}
      exportJson={data ?? undefined}
      exportCsv={isFlatObjectArray(data) ? data : undefined}
    >
      {error ? (
        <PanelError message={error} />
      ) : data === null ? (
        <PanelLoading />
      ) : (
        <GenericData data={data} />
      )}
    </Panel>
  );
}
