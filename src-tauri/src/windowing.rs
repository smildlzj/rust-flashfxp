//! 一个应用管理多个会话窗口，共用 Dock / 托盘和原生窗口菜单。
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewWindow};
static LAST_WINDOW: Mutex<Option<String>> = Mutex::new(None);
static SAVE_LOCK: Mutex<()> = Mutex::new(());
static NEXT_WINDOW: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

pub fn preferred(app: &AppHandle) -> Option<WebviewWindow> {
    let windows = app.webview_windows();
    let last = LAST_WINDOW.lock().ok().and_then(|v| v.clone());
    last.and_then(|label| windows.get(&label).cloned())
        .or_else(|| windows.get("main").cloned())
        .or_else(|| windows.values().next().cloned())
}

pub fn show(app: &AppHandle) {
    if let Some(window) = preferred(app) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn hide(app: &AppHandle) {
    if let Some(window) = preferred(app) { let _ = window.hide(); }
}

pub fn attach(window: &WebviewWindow) {
    let (tx, rx) = std::sync::mpsc::channel::<crate::WinRect>();
    let win = window.clone();
    let mut rect = crate::WinRect::default();
    let scale = win.scale_factor().unwrap_or(1.0);
    let pos: tauri::LogicalPosition<i32> = win.outer_position().unwrap_or_default().to_logical(scale);
    let size: tauri::LogicalSize<u32> = win.inner_size().unwrap_or_default().to_logical(scale);
    rect.x = pos.x; rect.y = pos.y; rect.w = size.width; rect.h = size.height;
    let label = window.label().to_string();
    let rect = Mutex::new(rect);
    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = win.hide();
                return;
            }
            tauri::WindowEvent::Focused(true) => {
                if let Ok(mut last) = LAST_WINDOW.lock() { *last = Some(label.clone()); }
                return;
            }
            _ => {}
        }
        if !matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_))
            || win.is_maximized().unwrap_or(false)
            || win.is_fullscreen().unwrap_or(false)
        {
            return;
        }
        if let Ok(mut rect) = rect.lock() {
            let scale = win.scale_factor().unwrap_or(1.0);
            match event {
                tauri::WindowEvent::Moved(p) => {
                    let p: tauri::LogicalPosition<i32> = p.to_logical(scale);
                    rect.x = p.x; rect.y = p.y;
                }
                tauri::WindowEvent::Resized(s) => {
                    // 最小化窗口的 0 尺寸不能覆盖有效布局。
                    if s.width == 0 || s.height == 0 { return; }
                    let s: tauri::LogicalSize<u32> = s.to_logical(scale);
                    rect.w = s.width; rect.h = s.height;
                }
                _ => return,
            }
            let _ = tx.send(*rect);
        }
    });
    let app = window.app_handle().clone();
    std::thread::spawn(move || {
        while let Ok(mut rect) = rx.recv() {
            while let Ok(next) = rx.recv_timeout(std::time::Duration::from_millis(500)) { rect = next; }
            if let Ok(_guard) = SAVE_LOCK.lock() { crate::save_win_state(&app, rect); }
        }
    });
}

pub fn create(app: &AppHandle) -> Result<(), String> {
    let number = NEXT_WINDOW.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let label = format!("session-{number}");
    // 在页面导航前注册后台：隐藏页面仍然会执行启动 invoke。
    crate::attach_session(app, &label)?;
    let built = tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
        .title("Rust Flash Ftp")
        .inner_size(1213.0, 731.0).min_inner_size(900.0, 600.0)
        .visible(false).build();
    let window = match built {
        Ok(window) => window,
        Err(error) => {
            if let Ok(mut sessions) = crate::session_state::SESSIONS.lock() { sessions.remove(&label); }
            return Err(error.to_string());
        }
    };
    attach(&window);
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

pub fn native_menu(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    let menu = match app.menu() { Some(menu) => menu, None => Menu::default(app)? };
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            if submenu.text()? == "File" {
                let new = MenuItem::with_id(app, "new-session", "New Window", true, Some("CmdOrCtrl+N"))?;
                submenu.insert(&new, 0)?;
                break;
            }
        }
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id().as_ref() == "new-session" {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = create(&app) { eprintln!("New window: {error}"); }
            });
        }
    });
    Ok(())
}
