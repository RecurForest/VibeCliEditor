use crate::models::git::{GitChangesResult, GitCommitResult, GitDiffResult};
use crate::services::git;

#[tauri::command]
pub fn get_git_changes(root_path: String) -> Result<GitChangesResult, String> {
    git::get_git_changes(&root_path)
}

#[tauri::command]
pub fn get_git_diff(root_path: String, abs_path: String) -> Result<GitDiffResult, String> {
    git::get_git_diff(&root_path, &abs_path)
}

#[tauri::command]
pub fn commit_git_selection(
    root_path: String,
    abs_paths: Vec<String>,
    message: String,
    amend: bool,
) -> Result<GitCommitResult, String> {
    git::commit_git_selection(&root_path, &abs_paths, &message, amend)
}

#[tauri::command]
pub fn stage_git_paths(root_path: String, abs_paths: Vec<String>) -> Result<(), String> {
    git::stage_git_paths(&root_path, &abs_paths)
}

#[tauri::command]
pub fn rollback_git_paths(root_path: String, abs_paths: Vec<String>) -> Result<(), String> {
    git::rollback_git_paths(&root_path, &abs_paths)
}

#[tauri::command]
pub fn ignore_git_paths(root_path: String, abs_paths: Vec<String>) -> Result<(), String> {
    git::ignore_git_paths(&root_path, &abs_paths)
}

#[tauri::command]
pub fn delete_git_paths(root_path: String, abs_paths: Vec<String>) -> Result<(), String> {
    git::delete_git_paths(&root_path, &abs_paths)
}

#[tauri::command]
pub fn push_git_branch(root_path: String) -> Result<String, String> {
    git::push_git_branch(&root_path)
}
