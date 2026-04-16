use crate::models::session_diff::SessionDiffResult;
use crate::services::session_diff;

#[tauri::command]
pub fn create_session_diff_baseline(session_id: String, root_path: String) -> Result<(), String> {
    session_diff::create_baseline(&session_id, &root_path)
}

#[tauri::command]
pub fn get_session_diff(session_id: String, root_path: String) -> Result<SessionDiffResult, String> {
    session_diff::get_session_diff(&session_id, &root_path)
}

#[tauri::command]
pub fn dispose_session_diff_baseline(session_id: String) -> Result<(), String> {
    session_diff::dispose_baseline(&session_id)
}

#[tauri::command]
pub fn dispose_session_diff_baselines(keep_session_id: Option<String>) -> Result<(), String> {
    session_diff::dispose_baselines(keep_session_id.as_deref())
}
