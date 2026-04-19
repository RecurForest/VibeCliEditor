mod commands;
mod models;
mod services;

use services::terminal::TerminalState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::files::get_default_root,
            commands::files::scan_working_dir,
            commands::files::read_directory,
            commands::files::read_file,
            commands::files::read_media_file_data_url,
            commands::files::write_file,
            commands::files::upsert_file,
            commands::files::create_directory,
            commands::files::delete_file,
            commands::files::delete_path,
            commands::files::rename_path,
            commands::files::paste_clipboard_items,
            commands::files::save_clipboard_files_to_temp,
            commands::files::cleanup_stale_composer_attachment_temp,
            commands::files::search_files,
            commands::files::search_text_in_files,
            commands::files::get_git_branch,
            commands::files::open_in_file_manager,
            commands::git::get_git_changes,
            commands::git::get_git_diff,
            commands::git::commit_git_selection,
            commands::git::stage_git_paths,
            commands::git::rollback_git_paths,
            commands::git::ignore_git_paths,
            commands::git::delete_git_paths,
            commands::git::push_git_branch,
            commands::session_diff::create_session_diff_baseline,
            commands::session_diff::get_session_diff,
            commands::session_diff::dispose_session_diff_baseline,
            commands::session_diff::dispose_session_diff_baselines,
            commands::terminal::start_terminal,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
            commands::terminal::insert_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
