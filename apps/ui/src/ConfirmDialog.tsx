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
    <div className="dialog-overlay" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
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
