import { AlertTriangle } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

interface ConfirmDialogProps {
  cancelLabel?: string;
  confirmLabel?: string;
  isOpen: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  tone?: "default" | "danger";
}

export function ConfirmDialog({
  cancelLabel = "Cancel",
  confirmLabel = "Confirm",
  isOpen,
  message,
  onCancel,
  onConfirm,
  title = "Confirm Action",
  tone = "default",
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    requestAnimationFrame(() => {
      panelRef.current?.focus();
    });
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    onConfirm();
  }

  return (
    <div
      className="confirm-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      role="presentation"
    >
      <div
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="confirm-dialog__panel"
        onKeyDown={handleKeyDown}
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="confirm-dialog__header">
          <div className="confirm-dialog__icon" data-tone={tone} aria-hidden="true">
            <AlertTriangle size={18} />
          </div>
          <div className="confirm-dialog__copy">
            <div className="confirm-dialog__title" id="confirm-dialog-title">
              {title}
            </div>
            <div className="confirm-dialog__message">{message}</div>
          </div>
        </div>

        <div className="confirm-dialog__actions">
          <button
            className="confirm-dialog__button confirm-dialog__button--ghost"
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="confirm-dialog__button"
            data-tone={tone}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
