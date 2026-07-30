mod admin;
mod cloudflare;
mod diagnostics;
mod network;
mod runtime;
mod security;
mod state;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            security::initialize(app.handle()).map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            admin::inspect_admin_deployment,
            admin::open_admin_endpoint,
            admin::prepare_route_subscription,
            admin::prepare_route_subscription_node,
            admin::probe_route_for_optimization,
            admin::refresh_admin_deployment,
            cloudflare::authorize_cloudflare,
            cloudflare::cancel_cloudflare_oauth,
            cloudflare::cloudflare_oauth_configuration,
            cloudflare::complete_cloudflare_oauth,
            cloudflare::create_cloudflare_deployment_plan,
            cloudflare::deploy_cloudflare_connection,
            cloudflare::start_cloudflare_oauth,
            diagnostics::probe_endpoints,
            diagnostics::validate_admin_endpoint,
            runtime::get_runtime_info,
            security::credential_vault_status,
            security::delete_secret,
            security::secret_exists,
            security::store_shared_secret,
            security::store_secret,
            state::load_workspace_state,
            state::save_workspace_state,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Glide");
}
