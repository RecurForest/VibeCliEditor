# VibeCliEditor Code Wiki

这份文档面向维护者，描述当前仓库里已经落地的实现，按现有代码组织，不把设计预案写成事实。

内容基于当前工作区代码整理，包含已经存在于仓库中的 `Workspace Search`、`Session Diff`、多窗口工作区切换等功能。

## 1. 项目定位

- VibeCliEditor 是一个基于 React + Tauri 2 的桌面工作台，目标是把文件浏览、文本编辑、集成终端和 AI CLI 会话放进同一窗口。
- 当前主界面由五块组成：自定义标题栏、左侧 Explorer、中间编辑区、右侧多会话终端、底部状态栏。
- 编辑区下方还可以展开一个独立的底部 `CMD` 面板，它和右侧终端不是同一个会话池。
- 当前活跃 UI 固定使用 `cmd`；底层类型和 Rust 后端虽然支持 `powershell`，但当前主界面没有把 shell 切换入口接上。
- 工作区来源优先是 URL 上的 `?workspace=` 参数，其次是前端 `localStorage` 中保存的最近目录；当前前端没有主动调用后端的 `get_default_root`。

## 2. 运行时结构

```text
React App (src/App.tsx)
  |- Titlebar / Workspace Switcher / Workspace Search
  |- Explorer (FileTree)
  |- Workbench (EditorPane + Session Diff Tab)
  |- Right Terminal Pane (multi-session xterm)
  |- Optional Bottom Inline CMD Terminal
  |- StatusBar
       |
       | Tauri invoke / event
       v
Tauri Commands
  |- files.rs
  |- terminal.rs
  |- session_diff.rs
       |
       v
Rust Services
  |- file_tree.rs
  |- terminal.rs
  |- session_diff.rs
  |- path_insert.rs
  |- paths.rs
```

补充说明：

- 右侧终端和底部内联终端各自持有一套独立的 `useTerminal()` 状态。
- 文件树、编辑器、搜索栏、状态栏都围绕同一个 `rootPath` 运转。
- `Session Diff` 的结果最终不是单独弹窗，而是作为一种特殊 workbench tab 插入编辑区。

## 3. 前端结构

### `src/App.tsx`

应用总装配层，负责把所有前端子系统串起来。

主要职责：

- 维护 `rootPath`、最近目录、窗口最大化状态、文件树刷新 token、底部终端显隐、session diff tab 状态。
- 通过 `useFileTree()`、`useEditor()`、`useTerminal()` 组合出主工作台行为。
- 根据文件树当前选中节点推导终端启动目录：
  - 选中目录时直接用该目录
  - 选中文件时用其父目录
  - 没有选中时回退到工作区根目录
- 提供工作区切换菜单：
  - 当前窗口打开
  - 新窗口打开
  - 最近目录列表
- 使用 `WebviewWindow` 通过 `?workspace=` 参数打开新窗口。
- 负责标题栏拖拽、最大化、最小化、关闭窗口。
- 把 `WorkspaceFileSearch`、Explorer、Editor、Terminal、StatusBar 组合成完整布局。
- 负责“从终端选中文本定位文件”这条辅助链路。

需要注意的当前行为：

- `shellKind` 在这里被硬编码成 `cmd`。
- `Session Diff` 被包装成 `WorkbenchTab`，直接和普通文件 tab 共用同一套标签栏。
- 工作区切换时会清空编辑器状态，并让终端 hook 关闭现有 session。

### `src/components/FileTree/useFileTree.ts`

文件树状态层。

职责：

- 在 `rootPath` 或 `refreshToken` 变化时调用 `scan_working_dir`。
- 同一工作区刷新时，尽量保留展开状态和选中状态。
- 懒加载目录内容：目录首次展开时调用 `read_directory`。
- 维护：
  - `rootNode`
  - `selectedPaths`
  - `expandedPaths`
  - `loadingPaths`
  - `contextMenu`
  - `error`
