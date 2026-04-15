use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::models::terminal::{
    PathInsertMode, ShellKind, TerminalExitEvent, TerminalOutputEvent, TerminalSessionInfo,
};
use crate::services::path_insert;
use crate::services::paths::{path_for_shell, path_to_string};

pub struct TerminalState {
    sessions: Arc<Mutex<HashMap<String, TerminalSession>>>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

struct TerminalSession {
    child: Box<dyn portable_pty::Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    working_dir: PathBuf,
    shell_kind: ShellKind,
}

impl TerminalState {
    pub fn start_session(
        &self,
        app: AppHandle,
        working_dir: String,
        cols: u16,
        rows: u16,
        shell_kind: ShellKind,
        startup_command: Option<String>,
    ) -> Result<TerminalSessionInfo, String> {
        let working_dir = std::fs::canonicalize(working_dir).map_err(|error| error.to_string())?;
        let display_working_dir = path_to_string(&working_dir);
        let pty_system = native_pty_system();
        let pty_pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())?;

        let mut command = shell_command(shell_kind);
        command.cwd(path_for_shell(&working_dir));

        let child = pty_pair
            .slave
            .spawn_command(command)
            .map_err(|error| error.to_string())?;

        let mut reader = pty_pair
            .master
            .try_clone_reader()
            .map_err(|error| error.to_string())?;
        let mut writer = pty_pair
            .master
            .take_writer()
            .map_err(|error| error.to_string())?;

        let startup_input =
            build_startup_input(&display_working_dir, shell_kind, startup_command.as_deref());
        if !startup_input.is_empty() {
            writer
                .write_all(startup_input.as_bytes())
                .map_err(|error| error.to_string())?;
            writer.flush().map_err(|error| error.to_string())?;
        }

        let session_id = Uuid::new_v4().to_string();
        let output_session_id = session_id.clone();
        let exit_session_id = session_id.clone();
        let output_app = app.clone();
        let exit_app = app;
        let sessions = Arc::clone(&self.sessions);

        thread::spawn(move || {
            let mut buffer = [0_u8; 8192];

            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(size) => {
                        let data = String::from_utf8_lossy(&buffer[..size]).to_string();
                        let _ = output_app.emit(
                            "terminal-output",
                            TerminalOutputEvent {
                                session_id: output_session_id.clone(),
                                data,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }

            sessions
                .lock()
                .expect("terminal sessions mutex poisoned")
                .remove(&output_session_id);

            let _ = exit_app.emit(
                "terminal-exit",
                TerminalExitEvent {
                    session_id: exit_session_id,
                    exit_code: None,
                },
            );
        });

        let session = TerminalSession {
            child,
            master: pty_pair.master,
            writer,
            working_dir: working_dir.clone(),
            shell_kind,
        };

        self.sessions().insert(session_id.clone(), session);

        Ok(TerminalSessionInfo {
            session_id,
            shell_kind: shell_kind.as_str().to_string(),
            working_dir: display_working_dir,
        })
    }

    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Unknown terminal session: {session_id}"))?;

        session
            .writer
            .write_all(data)
            .map_err(|error| error.to_string())?;
        session.writer.flush().map_err(|error| error.to_string())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions();
        let session = sessions
            .get(session_id)
            .ok_or_else(|| format!("Unknown terminal session: {session_id}"))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())
    }

    pub fn insert_paths(
        &self,
        session_id: &str,
        project_root: &str,
        paths: Vec<String>,
        mode: PathInsertMode,
    ) -> Result<(), String> {
        let mut sessions = self.sessions();
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Unknown terminal session: {session_id}"))?;
        let project_root =
            std::fs::canonicalize(project_root).map_err(|error| error.to_string())?;
        let path_bufs = paths
            .into_iter()
            .map(std::fs::canonicalize)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        let insert_text = path_insert::build_insert_text(
            &project_root,
            &session.working_dir,
            &path_bufs,
            session.shell_kind,
            mode,
        );

        session
            .writer
            .write_all(insert_text.as_bytes())
            .map_err(|error| error.to_string())?;
        session.writer.flush().map_err(|error| error.to_string())
    }

    pub fn close_session(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions();
        if let Some(mut session) = sessions.remove(session_id) {
            let _ = session.writer.flush();
            session.child.kill().map_err(|error| error.to_string())?;
        }

        Ok(())
    }

    fn sessions(&self) -> std::sync::MutexGuard<'_, HashMap<String, TerminalSession>> {
        self.sessions
            .lock()
            .expect("terminal sessions mutex poisoned")
    }
}

fn shell_command(shell_kind: ShellKind) -> CommandBuilder {
    match shell_kind {
        ShellKind::Cmd => CommandBuilder::new("cmd.exe"),
        ShellKind::PowerShell => {
            let mut command = CommandBuilder::new("powershell.exe");
            command.arg("-NoLogo");
            command
        }
    }
}

fn build_startup_input(
    working_dir: &str,
    shell_kind: ShellKind,
    startup_command: Option<&str>,
) -> String {
    let mut commands = vec![match shell_kind {
        ShellKind::Cmd => format!("cd /d {}", escape_for_cmd(working_dir)),
        ShellKind::PowerShell => {
            format!(
                "Set-Location -LiteralPath {}",
                escape_for_powershell(working_dir)
            )
        }
    }];

    if let Some(startup_command) = startup_command.filter(|value| !value.trim().is_empty()) {
        commands.push(startup_command.trim().to_string());
    }

    let mut input = String::new();
    for command in commands {
        input.push_str(&command);
        input.push('\r');
    }

    input
}

fn escape_for_cmd(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn escape_for_powershell(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}
