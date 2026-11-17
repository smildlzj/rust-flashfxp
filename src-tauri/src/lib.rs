//! Tauri 后端：把核心库（协议/传输/存储）桥接为前端 command + event
use std::sync::mpsc as std_mpsc;
use std::sync::Mutex;
mod instance;
mod session_state;
mod windowing;
use std::sync::Arc;
use session_state::Session;
use tauri::{Manager, WebviewWindow};

fn session(window: &WebviewWindow) -> Result<Arc<Session>, String> {
    session_state::get(window.label())
}
fn current_site(window: &WebviewWindow) -> Result<(Site, Option<Proxy>), String> {
    session(window)?.current_site.lock().map_err(|e| e.to_string())?.clone()
        .ok_or_else(|| flashfxp_lib::localized!("未连接目标站点", "No destination site connected"))
}
fn owner(window: &WebviewWindow) -> Result<String, String> { Ok(session(window)?.lease.id.clone()) }

use flashfxp_lib::bus::{remote_join, Direction, TransferTask, UiCmd, UiEvent};
use flashfxp_lib::session::run_backend;
use flashfxp_lib::store::{Proxy, Site, SiteRepo};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::unbounded_channel;

// ---------------- 窗口状态持久化 ----------------

#[derive(Clone, Copy, serde::Serialize, serde::Deserialize, Default)]
struct WinRect {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
}

fn win_state_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    app.path().app_data_dir().ok().map(|d| d.join("window_state.json"))
}

fn save_win_state(app: &AppHandle, r: WinRect) {
    if let Some(p) = win_state_path(app) {
        let _ = std::fs::create_dir_all(p.parent().unwrap());
        let _ = instance::atomic_write(&p, serde_json::to_string(&r).unwrap_or_default().as_bytes());
    }
}

fn restore_win_state(app: &AppHandle) {
    use tauri::Manager;
    let Some(win) = app.get_webview_window("main") else { return };
    let Some(p) = win_state_path(app) else { return };
    let Ok(text) = std::fs::read_to_string(&p) else { return };
    let Ok(r) = serde_json::from_str::<WinRect>(&text) else { return };
    if r.w < 400 || r.h < 300 {
        return;
    }
    // 逻辑像素存取：避免 Retina(2x)/外接屏(1x) 混用时窗口大小减半
    let _ = win.set_size(tauri::LogicalSize::new(r.w as f64, r.h as f64));
    // 位置可能来自已拔掉的外接屏：超出当前屏幕范围则放弃恢复（保持默认位置）
    let f = win.scale_factor().unwrap_or(1.0);
    let on_screen = win.current_monitor().ok().flatten().map(|m| {
        let ms: tauri::LogicalSize<f64> = m.size().to_logical(f);
        let mp: tauri::LogicalPosition<f64> = m.position().to_logical(f);
        r.x >= mp.x as i32
            && r.y >= mp.y as i32
            && (r.x as f64) < mp.x + ms.width - 200.0
            && (r.y as f64) < mp.y + ms.height - 100.0
    });
    if on_screen.unwrap_or(true) {
        let _ = win.set_position(tauri::LogicalPosition::new(r.x as f64, r.y as f64));
    }
}

fn track_task(window: &WebviewWindow, id: u64, db_id: i64) -> Result<(), String> {
    session(window)?.tasks.lock().map_err(|e| e.to_string())?.insert(id, db_id);
    Ok(())
}

/// 取消传输任务（等待中的任务在开始前生效）
#[tauri::command]
fn transfer_cancel(window: WebviewWindow, id: u64) -> Result<bool, String> {
    let session = session(&window)?;
    let first = session.cancelled.lock().map_err(|e| e.to_string())?.insert(id);
    if first {
        let worker_id = session.ids.lock().map_err(|e| e.to_string())?.worker_id(id);
        flashfxp_lib::session::ftp::mark_cancelled(worker_id);
        if let Some(db_id) = session.tasks.lock().map_err(|e| e.to_string())?.get(&id).copied() {
            let repo = SiteRepo::open().map_err(|e| e.to_string())?;
            repo.queue_set_status_owned(&session.lease.id, db_id, "cancelled", None).map_err(|e| e.to_string())?;
        }
    }
    let restored_event = instance::restored_cancellation(id,
        &mut *session.restored.lock().map_err(|e| e.to_string())?,
        &mut *session.tasks.lock().map_err(|e| e.to_string())?);
    if let Some(event) = restored_event {
        session.cancelled.lock().map_err(|e| e.to_string())?.remove(&id);
        let worker = session.ids.lock().map_err(|e| e.to_string())?.worker_id(id);
        flashfxp_lib::session::ftp::take_cancelled(worker);
        session.ids.lock().map_err(|e| e.to_string())?.remove(id);
        window.emit_to(tauri::EventTarget::webview_window(window.label()), "fx-event", event).map_err(|e| e.to_string())?;
    }
    Ok(first)
}

