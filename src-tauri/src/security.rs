use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
};

use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use zeroize::{Zeroize, Zeroizing};

const ENCRYPTION_AAD: &[u8] = b"com.glide.desktop:credential-vault:v1";
const ENVELOPE_MAGIC: &[u8; 8] = b"GLIDEV1\0";
const EPHEMERAL_REFERENCE_PREFIX: &str = "cloudflare-auth:";
const KEY_BYTES: usize = 32;
const MAXIMUM_ENCRYPTED_BYTES: usize = 135_168;
const MAXIMUM_SECRET_BYTES: usize = 1_024;
const MAXIMUM_VAULT_BYTES: usize = 131_072;
const NONCE_BYTES: usize = 12;
const VAULT_VERSION: u8 = 1;

static EPHEMERAL_VAULT: OnceLock<Mutex<SecretVault>> = OnceLock::new();
static VAULT_PATHS: OnceLock<VaultPaths> = OnceLock::new();

#[derive(Deserialize, Serialize)]
struct SecretVault {
    entries: BTreeMap<String, String>,
    version: u8,
}

impl SecretVault {
    fn empty() -> Self {
        Self {
            entries: BTreeMap::new(),
            version: VAULT_VERSION,
        }
    }
}

impl Drop for SecretVault {
    fn drop(&mut self) {
        for secret in self.entries.values_mut() {
            secret.zeroize();
        }
    }
}

#[derive(Clone)]
struct VaultPaths {
    database: PathBuf,
    directory: PathBuf,
    key: PathBuf,
}

