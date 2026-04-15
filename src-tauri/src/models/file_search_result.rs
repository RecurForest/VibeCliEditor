use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchResult {
    pub name: String,
    pub abs_path: String,
    pub rel_path: String,
}
