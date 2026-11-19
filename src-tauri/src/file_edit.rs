//! Window-owned documents and temporary copies for View and Edit.
use flashfxp_lib::{
    bus::PipeMsg,
    localized,
    session::RemoteSession,
    store::{Proxy, Site},
};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Weak},
    time::Duration,
};
use tauri::{Emitter, EventTarget, WebviewWindow};
use tokio::{io::AsyncReadExt, sync::Mutex as AsyncMutex};

const MAX_BYTES: usize = 2 * 1024 * 1024;
const EXTERNAL_EDIT_POLL: Duration = Duration::from_millis(250);
const NETWORK_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Default)]
pub struct Documents {
    next_id: u32,
    entries: HashMap<u32, Arc<AsyncMutex<Document>>>,
}

enum Source {
    Local(PathBuf),
    Remote {
        path: String,
        site: Box<Site>,
        proxy: Option<Proxy>,
    },
}

struct Document {
    source: Source,
    original: Vec<u8>,
    revision: u64,
    editable: bool,
    program: Option<String>,
    external: Option<(tempfile::TempDir, PathBuf)>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    id: u32,
    path: String,
    site: Option<String>,
    text: Option<String>,
    external: bool,
}

fn too_large() -> String {
    localized!(
        "查看和编辑支持最多 2 MiB 的文件",
        "View and Edit support files up to 2 MiB"
    )
}

fn conflict() -> String {
    localized!(
        "源文件已改变。请保留草稿并重新打开文件",
        "The source file changed. Keep your draft and reopen the file"
    )
}

fn decode(bytes: &[u8]) -> Result<String, String> {
    let content = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes);
    std::str::from_utf8(content)
        .ok()
        .filter(|text| !text.contains('\0'))
        .map(|text| text.replace("\r\n", "\n").replace('\r', "\n"))
        .ok_or_else(|| {
            localized!(
                "内置编辑器仅支持 UTF-8 文本，请配置外部应用",
                "The built-in editor requires UTF-8 text. Configure an external app for this file"
            )
        })
}

fn encode(text: &str, original: &[u8]) -> Result<Vec<u8>, String> {
    if text.len() > MAX_BYTES {
        return Err(too_large());
    }
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let crlf = original.windows(2).filter(|pair| *pair == b"\r\n").count();
    let lf = original.iter().filter(|&&byte| byte == b'\n').count();
    let cr = original.iter().filter(|&&byte| byte == b'\r').count();
    let content = if crlf > 0 && crlf == cr && crlf == lf {
        normalized.replace('\n', "\r\n")
    } else if cr > 0 && lf == 0 {
        normalized.replace('\n', "\r")
    } else {
        normalized
    };
    let mut bytes = Vec::new();
    if original.starts_with(b"\xef\xbb\xbf") {
        bytes.extend_from_slice(b"\xef\xbb\xbf");
    }
    bytes.extend_from_slice(content.as_bytes());
    if bytes.len() > MAX_BYTES {
        return Err(too_large());
    }
    Ok(bytes)
}

async fn read_local(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err(localized!("请选择普通文件", "Select a regular file"));
    }
    if metadata.len() > MAX_BYTES as u64 {
        return Err(too_large());
    }
    let mut bytes = Vec::new();
    tokio::fs::File::open(path)
        .await
        .map_err(|error| error.to_string())?
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|error| error.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err(too_large());
    }
    Ok(bytes)
}

async fn read_remote(session: &mut RemoteSession, path: &str) -> Result<Vec<u8>, String> {
    let (tx, mut rx) = tokio::sync::mpsc::channel(2);
    let (events, _) = std::sync::mpsc::channel();
    let collect = async {
        let mut bytes = Vec::new();
        while let Some(message) = rx.recv().await {
            match message {
                PipeMsg::Data(chunk) => {
                    if bytes.len() + chunk.len() > MAX_BYTES {
                        return Err(too_large());
                    }
                    bytes.extend_from_slice(&chunk);
                }
                PipeMsg::End => return Ok(bytes),
            }
        }
        // The protocol error is supplied by the producer.
        Ok(bytes)
    };
    let (_, bytes) = tokio::try_join!(session.read_chunks(path, 0, 0, tx, &events), collect)?;
    Ok(bytes)
}

async fn network<T>(operation: impl Future<Output = Result<T, String>>) -> Result<T, String> {
    tokio::time::timeout(NETWORK_TIMEOUT, operation)
        .await
        .map_err(|_| localized!("文件操作超时", "The file operation timed out"))?
}

