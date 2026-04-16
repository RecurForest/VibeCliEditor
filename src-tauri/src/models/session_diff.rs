use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionDiffContentKind {
    Text,
    Binary,
    TooLarge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiffBaselineFile {
    pub path: String,
    pub kind: SessionDiffContentKind,
    pub size: u64,
    pub modified_at: Option<u64>,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiffBaselineManifest {
    pub session_id: String,
    pub root_path: String,
    pub created_at: u64,
    pub files: Vec<SessionDiffBaselineFile>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionDiffFileStatus {
    Added,
    Deleted,
    Modified,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiffFile {
    pub path: String,
    pub abs_path: String,
    pub status: SessionDiffFileStatus,
    pub is_binary: bool,
    pub too_large: bool,
    pub original_content: Option<String>,
    pub modified_content: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDiffResult {
    pub session_id: String,
    pub root_path: String,
    pub generated_at: u64,
    pub files: Vec<SessionDiffFile>,
}