- 支持 `Ctrl` / `Cmd` 多选。
- 提供 `revealPath()`，用于：
  - 工作区搜索结果定位
  - “定位当前文件”功能
  - 从终端选择文本反查文件后展开树

当前特征：

- 文件点击会直接打开。
- 目录点击会切换展开状态。
- 右键菜单面向“将路径插入终端”和“打开资源管理器”。
- `quickInsert()` 和 `insertSelection()` 虽然在 hook 中存在，但当前主界面只实际使用了右键插入。

### `src/components/FileTree/FileTree.tsx`

Explorer 视图层。

职责：

- 渲染 Explorer 标题、空状态、加载状态、错误提示和树本体。
- 提供：
  - `Locate active file`
  - `Refresh workspace`
  - 空状态下的 `Open Folder`
- 在树节点选中后自动滚动到可视区域。
- 渲染右键菜单：
  - `To terminal`
  - `Open in Explorer`

### `src/components/FileTree/FileTreeItem.tsx`

递归渲染单个树节点。

职责：

- 区分目录和文件图标。
- 显示展开箭头、选中态、当前激活文件态。
- 显示两个轻量标记：
  - `...` 表示目录子项仍在加载
  - `M` 表示该文件在编辑器里有未保存内容

### `src/utils/tree.ts`

只做一件事：`replaceNodeChildren()`。

作用：

- 在懒加载目录返回后，把指定目录的 `children` 合并回现有树。

### `src/components/Editor/useEditor.ts`

编辑器状态层。

职责：

- 管理多标签页文件编辑。
- 打开文件时调用 `read_file`。
- 保存文件时调用 `write_file`。
- 用 `content !== savedContent` 判断 dirty 状态。
- 处理全局 `Ctrl` / `Cmd + S`。
- 维护光标行列信息。

当前行为：

- 只支持打开已有文件。
- 没有自动保存、冲突处理、格式化、撤销栈持久化等高级能力。
- `isSaving` 状态已存在，但当前 UI 没有显式展示保存中提示。
- 工作区切换时会清空所有已打开 tab。

### `src/components/Editor/EditorPane.tsx`

工作区中心视图。

职责：

- 统一渲染两类 tab：
  - 普通文件 tab
  - `Session Diff` tab
- 普通文件 tab 使用 Monaco 编辑器。
- Markdown 文件支持编辑 / 预览切换。
- 在顶部展示标签栏，在次级区域展示 breadcrumb。
- 当激活 tab 是 `Session Diff` 时，切换到 `DiffViewerPane`。

当前特征：

- 标签栏支持横向滚轮滚动。
- Markdown 预览通过 `marked + DOMPurify` 生成 HTML。
- 会话 diff tab 和普通文件 tab 共用同一个关闭 / 切换逻辑。

### `src/components/Editor/monaco.ts`

Monaco 的集中配置模块。

职责：

- 注册 web worker。
- 定义自定义深色主题 `vibe-cli-editor-dark`。
- 通过扩展名推断语言类型。

### `src/components/Editor/markdown.ts`

Markdown 渲染辅助模块。

职责：

- 用 `marked` 解析 Markdown。
- 用 `DOMPurify` 清洗 HTML。

### `src/components/WorkspaceSearch/WorkspaceFileSearch.tsx`

标题栏中的工作区文件搜索框。

职责：

- 只搜索文件名和相对路径，不搜索文件内容。
- 输入防抖 320ms。
- 最少 2 个字符才触发查询。
- 调用后端 `search_files`。
- 支持键盘上下选择和回车打开。

当前特征：

- 结果打开后会同时：
  - 在文件树中展开并选中对应路径
  - 在编辑器中打开文件
- 没有独立的“全局快捷键唤起搜索”逻辑。

### `src/components/DiffViewer/DiffViewerPane.tsx`

会话差异查看器。

职责：

