//! 经典 Win32 视觉：立体描边（凸起/凹陷）+ 矢量小图标，替代默认 egui 圆角风格
use eframe::egui;

const FACE: egui::Color32 = egui::Color32::from_rgb(236, 233, 216);
const FACE_DARK: egui::Color32 = egui::Color32::from_rgb(215, 211, 190);
const LIGHT: egui::Color32 = egui::Color32::from_rgb(255, 255, 255);
const DARK: egui::Color32 = egui::Color32::from_rgb(120, 118, 108);
const BLACK: egui::Color32 = egui::Color32::BLACK;

/// 凸起（按钮）/ 凹陷（输入框、列表）描边
pub fn bevel(p: &egui::Painter, rect: egui::Rect, raised: bool) {
    let (tl, br) = if raised {
        (LIGHT, DARK)
    } else {
        (DARK, LIGHT)
    };
    p.line_segment(
        [rect.left_top(), rect.right_top()],
        egui::Stroke::new(1.0, tl),
    );
    p.line_segment(
        [rect.left_top(), rect.left_bottom()],
        egui::Stroke::new(1.0, tl),
    );
    p.line_segment(
        [rect.right_top(), rect.right_bottom()],
        egui::Stroke::new(1.0, br),
    );
    p.line_segment(
        [rect.left_bottom(), rect.right_bottom()],
        egui::Stroke::new(1.0, br),
    );
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Icon {
    Connect,
    Disconnect,
    Refresh,
    Up,
    NewDir,
    Rename,
    Delete,
    Upload,
    Download,
    Compare,
    Relay,
    Queue,
}

/// 经典 16 色调色板
const C_GREEN: egui::Color32 = egui::Color32::from_rgb(0, 130, 0);
const C_RED: egui::Color32 = egui::Color32::from_rgb(200, 0, 0);
const C_BLUE: egui::Color32 = egui::Color32::from_rgb(0, 70, 200);
const C_NAVY: egui::Color32 = egui::Color32::from_rgb(0, 0, 128);
const C_GOLD: egui::Color32 = egui::Color32::from_rgb(230, 160, 0);
const C_DGRAY: egui::Color32 = egui::Color32::from_rgb(80, 80, 80);

/// 用 painter 画小图标（中心对齐到 rect）
pub fn draw_icon(p: &egui::Painter, icon: Icon, rect: egui::Rect) {
    let c = rect.center();
    let w = rect.width();
    let h = rect.height();
    let s = w.min(h) / 2.0; // 半径
    match icon {
        Icon::Connect => {
            // 闪电
            let pts = vec![
                egui::pos2(c.x + s * 0.2, c.y - s),
                egui::pos2(c.x - s * 0.5, c.y + s * 0.1),
                egui::pos2(c.x - s * 0.05, c.y + s * 0.1),
                egui::pos2(c.x - s * 0.2, c.y + s),
                egui::pos2(c.x + s * 0.5, c.y - s * 0.15),
                egui::pos2(c.x + s * 0.05, c.y - s * 0.15),
            ];
            p.add(egui::Shape::convex_polygon(pts, C_GOLD, egui::Stroke::NONE));
        }
        Icon::Disconnect => {
            let r = rect.shrink(2.0);
            p.rect_filled(r, 0.0, C_RED);
            p.line_segment(
                [r.left_top() + egui::vec2(3.0, 3.0), r.right_bottom() - egui::vec2(3.0, 3.0)],
                egui::Stroke::new(2.0, LIGHT),
            );
            p.line_segment(
                [r.right_top() + egui::vec2(-3.0, 3.0), r.left_bottom() - egui::vec2(-3.0, 3.0)],
                egui::Stroke::new(2.0, LIGHT),
            );
        }
        Icon::Refresh => {
            // 圆弧 + 箭头
            let r = s * 0.75;
            p.circle_stroke(c, r, egui::Stroke::new(2.0, C_GREEN));
            p.add(egui::Shape::convex_polygon(
                vec![
                    egui::pos2(c.x + r, c.y - r),
                    egui::pos2(c.x + r + 4.0, c.y - r - 2.0),
                    egui::pos2(c.x + r + 1.0, c.y - r - 6.0),
                ],
                C_GREEN,
                egui::Stroke::NONE,
            ));
        }
        Icon::Up => {
            p.add(egui::Shape::convex_polygon(
                vec![
                    egui::pos2(c.x, c.y - s),
                    egui::pos2(c.x - s * 0.7, c.y),
                    egui::pos2(c.x - s * 0.25, c.y),
                    egui::pos2(c.x - s * 0.25, c.y + s),
                    egui::pos2(c.x + s * 0.25, c.y + s),
                    egui::pos2(c.x + s * 0.25, c.y),
                    egui::pos2(c.x + s * 0.7, c.y),
                ],
                C_BLUE,
                egui::Stroke::NONE,
            ));
        }
        Icon::NewDir => {
            // 文件夹：黄色带标签页
            let r = rect.shrink(3.0);
            let tab = egui::Rect::from_min_size(r.left_top(), egui::vec2(r.width() * 0.45, 3.0));
            p.rect_filled(tab, 0.0, C_GOLD.gamma_multiply(0.8));
            p.rect_filled(r, 0.0, C_GOLD);
            p.rect_stroke(r, 0.0, egui::Stroke::new(1.0, C_DGRAY), egui::StrokeKind::Middle);
        }
        Icon::Rename => {
            // 铅笔
            let a = c + egui::vec2(-s * 0.6, s * 0.6);
            let b = c + egui::vec2(s * 0.7, -s * 0.7);
            p.line_segment([a, b], egui::Stroke::new(3.0, C_NAVY));
            p.line_segment(
                [a, a + egui::vec2(3.0, -3.0)],
                egui::Stroke::new(3.0, C_GOLD),
            );
        }
        Icon::Delete => {
            let r = s * 0.7;
            p.line_segment(
                [c + egui::vec2(-r, -r), c + egui::vec2(r, r)],
                egui::Stroke::new(2.5, C_RED),
            );
            p.line_segment(
                [c + egui::vec2(r, -r), c + egui::vec2(-r, r)],
                egui::Stroke::new(2.5, C_RED),
            );
        }
        Icon::Upload | Icon::Download => {
            let up = icon == Icon::Upload;
            let color = if up { C_BLUE } else { C_GREEN };
            let dir = if up { -1.0 } else { 1.0 };
            // 箭头
            let tip = egui::pos2(c.x, c.y + dir * s * 0.7);
            p.add(egui::Shape::convex_polygon(
                vec![
                    tip,
                    egui::pos2(c.x - s * 0.45, c.y + dir * -0.1 * s + dir * s * 0.2),
                    egui::pos2(c.x + s * 0.45, c.y + dir * -0.1 * s + dir * s * 0.2),
                ],
                color,
                egui::Stroke::NONE,
            ));
            // 杆
            p.line_segment(
                [egui::pos2(c.x, c.y - dir * s * 0.6), egui::pos2(c.x, c.y + dir * s * 0.2)],
                egui::Stroke::new(2.0, color),
            );
            // 托盘
            let tray_y = c.y + if up { s * 0.9 } else { -s * 0.2 };
            p.line_segment(
                [
                    egui::pos2(c.x - s * 0.8, tray_y),
                    egui::pos2(c.x + s * 0.8, tray_y),
                ],
                egui::Stroke::new(2.0, C_DGRAY),
            );
        }
        Icon::Compare => {
            let r1 = egui::Rect::from_center_size(
                c + egui::vec2(-3.0, 0.0),
                egui::vec2(w * 0.55, h * 0.7),
            );
            let r2 = egui::Rect::from_center_size(
                c + egui::vec2(3.0, 0.0),
                egui::vec2(w * 0.55, h * 0.7),
            );
            p.rect_filled(r1, 0.0, C_BLUE.gamma_multiply(0.25));
            p.rect_stroke(r1, 0.0, egui::Stroke::new(1.0, C_BLUE), egui::StrokeKind::Middle);
            p.rect_filled(r2, 0.0, C_GREEN.gamma_multiply(0.25));
            p.rect_stroke(r2, 0.0, egui::Stroke::new(1.0, C_GREEN), egui::StrokeKind::Middle);
        }
        Icon::Relay => {
            // ⇄ 双向箭头
            p.line_segment(
                [c + egui::vec2(-s * 0.8, -s * 0.3), c + egui::vec2(s * 0.6, -s * 0.3)],
                egui::Stroke::new(2.0, C_GOLD),
            );
            p.add(egui::Shape::convex_polygon(
                vec![
                    c + egui::vec2(s * 0.8, -s * 0.3),
                    c + egui::vec2(s * 0.4, -s * 0.6),
                    c + egui::vec2(s * 0.4, 0.0),
                ],
                C_GOLD,
                egui::Stroke::NONE,
            ));
            p.line_segment(
                [c + egui::vec2(s * 0.8, s * 0.3), c + egui::vec2(-s * 0.6, s * 0.3)],
                egui::Stroke::new(2.0, C_GOLD),
            );
            p.add(egui::Shape::convex_polygon(
                vec![
                    c + egui::vec2(-s * 0.8, s * 0.3),
                    c + egui::vec2(-s * 0.4, s * 0.0),
                    c + egui::vec2(-s * 0.4, s * 0.6),
                ],
                C_GOLD,
                egui::Stroke::NONE,
            ));
        }
        Icon::Queue => {
            for i in 0..3 {
                let y = c.y - s * 0.6 + i as f32 * (s * 0.6);
                p.line_segment(
                    [egui::pos2(c.x - s * 0.8, y), egui::pos2(c.x + s * 0.8, y)],
                    egui::Stroke::new(2.0, if i == 0 { C_NAVY } else { C_DGRAY }),
                );
            }
        }
    }
}

/// 经典图标按钮：凸起描边 + 悬停高亮
pub fn icon_button(
    ui: &mut egui::Ui,
    icon: Icon,
    tip: &str,
    enabled: bool,
) -> egui::Response {
    let size = egui::vec2(24.0, 22.0);
    let (rect, resp) = ui.allocate_exact_size(size, egui::Sense::click());
    let resp = if enabled {
        resp
    } else {
        resp.on_disabled_hover_text(tip)
    };
    if ui.is_rect_visible(rect) {
        let p = ui.painter();
        let fill = if resp.hovered() && enabled {
            FACE_DARK
        } else {
            FACE
        };
        p.rect_filled(rect, 0.0, fill);
        bevel(p, rect, true);
        if enabled {
            draw_icon(p, icon, rect.shrink(3.0));
        } else {
            // 禁用态：画图标后罩一层半透明底色变灰
            draw_icon(p, icon, rect.shrink(3.0));
            p.rect_filled(rect.shrink(3.0), 0.0, FACE.gamma_multiply(0.6));
        }
    }
    if enabled {
        resp.on_hover_text(tip)
    } else {
        resp
    }
}

/// 凹陷输入框容器：白底 + 立体凹陷边
pub fn sunken_field(ui: &mut egui::Ui, add_contents: impl FnOnce(&mut egui::Ui)) {
    egui::Frame::NONE
        .fill(egui::Color32::WHITE)
        .inner_margin(egui::Margin::symmetric(4, 3))
        .show(ui, |ui| add_contents(ui));
    let r = ui.min_rect();
    bevel(ui.painter(), r, false);
}
