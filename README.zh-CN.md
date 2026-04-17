# VibeCliEditor

[English](./README.md) | 简体中文

<p align="center">
  <img src="src/assets/vibe-cli-editor-logo.svg" alt="VibeCliEditor logo" width="96" />
</p>

<p align="center">
  <strong>VibeCliEditor 最大的特色，是为 AI vibe coding 提供可审查、可回退的会话级 diff 工作流。</strong>
  当你使用 <code>codex</code> 或 Claude Code（<code>claude</code>）开发时，真正麻烦的不只是让 AI 改代码，而是改完之后很难快速审查到底改了什么，也很难安全地还原。VibeCliEditor 把这些终端驱动的改动直接变成可查看、可对比、可回退的工作流。
</p>

<p align="center">
  你可以为一次 AI 会话建立 baseline，打开专门的 diff 视图，按文件检查改动，并按文件或按代码块执行 revert。这正面解决了 <code>codex</code> / Claude Code 工作流中最常见的痛点：改动来得快，但难审查、难撤销。
</p>

<p align="center">
  同时，VibeCliEditor 也把文件树、编辑器、集成终端和 AI CLI 入口放进同一个桌面工作区里，让你可以浏览文件、选中目标、查看 diff，并把文件路径快速送进终端工作流，而不需要在多个窗口和上下文之间来回切换。
</p>

<p align="center">
  <img src="public/vibe-cli-editor-snapshot.png" alt="VibeCliEditor snapshot" width="100%" />
</p>

> 核心意图：让 `codex` / Claude Code 会话里的改动变得可审查、可还原，同时也让你更轻松地把正确的项目文件带进 AI 驱动的开发循环。

## 项目为什么存在

在普通终端工作流里，AI CLI 工具很擅长生成和修改代码，但在一个重复动作上体验并不好：

- 在项目里找到正确的文件
- 判断下一个应该引用哪个文件或目录
- 再把这些路径快速送回终端输入中

VibeCliEditor 就是围绕这个缺口设计的。会话级 diff 工作流负责解决“怎么审查、怎么还原”这类核心问题，左侧 Explorer、工作区搜索和终端集成则负责更快定位文件，并把选中的路径更顺手地送进当前 AI 会话。

## 功能特性

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

### 环境要求

- Node.js
- pnpm
- Rust toolchain
- Tauri development environment

当前项目主要在 Windows 桌面环境下开发和验证。

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

当前仓库还没有附带 `LICENSE` 文件。

如果你准备公开发布，建议在发布前补上一份明确的开源许可证，例如：

- MIT
- Apache-2.0
- GPL-3.0

## 致谢

- [Tauri](https://tauri.app/)
- [React](https://react.dev/)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/)
- [xterm.js](https://xtermjs.org/)
