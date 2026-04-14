# Jterminal — 桌面终端文件管理器

## 1. 产品定位

**Jterminal** 是一款面向开发者的轻量级桌面终端编辑器，核心场景是在终端操作中快速定位并插入文件路径。

技术栈：
- **桌面框架**：Tauri v2（需 Rust 1.77+）
- **前端**：React 18 + TypeScript + Vite
- **后端**：Rust（tokio 异步运行时）

核心形态：
- 左侧文件树 + 右侧终端面板（可调节分割比例）
- 支持将选中文件的相对路径插入命令行输入区
- 首发支持 Windows，架构兼容 macOS / Linux

---

## 2. 系统架构

```text
┌───────────────────────────────────────────────┐
│                  Tauri Shell                   │
│  ┌──────────────┐       ┌──────────────────┐  │
│  │  React/TS UI │◄─IPC─►│   Rust Backend   │  │
│  │  (WebView)   │       │   (Commands)     │  │
│  └──────────────┘       └──────┬───────────┘  │
│                                │              │
│                    ┌───────────┼───────────┐  │
│                    │ PTY  │ FS │ Watcher   │  │
│                    └───────────┴───────────┘  │
└───────────────────────────────────────────────┘
```

### 前端层（React / TypeScript）

职责：
- 布局与界面（文件树、终端面板、工具栏、右键菜单、设置页）
- 终端渲染（xterm.js）
- 状态管理与用户交互

推荐依赖：
| 包名 | 用途 |
|---|---|
| react / react-dom | UI 框架 |
| typescript | 类型系统 |
| vite | 构建工具 |
| @xterm/xterm | 终端仿真 |
| @xterm/addon-fit | 终端自适应容器 |
| @xterm/addon-webgl | GPU 加速渲染（推荐） |
| zustand | 轻量状态管理 |
| react-virtuoso | 虚拟列表（大目录文件树） |
| react-resizable-panels | 面板布局拖拽调整 |
| lucide-react | 图标库 |
| react-hotkeys-hook | 快捷键绑定（Phase 2） |

### 桌面壳（Tauri v2）

职责：
- 桌面窗口管理与生命周期
- IPC 通道（前端 ↔ Rust command 调用）
- 事件系统（Rust 向前端推送消息）
- 文件系统权限边界（`allowlist` 最小权限原则）

> **安全边界**：Tauri v2 的 `capabilities` 配置应仅开放业务所需的 API（`fs:read`、`shell:open`、`dialog:open` 等），避免暴露 `shell:execute` 等高风险权限。

### 核心后端（Rust）

职责：
- 文件树扫描与懒加载
- 文件系统监听（增删改通知前端）
- `.gitignore` / 自定义 ignore 规则过滤
- PTY 终端会话管理
- cwd 跟踪
- 路径计算（绝对 → 相对，shell 转义）
- 配置持久化（JSON / TOML）

推荐 crate：
| crate | 用途 |
|---|---|
| tauri (v2) | 桌面框架 |
| tokio | 异步运行时 |
| serde + serde_json | 序列化 |
| anyhow / thiserror | 错误处理 |
| walkdir | 目录遍历 |
| ignore | gitignore 规则解析 |
| notify | 文件系统事件监听 |
| portable-pty | 跨平台 PTY |
| pathdiff | 相对路径计算 |
| dirs | 系统配置/数据目录 |
| tracing + tracing-subscriber | 结构化日志 |

---

## 3. 核心功能规划

### MVP（最小可用产品）
1. 打开 / 选择工作目录
2. 左侧文件树（懒加载、排序：目录在前）
3. 右侧终端（基于 PTY + xterm.js）
4. 右键文件 → 插入相对路径到终端
5. 多选文件批量插入
6. 自动 shell 转义（根据当前 shell 类型）
7. 最近项目列表

### Phase 2（增强体验）
1. 文件搜索（fuzzy match）
2. 收藏路径 / 书签
3. 命令模板（可参数化的常用命令片段）
4. 快捷键系统（可自定义绑定）
5. 终端多标签（多 PTY 会话）
6. 主题切换（亮色 / 暗色）

### Phase 3（高级功能）
1. Git 状态标记（modified / untracked / staged）
2. Prompt 模板库
3. AI 助手快捷动作（Claude / Codex 集成）
4. 工作区会话恢复（重启后还原上次状态）

---

## 4. 目录结构

