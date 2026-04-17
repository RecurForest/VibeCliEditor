use std::convert::TryFrom;
use std::env;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

const CODEX_SESSION_RESOLVE_POLL_MS: u64 = 200;
const CODEX_SESSION_STARTED_AT_GRACE_MS: i64 = 3_000;

pub fn resolve_codex_session_id(
    working_dir: &str,
    started_at_ms: i64,
    timeout_ms: u64,
) -> Result<Option<String>, String> {
    let Some(sessions_dir) = codex_sessions_dir() else {
        return Ok(None);
    };

    let normalized_working_dir = normalize_path_for_match(Path::new(working_dir));
    let attempts = (timeout_ms / CODEX_SESSION_RESOLVE_POLL_MS).max(1);

    for attempt in 0..=attempts {
        if let Some(session_id) =
            find_codex_session_id(&sessions_dir, &normalized_working_dir, started_at_ms)?
        {
            return Ok(Some(session_id));
        }

        if attempt < attempts {
            thread::sleep(Duration::from_millis(CODEX_SESSION_RESOLVE_POLL_MS));
        }
    }

    Ok(None)
}

fn find_codex_session_id(
    sessions_dir: &Path,
    normalized_working_dir: &str,
    started_at_ms: i64,
) -> Result<Option<String>, String> {
    let mut rollout_files = Vec::new();
    collect_rollout_files(sessions_dir, &mut rollout_files)?;

    let mut best_match: Option<(i64, i64, String)> = None;

    for rollout_file in rollout_files {
        let Some(session_meta) = read_codex_session_meta(&rollout_file)? else {
            continue;
        };

        if session_meta.normalized_cwd != normalized_working_dir {
            continue;
        }

        let delta_ms = session_meta.started_at_ms - started_at_ms;
        if delta_ms < -CODEX_SESSION_STARTED_AT_GRACE_MS {
            continue;
        }

        let distance_ms = delta_ms.abs();
        match &best_match {
            Some((best_distance_ms, best_started_at_ms, _))
                if distance_ms > *best_distance_ms
                    || (distance_ms == *best_distance_ms
                        && session_meta.started_at_ms <= *best_started_at_ms) => {}
            _ => {
                best_match = Some((distance_ms, session_meta.started_at_ms, session_meta.id));
            }
        }
    }

    Ok(best_match.map(|(_, _, session_id)| session_id))
}

fn collect_rollout_files(directory: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            collect_rollout_files(&path, files)?;
            continue;
        }

        let is_rollout_file = path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.starts_with("rollout-") && value.ends_with(".jsonl"));
        if is_rollout_file {
            files.push(path);
        }
    }

    Ok(())
}

fn read_codex_session_meta(path: &Path) -> Result<Option<CodexSessionMeta>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file);
    let mut first_line = String::new();

    if reader
        .read_line(&mut first_line)
        .map_err(|error| error.to_string())?
        == 0
    {
        return Ok(None);
    }

    let Ok(record) = serde_json::from_str::<CodexSessionRecord>(first_line.trim_end()) else {
        return Ok(None);
    };
    if record.record_type != "session_meta" {
        return Ok(None);
    }

    if record
        .payload
        .originator
        .as_deref()
        .is_some_and(|value| value != "codex-tui")
    {
        return Ok(None);
    }

    let Ok(started_at_ms) = parse_rfc3339_millis(&record.payload.timestamp) else {
        return Ok(None);
    };

    Ok(Some(CodexSessionMeta {
        id: record.payload.id,
        normalized_cwd: normalize_path_for_match(Path::new(&record.payload.cwd)),
        started_at_ms,
    }))
}

fn codex_sessions_dir() -> Option<PathBuf> {
    let codex_home = env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|value| PathBuf::from(value).join(".codex")))
        .or_else(|| env::var_os("USERPROFILE").map(|value| PathBuf::from(value).join(".codex")))?;

    let sessions_dir = codex_home.join("sessions");
    sessions_dir.is_dir().then_some(sessions_dir)
}

fn normalize_path_for_match(path: &Path) -> String {
    let canonical_path = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let normalized = canonical_path.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        normalized.replace('/', "\\").to_ascii_lowercase()
    }

    #[cfg(not(windows))]
    {
        normalized
    }
}

fn parse_rfc3339_millis(value: &str) -> Result<i64, String> {
    let timestamp = OffsetDateTime::parse(value, &Rfc3339).map_err(|error| error.to_string())?;
    let millis = timestamp.unix_timestamp_nanos() / 1_000_000;
    i64::try_from(millis).map_err(|error| error.to_string())
}

#[derive(Debug)]
struct CodexSessionMeta {
    id: String,
    normalized_cwd: String,
    started_at_ms: i64,
}

#[derive(Debug, Deserialize)]
struct CodexSessionRecord {
    #[serde(rename = "type")]
    record_type: String,
    payload: CodexSessionRecordPayload,
}

#[derive(Debug, Deserialize)]
struct CodexSessionRecordPayload {
    cwd: String,
    id: String,
    originator: Option<String>,
    timestamp: String,
}
