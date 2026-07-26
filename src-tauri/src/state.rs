use std::{fs, path::PathBuf};

use rusqlite::{params, Connection};
use serde_json::Value;
use tauri::{AppHandle, Manager};

const MAX_STATE_BYTES: usize = 1_048_576;
const DISALLOWED_STATE_KEYS: [&str; 6] = [
    "apikey",
    "authtoken",
    "globalapikey",
    "password",
    "secretvalue",
    "subscriptionurl",
];

#[tauri::command]
pub fn load_workspace_state(app: AppHandle) -> Result<Option<String>, String> {
    let connection = open_database(&app)?;
    let mut statement = connection
        .prepare("SELECT payload FROM app_state WHERE id = 1")
        .map_err(safe_database_error)?;
    let result = statement.query_row([], |row| row.get::<_, String>(0));

    match result {
        Ok(payload) => Ok(Some(payload)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(safe_database_error(error)),
    }
}

#[tauri::command]
pub fn save_workspace_state(app: AppHandle, payload: String) -> Result<(), String> {
    if payload.len() > MAX_STATE_BYTES {
        return Err("工作区状态超过 1 MiB 限制。".into());
    }
    let state: Value =
        serde_json::from_str(&payload).map_err(|_| "工作区状态不是有效 JSON。".to_string())?;
    if contains_disallowed_state_key(&state) {
        return Err("工作区状态包含禁止持久化的秘密字段。".into());
    }

    let mut connection = open_database(&app)?;
    let transaction = connection.transaction().map_err(safe_database_error)?;
    transaction
        .execute(
            "INSERT INTO app_state (id, payload, updated_at)
             VALUES (1, ?1, unixepoch())
             ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = unixepoch()",
            params![payload],
        )
        .map_err(safe_database_error)?;
    transaction.commit().map_err(safe_database_error)
}

fn database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法定位应用数据目录。".to_string())?;
    fs::create_dir_all(&app_data_directory).map_err(|_| "无法创建应用数据目录。".to_string())?;
    restrict_directory_permissions(&app_data_directory)?;
    Ok(app_data_directory.join("glide.db"))
}

fn open_database(app: &AppHandle) -> Result<Connection, String> {
    let path = database_path(app)?;
    let connection = Connection::open(&path).map_err(safe_database_error)?;
    restrict_file_permissions(&path)?;
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA secure_delete = ON;
             PRAGMA temp_store = MEMORY;
             PRAGMA trusted_schema = OFF;
             PRAGMA busy_timeout = 5000;
             CREATE TABLE IF NOT EXISTS app_state (
                 id INTEGER PRIMARY KEY CHECK (id = 1),
                 payload TEXT NOT NULL,
                 updated_at INTEGER NOT NULL
             );",
        )
        .map_err(safe_database_error)?;
    Ok(connection)
}

fn safe_database_error(_: rusqlite::Error) -> String {
    "本地数据库操作失败；秘密内容未写入数据库。".into()
}

fn contains_disallowed_state_key(value: &Value) -> bool {
    match value {
        Value::Array(items) => items.iter().any(contains_disallowed_state_key),
        Value::Object(fields) => fields.iter().any(|(key, nested_value)| {
            let normalized_key = key
                .chars()
                .filter(|character| character.is_ascii_alphanumeric())
                .collect::<String>()
                .to_ascii_lowercase();
            DISALLOWED_STATE_KEYS.contains(&normalized_key.as_str())
                || contains_disallowed_state_key(nested_value)
        }),
        _ => false,
    }
}

#[cfg(unix)]
fn restrict_directory_permissions(path: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| "无法收紧应用数据目录权限。".to_string())
}

#[cfg(not(unix))]
fn restrict_directory_permissions(_: &std::path::Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn restrict_file_permissions(path: &std::path::Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|_| "无法收紧本地数据库权限。".to_string())
}

#[cfg(not(unix))]
fn restrict_file_permissions(_: &std::path::Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::contains_disallowed_state_key;

    #[test]
    fn accepts_secret_references_without_secret_values() {
        let state = json!({
            "credentialReference": "device-subscription:123",
            "displayName": "我的电脑"
        });

        assert!(!contains_disallowed_state_key(&state));
    }

    #[test]
    fn rejects_nested_secret_fields() {
        let state = json!({
            "device": {
                "subscriptionUrl": "https://example.com/private"
            }
        });

        assert!(contains_disallowed_state_key(&state));
    }
}
