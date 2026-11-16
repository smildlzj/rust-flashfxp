use std::path::PathBuf;
use std::sync::mpsc;
use tokio::sync::mpsc::UnboundedSender;

use flashfxp_lib::bus::{remote_join, Direction, Entry, TransferTask, UiCmd, UiEvent};
use flashfxp_lib::session::ftp::run_backend;
use flashfxp_lib::store::{Group, Proxy, Site, SiteRepo};

mod classic;
mod ui_impl;

pub struct App {
    cmd_tx: UnboundedSender<UiCmd>,
    event_rx: mpsc::Receiver<UiEvent>,
    repo: SiteRepo,
    sites: Vec<Site>,
    groups: Vec<Group>,
    connected: bool,

    local_dir: PathBuf,
    local_entries: Vec<Entry>,
    local_sel: Option<usize>,
    remote_dir: Option<String>,
    remote_entries: Vec<Entry>,
    remote_sel: Option<usize>,

    qc_host: String,
    qc_port: String,
    qc_user: String,
    qc_pass: String,
    local_path_buf: String,
    remote_path_buf: String,

    show_site_manager: bool,
    show_proxy_manager: bool,
    site_manager_tab: u8, // 0=常规 1=高级
    expanded_groups: std::collections::HashSet<i64>,
    edit_site: Option<Site>,
    new_group_name: String,
    proxies: Vec<Proxy>,
    edit_proxy: Option<Proxy>,

    current_site: Option<Site>,
    current_proxy: Option<Proxy>,
    show_relay: bool,
    relay_site_id: Option<i64>,
    relay_path: String,

    sync_browse: bool,
    local_marks: std::collections::HashMap<String, CompareMark>,
    remote_marks: std::collections::HashMap<String, CompareMark>,

