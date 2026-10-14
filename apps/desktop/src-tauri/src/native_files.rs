use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, ipc::InvokeBody};
use tauri_plugin_dialog::DialogExt;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

const MAXIMUM_PDF_BYTES: u64 = 50 * 1024 * 1024;
const MAXIMUM_COMMENT_REPORT_BYTES: u64 = 3 * 1024 * 1024;
const MAXIMUM_CHUNK_BYTES: usize = 1024 * 1024;
const MAXIMUM_RECENT_FILES: usize = 8;
const RECENT_SETTINGS_VERSION: u8 = 1;

struct OpenTransfer {
    file: File,
    next_offset: u64,
    size: u64,
    token: String,
}

struct SaveTransfer {
    expected_size: u64,
    file: File,
    kind: SaveKind,
    next_offset: u64,
    target: PathBuf,
    temporary: PathBuf,
    token: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SaveKind {
    CommentReport,
    Pdf,
}

impl SaveKind {
    fn from_mime_type(mime_type: &str) -> Result<Self, String> {
        match mime_type {
            "application/pdf" => Ok(Self::Pdf),
            "application/json" => Ok(Self::CommentReport),
            _ => Err(error("NATIVE_SAVE_TYPE_UNSUPPORTED")),
        }
    }

    fn accepts_path(self, path: &Path) -> bool {
        match self {
            Self::Pdf => has_pdf_extension(path),
            Self::CommentReport => has_json_extension(path),
        }
    }

    fn maximum_bytes(self) -> u64 {
        match self {
            Self::Pdf => MAXIMUM_PDF_BYTES,
            Self::CommentReport => MAXIMUM_COMMENT_REPORT_BYTES,
        }
    }

    fn mime_type(self) -> &'static str {
        match self {
            Self::Pdf => "application/pdf",
            Self::CommentReport => "application/json",
        }
    }
}

#[derive(Default)]
pub struct NativeFileState {
    pending_launch: Mutex<Option<PathBuf>>,
    pending_open: Mutex<Option<OpenTransfer>>,
    pending_save: Mutex<Option<SaveTransfer>>,
    recent_files: Mutex<()>,
}

fn launch_pdf_candidate(arguments: &[String]) -> Option<PathBuf> {
    let [_, candidate] = arguments else {
        return None;
    };
    let path = PathBuf::from(candidate);
    if !path.is_absolute() || !has_pdf_extension(&path) {
        return None;
    }
    Some(path)
}

pub fn queue_launch_pdf(app: &AppHandle, arguments: &[String]) -> bool {
    let Some(path) = launch_pdf_candidate(arguments) else {
        return false;
    };
    let state = app.state::<NativeFileState>();
    let Ok(mut pending) = state.pending_launch.lock() else {
        return false;
    };
    *pending = Some(path);
    true
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativePdfSelection {
    display_name: String,
    selection_token: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSaveSelection {
    transfer_token: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredRecentFile {
    display_name: String,
    id: String,
    last_opened_at: String,
    path: PathBuf,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecentFileSettings {
    enabled: bool,
    entries: Vec<StoredRecentFile>,
    version: u8,
}

impl Default for RecentFileSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            entries: Vec::new(),
            version: RECENT_SETTINGS_VERSION,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFileEntry {
    available: bool,
    display_name: String,
    id: String,
    last_opened_at: String,
}

#[derive(Serialize)]
pub struct RecentFilesSnapshot {
    enabled: bool,
    entries: Vec<RecentFileEntry>,
}

fn error(code: &'static str) -> String {
    code.to_owned()
}

fn has_pdf_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
}

fn has_json_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
}

fn recent_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| error("NATIVE_RECENT_STATE_UNAVAILABLE"))?
        .join("recent-files.json"))
}

fn validate_recent_settings(settings: RecentFileSettings) -> Result<RecentFileSettings, String> {
    if settings.version != RECENT_SETTINGS_VERSION || settings.entries.len() > MAXIMUM_RECENT_FILES
    {
        return Err(error("NATIVE_RECENT_STATE_INVALID"));
    }
    if settings.entries.iter().any(|entry| {
        Uuid::parse_str(&entry.id).is_err()
            || entry.display_name.is_empty()
            || entry.display_name.len() > 260
            || entry.last_opened_at.len() > 40
            || !has_pdf_extension(&entry.path)
    }) {
        return Err(error("NATIVE_RECENT_STATE_INVALID"));
    }
    Ok(settings)
}

