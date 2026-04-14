import type { ShellKind } from "../../types";

interface ToolbarProps {
  rootPath: string | null;
  shellKind: ShellKind;
  onPickDirectory: () => Promise<void>;
  onRefresh: () => void;
  onShellChange: (shellKind: ShellKind) => void;
}

export function Toolbar({
  rootPath,
  shellKind,
  onPickDirectory,
  onRefresh,
  onShellChange,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <button className="toolbar__button" onClick={() => void onPickDirectory()} type="button">
        选择目录
      </button>

      <button className="toolbar__button" onClick={onRefresh} type="button">
        刷新文件树
      </button>

      <div className="toolbar__path" title={rootPath ?? "尚未选择工作目录"}>
        <span className="toolbar__label">Workspace</span>
        {rootPath ?? "尚未选择工作目录"}
      </div>

      <select
        aria-label="Terminal shell"
        className="toolbar__select"
        onChange={(event) => onShellChange(event.currentTarget.value as ShellKind)}
        value={shellKind}
      >
        <option value="cmd">cmd.exe</option>
        <option value="powershell">PowerShell</option>
      </select>
    </header>
  );
}
