use std::collections::{BTreeSet, HashMap};
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use pathdiff::diff_paths;
use sha2::{Digest, Sha256};

use crate::models::session_diff::{
    SessionDiffBaselineFile, SessionDiffBaselineManifest, SessionDiffContentKind, SessionDiffFile,
    SessionDiffFileStatus, SessionDiffResult,
};
use crate::services::paths::path_to_string;

const SESSION_DIFF_ROOT_DIR: &str = "jterminal-session-diff";
const MANIFEST_FILE_NAME: &str = "manifest.json";
const SNAPSHOT_FILES_DIR_NAME: &str = "files";
const MAX_DIFFABLE_TEXT_BYTES: u64 = 1_000_000;
const IGNORED_DIR_NAMES: &[&str] = &[".git", "node_modules", "dist", "build", "target", ".next", "coverage"];
const IGNORED_DIR_PREFIXES: &[&str] = &["target-"];

struct CurrentWorkspaceFile {
    abs_path: PathBuf,
    kind: SessionDiffContentKind,
    sha256: String,
}

pub fn create_baseline(session_id: &str, root_path: &str) -> Result<(), String> {
    if session_id.trim().is_empty() {
        return Err(String::from("Session id is required."));
    }

    let root = normalize_directory(Path::new(root_path))?;
    let baseline_dir = baseline_dir(session_id);
    let snapshot_root = baseline_dir.join(SNAPSHOT_FILES_DIR_NAME);

    if baseline_dir.exists() {
        fs::remove_dir_all(&baseline_dir).map_err(|error| error.to_string())?;
    }

    let create_result = (|| -> Result<(), String> {
        fs::create_dir_all(&snapshot_root).map_err(|error| error.to_string())?;

        let mut files = Vec::new();
        collect_baseline_files(&root, &root, &snapshot_root, &mut files)?;
        files.sort_by(|left, right| left.path.cmp(&right.path));

        let manifest = SessionDiffBaselineManifest {
            session_id: session_id.to_string(),
            root_path: path_to_string(&root),
            created_at: current_unix_timestamp_ms()?,
            files,
        };

        let manifest_json =
            serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?;
        fs::write(baseline_dir.join(MANIFEST_FILE_NAME), manifest_json)
            .map_err(|error| error.to_string())
    })();

    if create_result.is_err() {
        let _ = fs::remove_dir_all(&baseline_dir);
    }

    create_result
}

pub fn get_session_diff(session_id: &str, root_path: &str) -> Result<SessionDiffResult, String> {
    if session_id.trim().is_empty() {
        return Err(String::from("Session id is required."));
    }

    let root = normalize_directory(Path::new(root_path))?;
    let manifest = read_manifest(session_id)?;
    let resolved_root_path = path_to_string(&root);

    if !is_same_root(&manifest.root_path, &resolved_root_path) {
        return Err(String::from(
            "The session diff baseline does not match the current workspace.",
        ));
    }

    let snapshot_root = baseline_dir(session_id).join(SNAPSHOT_FILES_DIR_NAME);
    let baseline_files = manifest
        .files
        .into_iter()
        .filter(|file| !should_skip_relative_path(&file.path))
        .map(|file| (file.path.clone(), file))
        .collect::<HashMap<_, _>>();
    let current_files = collect_current_workspace_files(&root)?;

    let mut paths = BTreeSet::new();
    paths.extend(baseline_files.keys().cloned());
    paths.extend(current_files.keys().cloned());

    let mut files = Vec::new();

    for path in paths {
        let baseline_file = baseline_files.get(&path);
        let current_file = current_files.get(&path);

        let diff_file = match (baseline_file, current_file) {
            (Some(previous), None) => {
                let (original_content, modified_content) =
                    build_text_content_pair(&snapshot_root, Some(previous), None)?;

                Some(SessionDiffFile {
                    path: path.clone(),
                    abs_path: resolve_diff_abs_path(&root, &path),
                    status: SessionDiffFileStatus::Deleted,
                    is_binary: previous.kind == SessionDiffContentKind::Binary,
                    too_large: previous.kind == SessionDiffContentKind::TooLarge,
                    original_content,
                    modified_content,
                })
            }
            (None, Some(current)) => {
                let (original_content, modified_content) =
                    build_text_content_pair(&snapshot_root, None, Some(current))?;

                Some(SessionDiffFile {
                    path: path.clone(),
                    abs_path: path_to_string(&current.abs_path),
                    status: SessionDiffFileStatus::Added,
                    is_binary: current.kind == SessionDiffContentKind::Binary,
                    too_large: current.kind == SessionDiffContentKind::TooLarge,
                    original_content,
                    modified_content,
                })
            }
            (Some(previous), Some(current))
                if previous.sha256 != current.sha256 || previous.kind != current.kind =>
            {
                let (original_content, modified_content) =
                    build_text_content_pair(&snapshot_root, Some(previous), Some(current))?;

                Some(SessionDiffFile {
                    path: path.clone(),
                    abs_path: path_to_string(&current.abs_path),
                    status: SessionDiffFileStatus::Modified,
                    is_binary: previous.kind == SessionDiffContentKind::Binary
                        || current.kind == SessionDiffContentKind::Binary,
                    too_large: previous.kind == SessionDiffContentKind::TooLarge
                        || current.kind == SessionDiffContentKind::TooLarge,
                    original_content,
                    modified_content,
                })
            }
            _ => None,
        };

        if let Some(file) = diff_file {
            files.push(file);
        }
    }

    Ok(SessionDiffResult {
        session_id: session_id.to_string(),
        root_path: resolved_root_path,
        generated_at: current_unix_timestamp_ms()?,
        files,
    })
}

