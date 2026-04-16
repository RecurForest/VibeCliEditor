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
            commands::files::write_file,
            commands::files::upsert_file,
            commands::files::delete_file,
            commands::files::search_files,
            commands::files::get_git_branch,
            commands::files::open_in_file_manager,
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
