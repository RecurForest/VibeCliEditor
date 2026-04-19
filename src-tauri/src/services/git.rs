use std::collections::BTreeSet;
use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use git2::{Commit, Index, Repository, Status, StatusEntry, StatusOptions};
use pathdiff::diff_paths;

use crate::models::git::{
    GitChangeEntry, GitChangeGroup, GitChangeStatus, GitChangesResult, GitCommitResult,
    GitDiffResult, GitRepositoryChanges,
};
use crate::services::paths::path_to_string;

const MAX_DIFFABLE_TEXT_BYTES: u64 = 1_000_000;
const MAX_DISCOVERED_REPOSITORIES: usize = 32;
const REPO_DISCOVERY_SKIP_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".next",
    "coverage",
];

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct GitContext {
    repo: Repository,
    repo_root: PathBuf,
    workspace_root: PathBuf,
    listing_root: PathBuf,
}

#[derive(Debug, Clone)]
struct GitChangeRecord {
    path: String,
    abs_path: PathBuf,
    status: GitChangeStatus,
    group: GitChangeGroup,
    previous_path: Option<String>,
    current_repo_path: Option<PathBuf>,
    previous_repo_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TextContentKind {
    Text,
    Binary,
    TooLarge,
}

pub fn get_git_changes(root_path: &str) -> Result<GitChangesResult, String> {
    let normalized_root = normalize_directory(Path::new(root_path))?;
    let contexts = collect_workspace_git_contexts(&normalized_root)?;

    if contexts.is_empty() {
        return Ok(GitChangesResult {
            root_path: path_to_string(&normalized_root),
            has_repository: false,
            repositories: Vec::new(),
        });
    }

    let mut repositories = contexts
        .iter()
        .map(build_git_repository_changes)
        .collect::<Result<Vec<_>, _>>()?;
    sort_git_repositories(&mut repositories);

    Ok(GitChangesResult {
        root_path: path_to_string(&normalized_root),
        has_repository: true,
        repositories,
    })
}

pub fn get_git_diff(root_path: &str, abs_path: &str) -> Result<GitDiffResult, String> {
    let Some(context) = open_git_context(root_path)? else {
        return Err(String::from("No Git repository was found for the current workspace."));
    };

    let branch = resolve_branch_name(&context.repo);
    let record = collect_git_change_records(&context)?
        .into_iter()
        .find(|record| paths_equal(&record.abs_path, Path::new(abs_path)))
        .ok_or_else(|| String::from("The selected file is no longer part of the current Git changes."))?;

    let original_repo_path = match record.status {
        GitChangeStatus::Added => record.previous_repo_path.clone(),
        GitChangeStatus::Deleted => record.previous_repo_path.clone().or(record.current_repo_path.clone()),
        GitChangeStatus::Modified | GitChangeStatus::Renamed => {
            record.previous_repo_path.clone().or(record.current_repo_path.clone())
        }
    };
    let modified_repo_path = match record.status {
        GitChangeStatus::Deleted => None,
        GitChangeStatus::Added | GitChangeStatus::Modified | GitChangeStatus::Renamed => {
            record.current_repo_path.clone()
        }
    };

    let original_content_info = match original_repo_path.as_ref() {
        Some(repo_path) => read_head_text_content(&context.repo, repo_path)?,
        None => Some((TextContentKind::Text, String::new())),
    };
    let modified_content_info = match modified_repo_path.as_ref() {
        Some(repo_path) => read_worktree_text_content(&context.repo_root.join(repo_path))?,
        None => Some((TextContentKind::Text, String::new())),
    };

    let is_binary = matches!(
        original_content_info.as_ref().map(|(kind, _)| *kind),
        Some(TextContentKind::Binary)
    ) || matches!(
        modified_content_info.as_ref().map(|(kind, _)| *kind),
        Some(TextContentKind::Binary)
    );
    let too_large = matches!(
        original_content_info.as_ref().map(|(kind, _)| *kind),
        Some(TextContentKind::TooLarge)
    ) || matches!(
        modified_content_info.as_ref().map(|(kind, _)| *kind),
        Some(TextContentKind::TooLarge)
    );

    Ok(GitDiffResult {
        root_path: path_to_string(&context.workspace_root),
        branch,
        path: record.path,
        abs_path: path_to_string(&record.abs_path),
        status: record.status,
        group: record.group,
        previous_path: record.previous_path,
        is_binary,
        too_large,
        original_content: extract_text_content(original_content_info),
        modified_content: extract_text_content(modified_content_info),
    })
}

pub fn commit_git_selection(
    root_path: &str,
    abs_paths: &[String],
    message: &str,
    amend: bool,
) -> Result<GitCommitResult, String> {
    if abs_paths.is_empty() {
        return Err(String::from("Select at least one file before committing."));
    }

    if message.trim().is_empty() {
        return Err(String::from("Enter a commit message first."));
    }

    let Some(context) = open_git_context(root_path)? else {
        return Err(String::from("No Git repository was found for the current workspace."));
    };

    let branch = resolve_branch_name(&context.repo);
    let records = resolve_selected_git_records(&context, abs_paths)?;
    let mut index = stage_records(&context, &records)?;
    let tree_oid = index.write_tree().map_err(|error| error.to_string())?;
    let tree = context
        .repo
        .find_tree(tree_oid)
        .map_err(|error| error.to_string())?;
    let signature = context
        .repo
        .signature()
        .map_err(|error| format!("Unable to resolve the Git author signature: {error}"))?;

    let commit_oid = if amend {
        let head_commit = resolve_head_commit(&context.repo)?
            .ok_or_else(|| String::from("Cannot amend because this repository does not have any commits yet."))?;

        head_commit
            .amend(
                Some("HEAD"),
                Some(&signature),
                Some(&signature),
                None,
                Some(message),
                Some(&tree),
            )
            .map_err(|error| error.to_string())?
    } else {
        let parents = resolve_commit_parents(&context.repo)?;
        let parent_refs = parents.iter().collect::<Vec<_>>();
        context
            .repo
            .commit(Some("HEAD"), &signature, &signature, message, &tree, &parent_refs)
            .map_err(|error| error.to_string())?
    };

    Ok(GitCommitResult {
        branch,
        commit_oid: commit_oid.to_string(),
        summary: first_commit_message_line(message),
    })
}

pub fn stage_git_paths(root_path: &str, abs_paths: &[String]) -> Result<(), String> {
    if abs_paths.is_empty() {
        return Err(String::from("Select at least one file first."));
    }

    let Some(context) = open_git_context(root_path)? else {
        return Err(String::from("No Git repository was found for the current workspace."));
    };
    let records = resolve_selected_git_records(&context, abs_paths)?;
    stage_records(&context, &records).map(|_| ())
}

pub fn rollback_git_paths(root_path: &str, abs_paths: &[String]) -> Result<(), String> {
    if abs_paths.is_empty() {
        return Err(String::from("Select at least one file first."));
    }

    let Some(context) = open_git_context(root_path)? else {
        return Err(String::from("No Git repository was found for the current workspace."));
    };
    let records = resolve_selected_git_records(&context, abs_paths)?;
    rollback_records(&context, &records)
}

pub fn ignore_git_paths(root_path: &str, abs_paths: &[String]) -> Result<(), String> {
    if abs_paths.is_empty() {
        return Err(String::from("Select at least one file first."));
    }

    let Some(context) = open_git_context(root_path)? else {
        return Err(String::from("No Git repository was found for the current workspace."));
    };
    let records = resolve_selected_git_records(&context, abs_paths)?;
    let rules = records
        .iter()
        .filter(|record| record.group == GitChangeGroup::Unversioned)
        .map(|record| record.path.clone())
        .collect::<BTreeSet<_>>();

    if rules.is_empty() {
        return Err(String::from("Only unversioned files can be added to .gitignore."));
    }

    append_gitignore_rules(&context.workspace_root.join(".gitignore"), &rules)
}

pub fn delete_git_paths(root_path: &str, abs_paths: &[String]) -> Result<(), String> {
    if abs_paths.is_empty() {
        return Err(String::from("Select at least one file first."));
    }

    let Some(context) = open_git_context(root_path)? else {
        return Err(String::from("No Git repository was found for the current workspace."));
    };
    let records = resolve_selected_git_records(&context, abs_paths)?;
    delete_records(&context, &records)
}

pub fn push_git_branch(root_path: &str) -> Result<String, String> {
    let Some(context) = open_git_context(root_path)? else {
        return Err(String::from("No Git repository was found for the current workspace."));
    };

    if context.repo.head_detached().map_err(|error| error.to_string())? {
        return Err(String::from(
            "Cannot push while HEAD is detached. Check out a branch first.",
        ));
    }

    let branch = resolve_branch_name(&context.repo);
    if branch.is_empty() {
        return Err(String::from("Cannot determine the current branch to push."));
    }

    let args = [OsString::from("push")];
    run_git_with_repo_root(&context.repo_root, &args)?;
    Ok(branch)
}

fn open_git_context(root_path: &str) -> Result<Option<GitContext>, String> {
    let workspace_root = normalize_directory(Path::new(root_path))?;
    open_git_context_for_roots(&workspace_root, &workspace_root)
}

fn open_git_context_for_roots(
    workspace_root: &Path,
    listing_root: &Path,
) -> Result<Option<GitContext>, String> {
    let repo = match Repository::discover(&workspace_root) {
        Ok(repo) => repo,
        Err(error) if error.code() == git2::ErrorCode::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let repo_root = repo_workdir(&repo)?;

    Ok(Some(GitContext {
        repo,
        repo_root,
        workspace_root: workspace_root.to_path_buf(),
        listing_root: listing_root.to_path_buf(),
    }))
}

fn collect_workspace_git_contexts(workspace_root: &Path) -> Result<Vec<GitContext>, String> {
    if let Some(context) = open_git_context_for_roots(workspace_root, workspace_root)? {
        return Ok(vec![context]);
    }

    let repo_roots = discover_child_repository_roots(workspace_root)?;
    repo_roots
        .into_iter()
        .map(|repo_root| {
            open_git_context_for_roots(&repo_root, workspace_root)?
                .ok_or_else(|| format!("Failed to open Git repository at {}", path_to_string(&repo_root)))
        })
        .collect()
}

fn discover_child_repository_roots(workspace_root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut discovered = Vec::new();
    let mut pending_dirs = vec![workspace_root.to_path_buf()];

    while let Some(current_dir) = pending_dirs.pop() {
        if discovered.len() >= MAX_DISCOVERED_REPOSITORIES {
            break;
        }

        let entries = fs::read_dir(&current_dir).map_err(|error| error.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|error| error.to_string())?;
            let entry_path = entry.path();
            let file_type = entry.file_type().map_err(|error| error.to_string())?;
            if file_type.is_symlink() {
                continue;
            }

            if !file_type.is_dir() {
                continue;
            }

            if is_git_repository_root(&entry_path) {
                discovered.push(entry_path);
                if discovered.len() >= MAX_DISCOVERED_REPOSITORIES {
                    break;
                }
                continue;
            }

            if should_skip_repository_discovery_dir(&entry_path) {
                continue;
            }

            pending_dirs.push(entry_path);
        }
    }

    discovered.sort_by(|left, right| {
        normalize_comparable_path(left).cmp(&normalize_comparable_path(right))
    });
    Ok(discovered)
}

fn is_git_repository_root(path: &Path) -> bool {
    let git_path = path.join(".git");
    git_path.is_dir() || git_path.is_file()
}

fn should_skip_repository_discovery_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| REPO_DISCOVERY_SKIP_DIRS.iter().any(|skip| name.eq_ignore_ascii_case(skip)))
}

