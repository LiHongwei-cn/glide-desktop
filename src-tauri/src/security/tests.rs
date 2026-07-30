use std::{fs, sync::Arc, thread};

use rusqlite::{params, Connection};

use super::{
    delete_secret, initialize_paths, is_ephemeral_reference, read_persistent_vault, read_secret,
    store_secret_entries, update_persistent_vault, validate_reference, validate_secret,
    validate_vault, SecretVault, VaultPaths, MAXIMUM_VAULT_BYTES,
};

struct TemporaryVault {
    paths: VaultPaths,
}

impl TemporaryVault {
    fn new(label: &str) -> Self {
        let mut random = [0_u8; 8];
        getrandom::fill(&mut random).expect("test randomness should work");
        let suffix = random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let directory = std::env::temp_dir().join(format!(
            "glide-vault-{label}-{}-{suffix}",
            std::process::id()
        ));
        let paths = VaultPaths::new(directory);
        initialize_paths(&paths).expect("test vault should initialize");
        Self { paths }
    }
}

impl Drop for TemporaryVault {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.paths.directory);
    }
}

#[test]
fn accepts_scoped_uuid_reference() {
    assert!(validate_reference("legacy-admin:34b12d11-3535-461b-95c0-bcafe18a4a5f").is_ok());
}

#[test]
fn rejects_path_like_reference() {
    assert!(validate_reference("../../secret").is_err());
}

#[test]
fn rejects_oversized_secret() {
    assert!(validate_secret(&"x".repeat(1_025)).is_err());
}

#[test]
fn accepts_small_versioned_vault() {
    let mut vault = SecretVault::empty();
    vault
        .entries
        .insert("legacy-admin:1".into(), "private".into());
    let payload = serde_json::to_vec(&vault).unwrap();

    assert!(payload.len() < MAXIMUM_VAULT_BYTES);
    assert!(validate_vault(&vault).is_ok());
}

#[test]
fn stores_secrets_encrypted_and_reads_them_after_reopening() {
    let vault = TemporaryVault::new("restart");
    update_persistent_vault(&vault.paths, |stored| {
        stored
            .entries
            .insert("legacy-admin:route-1".into(), "private-password".into());
    })
    .expect("secret should persist");

    let database_bytes = fs::read(&vault.paths.database).expect("database should be readable");
    assert!(!database_bytes
        .windows("private-password".len())
        .any(|window| window == b"private-password"));
    let reopened = read_persistent_vault(&vault.paths).expect("vault should reopen");
    assert_eq!(
        reopened.entries.get("legacy-admin:route-1"),
        Some(&"private-password".to_string())
    );
}

#[test]
fn recovers_the_previous_encrypted_snapshot_after_tampering() {
    let vault = TemporaryVault::new("backup");
    update_persistent_vault(&vault.paths, |stored| {
        stored
            .entries
            .insert("legacy-admin:route-1".into(), "first-password".into());
    })
    .expect("first snapshot should persist");
    update_persistent_vault(&vault.paths, |stored| {
        stored
            .entries
            .insert("legacy-admin:route-1".into(), "second-password".into());
    })
    .expect("second snapshot should persist");

    let connection = Connection::open(&vault.paths.database).expect("database should open");
    connection
        .execute(
            "UPDATE credential_vault SET payload = ?1 WHERE id = 1",
            params![vec![0_u8; 64]],
        )
        .expect("primary payload should be corrupted for the test");
    let recovered = read_persistent_vault(&vault.paths).expect("backup should recover");
    assert_eq!(
        recovered.entries.get("legacy-admin:route-1"),
        Some(&"first-password".to_string())
    );
}

#[test]
fn serializes_concurrent_writers_without_losing_entries() {
    let vault = TemporaryVault::new("concurrent");
    let paths = Arc::new(vault.paths.clone());
    let writers = (0..8)
        .map(|index| {
            let paths = Arc::clone(&paths);
            thread::spawn(move || {
                update_persistent_vault(&paths, |stored| {
                    stored.entries.insert(
                        format!("legacy-admin:route-{index}"),
                        format!("password-{index}"),
                    );
                })
            })
        })
        .collect::<Vec<_>>();

    for writer in writers {
        writer
            .join()
            .expect("writer thread should finish")
            .expect("writer should persist");
    }
    let stored = read_persistent_vault(&paths).expect("vault should reopen");
    assert_eq!(stored.entries.len(), 8);
}

#[test]
fn keeps_cloudflare_authorization_in_memory_only() {
    let reference = "cloudflare-auth:test-memory-only";
    assert!(is_ephemeral_reference(reference));
    assert!(!is_ephemeral_reference("legacy-admin:route-1"));
    store_secret_entries([reference.to_string()], "temporary-token-value".into())
        .expect("temporary token should stay in memory");
    assert_eq!(
        read_secret(reference).expect("temporary token should be readable"),
        "temporary-token-value"
    );
    delete_secret(reference.into()).expect("temporary token should be deleted");
    assert!(read_secret(reference).is_err());
}

#[cfg(unix)]
#[test]
fn restricts_vault_directory_and_files_to_the_current_user() {
    use std::os::unix::fs::PermissionsExt;

    let vault = TemporaryVault::new("permissions");
    let directory_mode = fs::metadata(&vault.paths.directory)
        .expect("directory metadata")
        .permissions()
        .mode()
        & 0o777;
    let database_mode = fs::metadata(&vault.paths.database)
        .expect("database metadata")
        .permissions()
        .mode()
        & 0o777;
    let key_mode = fs::metadata(&vault.paths.key)
        .expect("key metadata")
        .permissions()
        .mode()
        & 0o777;

    assert_eq!(directory_mode, 0o700);
    assert_eq!(database_mode, 0o600);
    assert_eq!(key_mode, 0o600);
}

#[cfg(unix)]
#[test]
fn rejects_a_symlinked_credential_database() {
    use std::os::unix::fs::symlink;

    let vault = TemporaryVault::new("symlink");
    let replacement = vault.paths.directory.join("replacement.db");
    fs::write(&replacement, b"not a credential database").expect("replacement should be created");
    fs::remove_file(&vault.paths.database).expect("test database should be removed");
    symlink(&replacement, &vault.paths.database).expect("test symlink should be created");

    let error = match read_persistent_vault(&vault.paths) {
        Ok(_) => panic!("symlinked credential database must be rejected"),
        Err(error) => error,
    };
    assert!(error.contains("不是安全的普通文件"));
}

#[test]
fn test_paths_stay_inside_the_temporary_directory() {
    let vault = TemporaryVault::new("paths");
    let temp_directory = std::env::temp_dir();
    assert!(vault.paths.directory.starts_with(temp_directory));
}
