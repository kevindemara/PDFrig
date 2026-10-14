use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;
use time::format_description::well_known::Rfc3339;

const MAXIMUM_RELEASE_NOTES_CHARS: usize = 2_000;
const MAXIMUM_VERSION_CHARS: usize = 64;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    current_version: String,
    notes: Option<String>,
    published_at: Option<String>,
    version: String,
}

fn error(code: &'static str) -> String {
    code.to_owned()
}

fn safe_release_notes(notes: Option<String>) -> Option<String> {
    notes.map(|value| {
        value
            .chars()
            .filter(|character| !character.is_control() || *character == '\n' || *character == '\t')
            .take(MAXIMUM_RELEASE_NOTES_CHARS)
            .collect()
    })
}

fn valid_expected_version(version: &str) -> bool {
    !version.is_empty()
        && version.len() <= MAXIMUM_VERSION_CHARS
        && version.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '+')
        })
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<Option<AvailableUpdate>, String> {
    let updater = app
        .updater()
        .map_err(|_| error("NATIVE_UPDATE_UNAVAILABLE"))?;
    let update = updater
        .check()
        .await
        .map_err(|_| error("NATIVE_UPDATE_CHECK_FAILED"))?;
    Ok(update.map(|available| AvailableUpdate {
        current_version: available.current_version,
        notes: safe_release_notes(available.body),
        published_at: available.date.and_then(|date| date.format(&Rfc3339).ok()),
        version: available.version,
    }))
}

#[tauri::command]
pub async fn install_available_update(
    app: AppHandle,
    expected_version: String,
) -> Result<(), String> {
    if !valid_expected_version(&expected_version) {
        return Err(error("NATIVE_UPDATE_VERSION_INVALID"));
    }
    let updater = app
        .updater()
        .map_err(|_| error("NATIVE_UPDATE_UNAVAILABLE"))?;
    let update = updater
        .check()
        .await
        .map_err(|_| error("NATIVE_UPDATE_CHECK_FAILED"))?
        .ok_or_else(|| error("NATIVE_UPDATE_NOT_AVAILABLE"))?;
    if update.version != expected_version {
        return Err(error("NATIVE_UPDATE_CHANGED"));
    }
    // The plugin verifies the updater signature before it invokes the Windows installer.
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|_| error("NATIVE_UPDATE_INSTALL_FAILED"))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use minisign::{KeyPair, sign};
    use minisign_verify::{PublicKey, Signature};

    use super::*;

    #[test]
    fn update_release_fields_are_bounded_and_safe() {
        let notes = format!("hello\0{}", "x".repeat(MAXIMUM_RELEASE_NOTES_CHARS + 10));
        let safe = safe_release_notes(Some(notes)).expect("notes remain present");
        assert!(!safe.contains('\0'));
        assert_eq!(safe.chars().count(), MAXIMUM_RELEASE_NOTES_CHARS);
        assert!(valid_expected_version("1.2.3-alpha.4+build5"));
        assert!(!valid_expected_version("../installer.exe"));
    }

    #[test]
    fn updater_signature_verifier_rejects_tampered_artifacts() {
        let pair = KeyPair::generate_unencrypted_keypair().expect("ephemeral key generation");
        let artifact = b"synthetic PDFMason updater artifact";
        let signature = sign(
            Some(&pair.pk),
            &pair.sk,
            Cursor::new(artifact),
            Some("synthetic test signature"),
            None,
        )
        .expect("ephemeral artifact signing");
        let verifier_key =
            PublicKey::decode(&pair.pk.to_box().expect("public key box").to_string())
                .expect("Tauri verifier public key");
        let verifier_signature =
            Signature::decode(&signature.into_string()).expect("Tauri verifier signature");
        verifier_key
            .verify(artifact, &verifier_signature, true)
            .expect("authentic updater artifact");
        let mut tampered = artifact.to_vec();
        tampered[0] ^= 1;
        assert!(
            verifier_key
                .verify(&tampered, &verifier_signature, true)
                .is_err()
        );
    }
}
