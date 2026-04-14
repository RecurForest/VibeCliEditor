use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use pathdiff::diff_paths;

use crate::models::file_node::FileNode;
use crate::services::paths::path_to_string;

pub fn scan_root(root: &Path) -> Result<FileNode, String> {
    let root = normalize_directory(root)?;
    build_node(&root, &root, true)
}

pub fn read_directory(root: &Path, dir: &Path) -> Result<Vec<FileNode>, String> {
    let root = normalize_directory(root)?;
    let dir = normalize_directory(dir)?;
    ensure_within_root(&root, &dir)?;
    list_children(&root, &dir)
}

pub fn read_file(root: &Path, file: &Path) -> Result<String, String> {
    let root = normalize_directory(root)?;
    let file = normalize_existing_path(file)?;
    ensure_within_root(&root, &file)?;

    if file.is_dir() {
        return Err(format!(
            "Cannot read directory as file: {}",
            file.to_string_lossy()
        ));
    }

    fs::read_to_string(file).map_err(|error| error.to_string())
}

pub fn write_file(root: &Path, file: &Path, content: String) -> Result<(), String> {
    let root = normalize_directory(root)?;
    let file = normalize_existing_path(file)?;
    ensure_within_root(&root, &file)?;

    if file.is_dir() {
        return Err(format!(
            "Cannot write directory as file: {}",
            file.to_string_lossy()
        ));
    }

    fs::write(file, content).map_err(|error| error.to_string())
}

fn build_node(root: &Path, path: &Path, include_children: bool) -> Result<FileNode, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let has_children = metadata.is_dir() && directory_has_children(path)?;
    let children = if include_children && metadata.is_dir() {
        Some(list_children(root, path)?)
    } else {
        None
    };

    Ok(FileNode {
        id: path_to_string(path),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| path_to_string(path)),
        abs_path: path_to_string(path),
        rel_path: relative_path(root, path),
        is_dir: metadata.is_dir(),
        size: metadata.is_file().then_some(metadata.len()),
        modified_at: metadata
            .modified()
            .ok()
            .and_then(|timestamp| timestamp.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64),
        has_children,
        children,
    })
}

fn list_children(root: &Path, dir: &Path) -> Result<Vec<FileNode>, String> {
    let mut nodes = fs::read_dir(dir)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| !is_hidden(path))
        .map(|path| build_node(root, &path, false))
        .collect::<Result<Vec<_>, _>>()?;

    nodes.sort_by(compare_nodes);

    Ok(nodes)
}

fn directory_has_children(path: &Path) -> Result<bool, String> {
    let entries = fs::read_dir(path).map_err(|error| error.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        if !is_hidden(&entry.path()) {
            return Ok(true);
        }
    }

    Ok(false)
}

fn compare_nodes(left: &FileNode, right: &FileNode) -> Ordering {
    match (left.is_dir, right.is_dir) {
        (true, false) => Ordering::Less,
        (false, true) => Ordering::Greater,
        _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
    }
}

fn normalize_directory(path: &Path) -> Result<PathBuf, String> {
    let normalized = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if normalized.is_dir() {
        Ok(normalized)
    } else {
        Err(format!("Not a directory: {}", normalized.to_string_lossy()))
    }
}

fn normalize_existing_path(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|error| error.to_string())
}

fn ensure_within_root(root: &Path, dir: &Path) -> Result<(), String> {
    if dir.starts_with(root) {
        Ok(())
    } else {
        Err(format!(
            "Directory is outside of project root: {}",
            dir.to_string_lossy()
        ))
    }
}

fn relative_path(root: &Path, path: &Path) -> String {
    if root == path {
        ".".to_string()
    } else {
        diff_paths(path, root)
            .unwrap_or_else(|| path.to_path_buf())
            .to_string_lossy()
            .to_string()
    }
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with('.'))
        .unwrap_or(false)
}
