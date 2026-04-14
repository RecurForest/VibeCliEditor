use std::path::PathBuf;

use crate::models::file_node::FileNode;
use crate::services::file_tree;
use crate::services::paths::path_to_string;

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
pub fn write_file(root_path: String, file_path: String, content: String) -> Result<(), String> {
    let root = PathBuf::from(root_path);
    let file = PathBuf::from(file_path);
    file_tree::write_file(&root, &file, content)
}

fn resolve_default_root() -> Result<PathBuf, String> {
    if let Ok(project_root) = std::env::var("JTERMINAL_PROJECT_ROOT") {
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
