import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { downloadCsv, downloadJson } from '../export';

/** Card with an optional title row and actions. */
export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  id,
}: {
  title?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`} id={id}>
      {title || actions ? (
        <header className="card-head">
          <div>
            {title ? <h3 className="card-title">{title}</h3> : null}
            {subtitle ? <p className="card-sub">{subtitle}</p> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function ViewHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="view-head">
      <div>
        <h2 className="view-title">{title}</h2>
        {description ? <p className="view-desc">{description}</p> : null}
      </div>
      {actions ? <div className="view-actions">{actions}</div> : null}
    </div>
  );
}

export function ExportButtons({
  name,
  json,
  csv,
}: {
  name: string;
  json?: unknown;
  csv?: Array<object>;
}) {
  return (
    <div className="btn-group" role="group" aria-label="Export">
      {json !== undefined ? (
        <button type="button" className="btn btn-sm" onClick={() => downloadJson(name, json)}>
          JSON
        </button>
      ) : null}
      {csv ? (
        <button type="button" className="btn btn-sm" onClick={() => downloadCsv(name, csv)}>
          CSV
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ lines = 4, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="skeleton-block" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${95 - ((i * 13) % 40)}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <p className="empty-text">{children}</p> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <p className="error-text">
        <span aria-hidden="true">✕ </span>
        {message}
      </p>
      {onRetry ? (
        <button type="button" className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: string;
}) {
  return (
    <button
      type="button"
      className={`chip${tone ? ` chip-${tone}` : ''}${active ? ' chip-active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {active ? <span aria-hidden="true">✓ </span> : null}
      {children}
    </button>
  );
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Traps Tab inside `ref` while mounted, closes on Escape, moves focus in on
 * open and returns it to the previously focused element on close.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node;
    first?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const head = items[0] as HTMLElement;
      const tail = items[items.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (e.shiftKey && (active === head || active === node)) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && active === tail) {
        e.preventDefault();
        head.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [ref]);
}

/** Right-hand detail drawer (modal: focus trapped, Esc closes). */
export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref, onClose);
  return (
    <div className="drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <header className="drawer-head">
          <h3>{title}</h3>
          <button type="button" className="btn btn-sm" onClick={onClose} data-autofocus>
            Close
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}
