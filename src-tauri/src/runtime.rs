use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    app_version: &'static str,
    architecture: &'static str,
    desktop: bool,
    operating_system: &'static str,
}

#[tauri::command]
pub fn get_runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        app_version: env!("CARGO_PKG_VERSION"),
        architecture: std::env::consts::ARCH,
        desktop: true,
        operating_system: std::env::consts::OS,
    }
}
