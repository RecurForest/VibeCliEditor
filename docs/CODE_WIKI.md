# VibeCliEditor Code Wiki

这份文档面向维护者，描述当前仓库里已经落地的实现，按现有代码组织，不把设计预案写成事实。

内容基于当前工作区代码整理，覆盖已经存在于仓库中的工作区切换、文件树增删改、编辑器、终端多会话、AI Session Diff、差异回滚，以及与 `codex` / `claude` 相关的实际启动链路。

## 1. 项目定位

- VibeCliEditor 是一个基于 React 19 + Tauri 2 的桌面工作台，目标是把文件浏览、文本编辑、集成终端和 AI CLI 会话放进同一窗口。
- 当前主界面由五块组成：自定义标题栏、左侧 Explorer、中间工作区、右侧多会话终端、底部状态栏。
- 编辑区下方还可以展开一个独立的底部 `CMD` 面板，它和右侧终端不是同一个会话池。
- 当前活跃 UI 固定使用 `cmd`；底层类型和 Rust 后端虽然支持 `powershell`，但主流程没有暴露 shell 切换入口。
- 右侧终端支持三类 session：
  - `shell`
  - `codex`
  - `claude`
- Session Diff 不是独立窗口，而是编辑区中的特殊 tab；同时还支持把变更文件直接作为普通内容 tab 打开。
- 工作区来源优先是 URL 上的 `?workspace=` 参数，其次是前端 `localStorage` 中保存的最近目录；前端仍然没有主动调用后端的 `get_default_root`。

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
  |- agent_sessions.rs
  |- session_diff.rs
  |- path_insert.rs
  |- paths.rs