use std::future::Future;

fn launch(program: &Path, file: &Path) -> Result<(), String> {
    if !program.is_absolute() {
        return Err(localized!(
            "请填写应用程序的绝对路径",
            "Enter an absolute application path"
        ));
    }
    #[cfg(target_os = "macos")]
    if program.extension().is_some_and(|ext| ext == "app") {
        let status = std::process::Command::new("/usr/bin/open")
            .arg("-a")
            .arg(program)
            .arg("--")
            .arg(file)
            .status()
            .map_err(|error| error.to_string())?;
        return if status.success() {
            Ok(())
        } else {
            Err(localized!(
                "无法打开关联应用",
                "Could not open the associated app"
            ))
        };
    }
    let mut child = std::process::Command::new(program)
        .arg(file)
        .spawn()
        .map_err(|error| error.to_string())?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

fn write_local(path: &Path, original: &[u8], bytes: &[u8]) -> Result<(), String> {
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or_else(conflict)?)
        .map_err(|error| error.to_string())?;
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > MAX_BYTES as u64
        || std::fs::read(path).map_err(|error| error.to_string())? != original
    {
        return Err(conflict());
    }
    temp.write_all(bytes)
        .and_then(|_| temp.as_file().set_permissions(metadata.permissions()))
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|error| error.to_string())?;
    temp.persist(path).map_err(|error| error.to_string())?;
    Ok(())
}

fn document(window: &WebviewWindow, id: u32) -> Result<Arc<AsyncMutex<Document>>, String> {
    crate::session(&crate::editor_window::owner(window)?)?
        .documents
        .lock()
        .map_err(|error| error.to_string())?
        .entries
        .get(&id)
        .cloned()
        .ok_or_else(|| localized!("文件已关闭", "The file is closed"))
}

#[tauri::command]
pub async fn file_edit_open(
    window: WebviewWindow,
    path: String,
    remote: bool,
    editable: bool,
    program: Option<String>,
    policy: Option<String>,
    site_key: Option<String>,
) -> Result<OpenedFile, String> {
    let owner = crate::editor_window::owner(&window)?;
    if let Some(program) = program.as_deref().filter(|_| !remote) {
        let local = tokio::fs::canonicalize(&path)
            .await
            .map_err(|error| error.to_string())?;
        if !local.is_file() {
            return Err(localized!("请选择普通文件", "Select a regular file"));
        }
        launch(Path::new(program), &local)?;
        return Ok(OpenedFile {
            id: 0,
            path,
            site: None,
            text: None,
            external: true,
        });
    }
    let (source, original, site) = if remote {
        if !path.starts_with('/') || path.contains(['\r', '\n', '\0']) {
            return Err(localized!("远程文件路径无效", "Invalid remote file path"));
        }
        let (site, proxy) = crate::current_site(&owner)?;
        if site_key.as_deref() != Some(crate::instance::site_key(&site).as_str()) {
            return Err(localized!(
                "站点已切换，请从文件列表重新打开",
                "The site changed. Reopen the file from the file list"
            ));
        }
        let original = network(async {
            let mut session = RemoteSession::open(&site, proxy.as_ref()).await?;
            read_remote(&mut session, &path).await
        })
        .await?;
        let name = site.name.clone();
        (
            Source::Remote {
                path: path.clone(),
                site: Box::new(site),
                proxy,
            },
            original,
            Some(name),
        )
    } else {
        let absolute = tokio::fs::canonicalize(&path)
            .await
            .map_err(|error| error.to_string())?;
        let original = read_local(&absolute).await?;
        (Source::Local(absolute), original, None)
    };

    let mut external = None;
    let text = if let Some(program) = program.as_deref() {
        let directory = tempfile::Builder::new()
            .prefix("rust-flash-ftp-")
            .tempdir()
            .map_err(|error| error.to_string())?;
        let name = path
            .rsplit('/')
            .next()
            .filter(|name| {
                Path::new(name)
                    .file_name()
                    .is_some_and(|file_name| file_name == *name)
            })
            .ok_or_else(conflict)?;
        let copy = directory.path().join(name);
        tokio::fs::write(&copy, &original)
            .await
            .map_err(|error| error.to_string())?;
        launch(Path::new(program), &copy)?;
        external = Some((directory, copy));
        None
    } else {
        Some(decode(&original)?)
    };
    let external_app = text.is_none();

    let handle = Arc::new(AsyncMutex::new(Document {
        source,
        original,
        revision: 0,
        editable,
        program,
        external,
    }));
    let window_session = crate::session(&owner)?;
    let id = {
        let mut documents = window_session
            .documents
            .lock()
            .map_err(|error| error.to_string())?;
        documents.next_id = documents.next_id.checked_add(1).ok_or_else(conflict)?;
        let id = documents.next_id;
        documents.entries.insert(id, handle.clone());
        id
    };
    if remote && external_app && editable {
        let mode = policy.unwrap_or_else(|| "prompt".into());
        tauri::async_runtime::spawn(watch_external(window, id, Arc::downgrade(&handle), mode));
    }
    Ok(OpenedFile {
        id,
        path,
        site,
        text,
        external: external_app,
    })
}