```text
jterminal/
  src/                          # 前端源码
    components/
      FileTree/                 # 文件树组件
        FileTree.tsx
        FileTreeItem.tsx
        useFileTree.ts
      TerminalPane/             # 终端面板
        TerminalPane.tsx
        useTerminal.ts
      Toolbar/                  # 顶部工具栏
      ContextMenu/              # 右键菜单
      Layout/                   # 布局容器（可拖拽分割面板）
    pages/
      Home/                     # 主界面
      Settings/                 # 设置页
      Welcome/                  # 欢迎页 / 最近项目
    store/                      # zustand store
      fileTreeStore.ts
      terminalStore.ts
      settingsStore.ts
    hooks/                      # 自定义 hooks
    utils/                      # 工具函数
    types/                      # 全局类型定义
    App.tsx
    main.tsx
  src-tauri/                    # Rust 后端
    src/
      commands/                 # Tauri command（IPC 入口）
        files.rs
        terminal.rs
        config.rs
      services/                 # 业务逻辑
        file_tree.rs
        watcher.rs
        pty.rs
        cwd_tracker.rs
        path_insert.rs
      models/                   # 数据模型
        file_node.rs
        terminal_event.rs
        app_config.rs
      error.rs                  # 统一错误类型
      lib.rs
      main.rs
    capabilities/               # Tauri v2 权限配置
      default.json
    tauri.conf.json
  package.json
  tsconfig.json
  vite.config.ts
```

---

## 5. 关键模块设计

### FileTreeService

职责：
- 扫描目录（`walkdir` + `ignore`）
- 懒加载子目录（首次只展开一层）
- 过滤隐藏文件与 ignore 项
- 输出树节点数据
- 监听文件系统变化，增量更新

前端数据结构：
```ts
interface FileNode {
  /** 唯一标识，使用路径哈希 */
  id: string
  /** 文件/目录名 */
  name: string
  /** 绝对路径 */
  absPath: string
  /** 相对于项目根目录的路径 */
  relPath: string
  /** 是否为目录 */
  isDir: boolean
  /** 文件大小（字节），仅文件有效 */
  size?: number
  /** 最后修改时间（Unix 时间戳 ms） */
  modifiedAt?: number
  /** 目录是否含有子节点（用于懒加载展开箭头） */
  hasChildren?: boolean
  /** 子节点列表（懒加载后填充） */
  children?: FileNode[]
}
```

### TerminalService

职责：
- 创建 / 销毁 PTY 会话
- 管理多个终端实例（Phase 2 多标签）
- 接收前端输入，写入 PTY stdin
- 读取 PTY stdout，通过 Tauri event 推送至前端
- 处理终端 resize（同步 xterm.js 与 PTY 的行列数）

通信模型：
```text
 xterm.js ──onData──► Tauri invoke("terminal_write") ──► PTY stdin
 xterm.js ◄──write─── Tauri event("terminal_output") ◄── PTY stdout
 xterm.js ──onResize─► Tauri invoke("terminal_resize") ─► PTY resize
```

### CwdTracker

职责：
- 获取当前终端工作目录
- 在用户执行 `cd` 等命令后保持同步

推荐方案（按 Shell 类型分别实现）：

1. **PROMPT 注入（cmd.exe 默认方案）**：启动 `cmd.exe` 时通过设置 `PROMPT` 环境变量，在每次命令执行后输出包含当前目录的自定义标记（如 `$_$+JT_CWD:$P$_`）。Rust 端解析 PTY 输出流中的标记即可获得精确 cwd。此方案无需 OSC 支持，与 `cmd.exe` 完全兼容。
2. **OSC 转义序列（PowerShell / bash / zsh）**：当用户切换到 PowerShell 或 bash 等 Shell 时，注入 prompt 脚本，通过 OSC 序列（如 `\x1b]7;file://host/path\x07`）上报当前 cwd。
3. **进程查询（备用）**：定期查询终端子进程的工作目录。Windows 下通过 `NtQueryInformationProcess` 获取，Linux/macOS 下读取 `/proc/<pid>/cwd`。
4. **手动同步（兜底）**：仅在上述方案均失败时使用，默认以项目根目录为 cwd。

### PathInsertService

职责：
- 绝对路径 → 相对路径（基于当前 cwd 计算）
- Shell 转义（根据 shell 类型应用不同规则）
- 写入 PTY 输入缓冲区（或复制到剪贴板）

转义规则：
| Shell | 转义策略 |
|---|---|
| cmd.exe | 双引号包裹，`"` 转义为 `""` |
| PowerShell | 单引号包裹，`'` 转义为 `''` |
| bash / zsh | 单引号包裹，`'` 转义为 `'\''` |

---

## 6. 关键交互

### 文件路径插入
- **插入到光标位置**：写入 PTY stdin（默认行为）
- **追加到命令末尾**：同上，终端光标通常在行尾
- **复制到系统剪贴板**：调用 Tauri clipboard API