fn load_recent_settings(app: &AppHandle) -> Result<RecentFileSettings, String> {
    let path = recent_settings_path(app)?;
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(failure) if failure.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RecentFileSettings::default());
        }
        Err(_) => return Err(error("NATIVE_RECENT_STATE_UNAVAILABLE")),
    };
    if bytes.len() > 64 * 1024 {
        return Err(error("NATIVE_RECENT_STATE_INVALID"));
    }
    validate_recent_settings(
        serde_json::from_slice(&bytes).map_err(|_| error("NATIVE_RECENT_STATE_INVALID"))?,
    )
}

fn save_recent_settings(app: &AppHandle, settings: &RecentFileSettings) -> Result<(), String> {
    let path = recent_settings_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| error("NATIVE_RECENT_STATE_UNAVAILABLE"))?;
    fs::create_dir_all(parent).map_err(|_| error("NATIVE_RECENT_STATE_UNAVAILABLE"))?;
    let bytes =
        serde_json::to_vec(settings).map_err(|_| error("NATIVE_RECENT_STATE_UNAVAILABLE"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)
        .map_err(|_| error("NATIVE_RECENT_STATE_UNAVAILABLE"))?;
    file.write_all(&bytes)
        .and_then(|()| file.sync_all())
        .map_err(|_| error("NATIVE_RECENT_STATE_UNAVAILABLE"))
}

fn current_timestamp() -> Result<String, String> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|_| error("NATIVE_RECENT_STATE_UNAVAILABLE"))
}

fn remember_recent_file(
    settings: &mut RecentFileSettings,
    path: PathBuf,
    display_name: String,
    timestamp: String,
) {
    if !settings.enabled {
        return;
    }
    let existing_id = settings
        .entries
        .iter()
        .find(|entry| entry.path == path)
        .map(|entry| entry.id.clone());
    settings.entries.retain(|entry| entry.path != path);
    settings.entries.insert(
        0,
        StoredRecentFile {
            display_name,
            id: existing_id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            last_opened_at: timestamp,
            path,
        },
    );
    settings.entries.truncate(MAXIMUM_RECENT_FILES);
}

fn record_recent_file(app: &AppHandle, path: PathBuf, display_name: String) -> Result<(), String> {
    let state = app.state::<NativeFileState>();
    let _guard = state
        .recent_files
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
    let mut settings = load_recent_settings(app)?;
    if !settings.enabled {
        return Ok(());
    }
    remember_recent_file(&mut settings, path, display_name, current_timestamp()?);
    save_recent_settings(app, &settings)
}

fn open_pdf_transfer(path: PathBuf) -> Result<(OpenTransfer, NativePdfSelection, PathBuf), String> {
    if !has_pdf_extension(&path) {
        return Err(error("NATIVE_EXTENSION_REQUIRED"));
    }
    let link_metadata = fs::symlink_metadata(&path).map_err(|_| error("NATIVE_OPEN_FAILED"))?;
    if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
        return Err(error("NATIVE_OPEN_TYPE_BLOCKED"));
    }
    let canonical = fs::canonicalize(&path).map_err(|_| error("NATIVE_OPEN_FAILED"))?;
    if !has_pdf_extension(&canonical) {
        return Err(error("NATIVE_EXTENSION_REQUIRED"));
    }
    let mut file = File::open(&canonical).map_err(|_| error("NATIVE_OPEN_FAILED"))?;
    let metadata = file.metadata().map_err(|_| error("NATIVE_OPEN_FAILED"))?;
    if metadata.len() < 5 || metadata.len() > MAXIMUM_PDF_BYTES {
        return Err(error("NATIVE_OPEN_LIMIT"));
    }
    let mut header = [0_u8; 5];
    file.read_exact(&mut header)
        .and_then(|()| file.seek(SeekFrom::Start(0)).map(|_| ()))
        .map_err(|_| error("NATIVE_OPEN_FAILED"))?;
    if &header != b"%PDF-" {
        return Err(error("NATIVE_OPEN_TYPE_UNSUPPORTED"));
    }
    let display_name = canonical
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .ok_or_else(|| error("NATIVE_FILENAME_UNSUPPORTED"))?;
    let token = Uuid::new_v4().to_string();
    let size = metadata.len();
    Ok((
        OpenTransfer {
            file,
            next_offset: 0,
            size,
            token: token.clone(),
        },
        NativePdfSelection {
            display_name,
            selection_token: token,
            size,
        },
        canonical,
    ))
}