fn build_git_repository_changes(context: &GitContext) -> Result<GitRepositoryChanges, String> {
    let branch = resolve_branch_name(&context.repo);
    let mut changes = Vec::new();
    let mut unversioned = Vec::new();

    for record in collect_git_change_records(context)? {
        let entry = GitChangeEntry {
            path: record.path,
            abs_path: path_to_string(&record.abs_path),
            status: record.status,
            group: record.group,
            previous_path: record.previous_path,
        };

        if entry.group == GitChangeGroup::Unversioned {
            unversioned.push(entry);
        } else {
            changes.push(entry);
        }
    }

    sort_git_entries(&mut changes);
    sort_git_entries(&mut unversioned);

    Ok(GitRepositoryChanges {
        root_path: path_to_string(&context.workspace_root),
        name: repository_display_name(&context.workspace_root),
        relative_path: repository_relative_path(context)?,
        branch,
        changes,
        unversioned,
    })
}

fn collect_git_change_records(context: &GitContext) -> Result<Vec<GitChangeRecord>, String> {
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .include_ignored(false)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true)
        .include_unmodified(false)
        .exclude_submodules(true);

    let statuses = context
        .repo
        .statuses(Some(&mut options))
        .map_err(|error| error.to_string())?;
    let mut records = Vec::new();

    for entry in statuses.iter() {
        if let Some(record) = build_git_change_record(context, &entry)? {
            records.push(record);
        }
    }

    Ok(records)
}

