//! Tauri 后端：把核心库（协议/传输/存储）桥接为前端 command + event
use std::sync::mpsc as std_mpsc;
use std::sync::OnceLock;

use flashfxp_lib::bus::{remote_join, Direction, TransferTask, UiCmd, UiEvent};
use flashfxp_lib::session::run_backend;
use flashfxp_lib::store::{Proxy, Site, SiteRepo};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

static CMD_TX: OnceLock<UnboundedSender<UiCmd>> = OnceLock::new();
static LAST_SITE: OnceLock<(Site, Option<Proxy>)> = OnceLock::new();

fn send_cmd(cmd: UiCmd) -> Result<(), String> {
    CMD_TX
        .get()
        .ok_or_else(|| "后端未就绪".to_string())?
        .send(cmd)
        .map_err(|e| format!("发送命令失败: {e}"))
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let (cmd_tx, cmd_rx) = unbounded_channel::<UiCmd>();
            let (event_tx, event_rx) = std_mpsc::channel::<UiEvent>();
            CMD_TX.set(cmd_tx).expect("重复初始化");

            // 核心后台（与 egui 版共用 run_backend）
            std::thread::Builder::new()
                .name("backend".into())
                .spawn(move || {
                    let rt = tokio::runtime::Builder::new_multi_thread()
                        .enable_all()
                        .build()
                        .expect("创建 tokio 运行时失败");
                    rt.block_on(run_backend(cmd_rx, event_tx));
                })
                .expect("启动后台线程失败");

            // 事件转发到前端
            let handle: AppHandle = app.handle().clone();
            std::thread::Builder::new()
                .name("event-bridge".into())
                .spawn(move || {
                    while let Ok(ev) = event_rx.recv() {
                        let _ = handle.emit("fx-event", &ev);
                    }
                })
                .expect("启动事件桥接失败");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            home_dir
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 启动失败");
}

// ---------------- 连接 ----------------

#[tauri::command]
fn quick_connect(host: String, port: u16, user: String, pass: String) -> Result<(), String> {
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
    };
    let _ = LAST_SITE.set((site.clone(), None));
    send_cmd(UiCmd::Connect { site, proxy: None })
}

#[tauri::command]
fn connect_site(site_id: i64) -> Result<(), String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    let site = repo
        .list_sites()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|s| s.id == site_id)
        .ok_or_else(|| "站点不存在".to_string())?;
    let proxy = site
        .proxy_id
        .and_then(|pid| repo.list_proxies().ok().and_then(|ps| ps.into_iter().find(|p| p.id == pid)));
    let _ = LAST_SITE.set((site.clone(), proxy.clone()));
    send_cmd(UiCmd::Connect { site, proxy })
}

#[tauri::command]
fn disconnect() -> Result<(), String> {
    send_cmd(UiCmd::Disconnect)
}

// ---------------- 浏览 / 文件操作 ----------------

#[tauri::command]
fn local_list(path: String) -> Result<(), String> {
    send_cmd(UiCmd::LocalList { path: path.into() })
}

#[tauri::command]
fn remote_list(path: String) -> Result<(), String> {
    send_cmd(UiCmd::RemoteList { path })
}

#[tauri::command]
fn mkdir_local(path: String) -> Result<(), String> {
    send_cmd(UiCmd::LocalMkdir { path: path.into() })
}

#[tauri::command]
fn mkdir_remote(path: String) -> Result<(), String> {
    send_cmd(UiCmd::RemoteMkdir { path })
}

#[tauri::command]
fn delete_local(paths: Vec<String>) -> Result<(), String> {
    send_cmd(UiCmd::LocalDelete {
        paths: paths.into_iter().map(Into::into).collect(),
    })
}

#[tauri::command]
fn delete_remote(paths: Vec<String>) -> Result<(), String> {
    send_cmd(UiCmd::RemoteDelete { paths })
}

#[tauri::command]
fn rename_local(from: String, to: String) -> Result<(), String> {
    send_cmd(UiCmd::LocalRename {
        from: from.into(),
        to: to.into(),
    })
}

#[tauri::command]
fn rename_remote(from: String, to: String) -> Result<(), String> {
    send_cmd(UiCmd::RemoteRename { from, to })
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
fn enqueue_transfer(args: EnqueueArgs) -> Result<(), String> {
    let direction = match args.direction.as_str() {
        "download" => Direction::Download,
        _ => Direction::Upload,
    };
    // 队列持久化
    let kind = match (direction, args.is_dir) {
        (Direction::Download, false) => "download",
        (Direction::Download, true) => "download_dir",
        (Direction::Upload, false) => "upload",
        (Direction::Upload, true) => "upload_dir",
        _ => "upload",
    };
    if let Ok(repo) = SiteRepo::open() {
        let _ = repo.queue_add(kind, &args.remote_path, &args.local_path, 0);
    }
    send_cmd(UiCmd::Enqueue {
        task: TransferTask {
            id: args.id,
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
fn relay_transfer(args: RelayArgs) -> Result<(), String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    let src_site = repo
        .list_sites()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|s| s.id == args.src_site_id)
        .ok_or_else(|| "源站点不存在".to_string())?;
    let src_proxy = src_site.proxy_id.and_then(|pid| {
        repo.list_proxies()
            .ok()
            .and_then(|ps| ps.into_iter().find(|p| p.id == pid))
    });
    // 目标 = 当前连接站点（前端无法传，需要后端记忆最近连接站点）
    let dst = LAST_SITE
        .get()
        .ok_or_else(|| "未连接目标站点".to_string())?;
    let dst_site = dst.0.clone();
    let dst_proxy = dst.1.clone();
    let dst_path = args.dst_path.trim_end_matches('/').to_string();
    let dst_path = if dst_path.is_empty() { "/".into() } else { dst_path };
    let _ = remote_join(&dst_path, ""); // 模块引用保活
    send_cmd(UiCmd::RelayEnqueue {
        task: flashfxp_lib::bus::RelayTask {
            id: args.id,
            src_site,
            src_proxy,
            src_path: args.src_path,
            dst_site,
            dst_proxy,
            dst_path,
        },
    })
}

/// 重新入队未完成任务（连接成功后前端调用）
#[tauri::command]
fn restore_pending_queue() -> Result<Vec<serde_json::Value>, String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    let pending = repo.queue_pending().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    static NEXT_ID: OnceLock<std::sync::atomic::AtomicU64> = OnceLock::new();
    let counter = NEXT_ID.get_or_init(|| std::sync::atomic::AtomicU64::new(1));
    for (db_id, kind, src, dst) in pending {
        let (direction, is_dir, remote, local) = match kind.as_str() {
            "download" => (Direction::Download, false, src, dst),
            "download_dir" => (Direction::Download, true, src, dst),
            "upload" => (Direction::Upload, false, dst, src),
            _ => (Direction::Upload, true, dst, src),
        };
        let id = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let _ = send_cmd(UiCmd::Enqueue {
            task: TransferTask {
                id,
                direction,
                remote_path: remote.clone(),
                local_path: local.clone().into(),
                is_dir,
            },
        });
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
fn queue_clear_finished() -> Result<(), String> {
    let repo = SiteRepo::open().map_err(|e| e.to_string())?;
    repo.queue_clear_finished().map_err(|e| e.to_string())
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
fn home_dir() -> String {
    std::env::home_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "/".into())
}
