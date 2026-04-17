use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use pathdiff::diff_paths;

use crate::models::file_node::FileNode;
use crate::models::file_search_result::FileSearchResult;
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

pub fn upsert_file(root: &Path, file: &Path, content: String) -> Result<(), String> {
    let root = normalize_directory(root)?;
    let file = normalize_path(root.as_path(), file)?;
    ensure_within_root(&root, &file)?;

    if file.exists() && file.is_dir() {
        return Err(format!(
            "Cannot write directory as file: {}",
            file.to_string_lossy()
        ));
    }

    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(file, content).map_err(|error| error.to_string())
}

pub fn create_directory(root: &Path, dir: &Path) -> Result<(), String> {
    let root = normalize_directory(root)?;
    let dir = normalize_path(root.as_path(), dir)?;
    ensure_within_root(&root, &dir)?;

    if dir.exists() {
        if dir.is_dir() {
            return Ok(());
        }

        return Err(format!(
            "Cannot create directory over file: {}",
            dir.to_string_lossy()
        ));
    }

    fs::create_dir_all(dir).map_err(|error| error.to_string())
}

pub fn delete_file(root: &Path, file: &Path) -> Result<(), String> {
    let root = normalize_directory(root)?;
    let file = normalize_path(root.as_path(), file)?;
    ensure_within_root(&root, &file)?;

    if !file.exists() {
        return Ok(());
    }

    if file.is_dir() {
        return Err(format!(
            "Cannot delete directory as file: {}",
            file.to_string_lossy()
        ));
    }

    fs::remove_file(file).map_err(|error| error.to_string())
}

pub fn delete_path(root: &Path, target: &Path) -> Result<(), String> {
    let root = normalize_directory(root)?;
    let target = normalize_path(root.as_path(), target)?;
    ensure_within_root(&root, &target)?;

    if !target.exists() {
        return Ok(());
    }

    if target.is_dir() {
        return fs::remove_dir_all(target).map_err(|error| error.to_string());
    }

    fs::remove_file(target).map_err(|error| error.to_string())
}

pub fn rename_path(root: &Path, from: &Path, to: &Path) -> Result<(), String> {
    let root = normalize_directory(root)?;
    let from = normalize_existing_path(from)?;
    let to = normalize_path(root.as_path(), to)?;
    ensure_within_root(&root, &from)?;
    ensure_within_root(&root, &to)?;

    if from == root {
        return Err(String::from("Cannot rename the workspace root."));
    }

    if to.exists() {
        return Err(format!("Target already exists: {}", to.to_string_lossy()));
    }

    let parent = to.parent().ok_or_else(|| {
        format!(
            "Unable to resolve parent directory for {}",
            to.to_string_lossy()
        )
    })?;

    if !parent.exists() {
        return Err(format!(
            "Parent directory does not exist: {}",
            parent.to_string_lossy()
        ));
    }

    fs::rename(from, to).map_err(|error| error.to_string())
}

pub fn search_files(
    root: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<FileSearchResult>, String> {
    let root = normalize_directory(root)?;
    let tokens = normalize_query_tokens(query);

    if tokens.is_empty() {
        return Ok(Vec::new());
    }

    let mut matches = Vec::new();
    collect_search_matches(&root, &root, &tokens, &mut matches)?;
    matches.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.rel_path.cmp(&right.1.rel_path))
    });

    Ok(matches
        .into_iter()
        .take(limit)
        .map(|(_, item)| item)
        .collect())
}

fn build_node(root: &Path, path: &Path, include_children: bool) -> Result<FileNode, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let children = if include_children && metadata.is_dir() {
        Some(list_children(root, path)?)
    } else {
        None
    };
    let has_children = if metadata.is_dir() {
        children
            .as_ref()
            .map(|entries| !entries.is_empty())
            .unwrap_or(true)
    } else {
        false
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

fn normalize_path(root: &Path, path: &Path) -> Result<PathBuf, String> {
    let candidate = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };

    if candidate.exists() {
        return normalize_existing_path(&candidate);
    }

    normalize_missing_path(&candidate)
}

