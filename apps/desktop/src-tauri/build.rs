fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "choose_pdf",
            "read_pdf_chunk",
            "cancel_pdf_read",
            "take_launch_pdf",
            "get_recent_files",
            "set_recent_files_enabled",
            "clear_recent_files",
            "open_recent_pdf",
            "choose_save_pdf",
            "write_pdf_chunk",
            "cancel_pdf_write",
            "store_secure_session",
            "get_secure_session",
            "clear_secure_session",
            "store_secure_entitlement",
            "get_secure_entitlement",
            "clear_secure_entitlement",
            "check_for_update",
            "install_available_update",
            "open_developer_profile",
        ]),
    ))
    .expect("PDFMason Tauri configuration failed to build");
}