- 展示某个 AI 会话启动以来的文件改动。
- 左侧展示改动文件列表。
- 右侧展示当前选中文件的差异详情。
- 文本文件使用 Monaco `DiffEditor` 渲染双栏差异。

当前特征：

- 会统计 `added` / `modified` / `deleted` 数量。
- 二进制文件和超大文件只展示状态，不展示文本预览。
- 后端直接返回 `originalContent` 和 `modifiedContent`；当前 UI 由 Monaco `DiffEditor` 基于这两段文本计算并渲染差异。

### `src/components/TerminalPane/useTerminal.ts`

终端状态层，也是当前前端最复杂的 hook。

职责：

- 初始化一个 `xterm.js` 实例。
- 管理多 session：
  - `shell`
  - `codex`
  - `claude`
- 维护 session 历史、当前选中 session、输出缓存、错误状态。
- 调用：
  - `start_terminal`
  - `terminal_write`
  - `terminal_resize`
  - `terminal_close`
  - `insert_paths`
- 监听：
  - `terminal-output`
  - `terminal-exit`
- 处理复制、粘贴、右键菜单配套行为。
- 负责 `Session Diff` 的前端生命周期：
  - AI session 启动后调用 `create_session_diff_baseline`
  - 用户查看 diff 时调用 `get_session_diff`
  - session 关闭或工作区变化时调用 `dispose_session_diff_baseline`
  - 工作区整体切换或 diff tracking 被关闭时调用 `dispose_session_diff_baselines`

当前特征：

- 切换 session 时，不是复用原生 PTY 视图，而是把该 session 累积的输出文本重新回放到当前 xterm。
- 新 session 创建后，前端会先写入一段 banner（title + workspace），然后再承接真实 PTY 输出。
- 第一次用户输入的可打印内容会尝试改写 session 标题，方便历史列表区分不同对话。
- 如果当前没有活动 session，`insertPaths()` 会先自动开一个 shell session 再写入路径。
- 工作区切换或工作区被清空时，会关闭并清空所有 session。
- 类型里虽然有 `starting` 状态，但当前运行时实际只会进入 `active` 和 `completed`。

### `src/components/TerminalPane/TerminalPane.tsx`

右侧终端面板。

职责：

- 渲染终端工具栏：
  - `Codex`
  - `Claude`
  - `Diff`
  - 新建 shell
  - session history
  - clear
  - close
- 渲染主终端视口。
- 渲染空状态和错误提示。
- 提供终端右键菜单：
  - `定位文件`
  - `复制`
  - `粘贴`

当前特征：

- `Diff` 只对 `codex` / `claude` session 有意义。
- `Preparing` / `Loading` 等按钮文案来自 `useTerminal()` 里的 diff 状态。

### `src/components/TerminalPane/InlineCmdTerminal.tsx`

底部内联终端。

职责：

- 在编辑器下方展开一个固定的 `CMD` 终端。
- 使用单独的 `useTerminal()` 实例。
- 面板显示后自动打开一个 shell。

当前特征：

- 它和右侧终端不共享 session。
- 只提供最小控制：清空和关闭。
- 不提供 `Codex` / `Claude` / `Diff` 工具条。

### `src/components/StatusBar/StatusBar.tsx`

底部状态栏。

职责：

- 显示当前 Git 分支。
- 显示活动文件名、光标位置、编码、扩展名、shell、工作区路径。

当前特征：

- Git 分支来自后端 `get_git_branch`。
- 会在以下时机重新拉取分支：
  - 工作区切换
  - 窗口重新获得焦点
  - 页面从隐藏变回可见
- 不显示诊断计数、Git 变更数、行尾格式等更细信息。

### `src/components/FileIcon/FileIcon.tsx`

轻量文件类型徽标。

职责：

- 按扩展名映射简短标签和颜色语义。
- 被文件树、编辑器 tab、diff 文件列表复用。

### `src/components/ActivityBar/ActivityBar.tsx`
### `src/components/Toolbar/Toolbar.tsx`

