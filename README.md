# Jterminal

Jterminal 是一个基于 `Tauri 2 + React 19 + TypeScript + Rust` 的桌面工作台，目标是把工作区文件浏览、轻量文本编辑和集成终端放到同一个窗口里。

当前仓库已经实现的是一个可运行的桌面原型，不再只是早期规划稿。本文档按现有代码说明项目，开发向结构说明见 [docs/CODE_WIKI.md](docs/CODE_WIKI.md)。

## 当前功能

- 打开本地工作区目录，并在启动时自动解析默认根目录
- 左侧文件树按目录优先排序，子目录按需懒加载
- 过滤以 `.` 开头的隐藏文件和目录
- 支持 `Ctrl` / `Cmd` 多选文件节点
- 右键或工具栏将选中文件路径插入到终端
- 中间编辑器支持多标签页、脏状态提示、行号和 `Ctrl` / `Cmd + S` 保存
- 右侧终端基于 `xterm.js + portable-pty`
- 可启动 `cmd.exe` 或 `PowerShell`
- 可从终端工具栏直接启动 `codex --yolo` 或 `claude`
- 自定义窗口标题栏、刷新按钮、Shell 切换和状态栏

## 当前限制

- 前端目前固定使用 `projectRelative` 模式插入路径，也就是按项目根目录生成相对路径
- 终端会话没有实时跟踪用户在 Shell 中执行 `cd` 后的新工作目录
- 编辑器是基于 `textarea` 的轻量实现，不包含语法高亮、LSP、diff 或格式化
- 文件读写走的是文本接口，二进制文件不在当前支持范围
- 终端快捷按钮依赖本机 `codex` 和 `claude` 命令已在 `PATH` 中可用
- 当前仅支持 `cmd` 和 `powershell`

## 技术栈

| 层 | 方案 |
| --- | --- |
| 桌面壳 | `Tauri 2` |
| 前端 | `React 19` + `TypeScript` + `Vite 7` |
| 终端渲染 | `@xterm/xterm` + `@xterm/addon-fit` |
| 布局 | `react-resizable-panels` |
| 图标 | `lucide-react` |
| 后端 | `Rust` |
| PTY | `portable-pty` |

## 目录说明

```text
Jterminal/
  src/                     React 前端
  src-tauri/               Tauri / Rust 后端
  scripts/run-tauri.mjs    Tauri 启动包装脚本
  docs/CODE_WIKI.md        代码结构说明
  UI-code/                 早期界面参考稿，不参与当前主程序运行
  __scaffold/              初始脚手架快照
```

## 开发运行

### 依赖

- Node.js
- `pnpm`
- Rust toolchain
- 本机可用的 Tauri 开发环境

### 安装

```bash
pnpm install
```

### 启动开发环境

```bash
pnpm tauri dev
```

仓库通过 `scripts/run-tauri.mjs` 启动 Tauri，它会做几件事：

- 设置 `JTERMINAL_PROJECT_ROOT`
- 为 Cargo 单独指定目标目录
- 在 Windows 下尝试清理占用 `1420` / `1421` 端口的旧开发进程

如果只想单独跑前端，也可以使用：

```bash
pnpm dev
```

### 构建

```bash
pnpm build
pnpm tauri build
```

## 运行行为说明

### 默认工作区

后端命令 `get_default_root` 会按以下顺序解析默认目录：

1. 优先使用环境变量 `JTERMINAL_PROJECT_ROOT`
2. 当前目录如果同时存在 `package.json` 和 `src/`，则把它视为项目根目录
3. 如果当前目录是 `src-tauri/`，则回退到它的父目录
4. 否则使用当前进程目录

### 文件树

- 根目录首次扫描时会加载首层节点
- 目录展开后再请求子节点
- 所有文件操作都会校验路径是否仍在工作区根目录内

### 编辑器

- 打开文件时会缓存到标签页
- 标签页显示未保存状态
- 保存时调用 Tauri `write_file`

### 终端

- 终端启动时会按当前选择的 Shell 创建 PTY 会话
- 新会话会先切换到目标目录，再执行可选启动命令
- 前端通过 Tauri event 接收 `terminal-output` 和 `terminal-exit`

## 开发文档

- [代码结构说明](docs/CODE_WIKI.md)

## 下一步建议

如果要继续推进这个项目，优先级比较合理的方向是：

1. 补上终端当前目录跟踪，让路径插入真正基于实时 cwd
2. 为文件树增加文件监听和刷新粒度优化
3. 把编辑器从 `textarea` 升级到更适合代码编辑的组件
4. 补测试和错误处理，尤其是终端生命周期与 Windows 兼容性