fn normalize_missing_path(path: &Path) -> Result<PathBuf, String> {
    let mut existing_ancestor = path.to_path_buf();
    let mut suffix = Vec::new();

    while !existing_ancestor.exists() {
        let Some(name) = existing_ancestor.file_name() else {
            return Err(format!(
                "Path does not have an existing ancestor: {}",
                path.to_string_lossy()
            ));
        };

        suffix.push(PathBuf::from(name));
        existing_ancestor = existing_ancestor
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| {
                format!(
                    "Path does not have an existing ancestor: {}",
                    path.to_string_lossy()
                )
            })?;
    }

    let mut normalized = fs::canonicalize(&existing_ancestor).map_err(|error| error.to_string())?;
    for component in suffix.iter().rev() {
        normalized.push(component);
    }

    Ok(normalized)
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

fn collect_search_matches(
    root: &Path,
    current_dir: &Path,
    tokens: &[String],
    matches: &mut Vec<(i64, FileSearchResult)>,
) -> Result<(), String> {
    for entry in fs::read_dir(current_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if is_hidden(&path) {
            continue;
        }

        if path.is_dir() {
            collect_search_matches(root, &path, tokens, matches)?;
            continue;
        }

        let relative = relative_path(root, &path);
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| path_to_string(&path));

        if let Some(score) = search_score(tokens, &name, &relative) {
            matches.push((
                score,
                FileSearchResult {
                    name,
                    abs_path: path_to_string(&path),
                    rel_path: relative,
                },
            ));
        }
    }

    Ok(())
}

fn normalize_query_tokens(query: &str) -> Vec<String> {
    query
        .split_whitespace()
        .map(normalize_search_text)
        .filter(|value| !value.is_empty())
        .collect()
}

fn normalize_search_text(value: &str) -> String {
    value
        .chars()
        .map(|char| match char {
            '\\' => '/',
            _ => char.to_ascii_lowercase(),
        })
        .collect()
}

fn search_score(tokens: &[String], name: &str, relative: &str) -> Option<i64> {
    let normalized_name = normalize_search_text(name);
    let normalized_relative = normalize_search_text(relative);
    let mut total_score = 0;

    for token in tokens {
        let name_score = fuzzy_score(token, &normalized_name).map(|score| score + 1_200);
        let relative_score = fuzzy_score(token, &normalized_relative);

        match name_score.max(relative_score) {
            Some(score) => total_score += score,
            None => return None,
        }
    }

    Some(total_score)
}

fn fuzzy_score(query: &str, candidate: &str) -> Option<i64> {
    if query.is_empty() || candidate.is_empty() {
        return None;
    }

    if let Some(start_index) = candidate.find(query) {
        return Some(
            8_000 - (start_index as i64 * 12) - (candidate.len() as i64 - query.len() as i64),
        );
    }

    let candidate_chars = candidate.chars().collect::<Vec<_>>();
    let query_chars = query.chars().collect::<Vec<_>>();
    let mut query_index = 0usize;
    let mut total_score = 0i64;
    let mut previous_match_index = None;

    for (candidate_index, candidate_char) in candidate_chars.iter().enumerate() {
        if query_index >= query_chars.len() {
            break;
        }

        if *candidate_char != query_chars[query_index] {
            continue;
        }

        total_score += 16;
        total_score -= candidate_index as i64;

        if previous_match_index
            .map(|value| value + 1 == candidate_index)
            .unwrap_or(false)
        {
            total_score += 28;
        }

        if candidate_index == 0
            || matches!(
                candidate_chars[candidate_index.saturating_sub(1)],
                '/' | '_' | '-' | '.' | ' '
            )
        {
            total_score += 22;
        }

        previous_match_index = Some(candidate_index);
        query_index += 1;
    }

    if query_index == query_chars.len() {
        Some(total_score)
    } else {
        None
    }
}