    show_queue: bool,
    bottom_tab: BottomTab,
    log: Vec<String>,
    sort_local: SortState,
    sort_remote: SortState,
    show_about: bool,
    queue: Vec<QueueItemUi>,
    next_task_id: u64,
    toasts: Vec<Toast>,
    dialog: Option<Dialog>,
    dialog_text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BottomTab {
    Queue,
    Log,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SortKey {
    Name,
    Size,
    Mtime,
}

#[derive(Debug, Clone, Copy)]
pub struct SortState {
    pub key: SortKey,
    pub desc: bool,
}

impl Default for SortState {
    fn default() -> Self {
        Self { key: SortKey::Name, desc: false }
    }
}

impl SortState {
    pub fn toggle(&mut self, key: SortKey) {
        if self.key == key {
            self.desc = !self.desc;
        } else {
            self.key = key;
            self.desc = false;
        }
    }

    pub fn sorted(&self, entries: &[Entry]) -> Vec<Entry> {
        let mut v = entries.to_vec();
        let dir = |e: &Entry| if e.is_dir { 0 } else { 1 };
        match self.key {
            SortKey::Name => v.sort_by(|a, b| {
                dir(a).cmp(&dir(b)).then(a.name.cmp(&b.name))
            }),
            SortKey::Size => v.sort_by(|a, b| {
                dir(a).cmp(&dir(b)).then(a.size.cmp(&b.size))
            }),
            SortKey::Mtime => v.sort_by(|a, b| {
                dir(a).cmp(&dir(b)).then(a.mtime.cmp(&b.mtime))
            }),
        }
        if self.desc {
            v.reverse();
        }
        v
    }
}

#[derive(Clone)]
enum Dialog {
    MkdirLocal,
    MkdirRemote,
    RenameLocal(usize),
    RenameRemote(usize),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CompareMark {
    OnlyLocal,
    OnlyRemote,
    SizeDiff,
    Same,
}

#[derive(Clone)]
struct Toast {
    text: String,
    err: bool,
    until: f64,
}

struct QueueItemUi {
    id: u64,
    db_id: Option<i64>,
    direction: Direction,
    remote: String,
    local: String,
    size: u64,
    transferred: u64,
    status: QueueStatus,
}

#[derive(Clone, PartialEq)]
enum QueueStatus {
    Waiting,
    Active,
    Done,
    Failed(String),
}

impl App {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        setup_fonts(&cc.egui_ctx);
        setup_style(&cc.egui_ctx);

        let (cmd_tx, cmd_rx) = tokio::sync::mpsc::unbounded_channel::<UiCmd>();
        let (event_tx, event_rx) = mpsc::channel::<UiEvent>();

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

        let repo = SiteRepo::open().expect("打开站点数据库失败");
        let sites = repo.list_sites().unwrap_or_default();
        let groups = repo.list_groups().unwrap_or_default();
        let proxies = repo.list_proxies().unwrap_or_default();

        let app = Self {
            cmd_tx,
            event_rx,
            repo,
            sites,
            groups,
            connected: false,
            local_dir: std::env::home_dir().unwrap_or_else(|| PathBuf::from("/")),
            local_entries: Vec::new(),
            local_sel: None,
            remote_dir: None,
            remote_entries: Vec::new(),
            remote_sel: None,
            qc_host: String::new(),
            qc_port: "21".into(),
            qc_user: String::new(),
            qc_pass: String::new(),
            local_path_buf: std::env::home_dir()
                .unwrap_or_default()
                .display()
                .to_string(),
            remote_path_buf: String::new(),
            show_site_manager: false,
            show_proxy_manager: false,
            site_manager_tab: 0,
            expanded_groups: std::collections::HashSet::new(),
            edit_site: None,
            new_group_name: String::new(),
            proxies,
            edit_proxy: None,
            current_site: None,
            current_proxy: None,
            show_relay: false,
            relay_site_id: None,
            relay_path: "/".into(),

            sync_browse: false,
            local_marks: std::collections::HashMap::new(),
            remote_marks: std::collections::HashMap::new(),
            show_queue: false,
            bottom_tab: BottomTab::Queue,
            log: Vec::new(),
            sort_local: SortState::default(),
            sort_remote: SortState::default(),
            show_about: false,
            queue: Vec::new(),
            next_task_id: 1,
            toasts: Vec::new(),
            dialog: None,
            dialog_text: String::new(),
        };
        app.send(UiCmd::LocalList { path: app.local_dir.clone() });

        // 测试钩子：FLASHFXP_TEST_SERVER=host:port:user:pass 自动连接（用于无 UI 自动化验证）
        if let Ok(spec) = std::env::var("FLASHFXP_TEST_SERVER") {
            let parts: Vec<&str> = spec.split(':').collect();
            if parts.len() >= 4 {
                let site = Site {
                    id: 0,
                    group_id: None,
                    name: "测试连接".into(),
                    host: parts[0].into(),
                    port: parts[1].parse().unwrap_or(21),
                    protocol: parts.get(4).unwrap_or(&"ftp").to_string(),
                    username: Some(parts[2].into()),
                    password: Some(parts[3].into()),
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
                app.send(UiCmd::Connect { site, proxy: None });
            }
        }
        app
    }

    fn send(&self, cmd: UiCmd) {
        let _ = self.cmd_tx.send(cmd);
    }

    fn refresh_local(&self) {
        self.send(UiCmd::LocalList { path: self.local_dir.clone() });
    }

    fn refresh_remote(&self) {
        if let Some(dir) = &self.remote_dir {
            self.send(UiCmd::RemoteList { path: dir.clone() });
        }
    }

    fn drain_events(&mut self, now: f64) {
        while let Ok(ev) = self.event_rx.try_recv() {
            match ev {
                UiEvent::Connected => {
                    self.connected = true;
                    self.push_toast("已连接", false);
                    self.log("已连接站点");
                    self.restore_pending();
                }
                UiEvent::Disconnected => {
                    self.connected = false;
                    self.current_site = None;
                    self.current_proxy = None;
                    self.remote_dir = None;
                    self.remote_entries.clear();
                    self.remote_sel = None;
                    self.push_toast("已断开", false);
                }
                UiEvent::LocalList { path, entries } => {
                    self.local_dir = path.clone();
                    self.local_path_buf = path.display().to_string();
                    self.local_entries = self.sort_local.sorted(&entries);
                    self.local_sel = None;
                    self.local_marks.clear();
                }
                UiEvent::RemoteList { path, entries } => {
                    self.log(&format!("列表完成: {} ({} 项)", path, entries.len()));
                    self.remote_path_buf = path.clone();
                    self.remote_dir = Some(path);
                    self.remote_entries = self.sort_remote.sorted(&entries);
                    self.remote_sel = None;
                    self.remote_marks.clear();
                }
                UiEvent::Notify { level, text } => {
                    self.push_toast(&text, level == flashfxp_lib::bus::Level::Error);
                }
                UiEvent::TransferStarted { id, size } => {
                    if let Some(q) = self.queue.iter().find(|q| q.id == id) {
                        let arrow = match q.direction {
                            Direction::Download => "下载",
                            Direction::Upload => "上传",
                            Direction::Relay => "互传",
                        };
                        self.log(&format!("开始{}: {} ({} 字节)", arrow, q.remote, size));
                    }
                    if let Some(q) = self.queue.iter_mut().find(|q| q.id == id) {
                        q.size = size;
                        q.status = QueueStatus::Active;
                    }
                }
                UiEvent::TransferProgress { id, transferred } => {
                    if let Some(q) = self.queue.iter_mut().find(|q| q.id == id) {
                        q.transferred = transferred;
                    }
                }
                UiEvent::TransferFinished { id, ok, error } => {
                    let need_refresh;
                    if let Some(q) = self.queue.iter_mut().find(|q| q.id == id) {
                        q.status = if ok {
                            QueueStatus::Done
                        } else {
                            QueueStatus::Failed(error.clone().unwrap_or_default())
                        };
                        if q.status == QueueStatus::Done {
                            if let Some(db_id) = q.db_id {
                                let _ = self.repo.queue_finish(db_id);
                            }
                        } else if let Some(db_id) = q.db_id {
                            let _ = self.repo.queue_fail(
                                db_id,
                                error.as_deref().unwrap_or("未知错误"),
                            );
                        }
                        need_refresh = Some(q.direction);
                    } else {
                        need_refresh = None;
                    }
                    if ok {
                        if need_refresh == Some(Direction::Download) {
                            self.refresh_local();
                        } else if need_refresh == Some(Direction::Upload)
                            || need_refresh == Some(Direction::Relay)
                        {
                            self.refresh_remote();
                        }
                        self.push_toast("传输完成", false);
                        if let Some(q) = self.queue.iter().find(|q| q.id == id) {
                            self.log(&format!("传输完成: {}", q.remote));
                        }
                    } else if let Some(e) = error {
                        self.push_toast(&e, true);
                        self.log(&format!("传输失败: {e}"));
                    }
                }
            }
        }
        self.toasts.retain(|t| t.until > now);
    }

    pub fn log(&mut self, text: &str) {
        use std::fmt::Write as _;
        let now = chrono::Local::now();
        let mut line = String::new();
        let _ = write!(line, "[{}] {}", now.format("%H:%M:%S"), text);
        self.log.push(line);
        if self.log.len() > 500 {
            self.log.drain(0..self.log.len() - 500);
        }
    }

    fn push_toast(&mut self, text: &str, err: bool) {
        self.toasts.push(Toast {
            text: text.to_string(),
            err,
            until: 0.0, // 由 update() 设定
        });
    }

    fn enqueue(&mut self, direction: Direction, name: &str, is_dir: bool) {
        let id = self.next_task_id;
        self.next_task_id += 1;
        let remote = remote_join(self.remote_dir.as_deref().unwrap_or("/"), name);
        let local = self.local_dir.join(name);
        let kind = match (direction, is_dir) {
            (Direction::Download, false) => "download",
            (Direction::Download, true) => "download_dir",
            (Direction::Upload, false) => "upload",
            (Direction::Upload, true) => "upload_dir",
            (Direction::Relay, _) => "relay",
        };
        let db_id = self
            .repo
            .queue_add(kind, &remote, &local.display().to_string(), 0)
            .ok();
        self.queue.push(QueueItemUi {
            id,
            db_id,
            direction,
            remote: remote.clone(),
            local: local.display().to_string(),
            size: 0,
            transferred: 0,
            status: QueueStatus::Waiting,
        });
        self.show_queue = true;
        self.send(UiCmd::Enqueue {
            task: TransferTask {
                id,
                direction,
                remote_path: remote,
                local_path: local,
                is_dir,
            },
        });
    }

    /// 崩溃/重启恢复：连接成功后重新入队未完成任务
    fn restore_pending(&mut self) {
        if let Ok(pending) = self.repo.queue_pending() {
            for (db_id, kind, src, dst) in pending {
                let (direction, is_dir) = match kind.as_str() {
                    "download" => (Direction::Download, false),
                    "download_dir" => (Direction::Download, true),
                    "upload" => (Direction::Upload, false),
                    "upload_dir" | _ => (Direction::Upload, true),
                };
                let id = self.next_task_id;
                self.next_task_id += 1;
                let (remote, local) = if direction == Direction::Download {
                    (src.clone(), PathBuf::from(&dst))
                } else {
                    (dst.clone(), PathBuf::from(&src))
                };
                self.queue.push(QueueItemUi {
                    id,
                    db_id: Some(db_id),
                    direction,
                    remote: remote.clone(),
                    local: local.display().to_string(),
                    size: 0,
                    transferred: 0,
                    status: QueueStatus::Waiting,
                });
                self.send(UiCmd::Enqueue {
                    task: TransferTask {
                        id,
                        direction,
                        remote_path: remote,
                        local_path: local,
                        is_dir,
                    },
                });
            }
            if !self.queue.is_empty() {
                self.show_queue = true;
            }
        }
    }

    fn enqueue_relay(&mut self, src_site: Site, src_proxy: Option<Proxy>, src_path: &str) {
        let (Some(dst_site), Some(dst_dir)) = (&self.current_site, self.remote_dir.clone()) else {
            self.push_toast("未连接目标站点", true);
            return;
        };
        let id = self.next_task_id;
        self.next_task_id += 1;
        let dst_path = remote_join(&dst_dir, "");
        let dst_path = dst_path.trim_end_matches('/').to_string();
        let dst_path = if dst_path.is_empty() { "/".into() } else { dst_path };
        self.queue.push(QueueItemUi {
            id,
            db_id: None,
            direction: Direction::Relay,
            remote: format!("{}:{} → {}", src_site.host, src_path, dst_path),
            local: String::new(),
            size: 0,
            transferred: 0,
            status: QueueStatus::Waiting,
        });
        self.show_queue = true;
        self.send(UiCmd::RelayEnqueue {
            task: flashfxp_lib::bus::RelayTask {
                id,
                src_site,
                src_proxy,
                src_path: src_path.to_string(),
                dst_site: dst_site.clone(),
                dst_proxy: self.current_proxy.clone(),
                dst_path,
            },
        });
    }

    fn resolve_proxy(&self, site: &Site) -> Option<Proxy> {
        site.proxy_id
            .and_then(|pid| self.proxies.iter().find(|p| p.id == pid))
            .cloned()
    }

    fn handle_dropped_files(&mut self, ctx: &egui::Context) {
        let dropped: Vec<PathBuf> = ctx.input(|i| {
            i.raw
                .dropped_files
                .iter()
                .filter_map(|f| f.path.clone())
                .collect()
        });
        for p in dropped {
            if self.remote_dir.is_some() {
                let name = p
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                if !name.is_empty() {
                    self.enqueue(Direction::Upload, &name, p.is_dir());
                }
            }
        }
    }
}

/// 加载系统中文字体（egui 默认字体不含 CJK）
fn setup_fonts(ctx: &egui::Context) {
    let candidates: &[(&str, &str)] = &[
        // macOS
        ("PingFang SC", "/System/Library/Fonts/PingFang.ttc"),
        ("Hiragino Sans GB", "/System/Library/Fonts/Hiragino Sans GB.ttc"),
        ("STHeiti", "/System/Library/Fonts/STHeiti Light.ttc"),
        // Linux
        ("Noto Sans CJK SC", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        ("WenQuanYi", "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"),
        // Windows
        ("Microsoft YaHei", "C:\\Windows\\Fonts\\msyh.ttc"),
        ("SimSun", "C:\\Windows\\Fonts\\simsun.ttc"),
    ];
    let mut fonts = egui::FontDefinitions::default();
    for &(name, path) in candidates {
        if let Ok(bytes) = std::fs::read(path) {
            fonts.font_data.insert(
                name.to_owned(),
                egui::FontData::from_owned(bytes).into(),
            );
            fonts
                .families
                .entry(egui::FontFamily::Proportional)
                .or_default()
                .push(name.to_owned());
            fonts
                .families
                .entry(egui::FontFamily::Monospace)
                .or_default()
                .push(name.to_owned());
            break;
        }
    }
    ctx.set_fonts(fonts);
}

/// 经典 FlashFXP 风格：浅色 Windows 传统 UI
fn setup_style(ctx: &egui::Context) {
    let mut v = egui::Visuals::light();
    v.panel_fill = egui::Color32::from_rgb(240, 240, 240);
    v.window_fill = egui::Color32::from_rgb(240, 240, 240);
    v.extreme_bg_color = egui::Color32::WHITE;
    v.faint_bg_color = egui::Color32::from_rgb(245, 245, 245);
    v.selection.bg_fill = egui::Color32::from_rgb(49, 106, 197);
    v.selection.stroke.color = egui::Color32::WHITE;
    v.hyperlink_color = egui::Color32::from_rgb(0, 0, 200);
    for w in [
        &mut v.widgets.noninteractive,
        &mut v.widgets.inactive,
        &mut v.widgets.hovered,
        &mut v.widgets.active,
        &mut v.widgets.open,
    ] {
        w.bg_stroke.width = 0.5;
        w.corner_radius = egui::CornerRadius::ZERO;
    }
    v.widgets.hovered.bg_fill = egui::Color32::from_rgb(204, 224, 245);
    ctx.set_visuals(v);

    let mut style = (*ctx.style()).clone();
    style.spacing.item_spacing = egui::vec2(6.0, 3.0);
    style.spacing.button_padding = egui::vec2(6.0, 2.0);
    style.spacing.interact_size = egui::vec2(18.0, 16.0);
    ctx.set_style(style);
}

pub fn human_size(n: u64) -> String {
    if n < 1024 {
        format!("{n} B")
    } else if n < 1024 * 1024 {
        format!("{:.1} KB", n as f64 / 1024.0)
    } else if n < 1024 * 1024 * 1024 {
        format!("{:.1} MB", n as f64 / 1024.0 / 1024.0)
    } else {
        format!("{:.1} GB", n as f64 / 1024.0 / 1024.0 / 1024.0)
    }
}

fn fmt_time(ts: Option<i64>) -> String {
    ts.map(|t| {
        chrono::DateTime::from_timestamp(t, 0)
            .map(|d| d.format("%Y-%m-%d %H:%M").to_string())
            .unwrap_or_default()
    })
    .unwrap_or_default()
}
