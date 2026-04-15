# Jterminal Code Wiki

这份文档面向维护者，描述当前仓库的实际结构、模块职责和关键数据流。它只覆盖已经存在于代码中的行为。

## 1. 项目定位

Jterminal 当前是一个桌面 IDE 风格原型，核心能力集中在三块：

- 工作区文件树
- 轻量文本编辑
- 集成 Shell / AI CLI 终端

主入口是 React 前端，系统能力由 Tauri 命令桥接到 Rust 后端。

## 2. 运行时架构

```text
React UI
  ├─ FileTree
  ├─ Editor
  ├─ TerminalPane
  └─ StatusBar
       │
       ▼
Tauri invoke / event
       │
       ▼
Rust commands
  ├─ files.rs
  └─ terminal.rs
       │
       ▼
Rust services
  ├─ file_tree.rs
  ├─ terminal.rs
  ├─ path_insert.rs
  └─ paths.rs
```

## 3. 前端结构

### `src/App.tsx`

应用总装配层，负责：

- 维护 `rootPath`、`shellKind`、窗口状态和刷新标记
- 协调 `useFileTree`、`useEditor`、`useTerminal`
- 根据当前选中文件计算终端启动目录
- 提供自定义标题栏和窗口控制

需要注意的行为：

- 文件树路径插入固定调用 `terminal.insertPaths(paths, rootPath, "projectRelative")`
- 终端启动目录优先取当前选中节点，如果是文件则取其父目录
- 切换工作区时，编辑器状态会清空，终端会重置

### `src/components/FileTree/useFileTree.ts`

文件树状态层，负责：

- 调用 `scan_working_dir` 获取根节点
- 调用 `read_directory` 懒加载子目录
- 管理选中态、展开态、右键菜单和插入动作

当前交互特征：

- `Ctrl` / `Cmd` 支持多选
- 普通点击文件会直接打开
- 普通点击目录会切换展开状态
- 右键菜单只有一个核心动作：插入选中路径到终端

### `src/components/FileTree/FileTree.tsx`

纯展示层，渲染 Explorer 面板和上下文菜单。

### `src/components/FileTree/FileTreeItem.tsx`

递归渲染树节点，负责：

- 目录展开图标
- 选中态和激活态
- 未保存文件的 `M` 标记
- 通过 `event.ctrlKey || event.metaKey` 传递 additive 选择

### `src/components/Editor/useEditor.ts`

编辑器状态层，负责：

- 管理多标签页
- 打开文件内容
- 跟踪保存前后内容，生成 dirty 状态
- 处理 `Ctrl` / `Cmd + S`
- 计算光标所在行列

保存流程直接调用 Tauri `write_file`，没有防抖、格式化或冲突处理。

### `src/components/Editor/EditorPane.tsx`

当前编辑器 UI 是一个增强版 `textarea`：

- 左侧行号
- 顶部标签页
- 路径 breadcrumb
- 底部语言和光标信息

语言识别只基于扩展名映射。

### `src/components/TerminalPane/useTerminal.ts`

终端状态层，负责：

- 初始化 `xterm.js`
- 监听容器尺寸变化并同步到 PTY
- 调用 `start_terminal` / `terminal_write` / `terminal_resize` / `terminal_close`
- 监听 `terminal-output` 和 `terminal-exit`
- 提供三个启动入口：
  - `openShell()`
  - `launchCodex()` => `codex --yolo`
  - `launchClaude()` => `claude`

实现细节：

- 没有 session 时，插入路径会先自动启动终端
- 工作区切换时会关闭现有 session
- 前端会在空白终端视图中写入 `Jterminal` 和当前 workspace 作为启动占位信息

### `src/components/TerminalPane/TerminalPane.tsx`

终端展示层，包含：

- Shell / Codex / Claude 启动按钮
- 清屏和关闭按钮
- session / status / cwd 展示
- `xterm` 容器节点

### `src/components/StatusBar/StatusBar.tsx`

状态栏当前是静态和半静态混合实现：

- 分支固定显示 `main`
- 问题计数固定为 `0`
- 文件名、光标、编码、扩展名和 shell 来自运行时状态

这部分更像 UI 占位，尚未连接真实诊断或 Git 状态。

### `src/types/index.ts`

定义前端共享类型，包括：

- `ShellKind`
- `PathInsertMode`
- `FileNode`
- `TerminalSessionInfo`
- `TerminalOutputEvent`
- `TerminalExitEvent`
- `EditorTab`
- `CursorPosition`

## 4. Tauri / Rust 结构

### `src-tauri/src/lib.rs`

主入口负责：

- 注册 `TerminalState`
- 挂载 `dialog` 和 `opener` 插件
- 暴露 Tauri commands

当前注册命令如下：

- `get_default_root`
- `scan_working_dir`
- `read_directory`
- `read_file`
- `write_file`
- `start_terminal`
- `terminal_write`
- `terminal_resize`
- `terminal_close`
- `insert_paths`

### `src-tauri/src/commands/files.rs`

文件相关命令入口，基本是对 `file_tree` service 的薄封装。