fn validate_filename_suggestion(value: &str, kind: SaveKind) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 100
        || value.contains("..")
        || value
            .chars()
            .any(|character| character.is_control() || "<>:\"/\\|?*".contains(character))
    {
        return Err(error("NATIVE_FILENAME_UNSUPPORTED"));
    }
    let path = Path::new(value);
    if !kind.accepts_path(path)
        || !matches!(path.components().next(), Some(Component::Normal(_)))
        || path.components().count() != 1
    {
        return Err(error("NATIVE_FILENAME_UNSUPPORTED"));
    }
    Ok(value)
}

fn validate_save_selection(path: PathBuf, kind: SaveKind) -> Result<PathBuf, String> {
    if !kind.accepts_path(&path) {
        return Err(error("NATIVE_EXTENSION_REQUIRED"));
    }
    if fs::symlink_metadata(&path).is_ok() {
        return Err(error("NATIVE_OVERWRITE_BLOCKED"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| error("NATIVE_SAVE_PATH_BLOCKED"))?;
    let parent_metadata = fs::metadata(parent).map_err(|_| error("NATIVE_SAVE_PATH_BLOCKED"))?;
    if !parent_metadata.is_dir() {
        return Err(error("NATIVE_SAVE_PATH_BLOCKED"));
    }
    Ok(path)
}

fn create_save_transfer(
    path: PathBuf,
    expected_size: u64,
    kind: SaveKind,
) -> Result<SaveTransfer, String> {
    if !(5..=kind.maximum_bytes()).contains(&expected_size) {
        return Err(error("NATIVE_SAVE_LIMIT"));
    }
    let target = validate_save_selection(path, kind)?;
    let parent = target
        .parent()
        .ok_or_else(|| error("NATIVE_SAVE_PATH_BLOCKED"))?;
    let temporary = parent.join(format!(".pdfmason-{}.part", Uuid::new_v4()));
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| error("NATIVE_WRITE_FAILED"))?;
    Ok(SaveTransfer {
        expected_size,
        file,
        kind,
        next_offset: 0,
        target,
        temporary,
        token: Uuid::new_v4().to_string(),
    })
}

fn has_valid_save_header(kind: SaveKind, bytes: &[u8]) -> bool {
    match kind {
        SaveKind::Pdf => bytes.starts_with(b"%PDF-"),
        SaveKind::CommentReport => {
            bytes.starts_with(b"{\n  \"schema\": \"pdfmason.comment-summary\"")
        }
    }
}

fn discard_save(transfer: SaveTransfer) {
    let temporary = transfer.temporary.clone();
    drop(transfer.file);
    let _ = fs::remove_file(temporary);
}

fn finalize_save(transfer: SaveTransfer) -> Result<(), String> {
    let temporary = transfer.temporary.clone();
    let target = transfer.target.clone();
    transfer
        .file
        .sync_all()
        .map_err(|_| error("NATIVE_WRITE_FAILED"))?;
    drop(transfer.file);
    if fs::symlink_metadata(&target).is_ok() {
        let _ = fs::remove_file(&temporary);
        return Err(error("NATIVE_OVERWRITE_BLOCKED"));
    }

    #[cfg(target_os = "windows")]
    let committed = fs::rename(&temporary, &target);

    #[cfg(not(target_os = "windows"))]
    let committed = fs::hard_link(&temporary, &target).and_then(|()| fs::remove_file(&temporary));

    if let Err(failure) = committed {
        let _ = fs::remove_file(&temporary);
        return Err(if failure.kind() == std::io::ErrorKind::AlreadyExists {
            error("NATIVE_OVERWRITE_BLOCKED")
        } else {
            error("NATIVE_WRITE_FAILED")
        });
    }
    Ok(())
}

fn request_header<'a>(
    request: &'a tauri::ipc::Request<'_>,
    name: &'static str,
) -> Result<&'a str, String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| error("NATIVE_TRANSFER_HEADERS_REQUIRED"))
}

