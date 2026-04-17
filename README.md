# VibeCliEditor

English | [简体中文](./README.zh-CN.md)

<p align="center">
  <img src="src/assets/vibe-cli-editor-logo.svg" alt="VibeCliEditor logo" width="96" />
</p>

<p align="center">
  <strong>VibeCliEditor's defining feature is its AI session diff workflow.</strong>
  In vibe coding with <code>codex</code> or Claude Code (<code>claude</code>), the hard part is not only generating code, but being able to review what the agent changed and safely roll it back. VibeCliEditor makes those terminal-driven changes visible, reviewable, and reversible inside one workspace.
</p>

<p align="center">
  You can capture a baseline for an AI session, open a dedicated diff view, inspect changes file by file, and revert either a whole file or a single hunk. This directly addresses one of the biggest pain points in <code>codex</code> / Claude Code workflows: code changes happen fast, but they are hard to audit and hard to undo.
</p>

<p align="center">
  VibeCliEditor also combines the file tree, editor, integrated terminal, and AI CLI entry points into one desktop workspace so you can browse files, select targets, inspect diffs, and insert file paths into the terminal workflow without constantly switching contexts.
</p>

<p align="center">
  <img src="public/vibe-cli-editor-snapshot.png" alt="VibeCliEditor snapshot" width="100%" />
</p>

> Core intent: make `codex` / Claude Code sessions auditable and reversible, while also making it much easier to bring the right project files into an AI-driven development loop.

## Why It Exists

In a normal terminal workflow, AI CLI tools are strong at generating and editing code, but weak at one repetitive interaction:

- finding the right files in a project
- deciding which file or directory should be referenced next
- quickly feeding those paths back into the terminal prompt

VibeCliEditor is built around that gap. The session diff workflow solves the review and rollback problem, while the Explorer, workspace search, and terminal integration make it much easier to find files and feed the right paths back into the active AI session.

## Features

- Session diff workflow for AI coding sessions, with baseline capture, dedicated diff view, and revert support
- File-level and hunk-level rollback for changes made during `codex` / `claude` workflows
- Desktop workspace built with Tauri 2, React 19, TypeScript, and Rust
- File tree Explorer with lazy loading, selection, refresh, and context actions
- Monaco-based code editor for common source file types
- Integrated terminal powered by `xterm.js` and `portable-pty`
- Quick launch entry points for local AI CLIs such as `codex` and `claude`
- Workspace file search from the title bar
- File-path insertion flow designed for terminal-first AI coding
- Recent workspace switching and multi-window project opening

## Preview

The current project is closer to a focused desktop coding workspace than a full IDE. The emphasis is on local workflow efficiency, especially around terminal-driven AI development.

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
VibeCliEditor/
|-- src/                # React frontend
|-- src-tauri/          # Tauri + Rust backend
|-- public/             # Static assets
|-- scripts/            # Development helper scripts
|-- docs/               # Additional project docs
|-- package.json
`-- README.md
```

## Getting Started

### Requirements

- Node.js
- pnpm
- Rust toolchain
- Tauri development environment

The project is currently developed and validated primarily on Windows desktop.

### Install

```bash
pnpm install
```

### Run In Development

```bash
pnpm tauri dev
```

If you only want the frontend dev server:

```bash
pnpm dev
```

### Build

```bash
pnpm build
pnpm tauri build
```

## Usage Notes

- When no recent workspace exists, the app stays empty until you open a folder yourself.
- The Explorer can be used to locate files and push selected paths into the terminal workflow.
- The integrated terminal is intended to work well with local AI CLIs already installed on your machine.
- The title-bar workspace switcher supports opening additional projects in new windows.

Make sure these commands are available in your local `PATH` if you want to use the quick-launch terminal actions:

- `codex`
- `claude`

## Development Notes

The repository includes `scripts/run-tauri.mjs` to help normalize local Tauri execution, including:

- injecting `VIBE_CLI_EDITOR_PROJECT_ROOT`
- using an isolated Cargo target directory
- reducing stale process issues on Windows

## Roadmap

- Add file watching and smarter refresh behavior
- Improve terminal workspace synchronization
- Expand editor capabilities such as formatting and diff workflows
- Add settings, shortcuts, and theme customization
- Improve packaging, testing, and release workflows

## Contributing

Issues and pull requests are welcome.

Useful contribution areas:

- file insertion workflow for AI terminal usage
- Explorer and workspace interaction details
- editor usability improvements
- terminal behavior and cross-platform compatibility

## License

This repository does not currently include a `LICENSE` file.

If you plan to publish it publicly, add an explicit open-source license before release, for example:

- MIT
- Apache-2.0
- GPL-3.0

## Acknowledgements

- [Tauri](https://tauri.app/)
- [React](https://react.dev/)
- [Monaco Editor](https://microsoft.github.io/monaco-editor/)
- [xterm.js](https://xtermjs.org/)