这两个组件目前仍在仓库中，但没有被 `src/App.tsx` 引用。

可以把它们视为：

- 早期布局残留
- 或未来可能复用的 UI 片段

当前不属于实际运行时入口。

## 4. 前端共享类型

`src/types/index.ts` 定义了当前前端核心共享类型，包括：

- `ShellKind`
- `PathInsertMode`
- `FileNode`
- `FileSearchResult`
- `TerminalSessionInfo`
- `TerminalSessionMode`
- `TerminalSessionStatus`
- `TerminalSessionRecord`
- `TerminalOutputEvent`
- `TerminalExitEvent`
- `SessionDiffFileStatus`
- `SessionDiffFile`
- `SessionDiffResult`
- `SessionDiffBaselineStatus`
- `CodexDiffSessionState`
- `ContextMenuState`
- `EditorTab`
- `SessionDiffTab`
- `WorkbenchTab`
- `CursorPosition`

需要注意的点：

- `FileNode` 除了树结构所需的路径 / 层级信息外，还带 `size` 和 `modifiedAt`，只是当前 UI 还没有大规模消费这些字段。
- `WorkbenchTab` 是当前编辑区支持“普通文件 tab + 会话 diff tab”的关键联合类型。
- `CodexDiffSessionState` 联合 `SessionDiffBaselineStatus`，驱动了终端面板里 `Diff / Preparing / Loading` 这组状态。
- `ContextMenuState` 目前只用于 Explorer 右键菜单。
- `TerminalSessionStatus` 定义了 `starting`，但当前 hook 逻辑尚未真的把 session 放进这个状态。

## 5. Tauri / Rust 结构

### `src-tauri/src/lib.rs`

Tauri 入口。

职责：

- 注册全局 `TerminalState`。
- 挂载：
  - `tauri-plugin-dialog`
  - `tauri-plugin-opener`
- 暴露 commands：
  - `get_default_root`
  - `scan_working_dir`
  - `read_directory`
  - `read_file`
  - `write_file`
  - `search_files`
  - `get_git_branch`
  - `open_in_file_manager`
  - `create_session_diff_baseline`
  - `get_session_diff`
  - `dispose_session_diff_baseline`
  - `dispose_session_diff_baselines`
  - `start_terminal`
  - `terminal_write`
  - `terminal_resize`
  - `terminal_close`
  - `insert_paths`

### `src-tauri/src/commands/files.rs`

文件系统相关 command 入口。

职责：

- 对 `file_tree` service 做薄封装。
- 提供文件搜索、Git 分支查询和系统文件管理器打开能力。

各命令说明：

- `get_default_root`
  - 根据 `VIBE_CLI_EDITOR_PROJECT_ROOT`、当前目录、是否位于 `src-tauri/` 下等规则推断默认根目录。
  - 当前前端没有实际调用它。
- `scan_working_dir`
  - 扫描工作区根节点和首层 children。
- `read_directory`
  - 读取某个目录的直接子项。
- `read_file`
  - 读取文本文件内容。
- `write_file`
  - 覆写文本文件内容。
- `search_files`
  - 返回最多 40 条匹配结果。
  - 查询会按空白分词；每个 token 都需要命中，文件名命中的权重高于相对路径命中。
- `get_git_branch`
  - 先尝试 `git branch --show-current`，失败时回退到 `git rev-parse --abbrev-ref HEAD`。
  - 如果 fallback 结果是 `HEAD`，会额外转成 `Detached`。
- `open_in_file_manager`
  - 如果传入的是文件，会打开其父目录，而不是高亮选择具体文件。

### `src-tauri/src/commands/terminal.rs`

终端 command 入口。

职责：

- 把前端字符串参数映射为后端枚举：
  - `ShellKind`
  - `PathInsertMode`
- 再委托给 `TerminalState`。

### `src-tauri/src/commands/session_diff.rs`

会话差异 command 入口。

