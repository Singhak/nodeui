import type { ReactNode } from 'react';
import {
  Card,
  EmptyState,
  ErrorState,
  ExportButtons,
  Skeleton,
  ViewHeader,
} from '../components/common';
import { DataTable, type Column } from '../components/DataTable';
import { usePanel } from '../telemetry';
import type { PanelId } from '../types';

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
    const columns: Column<Obj>[] = headers.map((h) => ({
      key: h,
      label: h,
      className: 'mono',
      render: (row) => cell(row[h]),
      sortValue: (row) => {
        const v = row[h];
        return typeof v === 'number' ? v : cell(v);
      },
    }));
    return (
      <DataTable
        caption="Plugin data"
        columns={columns}
        rows={data}
        rowKey={(r) => data.indexOf(r)}
        maxHeight="calc(100vh - 260px)"
      />
    );
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <EmptyState title="No data" />;
    return <pre className="generic-pre">{JSON.stringify(data, null, 2)}</pre>;
  }
  if (isPlainObject(data)) {
    const keys = Object.keys(data);
    if (keys.length === 0) return <EmptyState title="No data" />;
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

export function GenericView({
  id,
  title,
  intervalMs,
}: {
  id: PanelId;
  title: string;
  intervalMs: number;
}) {
  const { data, error, refetch } = usePanel<unknown>(id, `/${encodeURIComponent(id)}`, intervalMs);
  return (
    <>
      <ViewHeader
        title={title}
        description="Custom panel registered by a plugin."
        actions={
          <ExportButtons
            name={`nodeui-${id}`}
            json={data ?? undefined}
            csv={isFlatObjectArray(data) ? data : undefined}
          />
        }
      />
      <Card>
        {error && data === null ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : data === null ? (
          <Skeleton lines={4} />
        ) : (
          <GenericData data={data} />
        )}
      </Card>
    </>
  );
}
