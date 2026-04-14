use std::path::PathBuf;

use crate::models::file_node::FileNode;
use crate::services::file_tree;

#[tauri::command]
pub fn get_default_root() -> Result<String, String> {
    std::env::current_dir()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
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