#[tauri::command]
pub async fn choose_pdf(app: AppHandle) -> Result<Option<NativePdfSelection>, String> {
    let state = app.state::<NativeFileState>();
    *state
        .pending_open
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))? = None;
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("PDF document", &["pdf"])
        .set_title("Open a PDF in PDFrig")
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| error("NATIVE_OPEN_TYPE_BLOCKED"))?;
    let (transfer, metadata, canonical) = open_pdf_transfer(path)?;
    record_recent_file(&app, canonical, metadata.display_name.clone())?;
    *state
        .pending_open
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))? = Some(transfer);
    Ok(Some(metadata))
}

#[tauri::command]
pub fn get_recent_files(app: AppHandle) -> Result<RecentFilesSnapshot, String> {
    let state = app.state::<NativeFileState>();
    let _guard = state
        .recent_files
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
    let settings = load_recent_settings(&app)?;
    let entries = if settings.enabled {
        settings
            .entries
            .into_iter()
            .map(|entry| RecentFileEntry {
                available: fs::symlink_metadata(&entry.path)
                    .is_ok_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink()),
                display_name: entry.display_name,
                id: entry.id,
                last_opened_at: entry.last_opened_at,
            })
            .collect()
    } else {
        Vec::new()
    };
    Ok(RecentFilesSnapshot {
        enabled: settings.enabled,
        entries,
    })
}

#[tauri::command]
pub fn set_recent_files_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<NativeFileState>();
    let _guard = state
        .recent_files
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
    let mut settings = load_recent_settings(&app)?;
    settings.enabled = enabled;
    if !enabled {
        settings.entries.clear();
    }
    save_recent_settings(&app, &settings)
}

#[tauri::command]
pub fn clear_recent_files(app: AppHandle) -> Result<(), String> {
    let state = app.state::<NativeFileState>();
    let _guard = state
        .recent_files
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
    let mut settings = load_recent_settings(&app)?;
    settings.entries.clear();
    save_recent_settings(&app, &settings)
}

#[tauri::command]
pub fn open_recent_pdf(
    app: AppHandle,
    recent_file_id: String,
) -> Result<NativePdfSelection, String> {
    let state = app.state::<NativeFileState>();
    let path = {
        let _guard = state
            .recent_files
            .lock()
            .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
        let settings = load_recent_settings(&app)?;
        if !settings.enabled {
            return Err(error("NATIVE_RECENT_FILES_DISABLED"));
        }
        settings
            .entries
            .into_iter()
            .find(|entry| entry.id == recent_file_id)
            .map(|entry| entry.path)
            .ok_or_else(|| error("NATIVE_RECENT_FILE_REQUIRED"))?
    };
    let (transfer, metadata, canonical) = open_pdf_transfer(path)?;
    record_recent_file(&app, canonical, metadata.display_name.clone())?;
    *state
        .pending_open
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))? = Some(transfer);
    Ok(metadata)
}

#[tauri::command]
pub fn read_pdf_chunk(
    app: AppHandle,
    selection_token: String,
    offset: u64,
) -> Result<tauri::ipc::Response, String> {
    let state = app.state::<NativeFileState>();
    let mut slot = state
        .pending_open
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
    let result = (|| {
        let transfer = slot
            .as_mut()
            .ok_or_else(|| error("NATIVE_SELECTION_REQUIRED"))?;
        if transfer.token != selection_token || transfer.next_offset != offset {
            return Err(error("NATIVE_TRANSFER_MISMATCH"));
        }
        let remaining = transfer.size.saturating_sub(transfer.next_offset);
        let chunk_size = remaining.min(MAXIMUM_CHUNK_BYTES as u64) as usize;
        if chunk_size == 0 {
            return Err(error("NATIVE_FILE_CHANGED"));
        }
        let mut bytes = vec![0_u8; chunk_size];
        transfer
            .file
            .read_exact(&mut bytes)
            .map_err(|_| error("NATIVE_FILE_CHANGED"))?;
        transfer.next_offset += chunk_size as u64;
        Ok((bytes, transfer.next_offset == transfer.size))
    })();
    match result {
        Ok((bytes, finished)) => {
            if finished {
                slot.take();
            }
            Ok(tauri::ipc::Response::new(bytes))
        }
        Err(failure) => {
            slot.take();
            Err(failure)
        }
    }
}