#[tauri::command]
pub async fn file_edit_modified(window: WebviewWindow, id: u32) -> Result<Option<String>, String> {
    let handle = document(&window, id)?;
    let doc = handle.lock().await;
    external_fingerprint(&doc).await
}

async fn external_fingerprint(doc: &Document) -> Result<Option<String>, String> {
    let Some((_, path)) = &doc.external else {
        return Ok(None);
    };
    let bytes = read_local(path).await?;
    Ok((bytes != doc.original).then(|| format!("{:x}", Sha256::digest(&bytes))))
}

#[derive(Default)]
struct StableChange {
    previous: Option<String>,
    reported: Option<String>,
}

impl StableChange {
    fn observe(&mut self, fingerprint: Option<String>) -> bool {
        let changed = self.previous == fingerprint && self.reported != fingerprint;
        self.previous = fingerprint;
        if changed {
            self.reported.clone_from(&self.previous);
        }
        changed
    }
}

async fn watch_external(
    window: WebviewWindow,
    id: u32,
    handle: Weak<AsyncMutex<Document>>,
    policy: String,
) {
    let target = EventTarget::webview_window(window.label());
    let mut stable = StableChange::default();
    let mut observed_revision = 0;
    let mut read_error = None;
    loop {
        tokio::time::sleep(EXTERNAL_EDIT_POLL).await;
        let Some(handle) = handle.upgrade() else {
            return;
        };
        let Ok(mut doc) = handle.try_lock() else {
            continue;
        };
        if observed_revision != doc.revision {
            observed_revision = doc.revision;
            stable = StableChange::default();
        }
        let fingerprint = match external_fingerprint(&doc).await {
            Ok(fingerprint) => {
                if read_error.take().is_some() {
                    let _ = window.emit_to(
                        target.clone(),
                        "file-editor-change",
                        serde_json::json!({"id": id, "watchError": null}),
                    );
                }
                fingerprint
            }
            Err(error) => {
                stable.previous = None;
                if read_error.as_ref() != Some(&error) {
                    let _ = window.emit_to(
                        target.clone(),
                        "file-editor-change",
                        serde_json::json!({"id": id, "watchError": &error}),
                    );
                    read_error = Some(error);
                }
                continue;
            }
        };
        if !stable.observe(fingerprint.clone()) {
            continue;
        }
        let prompt = policy == "prompt" && fingerprint.is_some();
        let automatic = policy == "upload" && fingerprint.is_some();
        let _ = window.emit_to(target.clone(), "file-editor-change",
            serde_json::json!({"id": id, "fingerprint": &fingerprint, "prompt": prompt, "busy": automatic, "watchError": null}));
        if prompt {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.request_user_attention(Some(tauri::UserAttentionType::Informational));
        }
        if automatic {
            let result = save_from_editor(&window, &mut doc, None, fingerprint.as_deref()).await;
            let change = match result {
                Ok(()) => {
                    serde_json::json!({"id": id, "fingerprint": null, "busy": false, "saved": true})
                }
                Err(error) => serde_json::json!({"id": id, "busy": false, "watchError": error}),
            };
            let _ = window.emit_to(target.clone(), "file-editor-change", change);
        }
    }
}

#[tauri::command]
pub async fn file_edit_save(
    window: WebviewWindow,
    id: u32,
    text: Option<String>,
    fingerprint: Option<String>,
) -> Result<(), String> {
    let handle = document(&window, id)?;
    let mut doc = handle.lock().await;
    save_from_editor(&window, &mut doc, text.as_deref(), fingerprint.as_deref()).await
}