额外逻辑只有 `get_default_root`，它负责推断默认项目目录。

### `src-tauri/src/commands/terminal.rs`

终端相关命令入口，负责把前端字符串参数映射为：

- `ShellKind`
- `PathInsertMode`

随后委托给 `TerminalState`。

### `src-tauri/src/services/file_tree.rs`

这是当前文件系统服务的核心，提供：

- `scan_root`
- `read_directory`
- `read_file`
- `write_file`

关键约束：

- 所有访问都会先 `canonicalize`
- 所有读写都会校验目标仍在工作区根目录内
- 隐藏项判断标准是文件名以 `.` 开头
- 节点排序规则是目录优先，其次按名称不区分大小写排序

这里没有文件监听器，也没有 `.gitignore` 解析。

### `src-tauri/src/services/terminal.rs`

这是后端最复杂的模块，负责：

- 维护 PTY session map
- 为每个 session 保存 child、master、writer、working_dir、shell_kind
- 启动 shell 进程
- 把 PTY 输出转发为 `terminal-output`
- 在 reader 结束时发出 `terminal-exit`
- 处理输入、resize、关闭和路径插入

当前 shell 支持：

- `cmd.exe`
- `powershell.exe -NoLogo`

启动逻辑：

- 先 canonicalize 目标工作目录
- 创建 PTY
- spawn shell
- 立即写入启动命令，把 shell 切到目标目录
- 可选继续执行用户指定的启动命令

已知限制：

- `working_dir` 在 session 生命周期内不会随 shell 内部 `cd` 变化
- `terminal-exit` 当前没有真实退出码

### `src-tauri/src/services/path_insert.rs`

负责把路径列表转换成可直接写入终端的字符串。

支持两种模式：

- `projectRelative`
- `absolute`

当前前端只使用 `projectRelative`。

转义规则：

- `cmd` 使用双引号，并把 `"` 转义成 `""`
- `powershell` 使用单引号，并把 `'` 转义成 `''`

### `src-tauri/src/services/paths.rs`

Windows 兼容处理模块，主要用途是移除 `\\?\` 这类 verbatim path 前缀，避免路径在前端显示或传入 shell 时出现异常。

### `src-tauri/src/models/terminal.rs`

定义后端终端相关模型：

- `ShellKind`
- `PathInsertMode`
- `TerminalSessionInfo`
- `TerminalOutputEvent`
- `TerminalExitEvent`

## 5. 关键数据流

### 打开工作区

1. 前端启动时调用 `get_default_root`
2. `useFileTree` 监听到 `rootPath` 后调用 `scan_working_dir`
3. Rust 返回根节点和首层 children
4. React 渲染 Explorer

### 展开目录

1. 用户点击目录节点
2. `useFileTree.toggleDirectory()` 检查是否已加载 children
3. 未加载时调用 `read_directory`
4. 返回结果通过 `replaceNodeChildren()` 合并进现有树

### 打开并保存文件

1. 用户点击文件节点
2. `useEditor.openFile()` 调用 `read_file`
3. 内容缓存进 tabs
4. 用户编辑后 dirty 状态由 `content !== savedContent` 判定
5. `Ctrl` / `Cmd + S` 调用 `write_file`

### 启动终端

1. `useTerminal` 初始化 `xterm`
2. 用户点击 Shell / Codex / Claude 按钮
3. 前端调用 `start_terminal`
4. Rust 创建 PTY 并启动 shell
5. Rust 后台线程转发输出事件
6. 前端监听 `terminal-output` 后写入 `xterm`

### 插入文件路径到终端

1. 文件树右键或标题栏按钮收集选中路径
2. `useTerminal.insertPaths()` 检查 session 是否存在
3. 如果没有 session，先启动终端
4. 调用 `insert_paths`
5. Rust 根据 shell 类型和插入模式生成转义后的路径文本
6. 文本直接写入 PTY stdin

## 6. 仓库中的辅助目录

### `UI-code/`

这个目录更像一份界面灵感或独立原型，不是当前 Tauri 应用的运行入口。里面有自己的 `package.json`、`README.md` 和 AI Studio 元数据。

### `__scaffold/`

保留了脚手架初始化时的模板内容，主要用于参考初始结构，不参与当前主流程。

## 7. 当前缺口

如果后续继续迭代，最值得先补的是这些点：

- 终端 cwd 跟踪
- 文件监听和自动刷新
- 真正的代码编辑器能力
- Git 状态接入
- 更完整的错误展示与测试

## 8. 快速定位

如果要改某一块，通常从这里开始：

- 布局和总装配：`src/App.tsx`
- 文件树状态：`src/components/FileTree/useFileTree.ts`
- 编辑器状态：`src/components/Editor/useEditor.ts`
- 终端状态：`src/components/TerminalPane/useTerminal.ts`
- 文件系统后端：`src-tauri/src/services/file_tree.rs`
- 终端后端：`src-tauri/src/services/terminal.rs`
- 路径插入逻辑：`src-tauri/src/services/path_insert.rs`