#[tauri::command]
pub fn cancel_pdf_read(app: AppHandle, selection_token: String) -> Result<(), String> {
    let state = app.state::<NativeFileState>();
    let mut slot = state
        .pending_open
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
    if slot
        .as_ref()
        .is_some_and(|transfer| transfer.token != selection_token)
    {
        return Err(error("NATIVE_TRANSFER_MISMATCH"));
    }
    slot.take();
    Ok(())
}

#[tauri::command]
pub fn take_launch_pdf(app: AppHandle) -> Result<Option<NativePdfSelection>, String> {
    let state = app.state::<NativeFileState>();
    let Some(path) = state
        .pending_launch
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?
        .take()
    else {
        return Ok(None);
    };
    let (transfer, metadata, canonical) = open_pdf_transfer(path)?;
    let _ = record_recent_file(&app, canonical, metadata.display_name.clone());
    *state
        .pending_open
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))? = Some(transfer);
    Ok(Some(metadata))
}

#[tauri::command]
pub async fn choose_save_pdf(
    app: AppHandle,
    filename_suggestion: String,
    expected_size: u64,
    mime_type: String,
) -> Result<Option<NativeSaveSelection>, String> {
    let state = app.state::<NativeFileState>();
    if let Some(stale) = state
        .pending_save
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?
        .take()
    {
        discard_save(stale);
    }
    let kind = SaveKind::from_mime_type(&mime_type)?;
    let filename = validate_filename_suggestion(&filename_suggestion, kind)?;
    let dialog = app.dialog().file().set_file_name(filename);
    let dialog = match kind {
        SaveKind::Pdf => dialog
            .add_filter("PDF document", &["pdf"])
            .set_title("Save a new PDFrig copy"),
        SaveKind::CommentReport => dialog
            .add_filter("PDFrig comment summary", &["json"])
            .set_title("Save comment summary"),
    };
    let Some(selected) = dialog.blocking_save_file() else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| error("NATIVE_SAVE_PATH_BLOCKED"))?;
    let transfer = create_save_transfer(path, expected_size, kind)?;
    let metadata = NativeSaveSelection {
        transfer_token: transfer.token.clone(),
    };
    *state
        .pending_save
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))? = Some(transfer);
    Ok(Some(metadata))
}

#[tauri::command]
pub fn write_pdf_chunk(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(error("NATIVE_RAW_BODY_REQUIRED"));
    };
    if bytes.is_empty() || bytes.len() > MAXIMUM_CHUNK_BYTES {
        return Err(error("NATIVE_CHUNK_LIMIT"));
    }
    let token = request_header(&request, "x-pdfmason-transfer")?;
    let offset = request_header(&request, "x-pdfmason-offset")?
        .parse::<u64>()
        .map_err(|_| error("NATIVE_TRANSFER_HEADERS_REQUIRED"))?;
    let is_final = match request_header(&request, "x-pdfmason-final")? {
        "true" => true,
        "false" => false,
        _ => return Err(error("NATIVE_TRANSFER_HEADERS_REQUIRED")),
    };
    let content_type = request_header(&request, "content-type")?;
    let state = app.state::<NativeFileState>();
    let mut slot = state
        .pending_save
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
    let write_result = (|| {
        let transfer = slot
            .as_mut()
            .ok_or_else(|| error("NATIVE_SELECTION_REQUIRED"))?;
        if transfer.token != token || transfer.next_offset != offset {
            return Err(error("NATIVE_TRANSFER_MISMATCH"));
        }
        if content_type != transfer.kind.mime_type() {
            return Err(error("NATIVE_SAVE_TYPE_UNSUPPORTED"));
        }
        if offset == 0 && !has_valid_save_header(transfer.kind, bytes) {
            return Err(error("NATIVE_SAVE_TYPE_UNSUPPORTED"));
        }
        let next_offset = offset + bytes.len() as u64;
        if next_offset > transfer.expected_size
            || is_final != (next_offset == transfer.expected_size)
        {
            return Err(error("NATIVE_FILE_CHANGED"));
        }
        transfer
            .file
            .write_all(bytes)
            .map_err(|_| error("NATIVE_WRITE_FAILED"))?;
        transfer.next_offset = next_offset;
        Ok(())
    })();
    if let Err(failure) = write_result {
        let failed = slot.take();
        drop(slot);
        if let Some(transfer) = failed {
            discard_save(transfer);
        }
        return Err(failure);
    }
    if !is_final {
        return Ok(());
    }
    let completed = slot
        .take()
        .ok_or_else(|| error("NATIVE_SELECTION_REQUIRED"))?;
    drop(slot);
    finalize_save(completed)
}

