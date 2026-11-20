//! Route suppaftp's control-channel records to the window that owns the operation.
use std::cell::Cell;
use std::future::Future;
use std::sync::{mpsc::Sender, Once};

use log::{Level, LevelFilter, Log, Metadata, Record};

use crate::bus::UiEvent;

type Emit = Box<dyn Fn(UiEvent) + Send>;

struct Context {
    emit: Emit,
    skip_duplicate: Cell<bool>,
    peer: Option<String>,
}

pub(super) async fn with_ftp_events<T>(
    event_tx: Sender<UiEvent>,
    peer: Option<String>,
    operation: impl Future<Output = T>,
) -> T {
    with_ftp_log(
        peer,
        move |event| {
            let _ = event_tx.send(event);
        },
        operation,
    )
    .await
}

tokio::task_local! {
    static CONTEXT: Context;
}

pub async fn with_ftp_log<T>(
    peer: Option<String>,
    emit: impl Fn(UiEvent) + Send + 'static,
    operation: impl Future<Output = T>,
) -> T {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        log::set_logger(&ControlLogger).expect("FTP control logger must be the application logger");
        log::set_max_level(LevelFilter::Trace);
    });
    CONTEXT
        .scope(
            Context {
                emit: Box::new(emit),
                skip_duplicate: Cell::new(false),
                peer,
            },
            operation,
        )
        .await
}

struct ControlLogger;

impl Log for ControlLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.level() == Level::Trace && metadata.target() == "suppaftp::async_ftp"
    }

    fn log(&self, record: &Record<'_>) {
        if self.enabled(record.metadata()) {
            let _ = CONTEXT.try_with(|context| {
                let message = record.args().to_string();
                let event = if let Some(command) = message.strip_prefix("CC OUT: ") {
                    context.skip_duplicate.set(false);
                    let verb = command.split_ascii_whitespace().next().unwrap_or_default();
                    let text = if ["PASS", "ACCT", "ADAT"]
                        .iter()
                        .any(|secret| verb.eq_ignore_ascii_case(secret))
                    {
                        format!("{verb} ********")
                    } else {
                        command.to_owned()
                    };
                    UiEvent::FtpLog {
                        command: true,
                        peer: context.peer.clone(),
                        text,
                    }
                } else if let Some(line) = message.strip_prefix("CC IN: ") {
                    let Ok(bytes) = serde_json::from_str::<Vec<u8>>(line) else {
                        return;
                    };
                    if context.skip_duplicate.replace(false) {
                        return;
                    }
                    let text = String::from_utf8_lossy(&bytes)
                        .trim_end_matches(['\r', '\n'])
                        .to_owned();
                    UiEvent::FtpLog {
                        command: false,
                        peer: context.peer.clone(),
                        text,
                    }
                } else if let Some(line) = message.strip_prefix("FEAT IN: ") {
                    // FEAT reads its extension lines separately from read_response_in.
                    let Ok(text) = serde_json::from_str::<String>(line) else {
                        return;
                    };
                    UiEvent::FtpLog {
                        command: false,
                        peer: context.peer.clone(),
                        text: text.trim_end_matches(['\r', '\n']).to_owned(),
                    }
                } else {
                    // Suppaftp 6.3 traces the first reply line before and after parsing its code.
                    if message.starts_with("Code parsed from response: ") {
                        context.skip_duplicate.set(true);
                    }
                    return;
                };
                (context.emit)(event);
            });
        }
    }

    fn flush(&self) {}
}
