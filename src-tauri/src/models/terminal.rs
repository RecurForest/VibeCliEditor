use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ShellKind {
    Cmd,
    PowerShell,
}

impl ShellKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cmd => "cmd",
            Self::PowerShell => "powershell",
        }
    }
}

impl TryFrom<String> for ShellKind {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "cmd" => Ok(Self::Cmd),
            "powershell" => Ok(Self::PowerShell),
            other => Err(format!("Unsupported shell kind: {other}")),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum PathInsertMode {
    ProjectRelative,
    Absolute,
}

impl TryFrom<String> for PathInsertMode {
    type Error = String;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "projectRelative" => Ok(Self::ProjectRelative),
            "absolute" => Ok(Self::Absolute),
            other => Err(format!("Unsupported path insert mode: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInfo {
    pub session_id: String,
    pub shell_kind: String,
    pub working_dir: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub session_id: String,
    pub exit_code: Option<i32>,
}
