const KEYRING_SERVICE: &str = "com.glide.desktop";

#[tauri::command]
pub fn delete_secret(reference: String) -> Result<(), String> {
    validate_reference(&reference)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &reference).map_err(safe_keyring_error)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(safe_keyring_error(error)),
    }
}

#[tauri::command]
pub fn secret_exists(reference: String) -> Result<bool, String> {
    validate_reference(&reference)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, &reference).map_err(safe_keyring_error)?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(error) => Err(safe_keyring_error(error)),
    }
}

pub(crate) fn read_secret(reference: &str) -> Result<String, String> {
    validate_reference(reference)?;
    let entry = keyring::Entry::new(KEYRING_SERVICE, reference).map_err(safe_keyring_error)?;
    entry.get_password().map_err(|error| match error {
        keyring::Error::NoEntry => "系统钥匙串中没有这条线路的管理密码，请重新导入。".into(),
        other => safe_keyring_error(other),
    })
}

#[tauri::command]
pub fn store_secret(reference: String, secret: String) -> Result<(), String> {
    validate_reference(&reference)?;
    if secret.is_empty() || secret.len() > 16_384 {
        return Err("秘密内容为空或超过安全长度限制。".into());
    }
    let entry = keyring::Entry::new(KEYRING_SERVICE, &reference).map_err(safe_keyring_error)?;
    entry.set_password(&secret).map_err(safe_keyring_error)
}

fn safe_keyring_error(_: keyring::Error) -> String {
    "系统钥匙串操作失败；秘密内容未写入日志。".into()
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

#[cfg(test)]
mod tests {
    use super::validate_reference;

    #[test]
    fn accepts_scoped_uuid_reference() {
        assert!(validate_reference("legacy-admin:34b12d11-3535-461b-95c0-bcafe18a4a5f").is_ok());
    }

    #[test]
    fn rejects_path_like_reference() {
        assert!(validate_reference("../../secret").is_err());
    }
}