```

补充说明：

- 右侧终端和底部内联终端各自持有一套独立的 `useTerminal()` 状态。
- 文件树、编辑器、搜索栏、状态栏都围绕同一个 `rootPath` 运转。
- 右侧终端会按工作区把 session 历史持久化到 `localStorage`；底部内联终端不持久化。
- 标题栏右上角的 Diff 区域负责统一控制 AI session 的 diff tracking、baseline 重建、diff 视图打开和“只看改动文件”视图。

## 3. 前端结构

### `src/App.tsx`

应用总装配层，负责把所有前端子系统串起来。

主要职责：

- 维护：
  - `rootPath`
  - 最近目录列表
  - 文件树刷新 token
  - 标题栏工作区菜单状态
  - 窗口最大化状态
  - 底部终端显隐
  - `Session Diff` tab 状态
  - 文件树输入对话框状态
- 通过 `useFileTree()`、`useEditor()`、`useTerminal()` 组合出主工作台行为。
- 统一把右侧终端和底部内联终端的默认启动目录固定为当前工作区根目录。
- 负责标题栏工作区切换：
  - 当前窗口打开
  - 新窗口打开
  - 最近目录列表
- 使用 `WebviewWindow` 通过 `?workspace=` 参数打开新窗口。
- 负责标题栏拖拽、最大化、最小化、关闭窗口。
- 负责“从终端选中文本定位文件”的辅助链路。
- 在标题栏右上角暴露 diff 控件：
  - Diff tracking 开关
  - `Diff`
  - `View`
  - `Baseline`
- 负责把 `SessionDiffResult` 包装成 `SessionDiffTab`，与普通编辑 tab 合并成统一的 `WorkbenchTab[]`。
- 会在窗口重新聚焦、页面从隐藏变回可见时，尝试自动刷新当前干净 tab 或当前 diff tab。

需要注意的当前行为：

- `shellKind` 在这里被硬编码成 `cmd`。
- `Session Diff` 和普通文件 tab 共用同一套标签栏、关闭逻辑和激活逻辑。
- 工作区切换时会清空编辑器状态，并让终端 hook 关闭现有 session。
- App 已经接入了一整套 Terminal Composer 的解析与 profile 逻辑，但当前传给 `TerminalPane` 的 `composerEnabled` 是 `false`，所以主界面没有把这套输入 UI 打开。

### `src/components/FileTree/useFileTree.ts`

文件树状态层。

职责：

- 在 `rootPath`、外部 `refreshToken` 或本地 reload token 变化时调用 `scan_working_dir`。
- 同一工作区刷新时尽量保留展开状态和选中状态。
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
  - “定位当前文件”
  - 从终端选择文本反查文件后展开树
- 提供右键上下文操作：
  - 插入路径到终端
  - 创建文件
  - 创建文件夹
  - 重命名
  - 删除
- 在创建、重命名、删除之后触发整棵树 reload，并尝试重新定位目标。

当前特征：

- 创建文件走后端 `upsert_file`，会直接创建空文件。
- 创建文件夹走后端 `create_directory`。
- 删除支持多选，但会先做祖先路径折叠，避免父目录和子文件重复删除。
- 不允许重命名工作区根目录。
- 删除后会调用外部 `onDeletePaths`，让编辑器同步关闭受影响 tab。
- 重命名后会调用外部 `onRenamePath`，让编辑器同步改写已打开 tab 的路径。

### `src/components/FileTree/FileTree.tsx`

Explorer 视图层。

职责：

- 渲染 Explorer 标题、空状态、加载状态、错误提示和树本体。
- 提供：
  - `Locate active file`
  - `Refresh workspace`
  - 空状态下的 `Open Folder`
- 渲染右键菜单入口并承接 `useFileTree()` 返回的上下文动作。

### `src/components/FileTree/FileTreeItem.tsx`

递归渲染单个树节点。

职责：

- 区分目录和文件图标。
- 显示展开箭头、选中态、当前激活文件态。
- 显示轻量状态标记：
  - `...` 表示目录子项仍在加载
  - `M` 表示该文件在编辑器里有未保存内容

### `src/utils/tree.ts`

只做一件事：`replaceNodeChildren()`。

作用：

- 在懒加载目录返回后，把指定目录的 `children` 合并回现有树。

### `src/components/Dialog/InputDialog.tsx`

简单输入对话框。

职责：

- 给文件树的“新建文件 / 新建文件夹 / 重命名”提供一个统一的文本输入层。
- App 用 Promise resolver 方式把输入结果回传给 `useFileTree()`。

### `src/components/Editor/useEditor.ts`

编辑器状态层。

职责：

- 管理多标签页文件编辑。
- 打开磁盘文件时调用 `read_file`。
- 打开虚拟只读文件时不走磁盘读取。
- 保存文件时调用 `write_file`。
- 用 `content !== savedContent` 判断 dirty 状态。
- 处理全局 `Ctrl` / `Cmd + S`。
- 维护光标行列信息。
- 提供多种“从磁盘刷新”能力：
  - `reloadCleanTabsFromDisk()`
  - `reloadPathsFromDisk()`
  - `reloadActiveTabFromDisk()`
- 提供 `removePaths()` 和 `renamePath()`，用于响应文件树删除 / 重命名后的 tab 同步。

当前行为：

- 磁盘文件仍然只支持文本读取与写入。
- `openVirtualFile()` 用于把某些没有真实磁盘语义的内容作为只读 tab 打开，例如：
  - diff 中的已删除文件
  - 二进制或超大文件的占位内容
- 工作区切换时会清空所有已打开 tab。
- 自动刷新只会覆盖“当前仍然是干净的 tab”；如果 tab 已被用户修改，不会被静默覆盖。
- `isSaving` 状态已存在，但当前 UI 只在逻辑层使用，没有单独渲染显式保存中提示。

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
- 当激活 tab 是 diff tab 时，在 breadcrumb 右侧显示 `added / modified / deleted` 汇总。

当前特征：

- 标签栏支持横向滚轮滚动。
- 普通 tab 支持 dirty 状态圆点。
- Markdown 预览通过 `marked + DOMPurify` 生成 HTML。
- diff tab 和普通 tab 共用同一个关闭 / 切换模型。

### `src/components/Editor/monaco.ts`

Monaco 的集中配置模块。

职责：

- 注册 web worker。
- 定义自定义主题 `vibe-cli-editor-dark`。
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
- 不带独立的全局快捷键唤起逻辑。

### `src/components/DiffViewer/DiffViewerPane.tsx`

会话差异查看器。

职责：

- 展示某个 AI session 启动以来的文件改动。
- 左侧展示改动文件列表。
- 右侧展示当前选中文件的差异详情。
- 文本文件使用 Monaco `DiffEditor` 渲染双栏差异。
- 提供三类回滚能力：
  - `Revert File`
  - `Revert All`
  - hunk 级 `Revert`

当前特征：

- 以 `SessionDiffResult` 为数据源，不自己重新扫描文件系统。
- 对已新增文件的整文件回滚会走 `delete_file`。
- 对其他可恢复文件的整文件或 hunk 回滚会走 `upsert_file`。
- 回滚成功后通过 `onSessionDiffFilesReverted` 通知上层：
  - 刷新文件树
  - 重新从磁盘加载相关编辑 tab
  - 刷新当前 session diff tab
- 二进制文件和超大文件会出现在变更列表中，但：
  - 不能做文本预览
  - 如果 baseline 没有保存可恢复文本，也不能做完整回滚
- 变更列表、当前选中文件和 diff editor 视图状态都有一定的前端内存态缓存。

### `src/components/TerminalPane/useTerminal.ts`

终端状态层，也是当前前端最复杂的 hook。

职责：

- 初始化一个 `xterm.js` 实例。
- 管理多 session：
  - `shell`
  - `codex`
  - `claude`
- 维护：
  - session 历史
  - 当前选中 session
  - 输出缓存
  - 错误状态
  - diff tracking 状态
  - 待应用的 agent profile
- 调用：
  - `start_terminal`
  - `resolve_codex_session_id`
  - `terminal_write`
  - `terminal_resize`
  - `terminal_close`
  - `insert_paths`
- 监听：
  - `terminal-output`
  - `terminal-exit`
- 处理复制、粘贴、右键菜单配套行为。
- 负责 Session Diff 前端生命周期：
  - 打开 Diff tracking 后，为后续 AI session 建 baseline
  - AI session 启动时，如 Diff tracking 已开启则自动建 baseline
  - 用户查看 diff 时调用 `get_session_diff`
  - session 关闭或工作区变化时清理对应 baseline

当前特征：

- 切换 session 时，不是复用原生 PTY 视图，而是把该 session 累积的输出文本重新回放到当前 xterm。
- 新 session 创建后，前端会先写入一段 banner（title + workspace），然后再承接真实 PTY 输出。
- 第一次用户输入的可打印内容会尝试改写 session 标题，方便历史列表区分不同会话。
- 右侧终端默认会把当前工作区的 session 列表和选中态持久化到 `localStorage`；刷新页面后：
  - 历史会恢复
  - 之前仍是 `active` 的 session 会被视为 `completed`
- `sendRawText()` / `sendToSelectedSession()` 支持多种发送策略，但当前主界面没有把 composer UI 打开。
- `startAgentSession()` 会根据 `AgentSessionProfile` 构造实际 CLI 进程：
  - `codex`
  - `claude`
- Claude 继续对话与 Codex 继续对话的策略不同：
  - Claude 更偏向 provider 原生 continue
  - Codex 需要额外解析 runtime session id
- `resolve_codex_session_id` 会去匹配本机 `.codex/sessions/**/rollout-*.jsonl`，把前端 session 映射到 Codex 真实 runtime session id。
- 如果当前没有活动 session，`insertPaths()` 会先自动开一个 shell session 再写入路径。
- 工作区切换或工作区被清空时，会关闭并清空所有 session。
- 类型里虽然有 `starting`，但当前运行时实际主要使用 `active` 和 `completed`。

### `src/components/TerminalPane/TerminalPane.tsx`

右侧终端面板。

职责：

- 渲染终端工具栏：
  - `Codex`
  - `Claude`
  - 新建 shell
  - 新建 Codex session
  - session history
  - clear
  - close
- 渲染主终端视口。
- 渲染空状态和错误提示。
- 提供终端右键菜单：
  - `Locate File`
  - `Copy`
  - `Paste`

需要注意的当前行为：

- Diff 相关按钮不在这个组件里，而是在 `App.tsx` 的标题栏右上角。
- `composerEnabled` 虽然作为 prop 存在，但 App 当前传的是 `false`。

### `src/components/TerminalPane/InlineCmdTerminal.tsx`

底部内联终端。

职责：

- 在编辑器下方展开一个固定的 `CMD` 终端。
- 使用单独的 `useTerminal()` 实例。
- 面板显示后自动打开一个 shell。

当前特征：

- 它和右侧终端不共享 session。
- `ownsSessionDiffLifecycle: false`，所以不会维护 AI session baseline。
- `persistSessions: false`，刷新页面不会保留底部终端历史。
- 只提供最小控制：清空、关闭、复制、粘贴。

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

### `src/components/FileIcon/FileIcon.tsx`

轻量文件类型徽标。

职责：

- 按扩展名映射简短标签和颜色语义。
- 被文件树、编辑器 tab、diff 文件列表复用。

### `src/components/TerminalPane/agentSessionProfiles.ts`

AI CLI 启动参数构造模块。

职责：

- 维护 `codex` / `claude` 的默认 profile 结构。
- 负责 profile clone / patch。
- 根据 provider 生成真实终端进程描述：
  - `command`
  - `args`

当前特征：

- `codex` 新会话默认追加 `--yolo`。
- `codex` 支持 profile 中的 `model`、`profile`、`sandboxMode`、`approvalPolicy`。
- `claude` 支持 profile 中的 `model`、`effort`。

### `src/components/TerminalPane/TerminalComposer.tsx`
### `src/components/TerminalPane/terminalSlashRouter.ts`
### `src/components/TerminalPane/terminalComposerSendStrategy.ts`

这几部分代码已经存在，但当前主界面没有真正打开它们。

可以把它们视为：

- 已实现但尚未接入可见 UI 的 composer 输入链路
- 后续可能启用的 agent prompt / slash command / 发送策略基础设施

当前不属于用户默认可见主流程。

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
- `AgentProvider`
- `RuntimeModelSwitchStrategy`
- `AgentSessionProfile`
- `AgentSessionMeta`
- `ComposerTarget`
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
- `SessionDiffViewButtonState`
- `ContextMenuState`
- `EditorTab`
- `SessionDiffTab`
- `WorkbenchTab`
- `CursorPosition`

需要注意的点：

- `AgentSessionMeta` 不只是记录 provider，还会记录：
  - 用户请求的 profile
  - runtime session id
  - 运行时 model 切换策略
- `TerminalSessionRecord` 是右侧终端 session 持久化的核心结构。
- `EditorTab` 可以是正常磁盘文件，也可以是只读虚拟文件。
- `WorkbenchTab` 是当前编辑区支持“普通文件 tab + 会话 diff tab”的关键联合类型。
- `TerminalSessionStatus` 仍然定义了 `starting`，但当前 hook 没有把 session 长时间保留在这个状态。

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
  - `upsert_file`
  - `create_directory`
  - `delete_file`
  - `delete_path`
  - `rename_path`
  - `search_files`
  - `get_git_branch`
  - `open_in_file_manager`
  - `create_session_diff_baseline`
  - `get_session_diff`
  - `dispose_session_diff_baseline`
  - `dispose_session_diff_baselines`
  - `start_terminal`
  - `resolve_codex_session_id`
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
  - 覆写已存在的文本文件内容。
- `upsert_file`
  - 写入文本文件；如果文件不存在则创建，必要时会创建父目录。
- `create_directory`
  - 递归创建目录。
- `delete_file`
  - 删除单个文件，主要被 diff 回滚场景复用。
- `delete_path`
  - 删除文件或目录。
- `rename_path`
  - 在工作区内重命名或移动路径。
- `search_files`
  - 返回最多 40 条匹配结果。
- `get_git_branch`
  - 先尝试 `git branch --show-current`，失败时回退到 `git rev-parse --abbrev-ref HEAD`。
  - 如果 fallback 结果是 `HEAD`，会额外转成 `Detached`。
- `open_in_file_manager`
  - Windows 下调用 `explorer.exe`
  - macOS 下调用 `open`
  - Linux 下调用 `xdg-open`
  - 如果传入的是文件，会打开其父目录，而不是高亮具体文件

### `src-tauri/src/commands/terminal.rs`

终端 command 入口。

职责：

- 把前端字符串参数映射为后端枚举：
  - `ShellKind`
  - `PathInsertMode`
- 暴露 `resolve_codex_session_id`，并委托给 `agent_sessions` service。
- 其余终端操作统一委托给 `TerminalState`。

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
- `upsert_file`
- `create_directory`
- `delete_file`
- `delete_path`
- `rename_path`
- `search_files`

关键约束：

- 会先 `canonicalize` 根路径和目标路径，或为不存在路径做“带现有祖先的规范化”。
- 会检查目标路径必须处于工作区根目录内。
- 隐藏路径判定规则很简单：文件名以 `.` 开头。
- 排序规则：目录优先，其次按名称不区分大小写排序。

当前实现特征：

- `scan_root()` 会把根目录首层 children 一并带回。
- `read_directory()` 只返回一层子节点，供前端懒加载。
- `write_file()` 只支持写入已存在文件。
- `upsert_file()` 可以新建文件，也会自动创建父目录。
- `create_directory()` 如果目录已存在会直接返回成功。
- `delete_path()` 可以删目录，目录删除走 `remove_dir_all`。
- `rename_path()` 不允许改名工作区根目录，也不允许覆盖已存在目标。
- `search_files()` 是递归扫描，按空白分词后做模糊评分；文件名命中权重高于相对路径命中。

当前缺口：

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
- 启动 shell 或外部 CLI 进程并创建 PTY。
- 将 PTY 输出通过 Tauri 事件广播到前端。
- 处理输入、resize、close、路径插入。

当前行为：

- 支持的 shell：
  - `cmd.exe`
  - `powershell.exe -NoLogo`
- 也支持通过 `TerminalSpawnProcess` 启动外部命令，前端当前主要用它来拉起：
  - `codex`
  - `claude`
- Windows 下如果目标命令在 PATH 中对应到 `.ps1`，会自动转成 `powershell -ExecutionPolicy Bypass -File ...` 启动。
- 启动 session 时会：
  - `canonicalize` 工作目录
  - 配置 PTY 尺寸
  - spawn 目标进程
  - 写入 startup input 或 startup command
- 普通 shell session 会自动注入一条切换目录命令，把 shell 带到目标工作区。
- `close_session()` 会直接 kill 子进程。

已知限制：

- 后端记录的 `working_dir` 只是 session 启动目录，不会随着 shell 内部 `cd` 实时更新。
- `terminal-exit` 当前始终发出 `exit_code: None`，没有真实退出码。
- 当前实现是“事件转发 + 前端缓存输出”，不是多 PTY 视图并存。

### `src-tauri/src/services/agent_sessions.rs`

Codex runtime session 解析服务。

职责：

- 根据：
  - 工作目录
  - 前端记录的 session 启动时间
  - 超时时间
  去匹配本地 `.codex/sessions` 目录里的 rollout 记录。

当前实现特征：

- 优先从 `CODEX_HOME` 推断目录，否则回退到：
  - `$HOME/.codex`
  - `%USERPROFILE%\\.codex`
- 递归搜索 `rollout-*.jsonl`。
- 读取首行 `session_meta`，只接受 `originator = codex-tui` 的记录。
- 通过 cwd 和启动时间做最接近匹配。

作用：

- 让前端“继续上一个 Codex 会话”时，能拿到 Codex 自己的 runtime session id。

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
- 每个 sessionId 各自占用一个子目录；重建某个 session 的 baseline 只会覆盖它自己的目录。
- `manifest.json` 会记录每个基线文件的：
  - `path`
  - `kind`
  - `size`
  - `modifiedAt`
  - `sha256`
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
- 额外还会忽略以 `target-` 开头的目录。
- 文本 diff 只对 UTF-8 且不超过 1 MB 的文件生成。
- 超大文件或二进制文件仍会进入变更列表，但不返回文本预览内容。

需要注意的当前语义：

- 这是“会话启动以来工作区发生了什么变化”，不是“只归因于 AI 的变化”。
- 如果用户在 AI session 期间手动修改文件，这些变化也会一起出现在 diff 结果里。
- baseline 与当前工作区根目录不匹配时，后端会拒绝返回 diff。

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
5. 最近目录列表保存在 `localStorage`。

### 创建、重命名、删除文件

1. 用户在 Explorer 里打开右键菜单。
2. 文件树根据操作类型调用：
  - `upsert_file`
  - `create_directory`
  - `rename_path`
  - `delete_path`
3. 成功后 `useFileTree()` 触发整棵树 reload。
4. 如果是新建文件，会自动 reveal 并在编辑器中打开。
5. 如果是重命名或删除，会通过回调同步更新编辑器中的已打开 tab。

### 工作区搜索并打开文件

1. 用户在标题栏搜索框输入关键字。
2. `WorkspaceFileSearch` 调用 `search_files`。
3. 用户选中结果后：
  - `fileTree.revealPath()` 展开树并选中目标
  - `editor.openFile()` 调用 `read_file`
4. 文件在编辑区新开一个 tab。

### 从终端选中文本反查文件

1. 用户在右侧终端里选中文本并打开右键菜单。
2. 前端把选中文本拆成若干候选路径 / 文件名。
3. 对每个候选调用 `search_files`。
4. 命中后复用“工作区搜索打开文件”同一条链路。

### 打开、编辑、保存文件

1. 用户点击文件树中的文件节点。
2. `useEditor.openFile()` 调用 `read_file`。
3. 文件内容被放入 tab 列表。
4. Monaco 编辑时更新 `content`。
5. dirty 状态由 `content !== savedContent` 计算。
6. 用户按 `Ctrl` / `Cmd + S` 时调用 `write_file`。

### 自动刷新干净 tab

1. 窗口重新聚焦，或页面从隐藏变回可见。
2. `App.tsx` 触发当前活动工作区内容刷新。
3. 对普通编辑 tab，会调用 `reloadActiveTabFromDisk({ closeMissing: true, onlyClean: true })`。
4. 只有仍然干净的 tab 会被磁盘内容覆盖。

### 启动右侧终端 session

1. 用户点击 `Shell`、`Codex` 或 `Claude` 入口。
2. `useTerminal.startSession()` 调用 `start_terminal`。
3. Rust 创建 PTY 并启动目标 shell / CLI。
4. 后端通过 `terminal-output` 连续推送输出。
5. 前端缓存输出，并在选中的 session 上实时写入 xterm。
6. session 结束后，前端把它标记为 `completed`，并触发文件树刷新。

### 启动 Codex / Claude session

1. `useTerminal.startAgentSession()` 根据 profile 生成 `spawnProcess`。
2. 后端直接启动对应 CLI：
  - `codex`
  - `claude`
3. 如果是继续某个 Codex session，前端会先尝试解析真实 runtime session id。
4. 右侧终端会记录该 session 的 `AgentSessionMeta`。

### 打开 AI session diff

1. 用户先打开标题栏里的 Diff tracking 开关。
2. AI session 启动时，如果 Diff tracking 已开启，则自动调用 `create_session_diff_baseline`。
3. baseline 准备完成前，`Diff` / `View` / `Baseline` 会受到状态限制。
4. 用户点击 `Diff` 后，前端调用 `get_session_diff`。
5. 返回结果被 `App.tsx` 封装成 `SessionDiffTab`。
6. `EditorPane` 检测到这是 diff tab，转而渲染 `DiffViewerPane`。

### 直接打开本次改动文件

1. 用户点击标题栏里的 `View`。
2. 前端先加载当前 session 的 `SessionDiffResult`。
3. 每个 diff 文件被转换成：
  - 磁盘文件 tab
  - 或只读虚拟 tab
4. 编辑区会直接打开这些内容 tab，而不是进入 `Session Diff` tab。

### 回滚单个文件、单个 hunk 或全部改动

1. 用户在 `DiffViewerPane` 中点击 `Revert File`、`Revert All` 或某个 hunk 的 `Revert`。
2. 前端根据文件状态决定：
  - 走 `delete_file`
  - 或走 `upsert_file`
3. 回滚成功后通知 App：
  - 刷新文件树
  - 从磁盘刷新相关编辑 tab
  - 重新加载当前 session diff

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
4. 两套终端 hook 各自关闭现有 session。
5. 右侧终端会清理 diff baseline 和 diff 状态；底部终端不会接管这部分生命周期。
6. 文件树重新扫描新工作区。

## 7. 仓库中的辅助目录和文档

### `docs/TERMINAL_COMPOSER_EXECUTION_PLAN.md`

这是 Terminal Composer 方向的设计 / 执行文档，不代表当前主界面已经把 composer UI 打开。

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
- 没有文件系统 watcher，文件树刷新仍然依赖手动刷新、操作回调或终端 session 结束后的刷新。
- 文件树搜索和 session diff 都采用内置忽略规则，不解析 `.gitignore`。
- 编辑器和文件读写默认按文本文件处理，不覆盖二进制编辑场景。
- Session Diff 能展示“会话期间的工作区变化”，但不能严格区分 AI 修改和人工修改。
- 后端没有真实终端退出码，也没有实时同步 shell 内部 cwd。
- 右侧终端和底部内联终端彼此独立，不共享 session 历史。
- Terminal Composer 相关代码已经存在，但当前默认 UI 没有启用。
- `ActivityBar.tsx` 和 `Toolbar.tsx` 还在仓库里，但已经不代表当前主布局。

## 9. 快速定位

如果要改某一块，通常从这里开始：

- 应用总装配和窗口行为：`src/App.tsx`
- 文件树状态：`src/components/FileTree/useFileTree.ts`
- 文件树视图：`src/components/FileTree/FileTree.tsx`
- 编辑器状态：`src/components/Editor/useEditor.ts`
- 编辑器视图：`src/components/Editor/EditorPane.tsx`
- 工作区文件搜索：`src/components/WorkspaceSearch/WorkspaceFileSearch.tsx`
- 会话 diff 视图与回滚：`src/components/DiffViewer/DiffViewerPane.tsx`
- 主终端状态：`src/components/TerminalPane/useTerminal.ts`
- 主终端视图：`src/components/TerminalPane/TerminalPane.tsx`
- 底部内联终端：`src/components/TerminalPane/InlineCmdTerminal.tsx`
- Agent profile 构造：`src/components/TerminalPane/agentSessionProfiles.ts`
- 文件系统后端：`src-tauri/src/services/file_tree.rs`
- 终端后端：`src-tauri/src/services/terminal.rs`
- Codex session 解析：`src-tauri/src/services/agent_sessions.rs`
- 会话 diff 后端：`src-tauri/src/services/session_diff.rs`
- 路径插入逻辑：`src-tauri/src/services/path_insert.rs`

## 10. 修改履历

| 日期 | 说明 |
| --- | --- |
| 2026-04-17 | 按当前代码重写整份 Code Wiki，补齐文件树增删改、AI session 启动链路、session 持久化、Diff toggle / View / Baseline、差异回滚、`agent_sessions.rs` 与已存在但默认未启用的 Terminal Composer 基础设施说明。 |
