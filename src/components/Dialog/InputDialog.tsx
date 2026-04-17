import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

interface InputDialogProps {
  initialValue?: string;
  isOpen: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  submitLabel?: string;
}

export function InputDialog({
  initialValue = "",
  isOpen,
  onCancel,
  onSubmit,
  placeholder,
  submitLabel = "Confirm",
}: InputDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setValue(initialValue);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [initialValue, isOpen]);

  if (!isOpen) {
    return null;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    onSubmit(value);
  }

  return (
    <div
      className="input-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
      role="presentation"
    >
      <div className="input-dialog__panel" role="dialog" aria-modal="true">
        <input
          className="input-dialog__field"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={inputRef}
          spellCheck={false}
          type="text"
          value={value}
        />
        <div className="input-dialog__actions">
          <button className="input-dialog__button input-dialog__button--ghost" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="input-dialog__button" onClick={() => onSubmit(value)} type="button">
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
