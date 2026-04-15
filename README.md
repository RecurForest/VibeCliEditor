# Jterminal

<p align="center">
  <img src="src/assets/jterminal.png" alt="Jterminal logo" width="96" />
</p>

<p align="center">
  A desktop workspace built with Tauri 2, React 19, TypeScript and Rust.
</p>

<p align="center">
  Jterminal 将文件树、Monaco 编辑器、集成终端和 AI CLI 入口整合到一个桌面窗口中，目标是提供一个轻量、直接、适合本地工程工作的开发工作台。
</p>

## Features

- 自定义桌面工作台界面，包含标题栏、文件树、编辑区、终端区和状态栏
- 基于 Monaco Editor 的代码编辑体验，支持常见代码文件语言识别
- 工作区文件树支持懒加载、展开收起、右键菜单和多选
- 顶部工作区文件搜索，支持模糊搜索并定位到左侧文件树后直接打开
- 多标签编辑，支持脏状态提示和 `Ctrl/Cmd + S` 保存
- 右侧终端与底部内联终端，默认基于 `cmd` 工作
- 可从终端入口快速启动本地 AI CLI，例如 `codex` 和 `claude`
- 左下角显示当前真实 Git 分支
- 工作区切换支持最近目录，并以新窗口方式打开新的项目目录

## Preview

当前项目更接近一个持续迭代中的桌面 IDE 风格原型，重点放在本地工作流整合而不是完整 IDE 功能覆盖。

如果你准备将它发布到 GitHub，建议后续补充：

- 应用截图或演示 GIF
- LICENSE 文件
- issue / pull request 模板

## Tech Stack

| Layer | Stack |
| --- | --- |
| Desktop Shell | Tauri 2 |
| Frontend | React 19 + TypeScript + Vite 7 |
| Editor | Monaco Editor |
| Terminal Rendering | xterm.js |
| Layout | react-resizable-panels |
| Backend | Rust |
| PTY | portable-pty |
| Icons | lucide-react |

## Project Structure

```text
Jterminal/
├─ src/                # React frontend
├─ src-tauri/          # Tauri + Rust backend
├─ public/             # Static assets
├─ scripts/            # Development helper scripts
├─ docs/               # Additional project docs
├─ package.json
└─ README.md
```

## Getting Started

### Requirements

- Node.js
- pnpm
- Rust toolchain
- Tauri development environment

当前项目主要按 Windows 桌面环境进行开发和验证。

### Install

```bash
pnpm install
```

### Run In Development

```bash
pnpm tauri dev
```

如果你只想单独运行前端开发环境：

```bash
pnpm dev
```

### Build

```bash
pnpm build
pnpm tauri build
```

## Usage Notes

- `Open Folder` 会以新窗口方式打开新的工作区，不会直接覆盖当前窗口内容
- 顶部搜索框会在当前工作区内执行文件模糊搜索
- Explorer 中选择文件后会在中间编辑区打开，并在状态栏显示当前文件信息
- 终端相关快捷入口依赖本机已安装对应 CLI 命令

如果你希望快速使用 AI CLI 入口，请确保这些命令在本机 `PATH` 中可用：

- `codex`
- `claude`

## Development Notes

仓库中的 `scripts/run-tauri.mjs` 会在开发启动时做一些额外处理：

- 注入 `JTERMINAL_PROJECT_ROOT`
- 配置独立的 Cargo target 目录
- 在 Windows 下清理旧的开发端口占用进程

## Roadmap

- 增加文件监听与自动刷新
- 增强终端工作目录同步能力
- 补充更多编辑器能力，例如格式化、Diff、快捷操作
- 完善设置项、快捷键和主题配置
- 补充测试、发布流程和开源协作规范

## Contributing

欢迎提交 issue 或 pull request。

如果你准备参与开发，建议优先关注这些方向：

- UI/UX 细节打磨
- 文件树与工作区交互
- 编辑器体验增强
- 终端能力与跨平台兼容性

## License

当前仓库还没有附带 `LICENSE` 文件。

如果你准备将项目公开到 GitHub，建议在发布前补充一个明确的开源协议，例如：

- MIT
- Apache-2.0
- GPL-3.0

## Acknowledgements

- [Tauri](https://tauri.app/)
- [React](https://react.dev/)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/)
- [xterm.js](https://xtermjs.org/)
