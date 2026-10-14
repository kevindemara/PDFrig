use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::PathBuf,
    ptr,
    sync::Mutex,
};

use tauri::{AppHandle, Manager};
use uuid::Uuid;
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    },
};
use zeroize::Zeroizing;

const ENTITLEMENT_FILE_HEADER: &[u8] = b"PDFMASON-ENTITLEMENT-DPAPI-1\0";
const ENTITLEMENT_OPTIONAL_ENTROPY: &[u8] = b"PDFMason desktop entitlement v1";
const MAXIMUM_ENTITLEMENT_BYTES: usize = 32 * 1024;
const MAXIMUM_SESSION_BYTES: usize = 128 * 1024;
const SESSION_FILE_HEADER: &[u8] = b"PDFMASON-SESSION-DPAPI-1\0";
const SESSION_OPTIONAL_ENTROPY: &[u8] = b"PDFMason desktop session v1";

#[derive(Default)]
pub struct SecureSessionState {
    operation: Mutex<()>,
}

fn error(code: &'static str) -> String {
    code.to_owned()
}

fn session_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| error("NATIVE_SESSION_STORAGE_UNAVAILABLE"))?
        .join("secure-session.bin"))
}

fn entitlement_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| error("NATIVE_ENTITLEMENT_STORAGE_UNAVAILABLE"))?
        .join("secure-entitlement.bin"))
}

fn validate_session_payload(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if value.len() < 2
        || value.len() > MAXIMUM_SESSION_BYTES
        || !trimmed.starts_with('{')
        || !trimmed.ends_with('}')
    {
        return Err(error("NATIVE_SESSION_INVALID"));
    }
    Ok(())
}

fn input_blob(bytes: &[u8]) -> Result<CRYPT_INTEGER_BLOB, String> {
    Ok(CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(bytes.len()).map_err(|_| error("NATIVE_SESSION_INVALID"))?,
        pbData: bytes.as_ptr().cast_mut(),
    })
}

