use std::{
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::models::file_node::FileNode;
use crate::models::file_search_result::FileSearchResult;
use crate::services::file_tree;
use crate::services::file_tree::ClipboardPasteFile;
use crate::services::paths::path_to_string;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
pub fn get_default_root() -> Result<String, String> {
    resolve_default_root().map(|path| path_to_string(&path))
}

#[tauri::command]
pub fn scan_working_dir(root_path: String) -> Result<FileNode, String> {
    let root = PathBuf::from(root_path);
    file_tree::scan_root(&root)
}

#[tauri::command]
pub fn read_directory(root_path: String, dir_path: String) -> Result<Vec<FileNode>, String> {
    let root = PathBuf::from(root_path);
    let dir = PathBuf::from(dir_path);
    file_tree::read_directory(&root, &dir)
}

#[tauri::command]
pub fn read_file(root_path: String, file_path: String) -> Result<String, String> {
    let root = PathBuf::from(root_path);
    let file = PathBuf::from(file_path);
    file_tree::read_file(&root, &file)
}

#[tauri::command]
pub fn read_media_file_data_url(root_path: String, file_path: String) -> Result<String, String> {
    let root = PathBuf::from(root_path);
    let file = PathBuf::from(file_path);
    file_tree::read_media_file_data_url(&root, &file)
}

#[tauri::command]
pub fn write_file(root_path: String, file_path: String, content: String) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    let file = PathBuf::from(file_path);
    file_tree::write_file(&root, &file, content)
}

#[tauri::command]
pub fn upsert_file(root_path: String, file_path: String, content: String) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    let file = PathBuf::from(file_path);
    file_tree::upsert_file(&root, &file, content)
}

#[tauri::command]
pub fn create_directory(root_path: String, dir_path: String) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    let dir = PathBuf::from(dir_path);
    file_tree::create_directory(&root, &dir)
}

#[tauri::command]
pub fn delete_file(root_path: String, file_path: String) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    let file = PathBuf::from(file_path);
    file_tree::delete_file(&root, &file)
}

#[tauri::command]
pub fn delete_path(root_path: String, target_path: String) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    let target = PathBuf::from(target_path);
    file_tree::delete_path(&root, &target)
}

#[tauri::command]
pub fn rename_path(root_path: String, from_path: String, to_path: String) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    let from = PathBuf::from(from_path);
    let to = PathBuf::from(to_path);
    file_tree::rename_path(&root, &from, &to)
}

#[tauri::command]
pub fn paste_clipboard_items(
    root_path: String,
    target_dir_path: String,
    source_paths: Vec<String>,
    files: Vec<ClipboardPasteFile>,
) -> Result<Vec<String>, String> {
    let root = PathBuf::from(root_path);
    let target_dir = PathBuf::from(target_dir_path);
    let source_paths = source_paths
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    file_tree::paste_clipboard_items(&root, &target_dir, &source_paths, &files)
}

#[tauri::command]
pub fn search_files(root_path: String, query: String) -> Result<Vec<FileSearchResult>, String> {
    let root = PathBuf::from(root_path);
    file_tree::search_files(&root, &query, 40)
}

#[tauri::command]
pub fn get_git_branch(root_path: String) -> Result<String, String> {
    let root = PathBuf::from(root_path);
    let resolved_root = std::fs::canonicalize(&root).unwrap_or(root);

    if let Some(branch) = run_git_command(&resolved_root, &["branch", "--show-current"]) {
        if !branch.is_empty() {
            return Ok(branch);
        }
    }

    if let Some(branch) = run_git_command(&resolved_root, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        if branch.eq_ignore_ascii_case("head") {
            return Ok(String::from("Detached"));
        }

        if !branch.is_empty() {
            return Ok(branch);
        }
    }

    Ok(String::new())
}

#[tauri::command]
pub fn open_in_file_manager(target_path: String) -> Result<(), String> {
    let target = std::fs::canonicalize(target_path).map_err(|error| error.to_string())?;
    let open_target = if target.is_dir() {
        target
    } else {
        target
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| String::from("Unable to resolve parent folder."))?
    };

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer.exe");
        command.arg(&open_target);
        command.creation_flags(CREATE_NO_WINDOW);
        command.spawn().map_err(|error| error.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&open_target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(&open_target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn resolve_default_root() -> Result<PathBuf, String> {
    if let Ok(project_root) = std::env::var("VIBE_CLI_EDITOR_PROJECT_ROOT") {
        return std::fs::canonicalize(project_root).map_err(|error| error.to_string());
    }

    let current_dir = std::env::current_dir().map_err(|error| error.to_string())?;

    if current_dir.join("package.json").exists() && current_dir.join("src").is_dir() {
        return Ok(current_dir);
    }

    if current_dir
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("src-tauri"))
        .unwrap_or(false)
    {
        if let Some(parent) = current_dir.parent() {
            if parent.join("package.json").exists() && parent.join("src").is_dir() {
                return Ok(parent.to_path_buf());
            }
        }
    }

    Ok(current_dir)
}

fn run_git_command(root: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(root).args(args);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output().ok()?;

    if !output.status.success() {
        return None;
    }

    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