fn send_cmd(window: &WebviewWindow, cmd: UiCmd) -> Result<(), String> {
    session(window)?.cmd_tx.send(cmd)
        .map_err(|e| flashfxp_lib::localized!("发送命令失败: {e}", "Failed to send command: {e}"))
}

fn attach_session(app: &AppHandle, label: &str) -> Result<(), String> {
    let lease_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("instances");
    let lease = instance::Instance::create(lease_dir).map_err(|e| e.to_string())?;
    let (cmd_tx, cmd_rx) = unbounded_channel::<UiCmd>();
    let (event_tx, event_rx) = std_mpsc::channel::<UiEvent>();
    let session = Arc::new(Session {
        lease, cmd_tx, current_site: Mutex::new(None), tasks: Mutex::new(Default::default()),
        restored: Mutex::new(Default::default()), cancelled: Mutex::new(Default::default()),
        ids: Mutex::new(Default::default()),
    });
    session_state::insert(label.to_string(), session.clone())?;
    tauri::async_runtime::spawn(run_backend(cmd_rx, event_tx));
    let target = app.clone();
    let label = label.to_string();
    let weak_session = Arc::downgrade(&session);
    std::thread::spawn(move || {
        while let Ok(event) = event_rx.recv() {
            let Some(session) = weak_session.upgrade() else { break };
            let event = match session.ids.lock() {
                Ok(ids) => session_state::local_event(event, &ids),
                Err(_) => None,
            };
            let Some(event) = event else { continue };
            let mut payload = serde_json::to_value(&event).expect("event serialization");
            if let UiEvent::TransferFinished { id, ok, error } = &event {
                let cancelled = session.cancelled.lock().map(|mut set| set.remove(id)).unwrap_or(false) && !ok;
                payload["TransferFinished"]["cancelled"] = serde_json::json!(cancelled);
                let db_id = session.tasks.lock().ok().and_then(|mut tasks| tasks.remove(id));
                if let Some(db_id) = db_id {
                    if let Ok(repo) = SiteRepo::open() {
                        let status = if cancelled { "cancelled" } else if *ok { "done" } else { "failed" };
                        let _ = repo.queue_set_status_owned(&session.lease.id, db_id, status, error.as_deref());
                    }
                }
                if let Ok(mut ids) = session.ids.lock() { ids.remove(*id); }
            }
            let _ = target.emit_to(tauri::EventTarget::webview_window(&label), "fx-event", &payload);
        }
    });
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            restore_win_state(app.handle());
            let main = app.get_webview_window("main").expect("主窗口缺失");
            attach_session(app.handle(), main.label())?;
            windowing::attach(&main);
            windowing::native_menu(app.handle())?;

            // 托盘：菜单栏常驻图标，关窗驻留，左键切换窗口显隐
            {
                use tauri::menu::{Menu, MenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

                let show = MenuItem::with_id(app, "tray-show", "显示主窗口", true, None::<&str>)?;
                let hide = MenuItem::with_id(app, "tray-hide", "隐藏主窗口", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "tray-quit", "退出 Rust Flash Ftp", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

                let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray_template.png"))?;
                TrayIconBuilder::with_id("main-tray")
                    .icon(icon)
                    .icon_as_template(true)
                    .tooltip("Rust Flash Ftp")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "tray-show" => windowing::show(app),
                        "tray-hide" => windowing::hide(app),
                        "tray-quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if windowing::preferred(app).is_some_and(|w| w.is_visible().unwrap_or(false)) {
                                windowing::hide(app);
                            } else { windowing::show(app); }
                        }
                    })
                    .build(app)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            new_session,
            set_language,
            set_window_title,
            quick_connect,
            connect_site,
            disconnect,
            local_list,
            remote_list,
            mkdir_local,
            mkdir_remote,
            delete_local,
            delete_remote,
            rename_local,
            rename_remote,
            enqueue_transfer,
            relay_transfer,
            restore_pending_queue,
            sites_list,
            site_save,
            site_delete,
            groups_list,
            group_add,
            proxies_list,
            proxy_save,
            proxy_delete,
            queue_clear_finished,
            home_dir,
            pick_folder,
            disk_info,
            tree_list,
            transfer_cancel,
            app_exit
        ])
        .build(tauri::generate_context!())
        .expect("Tauri 启动失败")
        .run(|_app, _event| {
            // macOS 点击 Dock 图标时，恢复关闭后隐藏的主窗口。
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                windowing::show(_app);
            }
        });
}