fn resolve_selected_git_records(
    context: &GitContext,
    abs_paths: &[String],
) -> Result<Vec<GitChangeRecord>, String> {
    let records = collect_git_change_records(context)?;

    abs_paths
        .iter()
        .map(|abs_path| {
            let requested_path = Path::new(abs_path);
            records
                .iter()
                .find(|record| paths_equal(&record.abs_path, requested_path))
                .cloned()
                .ok_or_else(|| format!("The selected change is no longer available: {abs_path}"))
        })
        .collect()
}

fn stage_records(context: &GitContext, records: &[GitChangeRecord]) -> Result<Index, String> {
    let mut index = context.repo.index().map_err(|error| error.to_string())?;

    for record in records {
        stage_record(context, &mut index, record)?;
    }

    index.write().map_err(|error| error.to_string())?;
    Ok(index)
}

fn stage_record(context: &GitContext, index: &mut Index, record: &GitChangeRecord) -> Result<(), String> {
    if let Some(previous_repo_path) = record.previous_repo_path.as_ref() {
        let renamed_path = record
            .current_repo_path
            .as_ref()
            .is_some_and(|current_repo_path| current_repo_path != previous_repo_path);
        let previous_missing = !context.repo_root.join(previous_repo_path).exists();

        if (renamed_path || previous_missing) && index.get_path(previous_repo_path.as_path(), 0).is_some() {
            index
                .remove_path(previous_repo_path.as_path())
                .map_err(|error| error.to_string())?;
        }
    }

    if let Some(current_repo_path) = record.current_repo_path.as_ref() {
        if context.repo_root.join(current_repo_path).exists() {
            index
                .add_path(current_repo_path.as_path())
                .map_err(|error| error.to_string())?;
        } else if index.get_path(current_repo_path.as_path(), 0).is_some() {
            index
                .remove_path(current_repo_path.as_path())
                .map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn rollback_records(context: &GitContext, records: &[GitChangeRecord]) -> Result<(), String> {
    let mut index = context.repo.index().map_err(|error| error.to_string())?;
    let mut index_dirty = false;
    let mut restore_paths = BTreeSet::new();

    for record in records {
        if record.previous_repo_path.is_none() {
            if let Some(current_repo_path) = record.current_repo_path.as_ref() {
                remove_worktree_path(&context.repo_root.join(current_repo_path))?;
                if index.get_path(current_repo_path.as_path(), 0).is_some() {
                    index
                        .remove_path(current_repo_path.as_path())
                        .map_err(|error| error.to_string())?;
                    index_dirty = true;
                }
            }
            continue;
        }

        if let Some(previous_repo_path) = record.previous_repo_path.as_ref() {
            restore_paths.insert(previous_repo_path.clone());
        }

        if let Some(current_repo_path) = record.current_repo_path.as_ref() {
            restore_paths.insert(current_repo_path.clone());
        }
    }

    if index_dirty {
        index.write().map_err(|error| error.to_string())?;
    }

    if restore_paths.is_empty() {
        return Ok(());
    }

    if resolve_head_commit(&context.repo)?.is_none() {
        return Err(String::from("Cannot roll back changes because this repository does not have any commits yet."));
    }

    let mut args = vec![
        OsString::from("restore"),
        OsString::from("--source=HEAD"),
        OsString::from("--staged"),
        OsString::from("--worktree"),
        OsString::from("--"),
    ];
    args.extend(restore_paths.iter().map(|path| repo_pathspec(path)));
    run_git_with_repo_root(&context.repo_root, &args)
}

fn delete_records(context: &GitContext, records: &[GitChangeRecord]) -> Result<(), String> {
    let mut index = context.repo.index().map_err(|error| error.to_string())?;
    let mut index_dirty = false;

    for record in records {
        if let Some(current_repo_path) = record.current_repo_path.as_ref() {
            remove_worktree_path(&context.repo_root.join(current_repo_path))?;

            if record.previous_repo_path.is_none()
                && index.get_path(current_repo_path.as_path(), 0).is_some()
            {
                index
                    .remove_path(current_repo_path.as_path())
                    .map_err(|error| error.to_string())?;
                index_dirty = true;
            }
        } else {
            remove_worktree_path(&record.abs_path)?;
        }
    }

    if index_dirty {
        index.write().map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn build_git_change_record(
    context: &GitContext,
    entry: &StatusEntry<'_>,
) -> Result<Option<GitChangeRecord>, String> {
    let raw_status = entry.status();
    let current_repo_path = resolve_current_repo_path(entry);
    let previous_repo_path = resolve_previous_state_repo_path(entry, raw_status, &current_repo_path);
    let previous_display_repo_path = resolve_previous_display_repo_path(entry);
    let current_abs_path = current_repo_path
        .as_ref()
        .map(|repo_path| repo_path_to_absolute_path(&context.repo_root, repo_path));
    let previous_abs_path = previous_repo_path
        .as_ref()
        .map(|repo_path| repo_path_to_absolute_path(&context.repo_root, repo_path));
    let previous_display_abs_path = previous_display_repo_path
        .as_ref()
        .map(|repo_path| repo_path_to_absolute_path(&context.repo_root, repo_path));

    let current_in_workspace = current_abs_path
        .as_ref()
        .is_some_and(|path| path_is_within_root(path, &context.workspace_root));
    let previous_in_workspace = previous_abs_path
        .as_ref()
        .is_some_and(|path| path_is_within_root(path, &context.workspace_root));

    if !current_in_workspace && !previous_in_workspace {
        return Ok(None);
    }

    let base_group = infer_change_group(raw_status);
    let base_status = infer_change_status(raw_status);
    let effective_status = match (current_in_workspace, previous_in_workspace) {
        (true, false) => GitChangeStatus::Added,
        (false, true) => GitChangeStatus::Deleted,
        _ => base_status,
    };

    let display_abs_path = if current_in_workspace {
        current_abs_path
            .clone()
            .ok_or_else(|| String::from("Missing current path for Git change."))?
    } else {
        previous_abs_path
            .clone()
            .ok_or_else(|| String::from("Missing previous path for Git change."))?
    };
    let display_path = relative_path(&context.workspace_root, &display_abs_path)?;
    let previous_path = if current_in_workspace && previous_in_workspace && base_status == GitChangeStatus::Renamed {
        previous_display_abs_path
            .as_ref()
            .map(|path| relative_path(&context.workspace_root, path))
            .transpose()?
    } else {
        None
    };

    Ok(Some(GitChangeRecord {
        path: display_path,
        abs_path: display_abs_path,
        status: effective_status,
        group: base_group,
        previous_path,
        current_repo_path,
        previous_repo_path,
    }))
}

fn resolve_current_repo_path(entry: &StatusEntry<'_>) -> Option<PathBuf> {
    entry
        .index_to_workdir()
        .and_then(|delta| delta.new_file().path().map(PathBuf::from))
        .or_else(|| {
            entry
                .head_to_index()
                .and_then(|delta| delta.new_file().path().map(PathBuf::from))
        })
        .or_else(|| entry.path().map(PathBuf::from))
}

fn resolve_previous_display_repo_path(entry: &StatusEntry<'_>) -> Option<PathBuf> {
    let current_path = resolve_current_repo_path(entry);
    let previous_path = entry
        .index_to_workdir()
        .and_then(|delta| delta.old_file().path().map(PathBuf::from))
        .or_else(|| {
            entry
                .head_to_index()
                .and_then(|delta| delta.old_file().path().map(PathBuf::from))
        });

    match (current_path.as_ref(), previous_path) {
        (Some(current), Some(previous)) if current == &previous => None,
        (_, previous) => previous,
    }
}

fn resolve_previous_state_repo_path(
    entry: &StatusEntry<'_>,
    status: Status,
    current_repo_path: &Option<PathBuf>,
) -> Option<PathBuf> {
    resolve_previous_display_repo_path(entry).or_else(|| {
        if has_tracked_previous_state(status) {
            current_repo_path.clone()
        } else {
            None
        }
    })
}

fn infer_change_group(status: Status) -> GitChangeGroup {
    let staged_flags = Status::INDEX_NEW
        | Status::INDEX_MODIFIED
        | Status::INDEX_DELETED
        | Status::INDEX_RENAMED
        | Status::INDEX_TYPECHANGE;

    if status.contains(Status::WT_NEW) && !status.intersects(staged_flags) {
        GitChangeGroup::Unversioned
    } else {
        GitChangeGroup::Changes
    }
}

fn has_tracked_previous_state(status: Status) -> bool {
    status.intersects(
        Status::WT_MODIFIED
            | Status::WT_DELETED
            | Status::WT_RENAMED
            | Status::WT_TYPECHANGE
            | Status::INDEX_MODIFIED
            | Status::INDEX_DELETED
            | Status::INDEX_RENAMED
            | Status::INDEX_TYPECHANGE,
    )
}

fn infer_change_status(status: Status) -> GitChangeStatus {
    if status.intersects(Status::WT_RENAMED | Status::INDEX_RENAMED) {
        GitChangeStatus::Renamed
    } else if status.intersects(Status::WT_DELETED | Status::INDEX_DELETED) {
        GitChangeStatus::Deleted
    } else if status.intersects(Status::WT_NEW | Status::INDEX_NEW) {
        GitChangeStatus::Added
    } else {
        GitChangeStatus::Modified
    }
}

fn read_head_text_content(
    repo: &Repository,
    repo_path: &Path,
) -> Result<Option<(TextContentKind, String)>, String> {
    let Some(head_commit) = resolve_head_commit(repo)? else {
        return Ok(None);
    };
    let tree = head_commit.tree().map_err(|error| error.to_string())?;
    let tree_entry = match tree.get_path(repo_path) {
        Ok(entry) => entry,
        Err(error) if error.code() == git2::ErrorCode::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let object = tree_entry.to_object(repo).map_err(|error| error.to_string())?;
    let blob = object
        .as_blob()
        .ok_or_else(|| String::from("The selected Git object is not a file blob."))?;
    let bytes = blob.content();

    Ok(Some(classify_text_bytes(bytes)?))
}

fn read_worktree_text_content(path: &Path) -> Result<Option<(TextContentKind, String)>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(classify_text_bytes(&bytes)?)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn classify_text_bytes(bytes: &[u8]) -> Result<(TextContentKind, String), String> {
    if bytes.len() as u64 > MAX_DIFFABLE_TEXT_BYTES {
        return Ok((TextContentKind::TooLarge, String::new()));
    }

    match std::str::from_utf8(bytes) {
        Ok(text) => Ok((TextContentKind::Text, text.to_string())),
        Err(_) => Ok((TextContentKind::Binary, String::new())),
    }
}

fn append_gitignore_rules(path: &Path, rules: &BTreeSet<String>) -> Result<(), String> {
    let existing = match fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(error.to_string()),
    };
    let existing_rules = existing
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<BTreeSet<_>>();
    let missing_rules = rules
        .iter()
        .filter(|rule| !existing_rules.contains(rule.as_str()))
        .cloned()
        .collect::<Vec<_>>();

    if missing_rules.is_empty() {
        return Ok(());
    }

    let mut next_content = existing;
    if !next_content.is_empty() && !next_content.ends_with('\n') {
        next_content.push('\n');
    }

    for rule in missing_rules {
        next_content.push_str(&rule);
        next_content.push('\n');
    }

    fs::write(path, next_content).map_err(|error| error.to_string())
}

fn extract_text_content(content: Option<(TextContentKind, String)>) -> Option<String> {
    match content {
        Some((TextContentKind::Text, text)) => Some(text),
        _ => None,
    }
}

fn resolve_branch_name(repo: &Repository) -> String {
    if let Ok(head) = repo.head() {
        if head.is_branch() {
            if let Some(name) = head.shorthand() {
                if !name.trim().is_empty() {
                    return name.to_string();
                }
            }
        }

        if let Some(name) = head.shorthand() {
            if name.eq_ignore_ascii_case("head") {
                return String::from("Detached");
            }
        }
    }

    String::new()
}

fn resolve_head_commit(repo: &Repository) -> Result<Option<Commit<'_>>, String> {
    match repo.head() {
        Ok(reference) => reference
            .peel_to_commit()
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(error) if error.code() == git2::ErrorCode::UnbornBranch => Ok(None),
        Err(error) if error.code() == git2::ErrorCode::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn resolve_commit_parents(repo: &Repository) -> Result<Vec<Commit<'_>>, String> {
    let Some(head_commit) = resolve_head_commit(repo)? else {
        return Ok(Vec::new());
    };

    Ok(vec![head_commit])
}

fn repo_workdir(repo: &Repository) -> Result<PathBuf, String> {
    if let Some(workdir) = repo.workdir() {
        return fs::canonicalize(workdir).map_err(|error| error.to_string());
    }

    repo.path()
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| String::from("Unable to resolve the Git repository root."))
}

fn normalize_directory(path: &Path) -> Result<PathBuf, String> {
    let normalized = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if normalized.is_dir() {
        Ok(normalized)
    } else {
        Err(format!("Not a directory: {}", normalized.to_string_lossy()))
    }
}

fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    diff_paths(path, root)
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .ok_or_else(|| format!("Failed to resolve relative path for {}", path_to_string(path)))
}

fn repo_path_to_absolute_path(repo_root: &Path, repo_path: &Path) -> PathBuf {
    normalize_path_lexically(&repo_root.join(repo_path))
}

fn repo_pathspec(repo_path: &Path) -> OsString {
    OsString::from(repo_path.to_string_lossy().replace('\\', "/"))
}

fn normalize_path_lexically(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
        }
    }

    normalized
}

fn path_is_within_root(path: &Path, root: &Path) -> bool {
    let normalized_path = normalize_comparable_path(path);
    let normalized_root = normalize_comparable_path(root);

    normalized_path == normalized_root
        || normalized_path.starts_with(&format!("{normalized_root}/"))
}

fn normalize_comparable_path(path: &Path) -> String {
    let normalized = path_to_string(path).replace('\\', "/");

    #[cfg(windows)]
    {
        normalized.to_ascii_lowercase()
    }

    #[cfg(not(windows))]
    {
        normalized
    }
}

fn run_git_with_repo_root(repo_root: &Path, args: &[OsString]) -> Result<(), String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(repo_root);

    for arg in args {
        command.arg(arg);
    }

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output().map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!(
            "Git command failed in {} with status {}.",
            path_to_string(repo_root),
            output.status
        )
    };

    Err(message)
}

