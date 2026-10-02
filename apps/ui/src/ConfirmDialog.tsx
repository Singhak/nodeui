import { useRef } from 'react';
import { useModalFocus } from './components/common';

export function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  busy = false,
}: {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  if (!open) return null;
  return (
    <ConfirmDialogInner
      title={title}
      message={message}
      onConfirm={onConfirm}
      onCancel={onCancel}
      busy={busy}
    />
  );
}

function ConfirmDialogInner({
  title,
  message,
  onConfirm,
  onCancel,
  busy,
}: {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref, onCancel);
  return (
    <div className="dialog-overlay" role="presentation">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        tabIndex={-1}
      >
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy} data-autofocus>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