// ---------------- 连接 ----------------

#[tauri::command]
fn quick_connect(window: WebviewWindow, host: String, port: u16, user: String, pass: String) -> Result<(), String> {
    let site = Site {
        id: 0,
        group_id: None,
        name: format!("{host}:{port}"),
        host,
        port,
        protocol: "ftp".into(),
        username: Some(user),
        password: Some(pass),
        encoding: "auto".into(),
        passive_mode: true,
        login_cmds: None,
        proxy_id: None,
        tls_accept_invalid: false,
        local_path: None,
        remote_path: None,
        account: None,
        notes: String::new(),
        login_type: "normal".into(),
        timezone_offset_minutes: None,
    };
    *session(&window)?.current_site.lock().map_err(|e| e.to_string())? = Some((site.clone(), None));
    send_cmd(&window, UiCmd::Connect { site, proxy: None })
}

#[tauri::command]
fn connect_site(window: WebviewWindow, site_id: i64, username_override: Option<String>, password_override: Option<String>) -> Result<(), String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    let mut site = repo
        .list_sites()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|s| s.id == site_id)
        .ok_or_else(|| flashfxp_lib::localized!("站点不存在", "Site not found"))?;
    // 临时覆盖仅用于当前会话和队列 worker，绝不 upsert。
    if let Some(username) = username_override { site.username = Some(username); }
    if let Some(password) = password_override { site.password = Some(password); }
    let proxy = site
        .proxy_id
        .and_then(|pid| repo.list_proxies().ok().and_then(|ps| ps.into_iter().find(|p| p.id == pid)));
    *session(&window)?.current_site.lock().map_err(|e| e.to_string())? = Some((site.clone(), proxy.clone()));
    send_cmd(&window, UiCmd::Connect { site, proxy })
}

#[tauri::command]
fn disconnect(window: WebviewWindow) -> Result<(), String> {
    *session(&window)?.current_site.lock().map_err(|e| e.to_string())? = None;
    send_cmd(&window, UiCmd::Disconnect)
}

// ---------------- 浏览 / 文件操作 ----------------

#[tauri::command]
fn local_list(window: WebviewWindow, path: String) -> Result<(), String> {
    send_cmd(&window, UiCmd::LocalList { path: path.into() })
}

#[tauri::command]
fn remote_list(window: WebviewWindow, path: String) -> Result<(), String> {
    send_cmd(&window, UiCmd::RemoteList { path })
}

#[tauri::command]
fn mkdir_local(window: WebviewWindow, path: String) -> Result<(), String> {
    send_cmd(&window, UiCmd::LocalMkdir { path: path.into() })
}

#[tauri::command]
fn mkdir_remote(window: WebviewWindow, path: String) -> Result<(), String> {
    send_cmd(&window, UiCmd::RemoteMkdir { path })
}

#[tauri::command]
fn delete_local(window: WebviewWindow, paths: Vec<String>) -> Result<(), String> {
    send_cmd(&window, UiCmd::LocalDelete {
        paths: paths.into_iter().map(Into::into).collect(),
    })
}

#[tauri::command]
fn delete_remote(window: WebviewWindow, paths: Vec<String>) -> Result<(), String> {
    send_cmd(&window, UiCmd::RemoteDelete { paths })
}

#[tauri::command]
fn rename_local(window: WebviewWindow, from: String, to: String) -> Result<(), String> {
    send_cmd(&window, UiCmd::LocalRename {
        from: from.into(),
        to: to.into(),
    })
}

#[tauri::command]
fn rename_remote(window: WebviewWindow, from: String, to: String) -> Result<(), String> {
    send_cmd(&window, UiCmd::RemoteRename { from, to })
}

// ---------------- 传输 ----------------

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnqueueArgs {
    id: u64,
    direction: String,
    remote_path: String,
    local_path: String,
    is_dir: bool,
}