pub fn dispose_baseline(session_id: &str) -> Result<(), String> {
    if session_id.trim().is_empty() {
        return Ok(());
    }

    let baseline_dir = baseline_dir(session_id);
    if baseline_dir.exists() {
        fs::remove_dir_all(baseline_dir).map_err(|error| error.to_string())?;
    }

    Ok(())
}

pub fn dispose_baselines(keep_session_id: Option<&str>) -> Result<(), String> {
    let baseline_root = baseline_root_dir();
    if !baseline_root.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(&baseline_root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let Some(session_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };

        if keep_session_id.is_some_and(|keep| keep == session_name) {
            continue;
        }

        if path.is_dir() {
            fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
        } else {
            fs::remove_file(&path).map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn collect_baseline_files(
    root: &Path,
    current_dir: &Path,
    snapshot_root: &Path,
    files: &mut Vec<SessionDiffBaselineFile>,
) -> Result<(), String> {
    for entry in fs::read_dir(current_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if should_skip_entry(&path) {
            continue;
        }

        if path.is_dir() {
            collect_baseline_files(root, &path, snapshot_root, files)?;
            continue;
        }

        files.push(build_baseline_file(root, &path, snapshot_root)?);
    }

    Ok(())
}

fn build_baseline_file(
    root: &Path,
    path: &Path,
    snapshot_root: &Path,
) -> Result<SessionDiffBaselineFile, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let relative_path = relative_path(root, path)?;
    let modified_at = modified_at_ms(&metadata);

    let (kind, sha256, snapshot_bytes) = classify_file_for_baseline(path, metadata.len())?;

    if let Some(bytes) = snapshot_bytes {
        let snapshot_path = snapshot_root.join(&relative_path);
        if let Some(parent) = snapshot_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        fs::write(snapshot_path, bytes).map_err(|error| error.to_string())?;
    }

    Ok(SessionDiffBaselineFile {
        path: relative_path,
        kind,
        size: metadata.len(),
        modified_at,
        sha256,
    })
}

fn classify_file_for_baseline(
    path: &Path,
    size: u64,
) -> Result<(SessionDiffContentKind, String, Option<Vec<u8>>), String> {
    if size > MAX_DIFFABLE_TEXT_BYTES {
        return Ok((SessionDiffContentKind::TooLarge, sha256_file(path)?, None));
    }

    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let sha256 = sha256_bytes(&bytes);

    if std::str::from_utf8(&bytes).is_ok() {
        Ok((SessionDiffContentKind::Text, sha256, Some(bytes)))
    } else {
        Ok((SessionDiffContentKind::Binary, sha256, None))
    }
}

fn collect_current_workspace_files(root: &Path) -> Result<HashMap<String, CurrentWorkspaceFile>, String> {
    let mut files = HashMap::new();
    collect_current_workspace_files_recursive(root, root, &mut files)?;
    Ok(files)
}

fn collect_current_workspace_files_recursive(
    root: &Path,
    current_dir: &Path,
    files: &mut HashMap<String, CurrentWorkspaceFile>,
) -> Result<(), String> {
    for entry in fs::read_dir(current_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if should_skip_entry(&path) {
            continue;
        }

        if path.is_dir() {
            collect_current_workspace_files_recursive(root, &path, files)?;
            continue;
        }

        let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
        let relative_path = relative_path(root, &path)?;
        let (kind, sha256) = classify_current_file(&path, metadata.len())?;

        files.insert(
            relative_path,
            CurrentWorkspaceFile {
                abs_path: path,
                kind,
                sha256,
            },
        );
    }

    Ok(())
}

fn classify_current_file(path: &Path, size: u64) -> Result<(SessionDiffContentKind, String), String> {
    if size > MAX_DIFFABLE_TEXT_BYTES {
        return Ok((SessionDiffContentKind::TooLarge, sha256_file(path)?));
    }

    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let sha256 = sha256_bytes(&bytes);

    if std::str::from_utf8(&bytes).is_ok() {
        Ok((SessionDiffContentKind::Text, sha256))
    } else {
        Ok((SessionDiffContentKind::Binary, sha256))
    }
}

fn build_text_content_pair(
    snapshot_root: &Path,
    baseline: Option<&SessionDiffBaselineFile>,
    current: Option<&CurrentWorkspaceFile>,
) -> Result<(Option<String>, Option<String>), String> {
    if matches!(baseline.map(|file| file.kind), Some(kind) if kind != SessionDiffContentKind::Text)
        || matches!(current.map(|file| file.kind), Some(kind) if kind != SessionDiffContentKind::Text)
    {
        return Ok((None, None));
    }

    if baseline.is_none() && current.is_none() {
        return Ok((None, None));
    }

    let original_content = match baseline {
        Some(file) => Some(read_snapshot_text(snapshot_root, &file.path)?),
        None => Some(String::new()),
    };
    let modified_content = match current {
        Some(file) => Some(read_current_text(&file.abs_path)?),
        None => Some(String::new()),
    };

    Ok((original_content, modified_content))
}

fn read_snapshot_text(snapshot_root: &Path, relative_path: &str) -> Result<String, String> {
    fs::read_to_string(snapshot_root.join(relative_path)).map_err(|error| error.to_string())
}

fn read_current_text(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| error.to_string())
}

fn read_manifest(session_id: &str) -> Result<SessionDiffBaselineManifest, String> {
    let manifest_path = baseline_dir(session_id).join(MANIFEST_FILE_NAME);
    let manifest_json = fs::read(&manifest_path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            return format!(
                "The diff baseline for this session is missing at {}. Rebuild the baseline and try View again.",
                path_to_string(&manifest_path)
            );
        }

        format!(
            "Unable to read session diff baseline manifest at {}: {error}",
            path_to_string(&manifest_path)
        )
    })?;

    serde_json::from_slice(&manifest_json).map_err(|error| error.to_string())
}

