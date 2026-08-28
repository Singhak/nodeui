import type { ReactNode } from 'react';
import { downloadCsv, downloadJson } from '../export';

export function Panel({
  title,
  children,
  className,
  exportName,
  exportJson: jsonData,
  exportCsv: csvRows,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  exportName?: string;
  exportJson?: unknown;
  exportCsv?: Array<object>;
}) {
  return (
    <section className={`panel${className ? ` ${className}` : ''}`}>
      <div className="panel-head">
        <h2 className="panel-title">{title}</h2>
        {exportName ? (
          <div className="panel-actions">
            {jsonData !== undefined ? (
              <button
                type="button"
                className="btn btn-mini"
                onClick={() => downloadJson(exportName, jsonData)}
              >
                JSON
              </button>
            ) : null}
            {csvRows ? (
              <button
                type="button"
                className="btn btn-mini"
                onClick={() => downloadCsv(exportName, csvRows)}
              >
                CSV
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function PanelLoading() {
  return <p className="muted">Loading…</p>;
}

export function PanelError({ message }: { message: string }) {
  return <p className="panel-error">{message}</p>;
}
