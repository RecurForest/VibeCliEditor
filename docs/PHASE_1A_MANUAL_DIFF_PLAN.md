# Phase 1A Manual Diff Viewer Plan

## 1. Goal

为当前 `Codex` / `Claude` 集成先落一个最小版本：

- 不做自动弹出
- 不做 accept / refuse
- 不要求识别“每一轮对话结束”
- 只支持用户手动点击“查看差异”
- 展示“当前 AI 会话启动以来”的文件改动和文本 diff

这个阶段的目的不是做完整审阅系统，而是先把下面三件事跑通：

1. 会话级基线记录
2. 改动集合计算
3. 独立 diff 查看 UI

## 2. Scope

### In Scope

- 针对 `Codex` 和 `Claude` 会话
- 用户手动点击按钮后生成并展示 diff
- 支持查看：
  - 改动文件列表
  - 单文件 unified diff
  - 文件状态：新增 / 删除 / 修改
- 支持文本文件
- 当前会话关闭后，diff 基线失效

### Out of Scope

- 自动识别每轮对话结束
- 接受 / 拒绝改动
- hunk 级操作
- 普通 shell 会话 diff
- 二进制文件详细对比
- 基于 `.gitignore` 的完整忽略规则解析

## 3. User Flow

### 主流程

1. 用户点击 `Codex` 或 `Claude`
2. 应用启动当前 AI 会话
3. 同时记录这个会话的工作区基线
4. 用户与 AI CLI 交互
5. 用户手动点击 `查看差异`
6. 应用计算“当前工作区”相对“该会话基线”的变化
7. 右侧或独立面板展示 diff

### 边界行为

- 如果当前没有活动的 `Codex` 或 `Claude` 会话，按钮置灰
- 如果基线仍在构建，按钮显示 `Preparing...`
- 如果没有变化，显示 `No changes since session start`
- 如果文件是二进制或超大文件，只展示文件状态，不展示文本 diff

## 4. Core Design

### 4.1 基本策略

Phase 1A 不依赖 Git，也不依赖 Codex app-server。

继续沿用当前 PTY 方式启动 `codex --yolo` 或 `claude`，但在“AI 会话启动时”额外创建一个会话级 baseline snapshot。

手动点击 `查看差异` 时，对比：

- baseline snapshot
- 当前 workspace 实际文件内容

输出一个只读 diff 结果集。

### 4.2 为什么选 baseline snapshot

当前架构下：

- 只能可靠知道 AI CLI 进程什么时候启动 / 退出
- 不能可靠知道每一轮对话什么时候结束
- 编辑器的 dirty state 只覆盖应用内编辑，不覆盖 AI CLI 外部改动

所以对 Phase 1A 来说，最稳的基线是：

- 会话启动时记录一次原始状态
- 用户想看时再按需计算差异

### 4.3 baseline snapshot 内容

为每个支持 diff 的 AI terminal session 记录一个 snapshot manifest。

建议结构：

```ts
interface DiffBaselineFile {
  path: string;
  kind: "text" | "binary" | "missing";
  size: number;
  mtimeMs: number;
  snapshotPath?: string;
  contentHash?: string;
}

interface DiffBaselineSession {
  sessionId: string;
  rootPath: string;
  createdAt: number;
  status: "preparing" | "ready" | "error";
  files: DiffBaselineFile[];
}
```

其中：

- `snapshotPath` 指向应用缓存目录中的基线副本
- 文本文件保存原始内容副本
- 二进制文件只保存元数据，不做文本 diff

## 5. Snapshot Strategy

### 5.1 存储位置

不要把基线文件存回工作区。

建议放在应用缓存目录，例如：

```text
<AppData>/jterminal/session-diff/<sessionId>/
```

目录内包含：

- `manifest.json`
- `files/...` 基线副本

### 5.2 文件范围

Phase 1A 先用内置忽略规则，避免大目录拖慢基线构建。

建议默认忽略：

- `.git`
- `node_modules`
- `dist`
- `build`
- `target`
- `.next`
- `coverage`

同时继续忽略隐藏路径。

说明：

- 这不是最终忽略方案
- 只是为了让第一版性能可控
- 后续如果做正式审阅系统，再接 `.gitignore` 解析

### 5.3 文本文件限制

建议第一版只对下面文件生成文本 diff：

- UTF-8 / 常见源码文本文件
- 文件大小不超过 `1 MB` 或 `2 MB`

超出限制时：

- 文件仍计入改动列表
- 但详情页只显示 `Diff preview unavailable`

## 6. Diff Generation

### 6.1 比较结果模型

```ts
interface SessionDiffFile {
  path: string;
  status: "added" | "deleted" | "modified";
  isBinary: boolean;
  tooLarge: boolean;
  unifiedDiff: string | null;
}

interface SessionDiffResult {
  sessionId: string;
  rootPath: string;
  generatedAt: number;
  files: SessionDiffFile[];
}
```

### 6.2 计算逻辑

点击 `查看差异` 后：