impl VaultPaths {
    fn new(directory: PathBuf) -> Self {
        Self {
            database: directory.join("credentials.db"),
            key: directory.join("master-key.v1"),
            directory,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum VaultSource {
    Backup,
    Empty,
    Primary,
}

struct LoadedVault {
    source: VaultSource,
    vault: SecretVault,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialVaultStatus {
    missing_reference_count: usize,
    ready: bool,
}

pub(crate) fn initialize(app: &AppHandle) -> Result<(), String> {
    let app_data_directory = app
        .path()
        .app_data_dir()
        .map_err(|_| "无法定位应用数据目录。".to_string())?;
    let paths = VaultPaths::new(app_data_directory.join("credentials"));
    initialize_paths(&paths)?;
    match VAULT_PATHS.set(paths.clone()) {
        Ok(()) => Ok(()),
        Err(_) if vault_paths()?.directory == paths.directory => Ok(()),
        Err(_) => Err("本地凭据目录已经由另一位置初始化。".into()),
    }
}

#[tauri::command]
pub fn credential_vault_status(references: Vec<String>) -> Result<CredentialVaultStatus, String> {
    validate_references(&references)?;
    let persistent_vault = if references
        .iter()
        .any(|reference| !is_ephemeral_reference(reference))
    {
        Some(read_persistent_vault(vault_paths()?)?)
    } else {
        None
    };
    let ephemeral_vault = lock_ephemeral_vault()?;
    let missing_reference_count = references
        .iter()
        .filter(|reference| {
            if is_ephemeral_reference(reference) {
                !ephemeral_vault.entries.contains_key(*reference)
            } else {
                !persistent_vault
                    .as_ref()
                    .is_some_and(|vault| vault.entries.contains_key(*reference))
            }
        })
        .count();
    Ok(CredentialVaultStatus {
        missing_reference_count,
        ready: missing_reference_count == 0,
    })
}

#[tauri::command]
pub fn delete_secret(reference: String) -> Result<(), String> {
    validate_reference(&reference)?;
    if is_ephemeral_reference(&reference) {
        lock_ephemeral_vault()?.entries.remove(&reference);
        return Ok(());
    }
    update_persistent_vault(vault_paths()?, |vault| {
        vault.entries.remove(&reference);
    })
}

#[tauri::command]
pub fn secret_exists(reference: String) -> Result<bool, String> {
    validate_reference(&reference)?;
    if is_ephemeral_reference(&reference) {
        return Ok(lock_ephemeral_vault()?.entries.contains_key(&reference));
    }
    Ok(read_persistent_vault(vault_paths()?)?
        .entries
        .contains_key(&reference))
}

pub(crate) fn read_secret(reference: &str) -> Result<String, String> {
    validate_reference(reference)?;
    let secret = if is_ephemeral_reference(reference) {
        lock_ephemeral_vault()?.entries.get(reference).cloned()
    } else {
        read_persistent_vault(vault_paths()?)?
            .entries
            .get(reference)
            .cloned()
    };
    secret.ok_or_else(|| "本地凭据目录尚未保存这条连接的管理密码，请完成一次性设置。".into())
}

#[tauri::command]
pub fn store_secret(reference: String, secret: String) -> Result<(), String> {
    store_secret_entries([reference], secret)
}

#[tauri::command]
pub fn store_shared_secret(references: Vec<String>, secret: String) -> Result<(), String> {
    if references.is_empty() || references.len() > 64 {
        return Err("需要保存的连接数量无效。".into());
    }
    store_secret_entries(references, secret)
}

fn store_secret_entries(
    references: impl IntoIterator<Item = String>,
    mut secret: String,
) -> Result<(), String> {
    validate_secret(&secret)?;
    let references = references.into_iter().collect::<Vec<_>>();
    validate_references(&references)?;
    let ephemeral = references
        .first()
        .is_some_and(|reference| is_ephemeral_reference(reference));
    if references
        .iter()
        .any(|reference| is_ephemeral_reference(reference) != ephemeral)
    {
        secret.zeroize();
        return Err("不能在一次操作中混合临时 Token 与长期管理密码。".into());
    }

    let result = if ephemeral {
        let mut vault = lock_ephemeral_vault()?;
        for reference in references {
            vault.entries.insert(reference, secret.clone());
        }
        Ok(())
    } else {
        update_persistent_vault(vault_paths()?, |vault| {
            for reference in references {
                vault.entries.insert(reference, secret.clone());
            }
        })
    };
    secret.zeroize();
    result
}

fn initialize_paths(paths: &VaultPaths) -> Result<(), String> {
    fs::create_dir_all(&paths.directory).map_err(|_| "无法创建本地凭据目录。".to_string())?;
    validate_private_directory(&paths.directory)?;
    restrict_directory_permissions(&paths.directory)?;
    let key = read_or_create_key(paths)?;
    let mut connection = open_vault_database(paths)?;
    let loaded = read_vault_from_connection(&connection, &key)?;
    if loaded.source == VaultSource::Empty {
        persist_loaded_vault(&mut connection, &key, loaded)?;
    }
    Ok(())
}

fn update_persistent_vault(
    paths: &VaultPaths,
    operation: impl FnOnce(&mut SecretVault),
) -> Result<(), String> {
    let key = read_or_create_key(paths)?;
    let mut connection = open_vault_database(paths)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(safe_database_error)?;
    let mut loaded = read_vault_from_connection(&transaction, &key)?;
    operation(&mut loaded.vault);
    validate_vault(&loaded.vault)?;
    let encrypted = encrypt_vault(&loaded.vault, &key)?;

    if loaded.source != VaultSource::Backup {
        transaction
            .execute("DELETE FROM credential_vault_backup WHERE id = 1", [])
            .map_err(safe_database_error)?;
        transaction
            .execute(
                "INSERT INTO credential_vault_backup (id, payload, updated_at)
                 SELECT id, payload, updated_at FROM credential_vault WHERE id = 1",
                [],
            )
            .map_err(safe_database_error)?;
    }
    transaction
        .execute(
            "INSERT INTO credential_vault (id, payload, updated_at)
             VALUES (1, ?1, unixepoch())
             ON CONFLICT(id) DO UPDATE
             SET payload = excluded.payload, updated_at = excluded.updated_at",
            params![encrypted],
        )
        .map_err(safe_database_error)?;
    transaction.commit().map_err(safe_database_error)?;
    Ok(())
}

fn persist_loaded_vault(
    connection: &mut Connection,
    key: &[u8],
    loaded: LoadedVault,
) -> Result<(), String> {
    let encrypted = encrypt_vault(&loaded.vault, key)?;
    connection
        .execute(
            "INSERT INTO credential_vault (id, payload, updated_at)
             VALUES (1, ?1, unixepoch())
             ON CONFLICT(id) DO UPDATE
             SET payload = excluded.payload, updated_at = excluded.updated_at",
            params![encrypted],
        )
        .map_err(safe_database_error)?;
    Ok(())
}

fn read_persistent_vault(paths: &VaultPaths) -> Result<SecretVault, String> {
    let key = read_or_create_key(paths)?;
    let connection = open_vault_database(paths)?;
    let loaded = read_vault_from_connection(&connection, &key)?;
    Ok(loaded.vault)
}

fn read_vault_from_connection(connection: &Connection, key: &[u8]) -> Result<LoadedVault, String> {
    let primary = read_encrypted_row(connection, "credential_vault")?;
    if let Some(payload) = primary.as_ref() {
        if let Ok(vault) = decrypt_vault(payload, key) {
            return Ok(LoadedVault {
                source: VaultSource::Primary,
                vault,
            });
        }
    }

    let backup = read_encrypted_row(connection, "credential_vault_backup")?;
    if let Some(payload) = backup.as_ref() {
        if let Ok(vault) = decrypt_vault(payload, key) {
            return Ok(LoadedVault {
                source: VaultSource::Backup,
                vault,
            });
        }
    }

    if primary.is_none() && backup.is_none() {
        Ok(LoadedVault {
            source: VaultSource::Empty,
            vault: SecretVault::empty(),
        })
    } else {
        Err("本地凭据文件完整性校验失败；请重新保存管理密码。".into())
    }
}

fn read_encrypted_row(connection: &Connection, table: &str) -> Result<Option<Vec<u8>>, String> {
    let query = match table {
        "credential_vault" => "SELECT payload FROM credential_vault WHERE id = 1",
        "credential_vault_backup" => "SELECT payload FROM credential_vault_backup WHERE id = 1",
        _ => return Err("本地凭据表无效。".into()),
    };
    let payload = connection
        .query_row(query, [], |row| row.get::<_, Vec<u8>>(0))
        .optional()
        .map_err(safe_database_error)?;
    if payload
        .as_ref()
        .is_some_and(|bytes| bytes.len() > MAXIMUM_ENCRYPTED_BYTES)
    {
        return Err("本地凭据文件超过安全大小限制。".into());
    }
    Ok(payload)
}

fn encrypt_vault(vault: &SecretVault, key: &[u8]) -> Result<Vec<u8>, String> {
    validate_vault(vault)?;
    let mut plaintext =
        serde_json::to_vec(vault).map_err(|_| "无法序列化本地凭据。".to_string())?;
    if plaintext.len() > MAXIMUM_VAULT_BYTES {
        plaintext.zeroize();
        return Err("本地凭据目录已满，请移除不用的连接后重试。".into());
    }
    let mut nonce_bytes = [0_u8; NONCE_BYTES];
    getrandom::fill(&mut nonce_bytes).map_err(|_| "无法生成凭据加密随机数。".to_string())?;
    let key = LessSafeKey::new(
        UnboundKey::new(&AES_256_GCM, key).map_err(|_| "本地凭据加密密钥无效。".to_string())?,
    );
    key.seal_in_place_append_tag(
        Nonce::assume_unique_for_key(nonce_bytes),
        Aad::from(ENCRYPTION_AAD),
        &mut plaintext,
    )
    .map_err(|_| "无法加密本地凭据。".to_string())?;

    let mut envelope = Vec::with_capacity(ENVELOPE_MAGIC.len() + NONCE_BYTES + plaintext.len());
    envelope.extend_from_slice(ENVELOPE_MAGIC);
    envelope.extend_from_slice(&nonce_bytes);
    envelope.extend_from_slice(&plaintext);
    plaintext.zeroize();
    Ok(envelope)
}

fn decrypt_vault(envelope: &[u8], key: &[u8]) -> Result<SecretVault, String> {
    if envelope.len() <= ENVELOPE_MAGIC.len() + NONCE_BYTES
        || envelope.len() > MAXIMUM_ENCRYPTED_BYTES
        || !envelope.starts_with(ENVELOPE_MAGIC)
    {
        return Err("本地凭据文件格式无效。".into());
    }
    let nonce_start = ENVELOPE_MAGIC.len();
    let nonce_end = nonce_start + NONCE_BYTES;
    let nonce_bytes: [u8; NONCE_BYTES] = envelope[nonce_start..nonce_end]
        .try_into()
        .map_err(|_| "本地凭据随机数格式无效。".to_string())?;
    let mut ciphertext = envelope[nonce_end..].to_vec();
    let key = LessSafeKey::new(
        UnboundKey::new(&AES_256_GCM, key).map_err(|_| "本地凭据解密密钥无效。".to_string())?,
    );
    let result = key
        .open_in_place(
            Nonce::assume_unique_for_key(nonce_bytes),
            Aad::from(ENCRYPTION_AAD),
            &mut ciphertext,
        )
        .map_err(|_| "本地凭据完整性校验失败。".to_string())
        .and_then(|plaintext| {
            serde_json::from_slice::<SecretVault>(plaintext)
                .map_err(|_| "本地凭据内容无效。".to_string())
        })
        .and_then(validate_vault_owned);
    ciphertext.zeroize();
    result
}

fn open_vault_database(paths: &VaultPaths) -> Result<Connection, String> {
    match fs::symlink_metadata(&paths.database) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err("本地凭据数据库不是安全的普通文件。".into());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("无法检查本地凭据数据库。".into()),
    }
    let connection = Connection::open(&paths.database).map_err(safe_database_error)?;
    restrict_file_permissions(&paths.database)?;
    connection
        .execute_batch(
            "PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;
             PRAGMA journal_mode = DELETE;
             PRAGMA secure_delete = ON;
             PRAGMA temp_store = MEMORY;
             PRAGMA trusted_schema = OFF;
             CREATE TABLE IF NOT EXISTS credential_vault (
                 id INTEGER PRIMARY KEY CHECK (id = 1),
                 payload BLOB NOT NULL,
                 updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS credential_vault_backup (
                 id INTEGER PRIMARY KEY CHECK (id = 1),
                 payload BLOB NOT NULL,
                 updated_at INTEGER NOT NULL
             );",
        )
        .map_err(safe_database_error)?;
    Ok(connection)
}

fn read_or_create_key(paths: &VaultPaths) -> Result<Zeroizing<Vec<u8>>, String> {
    if paths.key.exists() {
        return read_key(&paths.key);
    }

    let mut key = vec![0_u8; KEY_BYTES];
    getrandom::fill(&mut key).map_err(|_| "无法生成本地凭据加密密钥。".to_string())?;
    match create_private_file(&paths.key) {
        Ok(mut file) => {
            if let Err(error) = file
                .write_all(&key)
                .and_then(|()| file.sync_all())
                .map_err(|_| "无法写入本地凭据加密密钥。".to_string())
            {
                let _ = fs::remove_file(&paths.key);
                key.zeroize();
                return Err(error);
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            key.zeroize();
            return read_key(&paths.key);
        }
        Err(_) => {
            key.zeroize();
            return Err("无法创建本地凭据加密密钥。".into());
        }
    }
    restrict_file_permissions(&paths.key)?;
    Ok(Zeroizing::new(key))
}

fn read_key(path: &Path) -> Result<Zeroizing<Vec<u8>>, String> {
    validate_private_regular_file(path)?;
    let mut key = fs::read(path).map_err(|_| "无法读取本地凭据加密密钥。".to_string())?;
    if key.len() == KEY_BYTES {
        Ok(Zeroizing::new(key))
    } else {
        key.zeroize();
        Err("本地凭据加密密钥格式无效。".into())
    }
}

fn create_private_file(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn ephemeral_vault() -> &'static Mutex<SecretVault> {
    EPHEMERAL_VAULT.get_or_init(|| Mutex::new(SecretVault::empty()))
}

fn lock_ephemeral_vault() -> Result<MutexGuard<'static, SecretVault>, String> {
    ephemeral_vault()
        .lock()
        .map_err(|_| "临时授权内存暂时不可用，请重新启动 Glide。".into())
}

fn vault_paths() -> Result<&'static VaultPaths, String> {
    VAULT_PATHS
        .get()
        .ok_or_else(|| "本地凭据目录尚未初始化。".into())
}

fn is_ephemeral_reference(reference: &str) -> bool {
    reference.starts_with(EPHEMERAL_REFERENCE_PREFIX)
}

fn safe_database_error(_: rusqlite::Error) -> String {
    "本地凭据数据库操作失败；秘密内容未写入日志。".into()
}

fn validate_reference(reference: &str) -> Result<(), String> {
    let valid = !reference.is_empty()
        && reference.len() <= 128
        && reference
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_:".contains(character));
    if valid {
        Ok(())
    } else {
        Err("凭据引用格式无效。".into())
    }
}

fn validate_references(references: &[String]) -> Result<(), String> {
    references
        .iter()
        .try_for_each(|reference| validate_reference(reference))
}

fn validate_secret(secret: &str) -> Result<(), String> {
    if secret.is_empty() || secret.len() > MAXIMUM_SECRET_BYTES {
        Err("秘密内容为空或超过安全长度限制。".into())
    } else {
        Ok(())
    }
}

fn validate_vault(vault: &SecretVault) -> Result<(), String> {
    if vault.version != VAULT_VERSION
        || vault.entries.len() > 64
        || vault.entries.iter().any(|(reference, secret)| {
            validate_reference(reference).is_err() || validate_secret(secret).is_err()
        })
    {
        Err("本地凭据格式无效，请重新保存管理密码。".into())
    } else {
        Ok(())
    }
}

fn validate_vault_owned(vault: SecretVault) -> Result<SecretVault, String> {
    validate_vault(&vault)?;
    Ok(vault)
}

fn validate_private_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "无法检查本地凭据目录。".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        Err("本地凭据目录不是安全的普通目录。".into())
    } else {
        Ok(())
    }
}

fn validate_private_regular_file(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "无法检查本地凭据文件。".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        Err("本地凭据文件不是安全的普通文件。".into())
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn restrict_directory_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| "无法收紧本地凭据目录权限。".to_string())
}

#[cfg(not(unix))]
fn restrict_directory_permissions(_: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(unix)]
fn restrict_file_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|_| "无法收紧本地凭据文件权限。".to_string())
}

#[cfg(not(unix))]
fn restrict_file_permissions(_: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests;
