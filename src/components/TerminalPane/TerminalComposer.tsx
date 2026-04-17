import { ArrowUp, CornerDownLeft } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type {
  TerminalComposerSendStrategy,
  TerminalComposerSendStrategyOption,
} from "./terminalComposerSendStrategy";

export interface TerminalComposerInsertRequest {
  id: number;
  text: string;
}

interface TerminalComposerProps {
  canSubmit?: boolean;
  disabled?: boolean;
  externalInsertRequest?: TerminalComposerInsertRequest | null;
  onSubmit: (text: string) => Promise<void>;
  onSendStrategyChange?: (strategy: TerminalComposerSendStrategy) => void;
  placeholder?: string;
  quickActions?: Array<{
    label: string;
    text: string;
  }>;
  sendStrategy?: TerminalComposerSendStrategy;
  sendStrategyOptions?: TerminalComposerSendStrategyOption[];
}

export function TerminalComposer({
  canSubmit = true,
  disabled = false,
  externalInsertRequest,
  onSubmit,
  onSendStrategyChange,
  placeholder,
  quickActions = [],
  sendStrategy,
  sendStrategyOptions = [],
}: TerminalComposerProps) {
  const helperId = useId();
  const isComposingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (disabled) {
      return;
    }

    textareaRef.current?.focus();
  }, [disabled]);

  useEffect(() => {
    if (!externalInsertRequest?.text) {
      return;
    }

    insertText(externalInsertRequest.text);
  }, [externalInsertRequest?.id]);

  function insertText(text: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      setValue((current) => (current ? `${current}${text}` : text));
      setError(null);
      return;
    }

    const selectionStart = textarea.selectionStart ?? value.length;
    const selectionEnd = textarea.selectionEnd ?? value.length;
    const nextValue = value.slice(0, selectionStart) + text + value.slice(selectionEnd);

    setValue(nextValue);
    setError(null);

    requestAnimationFrame(() => {
      textarea.focus();
      const nextCursor = selectionStart + text.length;
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function insertQuickAction(text: string) {
    insertText(text);
  }

  async function handleSubmit() {
    if (disabled || isSubmitting) {
      return;
    }

    if (!value.trim()) {
      setError("Enter some text first.");
      return;
    }

    if (!canSubmit) {
      setError("Start a terminal session first.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit(value);
      setValue("");
      textareaRef.current?.focus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (
      isComposingRef.current ||
      event.nativeEvent.isComposing ||
      (event.key !== "Enter" && event.code !== "Enter" && event.code !== "NumpadEnter") ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return;
    }

    event.preventDefault();
    void handleSubmit();
  }

  return (
    <div className="terminal-composer">
      <div className="terminal-composer__card">
        <textarea
          aria-describedby={error ? helperId : undefined}
          className="terminal-composer__input"
          disabled={disabled || isSubmitting}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) {
              setError(null);
            }
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={textareaRef}
          rows={3}
          spellCheck={false}
          value={value}
        />
        <div className="terminal-composer__footer">
          <div className="terminal-composer__actions">
            {quickActions.map((action) => (
              <button
                className="terminal-composer__action-chip"
                disabled={disabled || isSubmitting}
                key={`${action.label}:${action.text}`}
                onClick={() => insertQuickAction(action.text)}
                type="button"
              >
                {action.label}
              </button>
            ))}
          </div>
          <div className="terminal-composer__controls">
            {sendStrategy && sendStrategyOptions.length > 0 ? (
              <select
                className="terminal-composer__strategy-select"
                disabled={disabled || isSubmitting}
                onChange={(event) =>
                  onSendStrategyChange?.(event.target.value as TerminalComposerSendStrategy)
                }
                title="Composer send strategy"
                value={sendStrategy}
              >
                {sendStrategyOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}
            {error ? (
              <span
                className="terminal-composer__meta-text terminal-composer__meta-text--error"
                id={helperId}
              >
                {error}
              </span>
            ) : (
              <span className="terminal-composer__meta-text terminal-composer__meta-text--subtle">
                Enter sends. Shift+Enter inserts a newline.
              </span>
            )}
            <button
              className="terminal-composer__send"
              disabled={disabled || isSubmitting || !canSubmit}
              onClick={() => void handleSubmit()}
              title="Send"
              type="button"
            >
              {isSubmitting ? <CornerDownLeft size={14} /> : <ArrowUp size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