fn baseline_dir(session_id: &str) -> PathBuf {
    baseline_root_dir().join(session_id)
}

fn baseline_root_dir() -> PathBuf {
    std::env::temp_dir().join(SESSION_DIFF_ROOT_DIR)
}

fn resolve_diff_abs_path(root: &Path, relative_path: &str) -> String {
    path_to_string(&root.join(relative_path))
}

fn normalize_directory(path: &Path) -> Result<PathBuf, String> {
    let normalized = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if normalized.is_dir() {
        Ok(normalized)
    } else {
        Err(format!("Not a directory: {}", normalized.to_string_lossy()))
    }
}

fn should_skip_entry(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };

    name.starts_with('.') || (path.is_dir() && is_ignored_dir_name(name))
}

fn should_skip_relative_path(relative_path: &str) -> bool {
    let segments = relative_path
        .split(['/', '\\'])
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();

    let Some(last_index) = segments.len().checked_sub(1) else {
        return false;
    };

    segments.iter().enumerate().any(|(index, segment)| {
        segment.starts_with('.')
            || (index < last_index && is_ignored_dir_name(segment))
    })
}

fn is_ignored_dir_name(name: &str) -> bool {
    IGNORED_DIR_NAMES
        .iter()
        .any(|ignored| name.eq_ignore_ascii_case(ignored))
        || IGNORED_DIR_PREFIXES.iter().any(|prefix| {
            name.len() > prefix.len()
                && name
                    .get(..prefix.len())
                    .is_some_and(|value| value.eq_ignore_ascii_case(prefix))
        })
}

fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    diff_paths(path, root)
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .ok_or_else(|| format!("Failed to resolve relative path for {}", path_to_string(path)))
}

fn modified_at_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file);
    let mut buffer = [0_u8; 8192];
    let mut hasher = Sha256::new();

    loop {
        let read_size = reader.read(&mut buffer).map_err(|error| error.to_string())?;
        if read_size == 0 {
            break;
        }

        hasher.update(&buffer[..read_size]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn current_unix_timestamp_ms() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as u64)
}

fn is_same_root(left: &str, right: &str) -> bool {
    #[cfg(windows)]
    {
        return left.eq_ignore_ascii_case(right);
    }

    #[cfg(not(windows))]
    {
        left == right
    }
}
