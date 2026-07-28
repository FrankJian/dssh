pub mod ai;
pub mod app;
pub mod commands;
pub mod config;
pub mod crypto;
pub mod error;
pub mod forwarding;
pub mod hosttools;
pub mod models;
pub mod s3;
pub mod sftp;
pub mod ssh;
pub mod storage;
pub mod terminal;
pub mod theme;
pub mod utils;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // The updater and process plugins are desktop-only.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .setup(|app| {
            let state = app::AppState::initialize(app.handle()).map_err(|error| {
                Box::<dyn std::error::Error>::from(std::io::Error::other(error.message))
            })?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::app_health,
            commands::app::app_update_endpoint_diagnostics,
            commands::profiles::list_ssh_profiles,
            commands::profiles::create_ssh_profile,
            commands::profiles::update_ssh_profile,
            commands::profiles::delete_ssh_profile,
            commands::profiles::set_ssh_profile_favorite,
            commands::profiles::read_key_file,
            commands::s3::list_s3_profiles,
            commands::s3::create_s3_profile,
            commands::s3::update_s3_profile,
            commands::s3::delete_s3_profile,
            commands::s3::set_s3_profile_favorite,
            commands::s3::list_s3_bookmarks,
            commands::s3::create_s3_bookmark,
            commands::s3::delete_s3_bookmark,
            commands::s3::test_s3_profile,
            commands::s3::test_s3_connection,
            commands::s3::s3_list_buckets,
            commands::s3::s3_list_objects,
            commands::s3::s3_create_folder,
            commands::s3::s3_upload,
            commands::s3::s3_download,
            commands::s3::s3_download_prefix,
            commands::s3::s3_delete,
            commands::s3::s3_cleanup_preview,
            commands::s3::s3_cleanup_delete,
            commands::s3::s3_copy,
            commands::s3::s3_move,
            commands::s3::s3_set_canned_acl,
            commands::s3::s3_get_canned_acl,
            commands::config::export_profiles_yaml,
            commands::config::import_profiles_yaml,
            commands::config::export_profiles_encrypted,
            commands::config::import_profiles_encrypted,
            commands::config::read_text_file,
            commands::config::write_text_file,
            commands::config::read_image_data_url,
            commands::sessions::list_ssh_sessions,
            commands::sessions::start_local_session,
            commands::sessions::start_ssh_session,
            commands::sessions::write_ssh_session,
            commands::sessions::resize_ssh_session,
            commands::sessions::close_ssh_session,
            commands::sessions::cancel_reconnect,
            commands::sessions::respond_host_key_prompt,
            commands::sftp::sftp_home,
            commands::sftp::sftp_list,
            commands::sftp::sftp_read_text,
            commands::sftp::sftp_write_text,
            commands::sftp::sftp_read_image,
            commands::sftp::sftp_download,
            commands::sftp::sftp_download_dir,
            commands::sftp::sftp_upload,
            commands::sftp::sftp_create_dir,
            commands::sftp::sftp_create_file,
            commands::sftp::sftp_rename,
            commands::sftp::sftp_delete_file,
            commands::sftp::sftp_delete_empty_dir,
            commands::sftp::sftp_disconnect,
            commands::forwarding::start_port_forward,
            commands::forwarding::stop_port_forward,
            commands::forwarding::list_port_forwards,
            commands::hosttools::host_tools_snapshot,
            commands::ai::ai_list_models,
            commands::ai::ai_send_message,
            commands::ai::ai_approve_tool,
            commands::ai::ai_answer_question,
            commands::ai::ai_cancel_run,
            commands::ai::ai_load_chat_history,
            commands::ai::ai_save_chat_history,
            commands::ai::ai_clear_chat_history,
            commands::ai::ai_copilot_start_login,
            commands::ai::ai_copilot_cancel_login,
            commands::ai::ai_copilot_status,
            commands::ai::ai_copilot_logout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