职责：

- 对 `session_diff` service 做薄封装。
- 包含：
  - `create_session_diff_baseline`
  - `get_session_diff`
  - `dispose_session_diff_baseline`
  - `dispose_session_diff_baselines`

### `src-tauri/src/services/file_tree.rs`

当前文件系统服务核心。

职责：

- `scan_root`
- `read_directory`
- `read_file`
- `write_file`
- `search_files`

关键约束：

- 会先 `canonicalize` 根路径和目标路径。
- 会检查目标路径必须处于工作区根目录内。
- 隐藏路径判定规则很简单：文件名以 `.` 开头。
- 排序规则：目录优先，其次按名称不区分大小写排序。

当前实现特征：

- `scan_root()` 会把根目录首层 children 一并带回。
- `read_directory()` 只返回一层子节点，供前端懒加载。
- `read_file()` / `write_file()` 都是文本语义：
  - 使用 `fs::read_to_string`
  - 使用 `fs::write`
- `write_file()` 只支持写入已存在路径，不能借此创建新文件。
- `search_files()` 是递归扫描，先按空白分词，再按文件名和相对路径做模糊评分。
- 文件名命中会额外加权，所以同样匹配时，文件名更贴近查询的结果通常会排得更靠前。

当前缺口：

- 没有创建 / 删除 / 重命名 / 移动文件命令。
- 没有文件系统 watcher。
- 没有 `.gitignore` 解析。
- 二进制文件读取 / 编辑不在当前能力范围内。

### `src-tauri/src/services/terminal.rs`

后端终端核心服务。

职责：

- 维护 PTY session map。
- 为每个 session 保存：
  - `child`
  - `master`
  - `writer`
  - `working_dir`
  - `shell_kind`
- 启动 shell 进程并创建 PTY。
- 将 PTY 输出通过 Tauri 事件广播到前端。
- 处理输入、resize、close、路径插入。

当前行为：

- 支持的 shell：
  - `cmd.exe`
  - `powershell.exe -NoLogo`
- 启动 session 时会：
  - `canonicalize` 工作目录
  - 配置 PTY 尺寸
  - spawn shell
  - 立即写入启动命令，把 shell 切到目标目录
  - 可选执行前端传入的 startup command
- `close_session()` 会直接 kill 子进程。

已知限制：

- 后端记录的 `working_dir` 只是 session 启动目录，不会随着 shell 内部 `cd` 实时更新。
- `terminal-exit` 当前始终发出 `exit_code: None`，没有真实退出码。
- 当前实现是“事件转发 + 前端缓存输出”，不是多 PTY 视图并存。

### `src-tauri/src/services/session_diff.rs`

当前会话级差异服务。

职责：

- 在 AI session 启动时记录 baseline snapshot。
- 在用户手动查看 diff 时，比对 baseline 和当前工作区文件状态。
- 在单个 session 被移除时清理对应 baseline。
- 在工作区切换、工作区清空或关闭 diff tracking 时批量清理 baseline。

核心实现：

- baseline 存储位置：系统临时目录下的 `vibe-cli-editor-session-diff/<sessionId>/`
- 包含：
  - `manifest.json`
  - 文本文件基线副本目录 `files/`
- 每个 sessionId 各自占用一个子目录；重建某个 session 的 baseline 只会覆盖它自己的目录，不会清空其他 AI session 的 baseline。
- `manifest.json` 会记录每个基线文件的 `path`、`kind`、`size`、`modifiedAt`、`sha256`。
- 通过 SHA-256 判断内容是否变化。
- 通过相对路径并集计算：
  - `added`
  - `deleted`
  - `modified`

文件处理规则：

- 隐藏路径直接跳过。
- 目录级固定忽略：
  - `.git`
  - `node_modules`
  - `dist`
  - `build`
  - `target`
  - `.next`
  - `coverage`
- 文本 diff 只对 UTF-8 且不超过 1 MB 的文件生成。
- 超大文件或二进制文件仍会进入变更列表，但不返回文本预览内容。

