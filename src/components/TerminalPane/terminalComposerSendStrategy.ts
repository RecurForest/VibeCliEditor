export type TerminalComposerSendStrategy =
  | "auto"
  | "pty-cr"
  | "pty-crlf"
  | "xterm-paste-enter"
  | "xterm-paste-enter-delay"
  | "xterm-input-cr"
  | "xterm-char-by-char-cr"
  | "textarea-input-enter"
  | "textarea-paste-enter";

export interface TerminalComposerSendStrategyOption {
  label: string;
  value: TerminalComposerSendStrategy;
}

export const TERMINAL_COMPOSER_SEND_STRATEGY_OPTIONS: TerminalComposerSendStrategyOption[] = [
  { label: "Auto", value: "auto" },
  { label: "PTY + CR", value: "pty-cr" },
  { label: "PTY + CRLF", value: "pty-crlf" },
  { label: "Paste + Enter", value: "xterm-paste-enter" },
  { label: "Paste + Enter Delay", value: "xterm-paste-enter-delay" },
  { label: "Input + CR", value: "xterm-input-cr" },
  { label: "Chars + CR", value: "xterm-char-by-char-cr" },
  { label: "Textarea Input", value: "textarea-input-enter" },
  { label: "Textarea Paste", value: "textarea-paste-enter" },
];

export function isTerminalComposerSendStrategy(
  value: string | null | undefined,
): value is TerminalComposerSendStrategy {
  return TERMINAL_COMPOSER_SEND_STRATEGY_OPTIONS.some((option) => option.value === value);
}
