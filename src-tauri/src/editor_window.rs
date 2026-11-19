//! Active Edits runs in a separate WebView and borrows the owning FTP session.
use serde_json::Value;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const PREFIX: &str = "file-edits-";
static WINDOW_CREATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub fn label(owner: &str) -> String {
    format!("{PREFIX}{owner}")
}

pub fn owner(window: &WebviewWindow) -> Result<WebviewWindow, String> {
    match window.label().strip_prefix(PREFIX) {
        Some(label) => window
            .app_handle()
            .get_webview_window(label)
            .ok_or_else(|| "File editor session is unavailable".into()),
        None => Ok(window.clone()),
    }
}

#[tauri::command]
pub async fn show_file_editor(
    window: WebviewWindow,
    mut request: Option<Value>,
) -> Result<(), String> {
    if let Some(payload) = request.as_mut() {
        if payload["remote"] == true {
            let (site, _) = crate::current_site(&window)?;
            payload["siteKey"] = Value::String(crate::instance::site_key(&site));
        } else if payload["action"] == "manage" {
            payload["siteKey"] = crate::current_site(&window)
                .ok()
                .map_or(Value::Null, |(site, _)| {
                    Value::String(crate::instance::site_key(&site))
                });
        }
    }
    let session = crate::session(&window)?;
    let label = label(window.label());
    let app = window.app_handle();
    let _guard = WINDOW_CREATION.lock().await;
    let editor = match app.get_webview_window(&label) {
        Some(editor) => editor,
        None => {
            let editor =
                WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
                    .title(flashfxp_lib::localized!("活动编辑", "Active Edits"))
                    .inner_size(660.0, 440.0)
                    .min_inner_size(440.0, 290.0)
                    .visible(false)
                    .build()
                    .map_err(|error| error.to_string())?;
            let handle = editor.clone();
            editor.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = handle.hide();
                }
            });
            editor
        }
    };
    let show = request
        .as_ref()
        .is_none_or(|payload| payload["show"] != false);
    if let Some(request) = request {
        session
            .editor_requests
            .lock()
            .map_err(|error| error.to_string())?
            .push(request);
        // A newly created WebView also drains this queue on startup.
        editor
            .emit_to(
                tauri::EventTarget::webview_window(&label),
                "file-editor-request",
                (),
            )
            .map_err(|error| error.to_string())?;
    }
    if show {
        focus_file_editor(editor)?;
    }
    Ok(())
}

#[tauri::command]
pub fn focus_file_editor(editor: WebviewWindow) -> Result<(), String> {
    editor
        .show()
        .and_then(|_| editor.unminimize())
        .and_then(|_| editor.set_focus())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn take_file_editor_requests(window: WebviewWindow) -> Result<Vec<Value>, String> {
    let session = crate::session(&owner(&window)?)?;
    let mut requests = session
        .editor_requests
        .lock()
        .map_err(|error| error.to_string())?;
    Ok(std::mem::take(&mut *requests))
}