#[tauri::command]
fn enqueue_transfer(window: WebviewWindow, args: EnqueueArgs) -> Result<(), String> {
    let direction = match args.direction.as_str() {
        "download" => Direction::Download,
        _ => Direction::Upload,
    };
    let (site, _) = current_site(&window)?;
    let site_key = instance::site_key(&site);
    let owner = owner(&window)?;
    let session = session(&window)?;
    // 队列持久化
    let kind = match (direction, args.is_dir) {
        (Direction::Download, false) => "download",
        (Direction::Download, true) => "download_dir",
        (Direction::Upload, false) => "upload",
        (Direction::Upload, true) => "upload_dir",
        _ => "upload",
    };
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    let tracked = session.tasks.lock().map_err(|e| e.to_string())?.get(&args.id).copied();
    let db_id = if let Some(id) = tracked {
        if !repo.queue_owned_pending(&owner, id, &site_key).map_err(|e| e.to_string())? {
            return Err(flashfxp_lib::localized!("队列任务不属于当前站点或实例", "Queue task does not belong to the current site or instance"));
        }
        id
    } else {
        repo.queue_add_owned(&owner, &site_key, kind, &args.remote_path, &args.local_path, 0).map_err(|e| e.to_string())?
    };
    if !repo.queue_start_owned(&owner, db_id, &site_key).map_err(|e| e.to_string())? {
        return Err(flashfxp_lib::localized!("任务已提交或已取消", "Task has already been submitted or cancelled"));
    }
    session.restored.lock().map_err(|e| e.to_string())?.remove(&args.id);
    track_task(&window, args.id, db_id)?;
    let worker_id = session.ids.lock().map_err(|e| e.to_string())?.worker_id(args.id);
    send_cmd(&window, UiCmd::Enqueue {
        task: TransferTask {
            id: worker_id,
            direction,
            remote_path: args.remote_path,
            local_path: args.local_path.into(),
            is_dir: args.is_dir,
        },
    })
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelayArgs {
    id: u64,
    src_site_id: i64,
    src_path: String,
    dst_path: String,
}

#[tauri::command]
fn relay_transfer(window: WebviewWindow, args: RelayArgs) -> Result<(), String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    let src_site = repo
        .list_sites()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|s| s.id == args.src_site_id)
        .ok_or_else(|| flashfxp_lib::localized!("源站点不存在", "Source site not found"))?;
    let src_proxy = src_site.proxy_id.and_then(|pid| {
        repo.list_proxies()
            .ok()
            .and_then(|ps| ps.into_iter().find(|p| p.id == pid))
    });
    // 目标 = 当前连接站点（前端无法传，需要后端记忆最近连接站点）
    let (dst_site, dst_proxy) = current_site(&window)?;
    let dst_path = args.dst_path.trim_end_matches('/').to_string();
    let dst_path = if dst_path.is_empty() { "/".into() } else { dst_path };
    let _ = remote_join(&dst_path, ""); // 模块引用保活
    let worker_id = session(&window)?.ids.lock().map_err(|e| e.to_string())?.worker_id(args.id);
    send_cmd(&window, UiCmd::RelayEnqueue {
        task: flashfxp_lib::bus::RelayTask {
            id: worker_id,
            src_site,
            src_proxy,
            src_path: args.src_path,
            dst_site,
            dst_proxy,
            dst_path,
        },
    })
}

/// 恢复未完成任务（仅恢复到界面等待状态，不自动执行；由用户在队列面板点“恢复待传”手动重放）
#[tauri::command]
fn restore_pending_queue(window: WebviewWindow) -> Result<Vec<serde_json::Value>, String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    let (site, _) = current_site(&window)?;
    let key = instance::site_key(&site);
    let session = session(&window)?;
    let instance = &session.lease;
    let mut pending = Vec::new();
    for previous in repo.queue_owners(&key).map_err(|e| e.to_string())? {
        if let Some(_lease) = instance.lock_inactive(&previous).map_err(|e| e.to_string())? {
            pending.extend(repo.queue_claim(&instance.id, &previous, &key).map_err(|e| e.to_string())?);
        }
    }
    let mut out = Vec::new();
    static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1u64 << 32);
    let counter = &NEXT_ID;
    for task in pending {
        let db_id = task.id;
        let (direction, is_dir) = match task.kind.as_str() {
            "download" => (Direction::Download, false),
            "download_dir" => (Direction::Download, true),
            "upload" => (Direction::Upload, false),
            _ => (Direction::Upload, true),
        };
        let remote = task.remote;
        let local = task.local;
        let id = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        track_task(&window, id, db_id)?;
        session.restored.lock().map_err(|e| e.to_string())?.insert(id);
        out.push(serde_json::json!({
            "id": id,
            "dbId": db_id,
            "direction": if direction == Direction::Download { "download" } else { "upload" },
            "remote": remote,
            "local": local,
            "isDir": is_dir,
        }));
    }
    Ok(out)
}

