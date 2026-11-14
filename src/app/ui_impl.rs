use eframe::egui;
use egui_extras::{Column, TableBuilder};

use super::classic::{self, Icon};

use super::{
    human_size, App, BottomTab, CompareMark, Dialog, QueueStatus, SortKey, SortState,
};
use flashfxp_lib::bus::{remote_parent, Direction, UiCmd};
use flashfxp_lib::store::{Proxy, Site};

const DIR_COLOR: egui::Color32 = egui::Color32::from_rgb(0, 100, 160);
const SYMLINK_COLOR: egui::Color32 = egui::Color32::from_rgb(0, 128, 96);
/// XP 经典米色工具栏
const XP_FACE: egui::Color32 = egui::Color32::from_rgb(236, 233, 216);
const STATUS_FACE: egui::Color32 = egui::Color32::from_rgb(228, 228, 228);
/// 本地栏状态条（FlashFXP 为绿色）
const LOCAL_STATUS: egui::Color32 = egui::Color32::from_rgb(198, 229, 178);
const LOCAL_TAB: egui::Color32 = egui::Color32::from_rgb(170, 210, 140);
/// 远程栏页签（蓝色系）
const REMOTE_TAB: egui::Color32 = egui::Color32::from_rgb(160, 190, 225);
const LIST_WHITE: egui::Color32 = egui::Color32::WHITE;
const BORDER: egui::Color32 = egui::Color32::from_rgb(160, 160, 160);
// 彩色工具图标
const C_GREEN: egui::Color32 = egui::Color32::from_rgb(46, 125, 50);
const C_RED: egui::Color32 = egui::Color32::from_rgb(198, 40, 40);
const C_BLUE: egui::Color32 = egui::Color32::from_rgb(21, 101, 192);
const C_ORANGE: egui::Color32 = egui::Color32::from_rgb(230, 145, 30);

impl eframe::App for App {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let now = ctx.input(|i| i.time);
        for t in &mut self.toasts {
            if t.until == 0.0 {
                t.until = now + 6.0;
            }
        }
        self.drain_events(now);
        self.handle_dropped_files(ctx);

        self.show_menu_bar(ctx);
        self.show_toolbar(ctx);
        self.show_quick_connect(ctx);
        if self.show_queue {
            self.show_bottom_panel(ctx);
        }
        self.show_status_bar(ctx);
        self.show_panes(ctx);
        if self.show_site_manager {
            self.show_site_manager(ctx);
        }
        if self.show_proxy_manager {
            self.show_proxy_manager(ctx);
        }
        if self.show_relay {
            self.show_relay_dialog(ctx);
        }
        if self.show_about {
            self.show_about(ctx);
        }
        self.show_dialog(ctx);
        self.show_toasts(ctx);

        ctx.request_repaint_after(std::time::Duration::from_millis(250));
    }
}

impl App {
    // ---------------- 菜单栏（FlashFXP 经典菜单） ----------------
    fn show_menu_bar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("menu_bar")
            .frame(egui::Frame::NONE.fill(XP_FACE).inner_margin(egui::Margin::same(1)))
            .show(ctx, |ui| {
            egui::menu::bar(ui, |ui| {
                ui.menu_button("会话(E)", |ui| {
                    if ui.button("快速连接…").clicked() {
                        ui.close_menu();
                    }
                    if ui
                        .add_enabled(self.connected, egui::Button::new("断开(D)"))
                        .clicked()
                    {
                        self.send(UiCmd::Disconnect);
                        ui.close_menu();
                    }
                    ui.separator();
                    if ui.button("退出(X)").clicked() {
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                });
                ui.menu_button("站点(S)", |ui| {
                    if ui.button("站点管理器(F4)").clicked() {
                        self.show_site_manager = true;
                        ui.close_menu();
                    }
                    if ui
                        .add_enabled(self.connected, egui::Button::new("站点互传(R)"))
                        .clicked()
                    {
                        self.show_relay = true;
                        ui.close_menu();
                    }
                });
                ui.menu_button("选项(O)", |ui| {
                    if ui.button("代理设置(P)").clicked() {
                        self.show_proxy_manager = true;
                        ui.close_menu();
                    }
                });
                ui.menu_button("队列(Z)", |ui| {
                    if ui
                        .button(if self.show_queue { "隐藏队列/日志窗口" } else { "显示队列/日志窗口" })
                        .clicked()
                    {
                        self.show_queue = !self.show_queue;
                        ui.close_menu();
                    }
                    if ui.button("清空已完成").clicked() {
                        self.queue.retain(|q| {
                            q.status == QueueStatus::Waiting || q.status == QueueStatus::Active
                        });
                        let _ = self.repo.queue_clear_finished();
                        ui.close_menu();
                    }
                });
                ui.menu_button("查看(V)", |ui| {
                    if ui.checkbox(&mut self.sync_browse, "同步浏览").changed() {
                        ui.close_menu();
                    }
                });
                ui.menu_button("帮助(H)", |ui| {
                    if ui.button("关于 Rust FlashFXP").clicked() {
                        self.show_about = true;
                        ui.close_menu();
                    }
                });
            });
        });
    }