async fn save_from_editor(
    window: &WebviewWindow,
    doc: &mut Document,
    text: Option<&str>,
    fingerprint: Option<&str>,
) -> Result<(), String> {
    let (directory, remote) = match &doc.source {
        Source::Local(path) => (
            path.parent().unwrap_or(path).to_string_lossy().into_owned(),
            None,
        ),
        Source::Remote { path, site, .. } => {
            let directory = path
                .rsplit_once('/')
                .and_then(|(dir, _)| (!dir.is_empty()).then_some(dir))
                .unwrap_or("/");
            (directory.into(), Some((site.name.clone(), path.clone())))
        }
    };
    let publish = |status: &str, error: Option<&str>| {
        if let Ok(owner) = crate::editor_window::owner(window) {
            let _ = owner.emit_to(
                EventTarget::webview_window(owner.label()),
                "file-editor-save",
                serde_json::json!({
                    "status": status, "error": error, "directory": &directory,
                    "remote": &remote,
                }),
            );
        }
    };
    if remote.is_some() {
        publish("started", None);
    }
    let result = save_document(doc, text, fingerprint).await;
    match &result {
        Ok(()) => publish("saved", None),
        Err(error) if remote.is_some() => publish("failed", Some(error)),
        Err(_) => {}
    }
    result
}

async fn save_document(
    doc: &mut Document,
    text: Option<&str>,
    fingerprint: Option<&str>,
) -> Result<(), String> {
    if !doc.editable {
        return Err(localized!(
            "文件以查看模式打开",
            "The file is open for viewing"
        ));
    }
    let bytes = match &doc.external {
        Some((_, path)) => {
            let bytes = read_local(path).await?;
            if fingerprint != Some(&format!("{:x}", Sha256::digest(&bytes))) {
                return Err(localized!(
                    "临时文件再次改变，请重新确认上传",
                    "The temporary file changed again. Confirm the new changes before uploading"
                ));
            }
            bytes
        }
        None => encode(text.ok_or_else(conflict)?, &doc.original)?,
    };
    if bytes == doc.original {
        return Ok(());
    }
    match &doc.source {
        Source::Local(path) => {
            let path = path.clone();
            let original = doc.original.clone();
            let content = bytes.clone();
            tokio::task::spawn_blocking(move || write_local(&path, &original, &content))
                .await
                .map_err(|error| error.to_string())??;
        }
        Source::Remote { path, site, proxy } => {
            overwrite_remote(site, proxy.as_ref(), path, &doc.original, &bytes).await?;
        }
    }
    doc.original = bytes;
    doc.revision = doc.revision.wrapping_add(1);
    Ok(())
}

async fn overwrite_remote(
    site: &Site,
    proxy: Option<&Proxy>,
    path: &str,
    original: &[u8],
    bytes: &[u8],
) -> Result<(), String> {
    network(async {
        let mut session = RemoteSession::open(site, proxy).await?;
        let current = read_remote(&mut session, path).await?;
        if current == bytes {
            return Ok(());
        }
        if current != original {
            return Err(conflict());
        }
        let (tx, rx) = tokio::sync::mpsc::channel(2);
        tx.try_send(PipeMsg::Data(bytes.to_vec()))
            .map_err(|error| error.to_string())?;
        tx.try_send(PipeMsg::End)
            .map_err(|error| error.to_string())?;
        session.write_chunks(path, rx).await
    })
    .await
}

#[tauri::command]
pub async fn file_edit_reopen(
    window: WebviewWindow,
    id: u32,
    redownload: bool,
) -> Result<Option<String>, String> {
    let handle = document(&window, id)?;
    let mut doc = handle.lock().await;
    if !redownload {
        if let (Some(program), Some((_, local))) = (&doc.program, &doc.external) {
            launch(Path::new(program), local)?;
        }
        return Ok(None);
    }

    let Source::Remote { path, site, proxy } = &doc.source else {
        return Err(localized!("请选择远程文件", "Select a remote file"));
    };
    let current = if let Some((_, local)) = &doc.external {
        Some(read_local(local).await?)
    } else {
        None
    };
    let bytes = network(async {
        let mut session = RemoteSession::open(site, proxy.as_ref()).await?;
        read_remote(&mut session, path).await
    })
    .await?;
    let value = if let (Some((_, local)), Some(current)) = (&doc.external, current) {
        let local = local.clone();
        let replacement = bytes.clone();
        tokio::task::spawn_blocking(move || write_local(&local, &current, &replacement))
            .await
            .map_err(|error| error.to_string())??;
        None
    } else {
        Some(decode(&bytes)?)
    };
    doc.original = bytes;
    doc.revision = doc.revision.wrapping_add(1);
    Ok(value)
}

