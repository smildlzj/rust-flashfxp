mod app;

use flashfxp_lib::{bus, session};

fn main() -> eframe::Result {
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1100.0, 700.0])
            .with_title("Rust FlashFXP"),
        ..Default::default()
    };
    eframe::run_native(
        "Rust FlashFXP",
        options,
        Box::new(|cc| Ok(Box::new(app::App::new(cc)))),
    )
}
