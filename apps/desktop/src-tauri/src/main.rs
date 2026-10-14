#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod native_files;
mod secure_session;
mod updates;

fn main() {
    use tauri::{Emitter, Manager};

    let initial_arguments = std::env::args().collect::<Vec<_>>();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, arguments, _| {
            if native_files::queue_launch_pdf(app, &arguments) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = app.emit("pdfmason-launch-file", ());
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(native_files::NativeFileState::default())
        .manage(secure_session::SecureSessionState::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            native_files::queue_launch_pdf(app.handle(), &initial_arguments);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            native_files::choose_pdf,
            native_files::read_pdf_chunk,
            native_files::cancel_pdf_read,
            native_files::take_launch_pdf,
            native_files::get_recent_files,
            native_files::set_recent_files_enabled,
            native_files::clear_recent_files,
            native_files::open_recent_pdf,
            native_files::choose_save_pdf,
            native_files::write_pdf_chunk,
            native_files::cancel_pdf_write,
            secure_session::store_secure_session,
            secure_session::get_secure_session,
            secure_session::clear_secure_session,
            secure_session::store_secure_entitlement,
            secure_session::get_secure_entitlement,
            secure_session::clear_secure_entitlement,
            updates::check_for_update,
            updates::install_available_update,
        ])
        .run(tauri::generate_context!())
        .expect("PDFMason desktop shell failed to start");
}