需要注意的当前语义：

- 这是“会话启动以来工作区发生了什么变化”，不是“只归因于 AI 的变化”。
- 如果用户在 AI session 期间手动修改文件，这些变化也会一起出现在 diff 结果里。

### `src-tauri/src/services/path_insert.rs`

路径插入服务。

职责：

- 根据：
  - `project_root`
  - session 当前工作目录
  - 待插入路径列表
  - shell 类型
  - 插入模式
  生成一段可直接写入终端 stdin 的文本。

支持模式：

- `projectRelative`
- `absolute`

当前特征：

- `projectRelative` 下，如果结果是 `.` 且 session cwd 不等于项目根目录，会退回绝对路径，避免插入 `.` 带来歧义。
- `cmd` 使用双引号并转义 `"`。
- `powershell` 使用单引号并转义 `'`。
- 生成结果末尾会额外补一个空格，方便用户继续输入命令。

### `src-tauri/src/services/paths.rs`

Windows 路径兼容辅助。

职责：

- 去掉 Windows verbatim path 前缀，例如 `\\?\`。
- 避免路径展示和 shell 切换目录时出现异常格式。

### `src-tauri/src/models/*.rs`

后端模型当前分四组：

- `file_node.rs`
- `file_search_result.rs`
- `terminal.rs`
- `session_diff.rs`

作用：

- 为前后端序列化边界提供稳定结构。

## 6. 关键数据流

### 打开工作区

1. `App.tsx` 从 URL `?workspace=` 或最近目录列表推导初始 `rootPath`。
2. 用户也可以通过标题栏菜单调用系统目录选择器。
3. `useFileTree()` 监听 `rootPath` 后调用 `scan_working_dir`。
4. Rust 返回根节点和首层 children。
5. 前端渲染 Explorer。

### 多窗口切换工作区

1. 用户在标题栏工作区菜单里选择目录。
2. 如果当前没有工作区，默认在当前窗口打开。
3. 如果当前已有工作区，默认在新窗口打开。
4. 新窗口通过 `WebviewWindow` 和 `?workspace=` 参数启动。
5. 最近目录列表保存在浏览器 `localStorage`。

### 工作区搜索并打开文件

1. 用户在标题栏搜索框输入关键字。
2. `WorkspaceFileSearch` 调用 `search_files`。
3. 用户选中结果后：
   - `fileTree.revealPath()` 展开树并选中目标
   - `editor.openFile()` 调用 `read_file`
4. 文件在编辑区新开一个 tab。

### 从终端选中文本反查文件

1. 用户在右侧终端里选中文本并打开右键菜单。
2. 前端会把选中文本拆成若干候选路径 / 文件名。
3. 对每个候选调用 `search_files`。
4. 命中后复用“工作区搜索打开文件”同一条链路。

### 打开、编辑、保存文件

1. 用户点击文件树中的文件节点。
2. `useEditor.openFile()` 调用 `read_file`。
3. 文件内容被放入 tab 列表。
4. Monaco 编辑时更新 `content`。
5. dirty 状态由 `content !== savedContent` 计算。
6. 用户按 `Ctrl` / `Cmd + S` 时调用 `write_file`。

### 启动右侧终端 session

1. 用户点击 `Shell`、`Codex` 或 `Claude` 入口。
2. `useTerminal.startSession()` 调用 `start_terminal`。
3. Rust 创建 PTY 并启动目标 shell / CLI。
4. 后端通过 `terminal-output` 连续推送输出。
5. 前端缓存输出，并在选中的 session 上实时写入 xterm。
6. session 结束后，前端把它标记为 `completed`，并触发文件树刷新。

### 启动 AI session 并查看 diff

1. 用户点击 `Codex` 或 `Claude`。
2. `useTerminal()` 创建 session 后，同时调用 `create_session_diff_baseline`。
3. 基线准备完成前，`Diff` 按钮会显示 `Preparing`。
4. 用户点击 `Diff` 后，前端调用 `get_session_diff`。
5. 返回结果被 `App.tsx` 封装成 `SessionDiffTab`。
6. `EditorPane` 检测到这是 diff tab，转而渲染 `DiffViewerPane`。

### 将文件路径插入终端

1. 用户在 Explorer 中右键选中项。
2. 前端收集当前选中路径列表。
3. `useTerminal.insertPaths()` 检查是否已有活动 session。
4. 如果没有，会先自动创建一个 shell session。
5. 后端 `path_insert` 根据 shell 规则生成转义后的文本。
6. 文本直接写入 PTY stdin。

### 切换工作区

1. `rootPath` 变化。
2. 编辑器 tab 被清空。
3. `Session Diff` tab 被丢弃。
4. 两套终端 hook 各自关闭现有 session，并清理 AI session baseline。
5. 文件树重新扫描新工作区。

## 7. 仓库中的辅助目录和文档

### `docs/PHASE_1A_MANUAL_DIFF_PLAN.md`

这是 Session Diff 的设计说明，不是运行时真相。

当前实现与设计稿的差异之一：

- 设计稿倾向独立 diff 面板
- 当前实际落地是“编辑区中的特殊 tab”

### `UI-code/`

这是独立的前端原型目录，不是当前 Tauri 应用的运行入口。

特点：

- 自带独立 `package.json`
- 可以视为设计探索或视觉原型

### `__scaffold/`

保留了早期脚手架模板内容。

特点：

- 主要用于回看初始化结构
- 不参与当前主流程

## 8. 当前缺口和注意事项

如果要继续迭代，当前最值得留意的是这些点：

- 当前活跃 UI 没有 shell 切换入口，主流程实际固定走 `cmd`。
- `get_default_root` 虽然已实现，但当前前端没有调用。
- 文件系统侧只支持读 / 写已有文件，不支持创建、删除、重命名、移动。
- 没有文件监听器，文件树刷新目前依赖手动刷新或终端 session 结束后的回调。
- 编辑器默认按文本文件处理，不覆盖二进制编辑场景。
- 工作区搜索和 session diff 都采用内置忽略规则，不解析 `.gitignore`。
- 右侧终端和底部内联终端彼此独立，不共享 session 历史。
- `Session Diff` 能展示“会话期间的工作区变化”，但不能严格区分 AI 修改和人工修改。
- 后端没有真实终端退出码，也没有实时同步 shell 内部 cwd。
- `ActivityBar.tsx` 和 `Toolbar.tsx` 还在仓库里，但已经不代表当前主布局。

## 9. 快速定位

如果要改某一块，通常从这里开始：

- 应用总装配和窗口行为：`src/App.tsx`
- 文件树状态：`src/components/FileTree/useFileTree.ts`
- 编辑器状态：`src/components/Editor/useEditor.ts`
- 编辑器视图：`src/components/Editor/EditorPane.tsx`
- 工作区文件搜索：`src/components/WorkspaceSearch/WorkspaceFileSearch.tsx`
- 主终端状态：`src/components/TerminalPane/useTerminal.ts`
- 主终端视图：`src/components/TerminalPane/TerminalPane.tsx`
- 底部内联终端：`src/components/TerminalPane/InlineCmdTerminal.tsx`
- 会话 diff 视图：`src/components/DiffViewer/DiffViewerPane.tsx`
- 文件系统后端：`src-tauri/src/services/file_tree.rs`
- 终端后端：`src-tauri/src/services/terminal.rs`
- 会话 diff 后端：`src-tauri/src/services/session_diff.rs`
- 路径插入逻辑：`src-tauri/src/services/path_insert.rs`

## 10. 修改履历

| 日期 | 说明 |
| --- | --- |
| 2026-04-16 | 删除原有底部履历区块，新增并重建本次履历记录。|
1111111
