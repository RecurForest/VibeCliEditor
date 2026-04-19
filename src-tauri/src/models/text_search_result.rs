use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSearchResult {
    pub name: String,
    pub abs_path: String,
    pub rel_path: String,
    pub line: usize,
    pub column: usize,
    pub match_length: usize,
    pub line_text: String,
    pub preview: String,
    pub preview_start_line: usize,
}