#[tauri::command]
pub fn cancel_pdf_write(app: AppHandle, transfer_token: String) -> Result<(), String> {
    let state = app.state::<NativeFileState>();
    let mut slot = state
        .pending_save
        .lock()
        .map_err(|_| error("NATIVE_STATE_UNAVAILABLE"))?;
    if slot
        .as_ref()
        .is_some_and(|transfer| transfer.token != transfer_token)
    {
        return Err(error("NATIVE_TRANSFER_MISMATCH"));
    }
    let cancelled = slot.take();
    drop(slot);
    if let Some(transfer) = cancelled {
        discard_save(transfer);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn temporary_pdf_path(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("test clock must be after the Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "pdfmason-native-{label}-{}-{nonce}.pdf",
            std::process::id()
        ))
    }

    #[test]
    fn filename_suggestions_are_single_safe_reviewed_names() {
        assert_eq!(
            validate_filename_suggestion("synthetic-completed.pdf", SaveKind::Pdf),
            Ok("synthetic-completed.pdf")
        );
        assert_eq!(
            validate_filename_suggestion("pdfmason-comment-summary.json", SaveKind::CommentReport),
            Ok("pdfmason-comment-summary.json")
        );
        assert!(validate_filename_suggestion("../private.pdf", SaveKind::Pdf).is_err());
        assert!(validate_filename_suggestion("C:\\private.pdf", SaveKind::Pdf).is_err());
        assert!(validate_filename_suggestion("not-a-pdf.txt", SaveKind::Pdf).is_err());
        assert!(validate_filename_suggestion("disguised.pdf", SaveKind::CommentReport).is_err());
    }

    #[test]
    fn open_transfer_validates_pdf_and_retains_an_open_handle() {
        let path = temporary_pdf_path("open-transfer");
        let bytes = b"%PDF-1.7\nsynthetic fixture";
        fs::write(&path, bytes).expect("synthetic source should be written");
        let (mut transfer, metadata, canonical) =
            open_pdf_transfer(path.clone()).expect("synthetic PDF should open");
        fs::remove_file(&path).expect("an open Windows file may be delete-pending in tests");

        assert_eq!(metadata.size, bytes.len() as u64);
        assert_eq!(metadata.selection_token, transfer.token);
        assert!(canonical.is_absolute());
        let mut reopened = Vec::new();
        transfer
            .file
            .read_to_end(&mut reopened)
            .expect("retained handle should remain readable");
        assert_eq!(reopened, bytes);
    }

    #[test]
    fn save_transfer_commits_without_overwriting() {
        let path = temporary_pdf_path("chunked-save");
        let bytes = b"%PDF-1.7\nsynthetic fixture";
        let mut transfer = create_save_transfer(path.clone(), bytes.len() as u64, SaveKind::Pdf)
            .expect("save should start");
        transfer
            .file
            .write_all(bytes)
            .expect("synthetic bytes should be written");
        transfer.next_offset = bytes.len() as u64;
        finalize_save(transfer).expect("completed transfer should commit");
        assert_eq!(fs::read(&path).expect("output should be readable"), bytes);

        assert_eq!(
            create_save_transfer(path.clone(), bytes.len() as u64, SaveKind::Pdf)
                .err()
                .expect("existing output must be rejected"),
            error("NATIVE_OVERWRITE_BLOCKED")
        );
        fs::remove_file(path).expect("synthetic output should be removed");
    }

    #[test]
    fn comment_report_transfer_is_json_only_and_bounded() {
        let path = temporary_pdf_path("comment-report").with_extension("json");
        let bytes = b"{\n  \"schema\": \"pdfmason.comment-summary\",\n  \"version\": 1\n}\n";
        let mut transfer =
            create_save_transfer(path.clone(), bytes.len() as u64, SaveKind::CommentReport)
                .expect("comment report save should start");
        transfer
            .file
            .write_all(bytes)
            .expect("synthetic report should be written");
        transfer.next_offset = bytes.len() as u64;
        finalize_save(transfer).expect("completed report should commit");
        assert_eq!(fs::read(&path).expect("report should be readable"), bytes);
        assert!(has_valid_save_header(SaveKind::CommentReport, bytes));
        assert!(!has_valid_save_header(
            SaveKind::CommentReport,
            b"{\n  \"schema\": \"untrusted\"}"
        ));
        assert!(!has_valid_save_header(SaveKind::Pdf, bytes));
        fs::remove_file(path).expect("synthetic report should be removed");

        let oversized = temporary_pdf_path("oversized-report").with_extension("json");
        assert_eq!(
            create_save_transfer(
                oversized,
                MAXIMUM_COMMENT_REPORT_BYTES + 1,
                SaveKind::CommentReport,
            )
            .err()
            .expect("oversized report must be rejected"),
            error("NATIVE_SAVE_LIMIT")
        );
    }

    #[test]
    fn cancelled_save_removes_only_its_private_partial_file() {
        let path = temporary_pdf_path("cancelled-save");
        let transfer = create_save_transfer(path.clone(), 32, SaveKind::Pdf)
            .expect("synthetic transfer should start");
        let temporary = transfer.temporary.clone();
        assert!(temporary.exists());
        discard_save(transfer);
        assert!(!temporary.exists());
        assert!(!path.exists());
    }

    #[test]
    fn invalid_pdf_header_is_rejected_before_transfer() {
        let path = temporary_pdf_path("non-pdf");
        fs::write(&path, b"not a PDF").expect("synthetic source should be written");
        assert_eq!(
            open_pdf_transfer(path.clone())
                .err()
                .expect("non-PDF content must be rejected"),
            error("NATIVE_OPEN_TYPE_UNSUPPORTED")
        );
        fs::remove_file(path).expect("synthetic source should be removed");
    }

    #[test]
    fn recent_files_are_opt_in_deduplicated_and_bounded() {
        let mut settings = RecentFileSettings::default();
        remember_recent_file(
            &mut settings,
            PathBuf::from("disabled.pdf"),
            "disabled.pdf".to_owned(),
            "2026-08-24T12:00:00Z".to_owned(),
        );
        assert!(settings.entries.is_empty());

        settings.enabled = true;
        for index in 0..10 {
            remember_recent_file(
                &mut settings,
                PathBuf::from(format!("synthetic-{index}.pdf")),
                format!("synthetic-{index}.pdf"),
                format!("2026-08-24T12:00:{index:02}Z"),
            );
        }
        assert_eq!(settings.entries.len(), MAXIMUM_RECENT_FILES);
        assert_eq!(settings.entries[0].display_name, "synthetic-9.pdf");

        let retained_id = settings.entries[0].id.clone();
        remember_recent_file(
            &mut settings,
            PathBuf::from("synthetic-9.pdf"),
            "renamed-display.pdf".to_owned(),
            "2026-08-24T13:00:00Z".to_owned(),
        );
        assert_eq!(settings.entries.len(), MAXIMUM_RECENT_FILES);
        assert_eq!(settings.entries[0].id, retained_id);
        assert_eq!(settings.entries[0].display_name, "renamed-display.pdf");
    }

    #[test]
    fn launch_arguments_accept_exactly_one_absolute_pdf_path() {
        let path = temporary_pdf_path("launch");
        let executable = "pdfmason.exe".to_owned();
        assert_eq!(
            launch_pdf_candidate(&[executable.clone(), path.to_string_lossy().into_owned()]),
            Some(path)
        );
        assert_eq!(
            launch_pdf_candidate(&[executable.clone(), "relative.pdf".to_owned()]),
            None
        );
        assert_eq!(
            launch_pdf_candidate(&[executable.clone(), "C:\\document.txt".to_owned()]),
            None
        );
        assert_eq!(launch_pdf_candidate(&[executable]), None);
    }
}