### 路径模式（用户可在设置中切换默认值）
- 相对于当前终端 cwd（默认推荐）
- 相对于项目根目录
- 绝对路径
- 自动加引号（含空格 / 特殊字符时自动启用）

### 拖拽支持
- 文件树节点拖拽至终端面板 → 自动插入路径

---

## 7. 技术决策

### 为什么选 Tauri v2 + Rust + React/TS
- 比 Electron 更轻量（包体约 5-10MB vs 100MB+）
- 比纯 Rust GUI（egui / iced）更容易构建现代界面
- 比 Qt 更适合快速迭代和 Web 生态复用
- Tauri v2 的 plugin 体系和安全模型更成熟
- Windows 支持足够稳定

### 为什么终端渲染选 xterm.js
- 业界最成熟的 Web 终端仿真器
- 社区活跃，文档和资料丰富
- 与 PTY 分层清晰，前后端职责分明
- 支持 WebGL 加速渲染

### 为什么 PTY 交给 Rust
- Rust 更适合做底层会话管理和系统调用
- 多会话并发由 tokio 异步运行时保证性能
- 避免 Node.js 原生模块的跨平台编译问题

---

## 8. 开发阶段计划

### Phase 1：基础骨架（3~5 天）
- [ ] 使用 `create-tauri-app` 初始化项目（React + TypeScript + Vite）
- [ ] 搭建前端布局框架（可拖拽分割面板）
- [ ] 实现 Rust 端文件树扫描，前端渲染文件树
- [ ] 实现 Rust 端 PTY 管理，前端集成 xterm.js
- [ ] 实现单文件相对路径插入到终端

### Phase 2：核心体验完善（5~7 天）
- [ ] 多选文件批量插入
- [ ] CwdTracker 实现（cmd.exe PROMPT 注入优先，PowerShell/bash 用 OSC 方案）
- [ ] 右键菜单功能完善
- [ ] 最近项目列表与持久化
- [ ] 设置页（Shell 类型、主题、路径模式等）

### Phase 3：进阶功能（7~14 天）
- [ ] 文件搜索（fuzzy match）
- [ ] 快捷键系统
- [ ] 命令模板
- [ ] Git 状态集成
- [ ] 终端多标签
- [ ] 主题切换（亮色 / 暗色）

---

## 9. 构建与发布

### 开发环境
```bash
# 前置依赖
# - Rust 1.77+ (rustup)
# - Node.js 18+ (推荐 20 LTS)
# - pnpm (推荐) 或 npm

# 安装前端依赖
pnpm install

# 启动开发模式（前端热重载 + Rust 重编译）
pnpm tauri dev

# 格式化与检查
pnpm lint
cargo fmt --check
cargo clippy
```

### 生产构建
```bash
# 构建可分发安装包（Windows: .msi / .exe）
pnpm tauri build
```

### CI 建议
- GitHub Actions：使用 `tauri-apps/tauri-action` 自动构建多平台产物
- 版本号管理：遵循 SemVer，通过 `tauri.conf.json` 中的 `version` 字段统一管理

---

## 10. 风险点与应对

| 风险 | 说明 | 应对策略 |
|---|---|---|
| Windows PTY 兼容性 | ConPTY 存在重绘、光标定位、ANSI 序列兼容等已知问题 | MVP 默认绑定 `cmd.exe`；关注 `portable-pty` 上游 issue；后续支持 PowerShell / Git Bash |
| CWD 跟踪稳定性 | 跨平台、跨 Shell 获取准确工作目录困难 | MVP 默认 `cmd.exe`，优先实现 PROMPT 注入方案；后续支持 PowerShell/bash 时补充 OSC 方案；最终兜底用项目根目录 |
| Shell 转义差异 | 不同 Shell 对特殊字符的转义规则不同 | 建立转义规则表，PathInsertService 根据 Shell 类型分发 |
| 大目录性能 | 万级文件时文件树扫描和渲染可能卡顿 | Rust 端分页/流式返回；前端使用 `react-virtuoso` 虚拟列表；懒加载子目录 |
| Tauri v2 生态成熟度 | 部分 Tauri plugin 尚未完全适配 v2 | 跟踪官方 plugin 适配进度；必要时使用 Tauri v2 的自定义 plugin 机制替代 |
| xterm.js 内存占用 | 长时间运行终端的 scrollback buffer 可能导致内存增长 | 限制 scrollback 行数（默认 5000 行）；提供清屏快捷操作 |

---

## 11. 下一步计划

1. 确定产品名称（当前暂定 **Jterminal**）
2. 使用 `create-tauri-app` 初始化项目骨架
3. 定义 Rust command 接口（IPC 协议）
4. 实现 Phase 1 的开发任务清单
5. MVP 完成后进行内部试用，收集反馈
