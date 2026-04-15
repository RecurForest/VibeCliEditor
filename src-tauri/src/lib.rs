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
            commands::files::get_git_branch,
            commands::terminal::start_terminal,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close,
            commands::terminal::insert_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
