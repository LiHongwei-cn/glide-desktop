mod admin;
mod diagnostics;
mod network;
mod runtime;
mod security;
mod state;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            admin::inspect_admin_deployment,
            admin::open_admin_endpoint,
            admin::refresh_admin_deployment,
            diagnostics::probe_endpoints,
            diagnostics::validate_admin_endpoint,
            runtime::get_runtime_info,
            security::delete_secret,
            security::secret_exists,
            security::store_secret,
            state::load_workspace_state,
            state::save_workspace_state,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Glide");
}