#[tauri::command]
pub async fn file_edit_close(window: WebviewWindow, id: u32) -> Result<(), String> {
    let handle = document(&window, id)?;
    let _guard = handle.lock().await;
    crate::session(&crate::editor_window::owner(&window)?)?
        .documents
        .lock()
        .map_err(|error| error.to_string())?
        .entries
        .remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_round_trip_keeps_bom_and_crlf() {
        let original = b"\xef\xbb\xbfhello\r\nworld\r\n";
        assert_eq!(decode(original).unwrap(), "hello\nworld\n");
        assert_eq!(
            encode("edited\nworld\n", original).unwrap(),
            b"\xef\xbb\xbfedited\r\nworld\r\n"
        );
        assert!(decode(b"binary\0").is_err());
    }

    #[test]
    fn local_save_rejects_a_changed_source() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.txt");
        std::fs::write(&path, b"original").unwrap();
        write_local(&path, b"original", b"edited").unwrap();
        assert!(write_local(&path, b"original", b"stale edit").is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"edited");
    }

    #[tokio::test]
    async fn external_save_replacement_uploads_full_ftp_content_and_detects_conflicts() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        use tokio::net::TcpListener;

        for (baseline, expected) in [
            (b"old".as_slice(), Some(b"new longer text".as_slice())),
            (b"stale".as_slice(), None),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let fixture = tokio::spawn(async move {
                let (control, _) = listener.accept().await.unwrap();
                let mut control = BufReader::new(control);
                control
                    .get_mut()
                    .write_all(b"220 Fixture\r\n")
                    .await
                    .unwrap();
                let mut passive = None;
                let mut upload = None;
                loop {
                    let mut command = String::new();
                    if control.read_line(&mut command).await.unwrap() == 0 {
                        return upload;
                    }
                    let reply: String = match command.trim_end() {
                        "USER test" => "331 Password\r\n".into(),
                        "PASS secret" => "230 Logged in\r\n".into(),
                        "TYPE I" => "200 Binary\r\n".into(),
                        "PASV" => {
                            let data = TcpListener::bind("127.0.0.1:0").await.unwrap();
                            let port = data.local_addr().unwrap().port();
                            passive = Some(data);
                            format!("227 Passive (127,0,0,1,{},{})\r\n", port / 256, port % 256)
                        }
                        command @ ("RETR /edit.txt" | "STOR /edit.txt") => {
                            control.get_mut().write_all(b"150 Data\r\n").await.unwrap();
                            let (mut data, _) = passive.take().unwrap().accept().await.unwrap();
                            if command.starts_with("RETR") {
                                data.write_all(b"old").await.unwrap();
                            } else {
                                let mut bytes = Vec::new();
                                data.read_to_end(&mut bytes).await.unwrap();
                                upload = Some(bytes);
                            }
                            "226 Complete\r\n".into()
                        }
                        other => panic!("Unexpected command: {other}"),
                    };
                    control.get_mut().write_all(reply.as_bytes()).await.unwrap();
                }
            });
            let site: Site = serde_json::from_value(serde_json::json!({
                "id": 0, "name": "fixture", "host": "127.0.0.1", "port": port, "protocol": "ftp",
                "username": "test", "password": "secret", "encoding": "utf-8",
                "passiveMode": true, "tlsAcceptInvalid": false
            }))
            .unwrap();
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("edit.txt");
            std::fs::write(&path, baseline).unwrap();
            let mut doc = Document {
                source: Source::Remote {
                    path: "/edit.txt".into(),
                    site: Box::new(site),
                    proxy: None,
                },
                original: baseline.to_vec(),
                revision: 0,
                editable: true,
                program: None,
                external: Some((directory, path.clone())),
            };
            let mut replacement = tempfile::NamedTempFile::new_in(path.parent().unwrap()).unwrap();
            replacement.write_all(b"new longer text").unwrap();
            replacement.persist(&path).unwrap();

            let fingerprint = external_fingerprint(&doc).await.unwrap();
            let mut stable = StableChange::default();
            assert!(!stable.observe(fingerprint.clone()));
            assert!(stable.observe(fingerprint.clone()));
            assert!(!stable.observe(fingerprint.clone()));
            let result = save_document(&mut doc, None, fingerprint.as_deref()).await;
            assert_eq!(result.is_ok(), expected.is_some(), "{result:?}");
            let actual = tokio::time::timeout(Duration::from_secs(3), fixture)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(actual.as_deref(), expected);
        }
    }
}
