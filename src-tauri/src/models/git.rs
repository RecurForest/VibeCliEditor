use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitChangeStatus {
    Added,
    Deleted,
    Modified,
    Renamed,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GitChangeGroup {
    Changes,
    Unversioned,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangeEntry {
    pub path: String,
    pub abs_path: String,
    pub status: GitChangeStatus,
    pub group: GitChangeGroup,
    pub previous_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepositoryChanges {
    pub root_path: String,
    pub name: String,
    pub relative_path: String,
    pub branch: String,
    pub changes: Vec<GitChangeEntry>,
    pub unversioned: Vec<GitChangeEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangesResult {
    pub root_path: String,
    pub has_repository: bool,
    pub repositories: Vec<GitRepositoryChanges>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub root_path: String,
    pub branch: String,
    pub path: String,
    pub abs_path: String,
    pub status: GitChangeStatus,
    pub group: GitChangeGroup,
    pub previous_path: Option<String>,
    pub is_binary: bool,
    pub too_large: bool,
    pub original_content: Option<String>,
    pub modified_content: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitResult {
    pub branch: String,
    pub commit_oid: String,
    pub summary: String,
}