1. 读取 `manifest.json`
2. 扫描当前 workspace
3. 用路径做并集比较
4. 得出：
   - baseline 有、当前没有 => `deleted`
   - baseline 没有、当前有 => `added`
   - 两边都有但内容不同 => `modified`
5. 对文本文件生成 unified diff
6. 返回给前端展示

### 6.3 文本 diff 算法

前端和 Rust 均可做，但建议放在 Rust 侧完成：

- 减少大文本在前后端来回传输
- 直接返回统一格式结果
- 后续 accept / refuse 也更容易复用

第一版输出 unified diff 字符串即可，不要求 hunk 元数据结构化。

## 7. UI Proposal

### 7.1 入口位置

建议在 `TerminalPane` 的 AI 工具区增加一个按钮：

- `Diff`
- 仅当选中会话为 `codex` 或 `claude` 且基线可用时可点击

### 7.2 展示位置

建议使用独立面板，而不是直接塞进现有 Editor tab。

推荐布局：

- 左侧：改动文件列表
- 右侧：当前文件 diff 内容

原因：

- 与普通文件编辑语义分离
- 后续扩展 accept / refuse 更自然
- 不污染已有 editor tabs

### 7.3 Phase 1A 展示项

文件列表展示：

- 相对路径
- 状态标签 `A / D / M`

详情区展示：

- 文件路径
- 文件状态
- unified diff 文本

Monaco 可作为 diff 文本查看器使用，但第一版不强依赖 `DiffEditor`。

## 8. Frontend Work Items

### 8.1 新增状态

在终端层新增 AI diff 会话状态：

```ts
interface CodexDiffSessionState {
  sessionId: string;
  baselineStatus: "idle" | "preparing" | "ready" | "error";
  lastDiffResult: SessionDiffResult | null;
  error: string | null;
}
```

### 8.2 新增能力

- `launchCodex()` 或 `launchClaude()` 后触发 baseline 初始化
- `requestSessionDiff(sessionId)` 主动请求 diff
- `DiffPanel` 组件展示结果

### 8.3 建议新增文件

```text
src/components/DiffViewer/DiffViewerPane.tsx
src/components/DiffViewer/useSessionDiff.ts
```

## 9. Rust / Tauri Work Items

### 9.1 新增命令

建议新增：

- `create_session_diff_baseline`
- `get_session_diff`
- `dispose_session_diff_baseline`

### 9.2 建议新增服务

```text
src-tauri/src/services/session_diff.rs
src-tauri/src/models/session_diff.rs
src-tauri/src/commands/session_diff.rs
```

### 9.3 服务职责

`create_session_diff_baseline`

- 校验 rootPath
- 扫描文件
- 写入 manifest 和 snapshot 副本

`get_session_diff`

- 读取 manifest
- 扫描当前文件
- 生成结果集
- 输出 unified diff

`dispose_session_diff_baseline`

- 关闭 session 时清理缓存目录

## 10. Implementation Phases

### Phase A

- 新增 Rust 数据模型
- 完成 baseline 创建与清理
- 能返回“改动文件列表”，先不返回文本 diff

### Phase B

- 加入 unified diff 生成
- 前端做独立 Diff 面板
- 挂上手动按钮

### Phase C

- 补充异常处理
- 优化大项目性能
- 增加无变化和超大文件提示

## 11. Risks

### 性能风险

如果工作区很大，启动 AI 会话时构建 baseline 会有延迟。

缓解方式：

- 内置忽略目录
- 限制文本文件大小
- 基线准备状态可视化

### 一致性风险

如果用户在 AI 会话期间手动修改文件，Phase 1A 仍会把这些变化一起显示。

这是允许的，因为当前目标只是“查看差异”，不是“精准归因到 agent 的每一次修改”。

### 文本编码风险

不是所有文件都能安全按 UTF-8 文本处理。

第一版应该保守：

- 识别失败就按二进制处理
- 不强行渲染 diff

## 12. Acceptance Criteria

满足以下条件即可认为 Phase 1A 完成：

1. 启动 `Codex` 或 `Claude` 会话后，应用可建立 baseline
2. 用户可手动点击 `Diff` 查看本会话以来的变更
3. 可正确列出新增 / 删除 / 修改文件
4. 文本文件可展示 unified diff
5. 无变化时有明确空状态
6. 关闭该会话后，可清理 baseline 缓存

## 13. Deferred Items

以下内容明确延后到后续阶段：

- 自动按每轮对话弹出 diff
- `accept all`
- `reject all`
- 单文件接受 / 拒绝
- hunk 级接受 / 拒绝
- 与 Codex thread 状态联动
- 基于 app-server 的 turn 级精确审阅

## 14. Recommended Next Step

建议按下面顺序推进：

1. 先实现 Rust 侧 baseline + 文件列表 diff
2. 再接前端独立查看面板
3. 最后补 unified diff 文本细节

这样可以先验证最关键的两件事：

- baseline 方案是否足够稳
- 大多数项目上的性能是否可接受
