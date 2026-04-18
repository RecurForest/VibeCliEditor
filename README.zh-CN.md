# VibeCliEditor

[English](./README.md) | 简体中文

<p align="center">
  <img src="src/assets/vibe-cli-editor-logo.svg" alt="VibeCliEditor logo" width="96" />
</p>

> [!IMPORTANT]
> Windows 快速安装：前往 [Releases](https://github.com/jipeigong/VibeJTerminal/releases/latest) 下载最新打包版本，直接安装其中的 `.exe` 或 `.msi` 即可开始使用。
> 当前打包版仅支持 Windows。如果你想使用快捷启动入口，请先确认本机 `PATH` 中已经有 `codex` 和/或 `claude`。

## 核心亮点

- 面向 `codex` 和 Claude Code CLI 会话的 Terminal Composer，在终端工作区内提供独立的提示词输入区
- 支持通过文件选择器添加附件、粘贴本地文件路径，以及直接把截图或图片粘贴进 composer
- 粘贴进来的文件会在发送前自动保存成临时附件路径，让终端 AI 工作流里的附件传递更稳定
- session diff baseline、专用 diff 视图，以及按文件或代码块回退能力，让 AI 改动始终可审查、可回退

<p align="center">
  <strong>VibeCliEditor 把 AI 会话级 diff 工作流和面向 Codex / Claude Code 的实用 composer 放进了同一个桌面工作区。</strong>
  当你使用 <code>codex</code> 或 Claude Code（<code>claude</code>）开发时，麻烦的不只是让 AI 改代码，还包括怎么把正确的上下文附进去、怎么快速审查改动，以及怎么安全地回退。VibeCliEditor 把这些终端驱动的关键步骤都集中到一个工作区里。
</p>

<p align="center">
  你可以为一次 AI 会话建立 baseline，打开专门的 diff 视图，按文件检查改动，并按文件或按代码块执行 revert。现在你也可以在发送前把文件附件、粘贴图片和项目路径一起整理好，再送进当前 CLI 会话。
</p>

<p align="center">
  VibeCliEditor 把文件树、编辑器、集成终端、AI CLI 入口，以及新的 composer 输入流整合到同一个桌面界面中，让你可以浏览文件、选中目标、查看 diff、附加正确的文件，并把整个工作流留在一个窗口里完成。
</p>

<p align="center">
  <img src="public/vibe-cli-editor-snapshot.png" alt="VibeCliEditor snapshot" width="100%" />
</p>

> 核心意图：让 `codex` / Claude Code 会话里的改动可审查、可回退，也让项目文件、截图和提示词上下文更容易进入同一条 AI 开发链路。

## 项目为什么存在

在普通终端工作流里，AI CLI 工具很擅长生成和修改代码，但在几个重复动作上体验并不好：

- 在项目里找到正确的文件
- 判断下一个该引用哪个文件、目录或截图
- 再把这些路径或粘贴进来的图片快速送回当前终端提示词

VibeCliEditor 就是围绕这个缺口设计的。会话级 diff 工作流负责解决“怎么审查、怎么还原”，Explorer、工作区搜索、终端集成，以及 composer 的附件能力则负责更快地定位文件并把正确上下文带进当前 AI 会话。

## 功能特性

- 面向 `codex` / `claude` 的 Terminal Composer，支持草稿保留、附件选择、图片粘贴、缩略图预览和提示词插入
- 面向 AI 编码会话的 session diff 工作流，支持 baseline 建立、专用 diff 视图和还原操作
- 支持按文件和按代码块回退 `codex` / `claude` 工作流中的改动
- 基于 Tauri 2、React 19、TypeScript 和 Rust 的桌面工作区
- 支持懒加载、选择、刷新和上下文操作的文件树 Explorer
- 基于 Monaco 的代码编辑器，适配常见源码文件类型
- 基于 `xterm.js` 和 `portable-pty` 的集成终端
- 面向本地 AI CLI 的快速启动入口，例如 `codex` 和 `claude`
- 位于标题栏的工作区文件搜索
- 面向终端优先 AI 编码场景设计的文件路径插入流
- 最近工作区切换和多窗口打开项目能力

## 预览

当前项目更接近一个聚焦型桌面编码工作区，而不是完整 IDE。重点放在本地工作流效率，尤其是终端驱动的 AI 开发体验。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 桌面壳层 | Tauri 2 |
| 前端 | React 19 + TypeScript + Vite 7 |
| 编辑器 | Monaco Editor |
| 终端渲染 | xterm.js |
| 布局 | react-resizable-panels |
| 后端 | Rust |
| PTY | portable-pty |
| 图标 | lucide-react |

## 项目结构

```text
VibeCliEditor/
|-- src/                # React 前端
|-- src-tauri/          # Tauri + Rust 后端
|-- public/             # 静态资源
|-- scripts/            # 开发辅助脚本
|-- docs/               # 额外文档
|-- package.json
`-- README.md
```

## 快速开始

### 安装打包版（仅 Windows）

- 前往 [Releases](https://github.com/jipeigong/VibeJTerminal/releases/latest) 下载最新打包版本
- 安装其中的 `.exe` 或 `.msi`
- 如果你想使用快捷启动入口，请确保本机 `PATH` 中已经有 `codex` 和/或 `claude`

### 源码开发环境要求

- Node.js
- pnpm
- Rust toolchain
- Tauri development environment

当前项目和当前打包版都主要在 Windows 桌面环境下开发与验证。

### 安装依赖

```bash
pnpm install
```

### 开发模式运行

```bash
pnpm tauri dev
```

如果你只想启动前端开发服务器：

```bash
pnpm dev
```

### 构建

```bash
pnpm build
pnpm tauri build
```

## 使用说明

- 当没有最近工作区时，应用会保持空状态，等待你自己打开文件夹
- 你可以通过 Explorer 定位文件，并把选中的路径送进终端工作流
- 集成终端的设计目标，是更顺滑地配合本机已安装的 AI CLI 使用
- 标题栏的工作区切换器支持以新窗口方式打开其它项目

如果你想使用终端里的快捷启动入口，请确保这些命令已经在本机 `PATH` 中可用：

- `codex`
- `claude`

## 开发说明

仓库里的 `scripts/run-tauri.mjs` 会帮助规范本地 Tauri 执行流程，包括：

- 注入 `VIBE_CLI_EDITOR_PROJECT_ROOT`
- 使用独立的 Cargo target 目录
- 在 Windows 下减少陈旧进程带来的干扰

## 路线图

- 增加文件监听与更智能的刷新机制
- 改进终端与工作区目录同步
- 扩展编辑器能力，例如格式化和 diff 工作流
- 增加设置、快捷键和主题定制
- 完善打包、测试和发布流程

## 参与贡献

欢迎提交 issue 和 pull request。

适合优先投入的方向：

- 面向 AI 终端使用场景的文件插入工作流
- Explorer 与工作区交互细节
- 编辑器可用性增强
- 终端行为与跨平台兼容性

## 许可证

VibeCliEditor 采用 MIT License。详见 [LICENSE](./LICENSE)。

## 致谢

- [Tauri](https://tauri.app/)
- [React](https://react.dev/)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/)
- [xterm.js](https://xtermjs.org/)