#[tauri::command]
fn queue_clear_finished(window: WebviewWindow) -> Result<(), String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    repo.queue_clear_finished_owned(&owner(&window)?).map_err(|e| e.to_string())
}

// ---------------- 站点 / 分组 / 代理 CRUD ----------------

#[tauri::command]
fn sites_list() -> Result<Vec<Site>, String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    repo.list_sites().map_err(|e| e.to_string())
}

#[tauri::command]
fn site_save(site: Site) -> Result<i64, String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    repo.upsert_site(&site).map_err(|e| e.to_string())
}

#[tauri::command]
fn site_delete(site_id: i64) -> Result<(), String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    repo.delete_site(site_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn groups_list() -> Result<Vec<flashfxp_lib::store::Group>, String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    repo.list_groups().map_err(|e| e.to_string())
}

#[tauri::command]
fn group_add(name: String) -> Result<(), String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    repo.add_group(None, &name).map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn proxies_list() -> Result<Vec<Proxy>, String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    repo.list_proxies().map_err(|e| e.to_string())
}

#[tauri::command]
fn proxy_save(proxy: Proxy) -> Result<i64, String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    repo.upsert_proxy(&proxy).map_err(|e| e.to_string())
}

#[tauri::command]
fn proxy_delete(proxy_id: i64) -> Result<(), String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    repo.delete_proxy(proxy_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn disk_info(path: String) -> Result<(u64, u64), String> {
    use fs2::available_space;
    let p = std::path::Path::new(&path);
    let free = available_space(p).map_err(|e| e.to_string())?;
    let total = fs2::total_space(p).map_err(|e| e.to_string())?;
    Ok((free, total))
}

/// 目录树：列出指定目录的子目录（供左侧树懒加载）
#[tauri::command]
fn tree_list(path: String) -> Result<Vec<serde_json::Value>, String> {
    let mut out = Vec::new();
    let rd = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    for entry in rd.flatten() {
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if !is_dir {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let hidden = name.starts_with('.');
        out.push(serde_json::json!({
            "name": name,
            "path": format!("{}/{}", path.trim_end_matches('/'), name),
            "hidden": hidden,
        }));
    }
    out.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(out)
}

#[tauri::command]
fn home_dir() -> String {
    std::env::home_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "/".into())
}

/// 系统目录选择对话框：供站点「本地路径」浏览按钮使用。返回 None 表示用户取消。
#[tauri::command]
fn pick_folder() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|p| p.to_string_lossy().into_owned())
}

/// 菜单「会话 > 退出(X)」：与 macOS 原生关闭按钮等价，正常结束应用进程
#[tauri::command]
fn app_exit() {
    std::process::exit(0);
}

/// F12 / Cmd+N：同一应用进程内创建独立会话窗口。
#[tauri::command]
async fn new_session(app: AppHandle) -> Result<(), String> { windowing::create(&app) }

#[tauri::command]
fn set_language(app: AppHandle, language: String) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem};
    flashfxp_lib::i18n::set_language(&language);
    app.emit("language-changed", &language).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id("main-tray") {
        let show = MenuItem::with_id(&app, "tray-show", flashfxp_lib::localized!("显示主窗口", "Show main window"), true, None::<&str>).map_err(|e| e.to_string())?;
        let hide = MenuItem::with_id(&app, "tray-hide", flashfxp_lib::localized!("隐藏主窗口", "Hide main window"), true, None::<&str>).map_err(|e| e.to_string())?;
        let quit = MenuItem::with_id(&app, "tray-quit", flashfxp_lib::localized!("退出 Rust Flash Ftp", "Quit Rust Flash Ftp"), true, None::<&str>).map_err(|e| e.to_string())?;
        let menu = Menu::with_items(&app, &[&show, &hide, &quit]).map_err(|e| e.to_string())?;
        tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 使用调用窗口的原生标题，供 Dock / Window 菜单显示当前连接站点。
#[tauri::command]
fn set_window_title(window: WebviewWindow, title: String) -> Result<(), String> {
    window.set_title(&title).map_err(|e| e.to_string())
}