    // ---------------- 工具栏（经典图标 + 立体按钮） ----------------
    fn show_toolbar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("toolbar")
            .frame(
                egui::Frame::NONE
                    .fill(XP_FACE)
                    .inner_margin(egui::Margin::symmetric(6, 2)),
            )
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    if classic::icon_button(ui, Icon::Connect, "连接（下方快速连接栏输入主机）", true)
                        .clicked()
                    {
                        // 快速连接栏自带连接按钮
                    }
                    if classic::icon_button(ui, Icon::Disconnect, "断开连接", self.connected).clicked() {
                        self.send(UiCmd::Disconnect);
                    }
                    if classic::icon_button(ui, Icon::Refresh, "刷新双栏", true).clicked() {
                        self.refresh_local();
                        self.refresh_remote();
                    }
                    ui.separator();
                    if classic::icon_button(ui, Icon::Relay, "站点互传（源站点 → 当前站点）", self.connected)
                        .clicked()
                        && self.connected
                    {
                        self.show_relay = true;
                    }
                    if classic::icon_button(ui, Icon::Compare, "比较双栏目录差异", self.connected)
                        .clicked()
                        && self.connected
                    {
                        self.compare_panes();
                    }
                    ui.separator();
                    if classic::icon_button(ui, Icon::Queue, "显示/隐藏 队列与日志窗口", true).clicked() {
                        self.show_queue = !self.show_queue;
                    }
                });
            });
    }

    // ---------------- 快速连接栏（FlashFXP 式） ----------------
    fn show_quick_connect(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::top("quick_connect")
            .frame(
                egui::Frame::NONE
                    .fill(XP_FACE)
                    .inner_margin(egui::Margin::symmetric(6, 4)),
            )
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    ui.strong("快速连接:");
                    ui.label("主机");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.qc_host)
                            .desired_width(180.0)
                            .hint_text("ftp.example.com"),
                    );
                    ui.label("端口");
                    ui.add(egui::TextEdit::singleline(&mut self.qc_port).desired_width(46.0));
                    ui.label("用户");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.qc_user)
                            .desired_width(110.0)
                            .hint_text("anonymous"),
                    );
                    ui.label("密码");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.qc_pass)
                            .password(true)
                            .desired_width(110.0),
                    );
                    if ui
                        .add_enabled(
                            !self.qc_host.trim().is_empty(),
                            egui::Button::new(
                                egui::RichText::new("⚡ 连接").color(egui::Color32::WHITE),
                            )
                            .fill(egui::Color32::from_rgb(49, 106, 197)),
                        )
                        .clicked()
                    {
                        self.quick_connect();
                    }
                });
            });
    }

    fn quick_connect(&mut self) {
        let port: u16 = self.qc_port.trim().parse().unwrap_or(21);
        let site = Site {
            id: 0,
            group_id: None,
            name: format!("{}:{}", self.qc_host.trim(), port),
            host: self.qc_host.trim().to_string(),
            port,
            protocol: "ftp".into(),
            username: Some(self.qc_user.trim().to_string()),
            password: Some(self.qc_pass.clone()),
            encoding: "auto".into(),
            passive_mode: true,
            login_cmds: None,
            proxy_id: None,
            tls_accept_invalid: false,
        };
        self.queue.clear();
        let _ = self.repo.queue_clear_finished();
        self.current_site = Some(site.clone());
        self.current_proxy = None;
        self.log(&format!("连接 {}:{}", site.host, site.port));
        self.send(UiCmd::Connect { site, proxy: None });
    }

    // ---------------- 状态栏 ----------------
    fn show_status_bar(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::bottom("status_bar")
            .frame(
                egui::Frame::NONE
                    .fill(STATUS_FACE)
                    .inner_margin(egui::Margin::symmetric(8, 3)),
            )
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    if self.connected {
                        ui.label("已连接");
                        ui.separator();
                        ui.monospace(
                            egui::RichText::new(self.remote_dir.as_deref().unwrap_or("")).weak(),
                        );
                    } else {
                        ui.weak("空闲");
                    }
                    ui.separator();
                    ui.weak(format!("本地: {}", self.local_dir.display()));
                    let active =
                        self.queue.iter().filter(|q| q.status == QueueStatus::Active).count();
                    let waiting =
                        self.queue.iter().filter(|q| q.status == QueueStatus::Waiting).count();
                    if active + waiting > 0 {
                        ui.separator();
                        ui.label(format!("传输中 {active}，等待 {waiting}"));
                    }
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                        ui.weak(format!(
                            "{}",
                            chrono::Local::now().format("%Y-%m-%d %H:%M")
                        ));
                    });
                });
            });
    }

    // ---------------- 双栏 ----------------
    fn show_panes(&mut self, ctx: &egui::Context) {
        egui::CentralPanel::default()
            .frame(egui::Frame::NONE.fill(XP_FACE).inner_margin(egui::Margin::same(6)))
            .show(ctx, |ui| {
                let avail = ui.available_size();
                let pane_w = (avail.x - 12.0) / 2.0;
                ui.horizontal(|ui| {
                    ui.vertical(|ui| {
                        ui.set_width(pane_w);
                        ui.set_height(avail.y);
                        self.show_local_pane(ui);
                    });
                    ui.separator();
                    ui.vertical(|ui| {
                        ui.set_width(pane_w);
                        ui.set_height(avail.y);
                        self.show_remote_pane(ui);
                    });
                });
            });
    }

    // 栏内：页签 + 经典图标导航 + 凹陷地址栏
    fn pane_header(
        ui: &mut egui::Ui,
        title: &str,
        tab_color: egui::Color32,
        path_buf: &mut String,
        up_enabled: bool,
    ) -> (bool, bool) {
        // 返回 (上级, 回车导航)
        let mut up = false;
        let mut go = false;
        ui.horizontal(|ui| {
            egui::Frame::NONE
                .fill(tab_color)
                .corner_radius(egui::CornerRadius { nw: 4, ne: 4, sw: 0, se: 0 })
                .inner_margin(egui::Margin::symmetric(10, 2))
                .stroke(egui::Stroke::new(1.0, BORDER))
                .show(ui, |ui| {
                    ui.label(
                        egui::RichText::new(title)
                            .strong()
                            .size(12.0)
                            .color(egui::Color32::from_rgb(30, 40, 60)),
                    );
                });
            if classic::icon_button(ui, Icon::Up, "上级目录", up_enabled).clicked() {
                up = true;
            }
            if classic::icon_button(ui, Icon::Refresh, "刷新", true).clicked() {
                go = true;
            }
            classic::sunken_field(ui, |ui| {
                let resp = ui.add(
                    egui::TextEdit::singleline(path_buf)
                        .desired_width(ui.available_width() - 4.0)
                        .hint_text("输入路径后回车"),
                    );
                if resp.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                    go = true;
                }
            });
        });
        (up, go)
    }

    fn show_local_pane(&mut self, ui: &mut egui::Ui) {
        let mut buf = self.local_path_buf.clone();
        let (up, _go) = Self::pane_header(ui, "本地", LOCAL_TAB, &mut buf, true);
        self.local_path_buf = buf;
        if up {
            if let Some(parent) = self.local_dir.parent() {
                let p = parent.to_path_buf();
                self.send(UiCmd::LocalList { path: p });
            }
        }
        self.pane_actions(ui, true);
        self.pane_list(ui, true);
    }

    fn show_remote_pane(&mut self, ui: &mut egui::Ui) {
        let connected = self.connected && self.remote_dir.is_some();
        let path_str = self.remote_dir.clone().unwrap_or_else(|| "未连接".into());
        let mut buf = self.remote_path_buf.clone();
        if !connected {
            buf.clear();
        }
        let title = self
            .current_site
            .as_ref()
            .map(|s| format!("{}:{}", s.host, s.port))
            .unwrap_or_else(|| "远程".into());
        let (up, _go) = Self::pane_header(ui, &title, REMOTE_TAB, &mut buf, connected);
        if connected {
            self.remote_path_buf = buf.clone();
            if up {
                if let Some(p) = remote_parent(&path_str) {
                    self.send(UiCmd::RemoteList { path: p });
                }
            }
        }
        if !connected {
            ui.separator();
            ui.centered_and_justified(|ui| {
                ui.weak("未连接 — 请在上方快速连接或在站点管理器中选择站点");
            });
            return;
        }
        self.pane_actions(ui, false);
        self.pane_list(ui, false);
    }

    /// 栏内操作按钮行（经典图标按钮）
    fn pane_actions(&mut self, ui: &mut egui::Ui, local: bool) {
        ui.horizontal(|ui| {
            let sel = if local { self.local_sel } else { self.remote_sel };
            let connected = self.connected && self.remote_dir.is_some();
            if classic::icon_button(ui, Icon::NewDir, "新建目录", true).clicked() {
                self.dialog = Some(if local {
                    Dialog::MkdirLocal
                } else {
                    Dialog::MkdirRemote
                });
                self.dialog_text.clear();
            }
            if classic::icon_button(ui, Icon::Rename, "重命名", sel.is_some()).clicked() {
                if let Some(i) = sel {
                    let entries = if local {
                        &self.local_entries
                    } else {
                        &self.remote_entries
                    };
                    self.dialog_text = entries[i].name.clone();
                    self.dialog = Some(if local {
                        Dialog::RenameLocal(i)
                    } else {
                        Dialog::RenameRemote(i)
                    });
                }
            }
            if classic::icon_button(ui, Icon::Delete, "删除", sel.is_some()).clicked() {
                if let Some(i) = sel {
                    if local {
                        let p = self.local_dir.join(&self.local_entries[i].name);
                        self.send(UiCmd::LocalDelete { paths: vec![p] });
                        self.local_sel = None;
                        self.refresh_local();
                    } else {
                        let path_str = self.remote_dir.clone().unwrap();
                        let p = flashfxp_lib::bus::remote_join(&path_str, &self.remote_entries[i].name);
                        self.send(UiCmd::RemoteDelete { paths: vec![p] });
                        self.remote_sel = None;
                        self.refresh_remote();
                    }
                }
            }
            let upload_icon = if local { Icon::Upload } else { Icon::Download };
            if classic::icon_button(
                ui,
                upload_icon,
                if local { "上传到远程" } else { "下载到本地" },
                sel.is_some() && connected,
            )
            .clicked()
            {
                if let Some(i) = sel {
                    let (name, is_dir, direction) = if local {
                        (
                            self.local_entries[i].name.clone(),
                            self.local_entries[i].is_dir,
                            Direction::Upload,
                        )
                    } else {
                        (
                            self.remote_entries[i].name.clone(),
                            self.remote_entries[i].is_dir,
                            Direction::Download,
                        )
                    };
                    self.enqueue(direction, &name, is_dir);
                }
            }
            if classic::icon_button(ui, Icon::Compare, "与对侧比较", connected).clicked() {
                self.compare_panes();
            }
            // 比较图例
            let has_marks = if local {
                !self.local_marks.is_empty()
            } else {
                !self.remote_marks.is_empty()
            };
            if has_marks {
                ui.separator();
                ui.colored_label(egui::Color32::from_rgb(0, 130, 0), "· 相同");
                ui.colored_label(C_BLUE, "＋ 仅本侧");
                ui.colored_label(C_ORANGE, "▲ 大小不同");
                if ui.small_button("清除比较").clicked() {
                    self.local_marks.clear();
                    self.remote_marks.clear();
                }
            }
        });
    }

    /// 栏内文件列表 + 栏底状态条
    fn pane_list(&mut self, ui: &mut egui::Ui, local: bool) {
        let entries: Vec<flashfxp_lib::bus::Entry> = if local {
            self.local_entries.clone()
        } else {
            self.remote_entries.clone()
        };
        let selected = if local { self.local_sel } else { self.remote_sel };
        let marks = if local {
            self.local_marks.clone()
        } else {
            self.remote_marks.clone()
        };
        let list_id = if local { "local_entries" } else { "remote_entries" };
        let sort: &mut SortState = if local {
            &mut self.sort_local
        } else {
            &mut self.sort_remote
        };
        let sort_now = *sort;

        let available_h = ui.available_height();
        let list_h = (available_h - 26.0).max(40.0);
        let (new_sel, action, sort_req) =
            Self::entry_list(ui, list_id, &entries, selected, Some(&marks), list_h);
        if let Some(key) = sort_req {
            sort.toggle(key);
            let sorted = sort.sorted(&entries);
            if local {
                self.local_entries = sorted;
            } else {
                self.remote_entries = sorted;
            }
        }
        if let Some(s) = new_sel {
            if local {
                self.local_sel = Some(s);
            } else {
                self.remote_sel = Some(s);
            }
        }
        let _ = sort_now;

        // 栏底状态条（FlashFXP：本地绿色，远程灰色；凹陷效果）
        let strip = if local { LOCAL_STATUS } else { STATUS_FACE };
        let resp = egui::Frame::NONE
            .fill(strip)
            .inner_margin(egui::Margin::symmetric(6, 2))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    let files = entries.iter().filter(|e| !e.is_dir).count();
                    let dirs = entries.iter().filter(|e| e.is_dir).count();
                    let total: u64 = entries.iter().map(|e| e.size).sum();
                    ui.weak(
                        egui::RichText::new(format!(
                            "{files} 个文件, {dirs} 个文件夹, 共计 {} 项 ({})",
                            files + dirs,
                            human_size(total)
                        ))
                        .size(11.0),
                    );
                    if let Some(i) = selected {
                        if let Some(e) = entries.get(i) {
                            ui.weak(egui::RichText::new(format!("选中: {}", e.name)).size(11.0));
                        }
                    }
                });
            })
            .response;
        classic::bevel(ui.painter(), resp.rect, false);

        match action {
            EntryAction::DirDouble(i) => {
                let e = entries[i].clone();
                if local {
                    let p = self.local_dir.join(&e.name);
                    self.send(UiCmd::LocalList { path: p });
                    // 同步浏览：远程侧跟随进入同名目录
                    if self.sync_browse && self.remote_dir.is_some() {
                        if self.remote_entries.iter().any(|r| r.name == e.name && r.is_dir) {
                            let rp = flashfxp_lib::bus::remote_join(
                                self.remote_dir.as_deref().unwrap_or("/"),
                                &e.name,
                            );
                            self.send(UiCmd::RemoteList { path: rp });
                        } else {
                            self.push_toast("同步浏览：远程侧没有同名目录", true);
                        }
                    }
                } else {
                    let path_str = self.remote_dir.clone().unwrap();
                    let p = flashfxp_lib::bus::remote_join(&path_str, &e.name);
                    self.send(UiCmd::RemoteList { path: p });
                    if self.sync_browse {
                        if self.local_entries.iter().any(|l| l.name == e.name && l.is_dir) {
                            let lp = self.local_dir.join(&e.name);
                            self.send(UiCmd::LocalList { path: lp });
                        } else {
                            self.push_toast("同步浏览：本地侧没有同名目录", true);
                        }
                    }
                }
            }
            EntryAction::FileDouble(i) => {
                let e = entries[i].clone();
                if local {
                    if self.remote_dir.is_some() {
                        self.enqueue(Direction::Upload, &e.name, false);
                    }
                } else {
                    self.enqueue(Direction::Download, &e.name, false);
                }
            }
            EntryAction::None => {}
        }
    }

    /// 目录比较：按名称比对本地/远程当前目录，标记差异
    fn compare_panes(&mut self) {
        self.local_marks.clear();
        self.remote_marks.clear();
        let remote_map: std::collections::HashMap<&str, &flashfxp_lib::bus::Entry> = self
            .remote_entries
            .iter()
            .map(|e| (e.name.as_str(), e))
            .collect();
        let local_map: std::collections::HashMap<&str, &flashfxp_lib::bus::Entry> = self
            .local_entries
            .iter()
            .map(|e| (e.name.as_str(), e))
            .collect();
        for e in &self.local_entries {
            let mark = match remote_map.get(e.name.as_str()) {
                Some(r) => {
                    if !e.is_dir && !r.is_dir && e.size != r.size {
                        CompareMark::SizeDiff
                    } else {
                        CompareMark::Same
                    }
                }
                None => CompareMark::OnlyLocal,
            };
            self.local_marks.insert(e.name.clone(), mark);
        }
        for e in &self.remote_entries {
            let mark = match local_map.get(e.name.as_str()) {
                Some(l) => {
                    if !e.is_dir && !l.is_dir && e.size != l.size {
                        CompareMark::SizeDiff
                    } else {
                        CompareMark::Same
                    }
                }
                None => CompareMark::OnlyRemote,
            };
            self.remote_marks.insert(e.name.clone(), mark);
        }
        let diff = self
            .local_marks
            .values()
            .filter(|m| **m != CompareMark::Same)
            .count()
            + self
                .remote_marks
                .values()
                .filter(|m| **m != CompareMark::Same)
                .count();
        self.log(&format!("比较完成：{diff} 处差异"));
        self.push_toast(&format!("比较完成：{diff} 处差异"), false);
    }

    // 经典白底列表（可点击表头排序）
    #[allow(clippy::type_complexity)]
    fn entry_list(
        ui: &mut egui::Ui,
        list_id: &str,
        entries: &[flashfxp_lib::bus::Entry],
        selected: Option<usize>,
        marks: Option<&std::collections::HashMap<String, CompareMark>>,
        height: f32,
    ) -> (Option<usize>, EntryAction, Option<SortKey>) {
        let mut new_sel = None;
        let mut action = EntryAction::None;
        let mut sort_req = None;
        if entries.is_empty() {
            egui::Frame::NONE
                .fill(LIST_WHITE)
                .stroke(egui::Stroke::new(1.0, BORDER))
                .inner_margin(egui::Margin::same(4))
                .show(ui, |ui| {
                    ui.set_height(height);
                    ui.centered_and_justified(|ui| ui.weak("（空目录）"));
                });
            return (None, EntryAction::None, None);
        }
        TableBuilder::new(ui)
            .id_salt(list_id)
            .striped(false)
            .resizable(false)
            .min_scrolled_height(height)
            .max_scroll_height(height)
            .cell_layout(egui::Layout::left_to_right(egui::Align::Center))
            .column(Column::remainder())
            .column(Column::exact(80.0))
            .column(Column::exact(128.0))
            .header(20.0, |mut header| {
                header.col(|ui| {
                    let (rect, _) =
                        ui.allocate_exact_size(egui::vec2(ui.available_width(), 18.0), egui::Sense::hover());
                    ui.painter().rect_filled(rect, 0.0, XP_FACE);
                    classic::bevel(ui.painter(), rect, true);
                    let resp = ui.put(rect, |ui: &mut egui::Ui| {
                        ui.set_clip_rect(rect);
                        ui.add(egui::Button::new(egui::RichText::new("名称").size(12.0)).frame(false))
                    });
                    if resp.clicked() {
                        sort_req = Some(SortKey::Name);
                    }
                });
                header.col(|ui| {
                    let (rect, _) =
                        ui.allocate_exact_size(egui::vec2(ui.available_width(), 18.0), egui::Sense::hover());
                    ui.painter().rect_filled(rect, 0.0, XP_FACE);
                    classic::bevel(ui.painter(), rect, true);
                    let resp = ui.put(rect, |ui: &mut egui::Ui| {
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            ui.add(egui::Button::new(egui::RichText::new("大小").size(12.0)).frame(false))
                        })
                        .response
                    });
                    if resp.clicked() {
                        sort_req = Some(SortKey::Size);
                    }
                });
                header.col(|ui| {
                    let (rect, _) =
                        ui.allocate_exact_size(egui::vec2(ui.available_width(), 18.0), egui::Sense::hover());
                    ui.painter().rect_filled(rect, 0.0, XP_FACE);
                    classic::bevel(ui.painter(), rect, true);
                    let resp = ui.put(rect, |ui: &mut egui::Ui| {
                        ui.add(egui::Button::new(egui::RichText::new("修改时间").size(12.0)).frame(false))
                    });
                    if resp.clicked() {
                        sort_req = Some(SortKey::Mtime);
                    }
                });
            })
            .body(|mut body| {
                for (i, e) in entries.iter().enumerate() {
                    let is_sel = selected == Some(i);
                    let icon = if e.is_dir {
                        "📁"
                    } else if e.is_symlink {
                        "🔗"
                    } else {
                        ""
                    };
                    let mark_icon = marks
                        .and_then(|m| m.get(&e.name))
                        .map(|m| match m {
                            CompareMark::Same => "",
                            CompareMark::OnlyLocal | CompareMark::OnlyRemote => " ＋",
                            CompareMark::SizeDiff => " ▲",
                        })
                        .unwrap_or("");
                    let name_color = if e.is_dir {
                        DIR_COLOR
                    } else if e.is_symlink {
                        SYMLINK_COLOR
                    } else {
                        egui::Color32::BLACK
                    };
                    body.row(18.0, |mut row| {
                        row.col(|ui| {
                            let label = egui::RichText::new(format!(
                                "{icon} {}{mark_icon}",
                                e.name
                            ))
                            .color(name_color);
                            let resp = ui.add(egui::SelectableLabel::new(is_sel, label));
                            if resp.clicked() {
                                new_sel = Some(i);
                            }
                            if resp.double_clicked() {
                                action = if e.is_dir {
                                    EntryAction::DirDouble(i)
                                } else {
                                    EntryAction::FileDouble(i)
                                };
                            }
                        });
                        row.col(|ui| {
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                if !e.is_dir {
                                    ui.weak(egui::RichText::new(human_size(e.size)).size(11.0));
                                }
                            });
                        });
                        row.col(|ui| {
                            ui.weak(egui::RichText::new(super::fmt_time(e.mtime)).size(11.0));
                        });
                    });
                }
            });
        (new_sel, action, sort_req)
    }

    // ---------------- 底部：队列窗口 / 日志窗口（标签页） ----------------
    fn show_bottom_panel(&mut self, ctx: &egui::Context) {
        egui::TopBottomPanel::bottom("bottom_panel")
            .default_height(150.0)
            .resizable(true)
            .frame(egui::Frame::NONE.fill(XP_FACE).inner_margin(egui::Margin::same(0)))
            .show(ctx, |ui| {
                ui.horizontal(|ui| {
                    let q_active = self.bottom_tab == BottomTab::Queue;
                    if ui
                        .selectable_label(q_active, egui::RichText::new("队列窗口").strong())
                        .clicked()
                    {
                        self.bottom_tab = BottomTab::Queue;
                    }
                    if ui
                        .selectable_label(
                            self.bottom_tab == BottomTab::Log,
                            egui::RichText::new("日志窗口").strong(),
                        )
                        .clicked()
                    {
                        self.bottom_tab = BottomTab::Log;
                    }
                    ui.separator();
                    if ui.button("清空已完成").clicked() {
                        self.queue.retain(|q| {
                            q.status == QueueStatus::Waiting || q.status == QueueStatus::Active
                        });
                        let _ = self.repo.queue_clear_finished();
                    }
                    if self.bottom_tab == BottomTab::Log && ui.button("清空日志").clicked() {
                        self.log.clear();
                    }
                });
                ui.separator();
                match self.bottom_tab {
                    BottomTab::Queue => {
                        egui::ScrollArea::vertical().show(ui, |ui| {
                            for q in &self.queue {
                                ui.horizontal(|ui| {
                                    let dir = match q.direction {
                                        Direction::Download => "↓",
                                        Direction::Upload => "↑",
                                        Direction::Relay => "⇄",
                                    };
                                    ui.label(dir);
                                    let (name, tip) = if q.direction == Direction::Relay {
                                        (q.remote.clone(), q.remote.clone())
                                    } else if q.direction == Direction::Download {
                                        (q.remote.clone(), format!("{} → {}", q.remote, q.local))
                                    } else {
                                        (q.local.clone(), format!("{} → {}", q.local, q.remote))
                                    };
                                    let short = name.rsplit('/').next().unwrap_or(&name).to_string();
                                    ui.monospace(short).on_hover_text(tip);
                                    let frac = if q.size > 0 {
                                        (q.transferred as f32 / q.size as f32).clamp(0.0, 1.0)
                                    } else {
                                        0.0
                                    };
                                    ui.add(
                                        egui::ProgressBar::new(frac)
                                            .show_percentage()
                                            .desired_width(200.0),
                                    );
                                    ui.label(format!(
                                        "{}/{}",
                                        human_size(q.transferred),
                                        human_size(q.size)
                                    ));
                                    match &q.status {
                                        QueueStatus::Waiting => ui.label("等待中"),
                                        QueueStatus::Active => ui.label("传输中…"),
                                        QueueStatus::Done => ui.label("完成 ✓"),
                                        QueueStatus::Failed(e) => {
                                            ui.colored_label(
                                                egui::Color32::RED,
                                                format!("失败: {e}"),
                                            )
                                            .on_hover_text(e.clone())
                                        }
                                    }
                                });
                            }
                        });
                    }
                    BottomTab::Log => {
                        egui::ScrollArea::vertical()
                            .id_salt("log_view")
                            .stick_to_bottom(true)
                            .show(ui, |ui| {
                                for line in &self.log {
                                    ui.monospace(egui::RichText::new(line).size(11.0).weak());
                                }
                            });
                    }
                }
            });
    }

    fn show_about(&mut self, ctx: &egui::Context) {
        let mut keep_open = true;
        egui::Window::new("关于 Rust FlashFXP")
            .open(&mut keep_open)
            .fixed_size([360.0, 150.0])
            .show(ctx, |ui| {
                ui.heading("Rust FlashFXP 0.1");
                ui.label("FTP / FTPS / SFTP 客户端 — Rust + egui 实现");
                ui.weak("站点管理 · 断点续传 · 代理 · 同步浏览 · 目录比较 · 站点互传");
            });
        if !keep_open {
            self.show_about = false;
        }
    }

    // ---------------- 站点管理器（FlashFXP 式：左树 + 右标签页 + 双击连接） ----------------
    fn show_site_manager(&mut self, ctx: &egui::Context) {
        let mut keep_open = true;
        let mut close_clicked = false;
        egui::Window::new("站点管理器")
            .open(&mut keep_open)
            .default_size([760.0, 520.0])
            .min_width(680.0)
            .show(ctx, |ui| {
                // 对话框内工具栏
                ui.horizontal(|ui| {
                    let sel_ok = self.edit_site.as_ref().is_some_and(|s| s.id > 0);
                    if ui
                        .add_enabled(
                            sel_ok,
                            egui::Button::new(
                                egui::RichText::new("🔌 连接(C)").color(egui::Color32::WHITE),
                            )
                            .fill(egui::Color32::from_rgb(49, 106, 197)),
                        )
                        .clicked()
                    {
                        self.connect_edit_site();
                    }
                    if ui
                        .add_enabled(self.connected, egui::Button::new("⏹ 断开(D)"))
                        .clicked()
                    {
                        self.send(UiCmd::Disconnect);
                    }
                    ui.separator();
                    if ui.button("📁 新建组(G)").clicked() {
                        let _ = self.repo.add_group(None, "新分组");
                        self.groups = self.repo.list_groups().unwrap_or_default();
                    }
                    if ui.button("📄 新建站点(N)").clicked() {
                        self.edit_site = Some(Site {
                            id: 0,
                            group_id: None,
                            name: String::new(),
                            host: String::new(),
                            port: 21,
                            protocol: "ftp".into(),
                            username: None,
                            password: None,
                            encoding: "auto".into(),
                            passive_mode: true,
                            login_cmds: None,
                            proxy_id: None,
                            tls_accept_invalid: false,
                        });
                        self.site_manager_tab = 0;
                    }
                    if ui
                        .add_enabled(sel_ok, egui::Button::new("✖ 删除"))
                        .clicked()
                    {
                        if let Some(site) = self.edit_site.clone() {
                            let _ = self.repo.delete_site(site.id);
                            self.sites = self.repo.list_sites().unwrap_or_default();
                            self.edit_site = None;
                        }
                    }
                });
                ui.separator();

                let avail = ui.available_size();
                let tree_w = 250.0f32.min(avail.x * 0.38);
                ui.horizontal(|ui| {
                    // 左侧站点树
                    ui.vertical(|ui| {
                        ui.set_width(tree_w);
                        ui.set_height(avail.y - 34.0);
                        egui::Frame::NONE
                            .fill(LIST_WHITE)
                            .stroke(egui::Stroke::new(1.0, BORDER))
                            .inner_margin(egui::Margin::same(4))
                            .show(ui, |ui| {
                                ui.strong(egui::RichText::new("站点").size(12.0));
                                ui.separator();
                                egui::ScrollArea::vertical()
                                    .id_salt("site_tree")
                                    .show(ui, |ui| {
                                        self.site_tree_ui(ui);
                                    });
                            });
                        // 底部：新建分组输入
                        ui.horizontal(|ui| {
                            ui.add(
                                egui::TextEdit::singleline(&mut self.new_group_name)
                                    .hint_text("新分组名称")
                                    .desired_width(120.0),
                            );
                            if ui.button("＋ 添加分组").clicked() {
                                let n = self.new_group_name.trim().to_string();
                                if !n.is_empty() {
                                    let _ = self.repo.add_group(None, &n);
                                    self.groups = self.repo.list_groups().unwrap_or_default();
                                    self.new_group_name.clear();
                                }
                            }
                        });
                    });

                    ui.separator();

                    // 右侧：常规/高级 标签页 + 表单 + 底部按钮
                    ui.vertical(|ui| {
                        ui.set_width(ui.available_width());
                        ui.set_height(avail.y - 34.0);
                        ui.horizontal(|ui| {
                            if ui
                                .selectable_label(
                                    self.site_manager_tab == 0,
                                    egui::RichText::new("常规").strong(),
                                )
                                .clicked()
                            {
                                self.site_manager_tab = 0;
                            }
                            if ui
                                .selectable_label(
                                    self.site_manager_tab == 1,
                                    egui::RichText::new("高级").strong(),
                                )
                                .clicked()
                            {
                                self.site_manager_tab = 1;
                            }
                        });
                        ui.separator();
                        egui::ScrollArea::vertical()
                            .id_salt("site_form_area")
                            .show(ui, |ui| {
                                self.site_form_ui(ui);
                            });
                        ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                            if ui.button("关闭(X)").clicked() {
                                close_clicked = true;
                            }
                            if ui.button("应用(A) 保存").clicked() {
                                self.save_edit_site();
                            }
                            if ui
                                .add_enabled(
                                    self.edit_site
                                        .as_ref()
                                        .is_some_and(|s| !s.host.trim().is_empty()),
                                    egui::Button::new("连接(C)"),
                                )
                                .clicked()
                            {
                                self.connect_edit_site();
                            }
                        });
                    });
                });
            });
        if !keep_open || close_clicked {
            self.show_site_manager = false;
        }
    }

    /// 连接当前编辑中的站点并关闭管理器（双击/连接按钮共用）
    fn connect_edit_site(&mut self) {
        let Some(s) = self.edit_site.clone() else { return };
        if s.host.trim().is_empty() {
            return;
        }
        self.save_edit_site();
        let s = self.edit_site.clone().unwrap_or(s);
        let proxy = self.resolve_proxy(&s);
        self.queue.clear();
        let _ = self.repo.queue_clear_finished();
        self.current_site = Some(s.clone());
        self.current_proxy = proxy.clone();
        self.log(&format!("连接站点 {} ({})", s.name, s.host));
        self.send(UiCmd::Connect { site: s, proxy });
        self.show_site_manager = false;
    }

    fn save_edit_site(&mut self) {
        let Some(s) = self.edit_site.clone() else { return };
        if s.host.trim().is_empty() || s.name.trim().is_empty() {
            return;
        }
        let _ = self.repo.upsert_site(&s);
        self.sites = self.repo.list_sites().unwrap_or_default();
    }

    /// 左侧站点树（分组可折叠；双击站点直接连接）
    fn site_tree_ui(&mut self, ui: &mut egui::Ui) {
        let edit_id = self.edit_site.as_ref().map(|s| s.id);
        let groups = self.groups.clone();
        let sites = self.sites.clone();
        let mut connect_now: Option<Site> = None;
        for g in &groups {
            let mut expanded = self.expanded_groups.contains(&g.id);
            let header = egui::RichText::new(format!("📁 {}", g.name)).strong();
            let resp = egui::CollapsingHeader::new(header)
                .default_open(true)
                .show(ui, |ui| {
                    for s in sites.iter().filter(|s| s.group_id == Some(g.id)) {
                        let is_sel = edit_id == Some(s.id);
                        let label = egui::RichText::new(format!("  📄 {}", s.name)).color(if is_sel {
                            egui::Color32::BLACK
                        } else {
                            egui::Color32::from_rgb(50, 50, 50)
                        });
                        let resp = ui.add(egui::SelectableLabel::new(is_sel, label));
                        if resp.clicked() {
                            self.edit_site = Some(s.clone());
                        }
                        if resp.double_clicked() {
                            self.edit_site = Some(s.clone());
                            connect_now = Some(s.clone());
                        }
                    }
                })
                .header_response;
            if resp.clicked() {
                if expanded {
                    self.expanded_groups.remove(&g.id);
                } else {
                    self.expanded_groups.insert(g.id);
                }
            }
        }
        // 未分组站点
        for s in sites.iter().filter(|s| s.group_id.is_none()) {
            let is_sel = edit_id == Some(s.id);
            let label = egui::RichText::new(format!("📄 {}", s.name)).color(if is_sel {
                egui::Color32::BLACK
            } else {
                egui::Color32::from_rgb(50, 50, 50)
            });
            let resp = ui.add(egui::SelectableLabel::new(is_sel, label));
            if resp.clicked() {
                self.edit_site = Some(s.clone());
            }
            if resp.double_clicked() {
                self.edit_site = Some(s.clone());
                connect_now = Some(s.clone());
            }
        }
        if let Some(_s) = connect_now {
            self.connect_edit_site();
        }
    }

    /// 右侧表单（常规 / 高级）
    fn site_form_ui(&mut self, ui: &mut egui::Ui) {
        let Some(site) = self.edit_site.clone() else {
            ui.centered_and_justified(|ui| {
                ui.weak("选择左侧站点，或点击「新建站点」；双击站点名可直接连接");
            });
            return;
        };
        let is_new = site.id == 0;
        ui.heading(if is_new { "新建站点" } else { "编辑站点" });
        ui.separator();
        egui::Grid::new("site_form")
            .num_columns(2)
            .spacing([10.0, 7.0])
            .show(ui, |ui| {
                if self.site_manager_tab == 0 {
                    // ---- 常规 ----
                    ui.label("站点名称:");
                    ui.text_edit_singleline(&mut self.edit_site.as_mut().unwrap().name);
                    ui.end_row();

                    ui.label("IP 地址:");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.edit_site.as_mut().unwrap().host)
                            .hint_text("ftp.example.com 或 192.168.1.1"),
                    );
                    ui.end_row();

                    ui.label("端口:");
                    let port_str = self.edit_site.as_ref().unwrap().port.to_string();
                    let mut port_buf = port_str.clone();
                    ui.add(egui::TextEdit::singleline(&mut port_buf).desired_width(70.0));
                    if let Ok(p) = port_buf.trim().parse::<u16>() {
                        self.edit_site.as_mut().unwrap().port = p;
                    }
                    ui.end_row();

                    ui.label("用户名:");
                    let mut user =
                        self.edit_site.as_ref().unwrap().username.clone().unwrap_or_default();
                    ui.text_edit_singleline(&mut user);
                    self.edit_site.as_mut().unwrap().username = Some(user);
                    ui.end_row();

                    ui.label("密码:");
                    let mut pass =
                        self.edit_site.as_ref().unwrap().password.clone().unwrap_or_default();
                    ui.add(egui::TextEdit::singleline(&mut pass).password(true));
                    self.edit_site.as_mut().unwrap().password = Some(pass);
                    ui.end_row();
                } else {
                    // ---- 高级 ----
                    ui.label("协议:");
                    let proto = self.edit_site.as_ref().unwrap().protocol.clone();
                    let proto_name = match proto.as_str() {
                        "ftp" => "FTP",
                        "ftps_explicit" => "FTPS (显式 TLS)",
                        "ftps_implicit" => "FTPS (隐式 SSL)",
                        "sftp" => "SFTP (SSH)",
                        _ => "FTP",
                    };
                    egui::ComboBox::from_id_salt("protocol")
                        .selected_text(proto_name)
                        .show_ui(ui, |ui| {
                            for (k, v) in [
                                ("ftp", "FTP"),
                                ("ftps_explicit", "FTPS (显式 TLS)"),
                                ("ftps_implicit", "FTPS (隐式 SSL)"),
                                ("sftp", "SFTP (SSH)"),
                            ] {
                                ui.selectable_value(
                                    &mut self.edit_site.as_mut().unwrap().protocol,
                                    k.to_string(),
                                    v,
                                );
                            }
                        });
                    ui.end_row();

                    ui.label("编码:");
                    let enc = self.edit_site.as_ref().unwrap().encoding.clone();
                    let enc_name = match enc.as_str() {
                        "auto" => "自动检测",
                        "utf-8" => "UTF-8",
                        "gbk" => "GBK (简体中文)",
                        "big5" => "Big5 (繁体中文)",
                        "shift-jis" => "Shift-JIS (日文)",
                        _ => "自动检测",
                    };
                    egui::ComboBox::from_id_salt("encoding")
                        .selected_text(enc_name)
                        .show_ui(ui, |ui| {
                            for (k, v) in [
                                ("auto", "自动检测"),
                                ("utf-8", "UTF-8"),
                                ("gbk", "GBK (简体中文)"),
                                ("big5", "Big5 (繁体中文)"),
                                ("shift-jis", "Shift-JIS (日文)"),
                            ] {
                                ui.selectable_value(
                                    &mut self.edit_site.as_mut().unwrap().encoding,
                                    k.to_string(),
                                    v,
                                );
                            }
                        });
                    ui.end_row();

                    ui.label("传输模式:");
                    let passive = self.edit_site.as_ref().unwrap().passive_mode;
                    egui::ComboBox::from_id_salt("mode")
                        .selected_text(if passive { "被动模式 (PASV)" } else { "主动模式 (PORT)" })
                        .show_ui(ui, |ui| {
                            if ui.selectable_label(passive, "被动模式 (PASV)").clicked() {
                                self.edit_site.as_mut().unwrap().passive_mode = true;
                            }
                            if ui
                                .selectable_label(!passive, "主动模式 (PORT)")
                                .clicked()
                            {
                                self.edit_site.as_mut().unwrap().passive_mode = false;
                            }
                        });
                    ui.end_row();

                    ui.label("证书校验:");
                    ui.checkbox(
                        &mut self.edit_site.as_mut().unwrap().tls_accept_invalid,
                        "忽略证书错误（自签名服务器）",
                    );
                    ui.end_row();

                    ui.label("代理:");
                    let pid = self.edit_site.as_ref().unwrap().proxy_id;
                    let pname = self
                        .proxies
                        .iter()
                        .find(|p| Some(p.id) == pid)
                        .map(|p| p.name.clone())
                        .unwrap_or_else(|| "（无）".into());
                    egui::ComboBox::from_id_salt("site_proxy")
                        .selected_text(pname)
                        .show_ui(ui, |ui| {
                            if ui.selectable_label(pid.is_none(), "（无）").clicked() {
                                self.edit_site.as_mut().unwrap().proxy_id = None;
                            }
                            for p in self.proxies.clone() {
                                if ui.selectable_label(pid == Some(p.id), p.name).clicked() {
                                    self.edit_site.as_mut().unwrap().proxy_id = Some(p.id);
                                }
                            }
                        });
                    ui.end_row();

                    ui.label("分组:");
                    let gid = self.edit_site.as_ref().unwrap().group_id;
                    let gname = self
                        .groups
                        .iter()
                        .find(|g| Some(g.id) == gid)
                        .map(|g| g.name.clone())
                        .unwrap_or_else(|| "（无）".into());
                    egui::ComboBox::from_id_salt("group")
                        .selected_text(gname)
                        .show_ui(ui, |ui| {
                            if ui.selectable_label(gid.is_none(), "（无）").clicked() {
                                self.edit_site.as_mut().unwrap().group_id = None;
                            }
                            for g in self.groups.clone() {
                                if ui.selectable_label(gid == Some(g.id), g.name).clicked() {
                                    self.edit_site.as_mut().unwrap().group_id = Some(g.id);
                                }
                            }
                        });
                    ui.end_row();
                }
            });
    }

    fn show_proxy_manager(&mut self, ctx: &egui::Context) {
        let mut keep_open = true;
        egui::Window::new("代理设置")
            .open(&mut keep_open)
            .default_size([460.0, 360.0])
            .show(ctx, |ui| {
                ui.heading("代理列表");
                egui::ScrollArea::vertical()
                    .id_salt("proxies")
                    .max_height(180.0)
                    .show(ui, |ui| {
                        for p in self.proxies.clone() {
                            ui.horizontal(|ui| {
                                let kind = if p.kind == "socks5" { "SOCKS5" } else { "HTTP" };
                                ui.strong(&p.name);
                                ui.weak(format!("{kind} {}:{}", p.host, p.port));
                                if ui.button("删除").clicked() {
                                    let _ = self.repo.delete_proxy(p.id);
                                    self.proxies = self.repo.list_proxies().unwrap_or_default();
                                    // 清掉站点上的绑定
                                    for s in &self.sites.clone() {
                                        if s.proxy_id == Some(p.id) {
                                            let mut s2 = s.clone();
                                            s2.proxy_id = None;
                                            let _ = self.repo.upsert_site(&s2);
                                        }
                                    }
                                    self.sites = self.repo.list_sites().unwrap_or_default();
                                }
                                if ui.button("编辑").clicked() {
                                    self.edit_proxy = Some(p);
                                }
                            });
                        }
                    });
                ui.separator();
                ui.heading(if self.edit_proxy.as_ref().map(|p| p.id == 0).unwrap_or(true) {
                    "新增代理"
                } else {
                    "编辑代理"
                });
                if self.edit_proxy.is_none() {
                    if ui.button("＋ 新增").clicked() {
                        self.edit_proxy = Some(Proxy {
                            id: 0,
                            name: String::new(),
                            kind: "socks5".into(),
                            host: String::new(),
                            port: 1080,
                            username: None,
                            password: None,
                        });
                    }
                } else {
                    egui::Grid::new("proxy_form")
                        .num_columns(2)
                        .spacing([10.0, 6.0])
                        .show(ui, |ui| {
                            ui.label("名称:");
                            ui.text_edit_singleline(&mut self.edit_proxy.as_mut().unwrap().name);
                            ui.end_row();
                            ui.label("类型:");
                            let kind = self.edit_proxy.as_ref().unwrap().kind.clone();
                            let kind_name = if kind == "socks5" { "SOCKS5" } else { "HTTP" };
                            egui::ComboBox::from_id_salt("proxy_kind")
                                .selected_text(kind_name)
                                .show_ui(ui, |ui| {
                                    ui.selectable_value(
                                        &mut self.edit_proxy.as_mut().unwrap().kind,
                                        "socks5".into(),
                                        "SOCKS5",
                                    );
                                    ui.selectable_value(
                                        &mut self.edit_proxy.as_mut().unwrap().kind,
                                        "http".into(),
                                        "HTTP",
                                    );
                                });
                            ui.end_row();
                            ui.label("主机:");
                            ui.text_edit_singleline(&mut self.edit_proxy.as_mut().unwrap().host);
                            ui.end_row();
                            ui.label("端口:");
                            let port_str = self.edit_proxy.as_ref().unwrap().port.to_string();
                            let mut port_buf = port_str.clone();
                            ui.add(egui::TextEdit::singleline(&mut port_buf).desired_width(60.0));
                            if let Ok(p) = port_buf.trim().parse::<u16>() {
                                self.edit_proxy.as_mut().unwrap().port = p;
                            }
                            ui.end_row();
                            ui.label("用户名:");
                            let mut user = self
                                .edit_proxy
                                .as_ref()
                                .unwrap()
                                .username
                                .clone()
                                .unwrap_or_default();
                            ui.text_edit_singleline(&mut user);
                            self.edit_proxy.as_mut().unwrap().username = Some(user);
                            ui.end_row();
                            ui.label("密码:");
                            let mut pass = self
                                .edit_proxy
                                .as_ref()
                                .unwrap()
                                .password
                                .clone()
                                .unwrap_or_default();
                            ui.add(egui::TextEdit::singleline(&mut pass).password(true));
                            self.edit_proxy.as_mut().unwrap().password = Some(pass);
                            ui.end_row();
                        });
                    ui.separator();
                    ui.horizontal(|ui| {
                        if ui.button("保存").clicked() {
                            let p = self.edit_proxy.as_ref().unwrap();
                            if !p.host.trim().is_empty() && !p.name.trim().is_empty() {
                                let _ = self.repo.upsert_proxy(p);
                                self.proxies = self.repo.list_proxies().unwrap_or_default();
                                self.edit_proxy = None;
                            }
                        }
                        if ui.button("取消").clicked() {
                            self.edit_proxy = None;
                        }
                    });
                }
            });
        if !keep_open {
            self.show_proxy_manager = false;
        }
    }

    fn show_relay_dialog(&mut self, ctx: &egui::Context) {
        let mut keep_open = true;
        egui::Window::new("站点互传（本地中转流水线）")
            .open(&mut keep_open)
            .default_size([520.0, 260.0])
            .show(ctx, |ui| {
                ui.label(format!(
                    "目标：当前连接站点 {} → {}",
                    self.current_site.as_ref().map(|s| format!("{}:{}", s.host, s.port)).unwrap_or_default(),
                    self.remote_dir.as_deref().unwrap_or("/")
                ));
                ui.separator();
                ui.horizontal(|ui| {
                    ui.label("源站点:");
                    let sel = self.relay_site_id;
                    let name = self
                        .sites
                        .iter()
                        .find(|s| Some(s.id) == sel)
                        .map(|s| format!("{} ({}:{})", s.name, s.host, s.port))
                        .unwrap_or_else(|| "（选择站点）".into());
                    egui::ComboBox::from_id_salt("relay_src")
                        .selected_text(name)
                        .show_ui(ui, |ui| {
                            for site in self.sites.clone() {
                                if ui
                                    .selectable_label(Some(site.id) == sel, format!("{} ({}:{})", site.name, site.host, site.port))
                                    .clicked()
                                {
                                    self.relay_site_id = Some(site.id);
                                }
                            }
                        });
                });
                ui.horizontal(|ui| {
                    ui.label("源路径:");
                    ui.add(
                        egui::TextEdit::singleline(&mut self.relay_path).desired_width(360.0),
                    );
                });
                ui.separator();
                ui.horizontal(|ui| {
                    let ready = self.relay_site_id.is_some()
                        && !self.relay_path.trim().is_empty()
                        && self.connected;
                    if ui.add_enabled(ready, egui::Button::new("开始互传")).clicked() {
                        if let Some(site) = self
                            .sites
                            .iter()
                            .find(|s| Some(s.id) == self.relay_site_id)
                            .cloned()
                        {
                            let proxy = self.resolve_proxy(&site);
                            let path = self.relay_path.trim().to_string();
                            self.enqueue_relay(site, proxy, &path);
                            self.show_relay = false;
                        }
                    }
                });
                ui.separator();
                ui.weak("说明：数据在内存中从源站点直转目标站点（8×256KB 缓冲流水线），不写入磁盘。目录将递归复制。");
            });
        if !keep_open {
            self.show_relay = false;
        }
    }

    fn show_dialog(&mut self, ctx: &egui::Context) {
        let Some(_) = &self.dialog else { return };
        let mut open = true;
        let title = match &self.dialog {
            Some(Dialog::MkdirLocal) => "新建本地目录",
            Some(Dialog::MkdirRemote) => "新建远程目录",
            Some(Dialog::RenameLocal(_)) => "重命名",
            Some(Dialog::RenameRemote(_)) => "重命名",
            None => unreachable!(),
        };
        egui::Window::new(title)
            .open(&mut open)
            .fixed_size([300.0, 100.0])
            .show(ctx, |ui| {
                ui.label("名称:");
                ui.text_edit_singleline(&mut self.dialog_text);
                ui.separator();
                ui.horizontal(|ui| {
                    if ui.button("确定(Enter)").clicked() {
                        self.apply_dialog();
                    }
                    if ui.button("取消").clicked() {
                        self.dialog = None;
                    }
                });
            });
        if !open {
            self.dialog = None;
        }
    }

    fn apply_dialog(&mut self) {
        let name = self.dialog_text.trim().to_string();
        if name.is_empty() {
            return;
        }
        match self.dialog.take() {
            Some(Dialog::MkdirLocal) => {
                let p = self.local_dir.join(&name);
                self.send(UiCmd::LocalMkdir { path: p });
                self.refresh_local();
            }
            Some(Dialog::MkdirRemote) => {
                if let Some(d) = &self.remote_dir {
                    let p = flashfxp_lib::bus::remote_join(d, &name);
                    self.send(UiCmd::RemoteMkdir { path: p });
                    self.refresh_remote();
                }
            }
            Some(Dialog::RenameLocal(i)) => {
                if let Some(e) = self.local_entries.get(i) {
                    let from = self.local_dir.join(&e.name);
                    let to = self.local_dir.join(&name);
                    self.send(UiCmd::LocalRename { from, to });
                    self.refresh_local();
                }
            }
            Some(Dialog::RenameRemote(i)) => {
                if let (Some(d), Some(e)) = (&self.remote_dir, self.remote_entries.get(i)) {
                    let from = flashfxp_lib::bus::remote_join(d, &e.name);
                    let to = flashfxp_lib::bus::remote_join(d, &name);
                    self.send(UiCmd::RemoteRename { from, to });
                    self.refresh_remote();
                }
            }
            None => {}
        }
    }

    fn show_toasts(&mut self, ctx: &egui::Context) {
        let now = ctx.input(|i| i.time);
        let screen = ctx.screen_rect();
        let mut y = screen.right_bottom().y - 120.0;
        for (ti, t) in self.toasts.clone().into_iter().enumerate() {
            let color = if t.err {
                egui::Color32::from_rgb(180, 40, 40)
            } else {
                egui::Color32::from_rgb(30, 110, 50)
            };
            egui::Area::new(egui::Id::new(format!("toast{ti}")))
                .order(egui::Order::Foreground)
                .fixed_pos(egui::pos2(screen.right_bottom().x - 320.0, y))
                .show(ctx, |ui| {
                    egui::Frame::popup(ui.style())
                        .fill(color.gamma_multiply(0.2))
                        .show(ui, |ui| {
                            ui.set_max_width(300.0);
                            ui.colored_label(color, t.text.clone());
                            let remaining = (t.until - now).max(0.0);
                            ui.add(
                                egui::ProgressBar::new(remaining as f32 / 6.0)
                                    .desired_width(280.0),
                            );
                        });
                });
            y -= 70.0;
        }
    }
}

enum EntryAction {
    None,
    DirDouble(usize),
    FileDouble(usize),
}
