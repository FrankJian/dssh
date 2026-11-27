pub mod ai;
pub mod app;
mod application_exit;
pub mod browser;
pub mod commands;
pub mod config;
pub mod crypto;
pub mod editor;
pub mod error;
pub mod forwarding;
pub mod hosttools;
pub mod jumpserver;
pub mod models;
#[cfg(target_os = "macos")]
mod native_application_exit;
mod native_editor_menu;
pub mod network_scan;
pub mod rdp;
pub mod s3;
pub mod sftp;
pub mod ssh;
pub mod storage;
pub mod terminal;
pub mod theme;
pub mod utils;
pub mod workspace;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init());

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
            app.manage(state.detached_workspaces.clone());
            app.manage(state);
            app.manage(network_scan::ScanManager::default());
            app.manage(application_exit::ApplicationExit::default());
            #[cfg(target_os = "macos")]
            native_application_exit::install(app.handle())?;
            app.manage(browser::BrowserManager::default());
            app.manage(native_editor_menu::NativeEditorMenus::new(app.handle())?);
            Ok(())
        })
        .on_menu_event(|app, event| {
            app.state::<native_editor_menu::NativeEditorMenus>()
                .dispatch(app, event.id().as_ref());
        })
        .invoke_handler(browser::guard(tauri::generate_handler![
            native_editor_menu::editor_set_native_context,
            application_exit::application_exit_reply,
            commands::editor_files::editor_begin_file_operation,
            commands::editor_files::editor_cancel_file_operation,
            commands::editor_files::editor_mutate_files,
            commands::editor_files::editor_delete_preview,
            commands::editor::editor_open_workspace,
            commands::editor::editor_detach_workspace,
            commands::editor::editor_handoff_ready,
            commands::editor::editor_wait_handoff,
            commands::editor::editor_finish_handoff,
            commands::editor::editor_close_workspace,
            commands::editor::editor_list,
            commands::editor::editor_read_text,
            commands::editor::editor_read_image,
            commands::editor::editor_inspect_file,
            commands::editor::editor_watch_files,
            commands::editor::editor_start_scan,
            commands::editor::editor_filter_open_paths,
            commands::editor::editor_next_scan,
            commands::editor::editor_cancel_scan,
            commands::editor::editor_save_text,
            commands::tools::save_tool_png,
            commands::tools::hash_tool_text,
            commands::network_scan::list_scan_interfaces,
            commands::network_scan::start_lan_ip_scan,
            commands::network_scan::cancel_lan_ip_scan,
            commands::artifactory::list_artifactory_profiles,
            commands::artifactory::save_artifactory_profile,
            commands::artifactory::delete_artifactory_profile,
            commands::artifactory::artifactory_repositories,
            commands::artifactory::artifactory_list_folder,
            commands::artifactory::artifactory_item_info,
            commands::artifactory::artifactory_upload,
            commands::artifactory::artifactory_download,
            commands::artifactory::artifactory_set_property,
            commands::artifactory::artifactory_delete_property,
            commands::artifactory::transfers::artifactory_enqueue_transfer,
            commands::artifactory::transfers::artifactory_list_transfers,
            commands::artifactory::transfers::artifactory_cancel_transfer,
            commands::artifactory::transfers::artifactory_retry_transfer,
            commands::artifactory::transfers::artifactory_clear_transfers,
            commands::jumpserver::list_jumpserver_profiles,
            commands::jumpserver::save_jumpserver_profile,
            commands::jumpserver::delete_jumpserver_profile,
            commands::jumpserver::jumpserver_login,
            commands::jumpserver::jumpserver_verify_otp,
            commands::jumpserver::jumpserver_cancel_login,
            commands::jumpserver::jumpserver_open_ssh_gateway,
            commands::jumpserver::jumpserver_identity,
            commands::jumpserver::jumpserver_list_assets,
            commands::jumpserver::jumpserver_list_nodes,
            commands::jumpserver::jumpserver_list_accounts,
            commands::jumpserver::jumpserver_open_terminal,
            commands::jumpserver::jumpserver_logout,
            commands::rdp::rdp_engine_status,
            commands::smb::list_smb_profiles,
            commands::smb::save_smb_profile,
            commands::smb::delete_smb_profile,
            commands::smb::map_smb_profile,
            commands::smb::unmap_smb_profile,
            commands::rdp::list_rdp_profiles,
            commands::rdp::save_rdp_profile,
            commands::rdp::delete_rdp_profile,
            commands::rdp::list_rdp_sessions,
            commands::rdp::start_rdp_session,
            commands::rdp::focus_rdp_session,
            commands::rdp::close_rdp_session,
            commands::browser::open_browser,
            commands::browser::list_browser_tabs,
            commands::browser::close_browser_tab,
            commands::browser::rename_browser_tab,
            commands::browser::detach_browser_tab,
            commands::browser::open_browser_external,
            commands::browser::mount_browser,
            commands::browser::resize_browser,
            commands::browser::browser_action,
            commands::app::app_health,
            commands::app::app_update_endpoint_diagnostics,
            commands::app::list_system_font_families,
            commands::app_lock::get_app_lock_status,
            commands::app_lock::update_app_lock_settings,
            commands::app_lock::lock_app,
            commands::app_lock::unlock_app,
            commands::app_lock::record_app_activity,
            commands::app_lock::lock_app_if_idle,
            commands::profiles::list_ssh_profiles,
            commands::profiles::create_ssh_profile,
            commands::profiles::clone_ssh_profile,
            commands::profiles::update_ssh_profile,
            commands::profiles::delete_ssh_profile,
            commands::profiles::rename_ssh_tag,
            commands::profiles::rename_connection_folder,
            commands::profiles::set_ssh_profile_favorite,
            commands::profiles::list_ssh_credentials,
            commands::profiles::save_ssh_credential,
            commands::profiles::delete_ssh_credential,
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
            commands::sessions::read_ssh_session_output,
            commands::sessions::subscribe_terminal_output,
            commands::sessions::acknowledge_terminal_output,
            commands::sessions::unsubscribe_terminal_output,
            commands::sessions::start_local_session,
            commands::sessions::start_ssh_session,
            commands::sessions::write_ssh_session,
            commands::sessions::prepare_shell_integration,
            commands::sessions::enable_shell_integration,
            commands::sessions::respond_zmodem_prompt,
            commands::sessions::respond_zmodem_conflict,
            commands::sessions::cancel_zmodem_transfer,
            commands::sessions::resize_ssh_session,
            commands::sessions::close_ssh_session,
            commands::sessions::reconnect_ssh_session,
            commands::sessions::cancel_reconnect,
            commands::sessions::respond_host_key_prompt,
            commands::sessions::respond_ssh_auth_prompt,
            commands::workspace::list_detached_workspaces,
            commands::workspace::get_detached_workspace,
            commands::workspace::take_terminal_command_outputs,
            commands::workspace::open_detached_terminal_workspace,
            commands::workspace::open_detached_sftp_workspace,
            commands::workspace::update_detached_terminal_workspace,
            commands::workspace::discard_detached_workspace,
            commands::workspace::update_detached_workbench,
            commands::sftp::sftp_home,
            commands::sftp::sftp_list,
            commands::sftp::sftp_local_home,
            commands::sftp::sftp_local_roots,
            commands::sftp::sftp_local_list,
            commands::sftp::sftp_local_read_text,
            commands::sftp::sftp_local_write_text,
            commands::sftp::sftp_local_read_image,
            commands::sftp::sftp_local_create_dir,
            commands::sftp::sftp_local_create_file,
            commands::sftp::sftp_local_rename,
            commands::sftp::sftp_local_delete,
            commands::sftp::sftp_read_text,
            commands::sftp::sftp_write_text,
            commands::sftp::sftp_read_image,
            commands::sftp::sftp_download,
            commands::sftp::sftp_download_dir,
            commands::sftp::sftp_download_tree,
            commands::sftp::sftp_upload,
            commands::sftp::sftp_upload_dir,
            commands::sftp::sftp_copy_remote,
            commands::sftp::sftp_create_dir,
            commands::sftp::sftp_create_file,
            commands::sftp::sftp_rename,
            commands::sftp::sftp_delete_file,
            commands::sftp::sftp_delete_empty_dir,
            commands::sftp::sftp_file_info,
            commands::sftp::sftp_set_permissions,
            commands::sftp::sftp_move_entries,
            commands::sftp::sftp_delete_preview,
            commands::sftp::sftp_delete_recursive,
            commands::sftp::sftp_cancel_operation,
            commands::sftp::sftp_disconnect,
            commands::forwarding::start_port_forward,
            commands::forwarding::stop_port_forward,
            commands::forwarding::list_port_forwards,
            commands::hosttools::host_tools_snapshot,
            commands::ai::ai_list_models,
            commands::ai::ai_test_connection,
            commands::ai::ai_load_providers,
            commands::ai::ai_save_provider,
            commands::ai::ai_delete_provider,
            commands::ai::ai_send_message,
            commands::ai::ai_background_sessions,
            commands::ai::ai_take_over_session,
            commands::ai::ai_close_background_session,
            commands::ai::ai_approve_tool,
            commands::ai::ai_answer_question,
            commands::ai::ai_cancel_run,
            commands::ai::ai_list_conversations,
            commands::ai::ai_create_conversation,
            commands::ai::ai_save_conversation,
            commands::ai::ai_generate_conversation_title,
            commands::ai::ai_reset_conversation,
        ]))
        .build(application_context())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, code, .. }
                if code != Some(tauri::RESTART_EXIT_CODE)
                    && !app.state::<application_exit::ApplicationExit>().allowed() =>
            {
                api.prevent_exit();
                application_exit::ApplicationExit::request(app, code.unwrap_or(0));
            }
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Focused(true),
                ..
            } => {
                let _ = app
                    .state::<native_editor_menu::NativeEditorMenus>()
                    .focus(app, &label);
            }
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } => {
                app.state::<network_scan::ScanManager>().close_owner(&label);
                app.state::<native_editor_menu::NativeEditorMenus>()
                    .remove(&label);
                app.state::<app::AppState>()
                    .sessions
                    .remove_output_window(&label);
                app.state::<app::AppState>().rdp.close_owner(Some(&label));
                app.state::<app::AppState>().jumpserver.cancel_owner(&label);
                let _ = app.state::<app::AppState>().editor.close_owner(&label);
                let state = app.state::<app::AppState>().inner().clone();
                state.ai.cancel_owner(&label);
                tauri::async_runtime::spawn(async move {
                    if let Ok(conversations) = state.profiles.list_ai_conversations(&label) {
                        for conversation in conversations {
                            let _ = state.sessions.close_conversation(&conversation.id).await;
                        }
                    }
                });
            }
            tauri::RunEvent::Exit => app.state::<app::AppState>().rdp.close_owner(None),
            _ => {}
        });
}

/// Shared by the desktop entry point and the native browser regression harness.
pub fn application_context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}
