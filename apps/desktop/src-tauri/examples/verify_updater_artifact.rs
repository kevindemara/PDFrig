//! Offline QA only: verify an actual internal installer and reject modified copies.
//! Accepts decoded Minisign public-key/signature boxes, never a private key.
//! Does not execute, install, download, or publish the artifact.

use std::{fs::File, io::Read, path::Path, process::ExitCode};

use minisign::KeyPair;
use minisign_verify::{PublicKey, Signature};

const MAX_ARTIFACT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_BOX_BYTES: u64 = 16 * 1024;

fn read_bounded(path: &Path, maximum: u64) -> Result<Vec<u8>, &'static str> {
    let file = File::open(path).map_err(|_| "QA_ARTIFACT_READ_FAILED")?;
    if !file
        .metadata()
        .map_err(|_| "QA_ARTIFACT_READ_FAILED")?
        .is_file()
    {
        return Err("QA_ARTIFACT_NOT_FILE");
    }
    let mut bytes = Vec::new();
    file.take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "QA_ARTIFACT_READ_FAILED")?;
    if bytes.is_empty() || bytes.len() as u64 > maximum {
        return Err("QA_ARTIFACT_SIZE_INVALID");
    }
    Ok(bytes)
}

fn verify_with_negatives(
    artifact: &[u8],
    public_box: &str,
    signature_box: &str,
) -> Result<(), &'static str> {
    if artifact.len() < 2 || artifact.len() as u64 > MAX_ARTIFACT_BYTES {
        return Err("QA_ARTIFACT_SIZE_INVALID");
    }
    if public_box.len() as u64 > MAX_BOX_BYTES {
        return Err("QA_PUBLIC_KEY_INVALID");
    }
    if signature_box.len() as u64 > MAX_BOX_BYTES {
        return Err("QA_SIGNATURE_INVALID");
    }
    let key = PublicKey::decode(public_box).map_err(|_| "QA_PUBLIC_KEY_INVALID")?;
    let signature = Signature::decode(signature_box).map_err(|_| "QA_SIGNATURE_INVALID")?;
    key.verify(artifact, &signature, true)
        .map_err(|_| "QA_SIGNATURE_REJECTED")?;

    let mut modified = artifact.to_vec();
    modified[0] ^= 1;
    if key.verify(&modified, &signature, true).is_ok() {
        return Err("QA_TAMPER_ACCEPTED");
    }
    if key
        .verify(&artifact[..artifact.len() / 2], &signature, true)
        .is_ok()
    {
        return Err("QA_TRUNCATION_ACCEPTED");
    }
    let other = KeyPair::generate_unencrypted_keypair().map_err(|_| "QA_TEST_KEY_FAILED")?;
    let other_box = other.pk.to_box().map_err(|_| "QA_TEST_KEY_FAILED")?;
    let other_key = PublicKey::decode(&other_box.to_string()).map_err(|_| "QA_TEST_KEY_FAILED")?;
    if other_key.verify(artifact, &signature, true).is_ok() {
        return Err("QA_WRONG_KEY_ACCEPTED");
    }
    Ok(())
}

fn run() -> Result<(), &'static str> {
    let arguments: Vec<_> = std::env::args_os().skip(1).take(4).collect();
    if arguments.len() != 3 {
        return Err("QA_EXPECT_INSTALLER_PUBLIC_BOX_SIGNATURE_BOX");
    }
    let artifact = read_bounded(Path::new(&arguments[0]), MAX_ARTIFACT_BYTES)?;
    let public_box = read_bounded(Path::new(&arguments[1]), MAX_BOX_BYTES)?;
    let signature_box = read_bounded(Path::new(&arguments[2]), MAX_BOX_BYTES)?;
    verify_with_negatives(
        &artifact,
        std::str::from_utf8(&public_box).map_err(|_| "QA_PUBLIC_KEY_INVALID")?,
        std::str::from_utf8(&signature_box).map_err(|_| "QA_SIGNATURE_INVALID")?,
    )
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => {
            println!("QA_SIGNATURE_VERIFIED: tamper, truncation and wrong-key checks rejected");
            ExitCode::SUCCESS
        }
        Err(code) => {
            eprintln!("{code}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use minisign::sign;

    use super::*;

    #[test]
    fn authentic_bytes_pass_all_negatives_and_modified_input_fails() {
        let pair = KeyPair::generate_unencrypted_keypair().expect("test key");
        let artifact = b"synthetic installer verification fixture";
        let public_box = pair.pk.to_box().expect("public box").to_string();
        let signature = sign(Some(&pair.pk), &pair.sk, Cursor::new(artifact), None, None)
            .expect("test signature")
            .into_string();
        assert_eq!(
            verify_with_negatives(artifact, &public_box, &signature),
            Ok(())
        );
        assert_eq!(
            verify_with_negatives(b"modified installer", &public_box, &signature),
            Err("QA_SIGNATURE_REJECTED")
        );
    }

    #[test]
    fn empty_bytes_and_invalid_boxes_fail_with_safe_codes() {
        assert_eq!(
            verify_with_negatives(b"", "", ""),
            Err("QA_ARTIFACT_SIZE_INVALID")
        );
        assert_eq!(
            verify_with_negatives(b"ab", "", ""),
            Err("QA_PUBLIC_KEY_INVALID")
        );
        let pair = KeyPair::generate_unencrypted_keypair().expect("test key");
        let public_box = pair.pk.to_box().expect("public box").to_string();
        assert_eq!(
            verify_with_negatives(b"ab", &public_box, ""),
            Err("QA_SIGNATURE_INVALID")
        );
        assert_eq!(
            verify_with_negatives(b"ab", &"x".repeat(MAX_BOX_BYTES as usize + 1), ""),
            Err("QA_PUBLIC_KEY_INVALID")
        );
        assert_eq!(
            verify_with_negatives(b"ab", &public_box, &"x".repeat(MAX_BOX_BYTES as usize + 1)),
            Err("QA_SIGNATURE_INVALID")
        );
    }

    #[test]
    fn file_reads_enforce_exact_bounds_and_omit_paths_on_failure() {
        let path =
            std::env::temp_dir().join(format!("pdfmason-artifact-{}.bin", uuid::Uuid::new_v4()));
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .expect("exclusive synthetic fixture");
        std::io::Write::write_all(&mut file, b"abc").expect("synthetic bytes");
        drop(file);
        assert_eq!(read_bounded(&path, 3), Ok(b"abc".to_vec()));
        assert_eq!(read_bounded(&path, 2), Err("QA_ARTIFACT_SIZE_INVALID"));
        std::fs::remove_file(&path).expect("remove exact synthetic fixture");
        assert_eq!(read_bounded(&path, 3), Err("QA_ARTIFACT_READ_FAILED"));
    }
}