fn protect_data(plaintext: &[u8], optional_entropy: &[u8]) -> Result<Vec<u8>, String> {
    let input = input_blob(plaintext)?;
    let entropy = input_blob(optional_entropy)?;
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: Both input blobs point to live slices for this call; optional pointers are null;
    // Windows allocates output with LocalAlloc and we copy then free it below.
    let succeeded = unsafe {
        CryptProtectData(
            &input,
            ptr::null(),
            &entropy,
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if succeeded == 0 || output.pbData.is_null() {
        return Err(error("NATIVE_SESSION_PROTECTION_FAILED"));
    }
    // SAFETY: CryptProtectData returned a valid output allocation of exactly cbData bytes.
    let protected = unsafe {
        let copy = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        LocalFree(output.pbData.cast());
        copy
    };
    Ok(protected)
}

fn unprotect_data(
    ciphertext: &[u8],
    optional_entropy: &[u8],
) -> Result<Zeroizing<Vec<u8>>, String> {
    let input = input_blob(ciphertext)?;
    let entropy = input_blob(optional_entropy)?;
    let mut output = CRYPT_INTEGER_BLOB::default();
    // SAFETY: Both input blobs point to live slices; DPAPI validates ciphertext integrity and
    // allocates output with LocalAlloc. No prompt or machine-wide scope is requested.
    let succeeded = unsafe {
        CryptUnprotectData(
            &input,
            ptr::null_mut(),
            &entropy,
            ptr::null(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if succeeded == 0 || output.pbData.is_null() {
        return Err(error("NATIVE_SESSION_TAMPERED"));
    }
    // SAFETY: CryptUnprotectData returned cbData plaintext bytes. Copy into a zeroizing buffer,
    // wipe the Windows allocation, then release it with LocalFree as required by DPAPI.
    let plaintext = unsafe {
        let copy = Zeroizing::new(
            std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec(),
        );
        ptr::write_bytes(output.pbData, 0, output.cbData as usize);
        LocalFree(output.pbData.cast());
        copy
    };
    Ok(plaintext)
}

fn persist_encrypted(path: PathBuf, file_header: &[u8], ciphertext: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| error("NATIVE_SESSION_STORAGE_UNAVAILABLE"))?;
    fs::create_dir_all(parent).map_err(|_| error("NATIVE_SESSION_STORAGE_UNAVAILABLE"))?;
    let temporary = parent.join(format!(".pdfmason-session-{}.part", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| error("NATIVE_SESSION_STORAGE_UNAVAILABLE"))?;
    let result = file
        .write_all(file_header)
        .and_then(|()| file.write_all(ciphertext))
        .and_then(|()| file.sync_all());
    drop(file);
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(error("NATIVE_SESSION_STORAGE_UNAVAILABLE"));
    }
    if path.exists() && fs::remove_file(&path).is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(error("NATIVE_SESSION_STORAGE_UNAVAILABLE"));
    }
    if fs::rename(&temporary, path).is_err() {
        let _ = fs::remove_file(&temporary);
        return Err(error("NATIVE_SESSION_STORAGE_UNAVAILABLE"));
    }
    Ok(())
}

#[tauri::command]
pub fn store_secure_session(
    app: AppHandle,
    state: tauri::State<'_, SecureSessionState>,
    session_json: String,
) -> Result<(), String> {
    let session_json = Zeroizing::new(session_json);
    validate_session_payload(&session_json)?;
    let _guard = state
        .operation
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
    let protected = protect_data(session_json.as_bytes(), SESSION_OPTIONAL_ENTROPY)?;
    persist_encrypted(session_path(&app)?, SESSION_FILE_HEADER, &protected)
}

#[tauri::command]
pub fn get_secure_session(
    app: AppHandle,
    state: tauri::State<'_, SecureSessionState>,
) -> Result<Option<String>, String> {
    let _guard = state
        .operation
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
    let path = session_path(&app)?;
    let file = match fs::read(&path) {
        Ok(file) => file,
        Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(error("NATIVE_SESSION_STORAGE_UNAVAILABLE")),
    };
    if file.len() <= SESSION_FILE_HEADER.len()
        || file.len() > MAXIMUM_SESSION_BYTES * 2
        || !file.starts_with(SESSION_FILE_HEADER)
    {
        let _ = fs::remove_file(path);
        return Err(error("NATIVE_SESSION_TAMPERED"));
    }
    let mut plaintext =
        unprotect_data(&file[SESSION_FILE_HEADER.len()..], SESSION_OPTIONAL_ENTROPY)?;
    let session = String::from_utf8(std::mem::take(&mut *plaintext))
        .map_err(|_| error("NATIVE_SESSION_TAMPERED"))?;
    if validate_session_payload(&session).is_err() {
        let _ = fs::remove_file(path);
        return Err(error("NATIVE_SESSION_TAMPERED"));
    }
    Ok(Some(session))
}

#[tauri::command]
pub fn clear_secure_session(
    app: AppHandle,
    state: tauri::State<'_, SecureSessionState>,
) -> Result<(), String> {
    let _guard = state
        .operation
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
    match fs::remove_file(session_path(&app)?) {
        Ok(()) => Ok(()),
        Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(error("NATIVE_SESSION_STORAGE_UNAVAILABLE")),
    }
}

#[tauri::command]
pub fn store_secure_entitlement(
    app: AppHandle,
    state: tauri::State<'_, SecureSessionState>,
    entitlement_json: String,
) -> Result<(), String> {
    let entitlement_json = Zeroizing::new(entitlement_json);
    let trimmed = entitlement_json.trim();
    if entitlement_json.len() < 2
        || entitlement_json.len() > MAXIMUM_ENTITLEMENT_BYTES
        || !trimmed.starts_with('{')
        || !trimmed.ends_with('}')
    {
        return Err(error("NATIVE_ENTITLEMENT_INVALID"));
    }
    let _guard = state
        .operation
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
    let protected = protect_data(entitlement_json.as_bytes(), ENTITLEMENT_OPTIONAL_ENTROPY)
        .map_err(|_| error("NATIVE_ENTITLEMENT_PROTECTION_FAILED"))?;
    persist_encrypted(entitlement_path(&app)?, ENTITLEMENT_FILE_HEADER, &protected)
        .map_err(|_| error("NATIVE_ENTITLEMENT_STORAGE_UNAVAILABLE"))
}

#[tauri::command]
pub fn get_secure_entitlement(
    app: AppHandle,
    state: tauri::State<'_, SecureSessionState>,
) -> Result<Option<String>, String> {
    let _guard = state
        .operation
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
    let path = entitlement_path(&app)?;
    let file = match fs::read(&path) {
        Ok(file) => file,
        Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(error("NATIVE_ENTITLEMENT_STORAGE_UNAVAILABLE")),
    };
    if file.len() <= ENTITLEMENT_FILE_HEADER.len()
        || file.len() > MAXIMUM_ENTITLEMENT_BYTES * 2
        || !file.starts_with(ENTITLEMENT_FILE_HEADER)
    {
        let _ = fs::remove_file(path);
        return Err(error("NATIVE_ENTITLEMENT_TAMPERED"));
    }
    let mut plaintext = unprotect_data(
        &file[ENTITLEMENT_FILE_HEADER.len()..],
        ENTITLEMENT_OPTIONAL_ENTROPY,
    )
    .map_err(|_| error("NATIVE_ENTITLEMENT_TAMPERED"))?;
    let entitlement = String::from_utf8(std::mem::take(&mut *plaintext))
        .map_err(|_| error("NATIVE_ENTITLEMENT_TAMPERED"))?;
    Ok(Some(entitlement))
}

#[tauri::command]
pub fn clear_secure_entitlement(
    app: AppHandle,
    state: tauri::State<'_, SecureSessionState>,
) -> Result<(), String> {
    let _guard = state
        .operation
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
    match fs::remove_file(entitlement_path(&app)?) {
        Ok(()) => Ok(()),
        Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(error("NATIVE_ENTITLEMENT_STORAGE_UNAVAILABLE")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_payload_is_bounded_and_object_shaped() {
        assert!(validate_session_payload(r#"{"access_token":"synthetic"}"#).is_ok());
        assert_eq!(
            validate_session_payload("[]"),
            Err(error("NATIVE_SESSION_INVALID"))
        );
        assert_eq!(
            validate_session_payload(&"x".repeat(MAXIMUM_SESSION_BYTES + 1)),
            Err(error("NATIVE_SESSION_INVALID"))
        );
    }

    #[test]
    fn windows_dpapi_round_trip_and_tamper_detection() {
        let plaintext = b"{\"access_token\":\"synthetic\"}";
        let protected = protect_data(plaintext, SESSION_OPTIONAL_ENTROPY)
            .expect("DPAPI should protect synthetic bytes");
        assert_ne!(protected, plaintext);
        assert_eq!(
            unprotect_data(&protected, SESSION_OPTIONAL_ENTROPY)
                .expect("DPAPI should unprotect its output")
                .as_slice(),
            plaintext
        );

        let mut tampered = protected;
        let last = tampered.last_mut().expect("DPAPI output is not empty");
        *last ^= 1;
        assert_eq!(
            unprotect_data(&tampered, SESSION_OPTIONAL_ENTROPY).err(),
            Some(error("NATIVE_SESSION_TAMPERED"))
        );
    }
}
