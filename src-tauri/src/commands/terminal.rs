use tauri::{AppHandle, State};

use crate::models::terminal::{PathInsertMode, ShellKind, TerminalSessionInfo};
use crate::services::terminal::TerminalState;

#[tauri::command]
pub fn start_terminal(
    app: AppHandle,
    state: State<'_, TerminalState>,
    working_dir: String,
    cols: u16,
    rows: u16,
    shell_kind: String,
) -> Result<TerminalSessionInfo, String> {
    state.start_session(
        app,
        working_dir,
        cols,
        rows,
        ShellKind::try_from(shell_kind)?,
    )
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, TerminalState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state.write(&session_id, data.as_bytes())
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn terminal_close(state: State<'_, TerminalState>, session_id: String) -> Result<(), String> {
    state.close_session(&session_id)
}

#[tauri::command]
pub fn insert_paths(
    state: State<'_, TerminalState>,
    session_id: String,
    project_root: String,
    paths: Vec<String>,
    mode: String,
) -> Result<(), String> {
    state.insert_paths(
        &session_id,
        &project_root,
        paths,
        PathInsertMode::try_from(mode)?,
    )
}
