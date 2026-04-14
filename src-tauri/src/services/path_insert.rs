use std::path::{Path, PathBuf};

use pathdiff::diff_paths;

use crate::models::terminal::{PathInsertMode, ShellKind};

pub fn build_insert_text(
    project_root: &Path,
    current_dir: &Path,
    paths: &[PathBuf],
    shell_kind: ShellKind,
    mode: PathInsertMode,
) -> String {
    let escaped_paths = paths
        .iter()
        .map(|path| {
            let target = match mode {
                PathInsertMode::ProjectRelative => diff_paths(path, project_root)
                    .unwrap_or_else(|| path.to_path_buf())
                    .to_string_lossy()
                    .to_string(),
                PathInsertMode::Absolute => path.to_string_lossy().to_string(),
            };

            let normalized = if matches!(mode, PathInsertMode::ProjectRelative)
                && current_dir != project_root
                && target == "."
            {
                path.to_string_lossy().to_string()
            } else {
                target
            };

            escape_for_shell(&normalized, shell_kind)
        })
        .collect::<Vec<_>>();

    let mut text = escaped_paths.join(" ");
    if !text.is_empty() {
        text.push(' ');
    }

    text
}

fn escape_for_shell(path: &str, shell_kind: ShellKind) -> String {
    match shell_kind {
        ShellKind::Cmd => format!("\"{}\"", path.replace('"', "\"\"")),
        ShellKind::PowerShell => format!("'{}'", path.replace('\'', "''")),
    }
}