fn remove_worktree_path(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())
    } else {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

fn sort_git_entries(entries: &mut [GitChangeEntry]) {
    entries.sort_by(|left, right| left.path.to_lowercase().cmp(&right.path.to_lowercase()));
}

fn sort_git_repositories(repositories: &mut [GitRepositoryChanges]) {
    repositories.sort_by(|left, right| {
        let left_key = format!("{}/{}", left.relative_path.to_lowercase(), left.name.to_lowercase());
        let right_key = format!(
            "{}/{}",
            right.relative_path.to_lowercase(),
            right.name.to_lowercase()
        );
        left_key.cmp(&right_key)
    });
}

fn first_commit_message_line(message: &str) -> String {
    message
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or_default()
        .to_string()
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        return path_to_string(left).eq_ignore_ascii_case(&path_to_string(right));
    }

    #[cfg(not(windows))]
    {
        left == right
    }
}

fn repository_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.trim().is_empty())
        .map(String::from)
        .unwrap_or_else(|| path_to_string(path))
}

fn repository_relative_path(context: &GitContext) -> Result<String, String> {
    if paths_equal(&context.workspace_root, &context.listing_root) {
        return Ok(String::from("."));
    }

    relative_path(&context.listing_root, &context.workspace_root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_workspace_filters_out_sibling_repo_files() {
        let repo_root = std::env::temp_dir().join("vibe-cli-editor-git-scope-tests").join("repo");
        let workspace_root = repo_root.join("apps").join("editor");
        let inside_path = repo_path_to_absolute_path(&repo_root, Path::new("apps/editor/src/main.ts"));
        let outside_path =
            repo_path_to_absolute_path(&repo_root, Path::new("apps/shared/package.json"));

        assert!(path_is_within_root(&inside_path, &workspace_root));
        assert!(!path_is_within_root(&outside_path, &workspace_root));
        assert_eq!(
            relative_path(&workspace_root, &inside_path).as_deref(),
            Ok("src/main.ts")
        );
    }

    #[test]
    fn parent_traversal_repo_paths_do_not_escape_into_workspace_results() {
        let repo_root = std::env::temp_dir().join("vibe-cli-editor-git-scope-tests").join("repo");
        let escaped_path = repo_path_to_absolute_path(&repo_root, Path::new("../outside.txt"));

        assert!(!path_is_within_root(&escaped_path, &repo_root));
    }

    #[test]
    fn repository_discovery_finds_child_repositories_under_workspace_root() {
        let temp_root = std::env::temp_dir()
            .join("vibe-cli-editor-git-scope-tests")
            .join("multi-repo-workspace");
        let _ = fs::remove_dir_all(&temp_root);
        fs::create_dir_all(temp_root.join("app-one").join(".git")).unwrap();
        fs::create_dir_all(temp_root.join("group").join("app-two").join(".git")).unwrap();
        fs::create_dir_all(temp_root.join("node_modules").join("ignored-repo").join(".git")).unwrap();

        let discovered = discover_child_repository_roots(&temp_root).unwrap();

        assert_eq!(
            discovered,
            vec![
                temp_root.join("app-one"),
                temp_root.join("group").join("app-two"),
            ]
        );

        let _ = fs::remove_dir_all(&temp_root);
    }
}
