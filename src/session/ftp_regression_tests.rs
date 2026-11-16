//! Self-contained wire tests: only loopback sockets and temporary files, no user DB.
use super::*;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::thread;
use std::time::Duration;

type Step = (&'static str, &'static str);

struct Server {
    port: u16,
    worker: thread::JoinHandle<()>,
}

impl Server {
    fn start(steps: Vec<Step>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        let worker = thread::spawn(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(5);
            let mut stream = loop {
                match listener.accept() {
                    Ok((s, _)) => break s,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            std::time::Instant::now() < deadline,
                            "client did not connect"
                        );
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(e) => panic!("accept: {e}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            stream.set_nodelay(true).unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            stream.write_all(b"220 Regression fixture\r\n").unwrap();
            let mut data_listener = None;
            for (expected, response) in steps {
                let mut command = String::new();
                reader.read_line(&mut command).unwrap();
                assert_eq!(command.trim_end_matches(['\r', '\n']), expected);
                if expected == "PASV" {
                    let data = TcpListener::bind("127.0.0.1:0").unwrap();
                    let port = data.local_addr().unwrap().port();
                    write!(
                        stream,
                        "227 Passive (127,0,0,1,{},{})\r\n",
                        port / 256,
                        port % 256
                    )
                    .unwrap();
                    data_listener = Some(data);
                } else if let Some(body) = response.strip_prefix("DATA:") {
                    stream.write_all(b"150 Sending data\r\n").unwrap();
                    let listener = data_listener.take().unwrap();
                    listener.set_nonblocking(true).unwrap();
                    let deadline = std::time::Instant::now() + Duration::from_secs(3);
                    let mut data = loop {
                        match listener.accept() {
                            Ok((s, _)) => break s,
                            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                assert!(
                                    std::time::Instant::now() < deadline,
                                    "missing data connection"
                                );
                                thread::sleep(Duration::from_millis(5));
                            }
                            Err(e) => panic!("data accept: {e}"),
                        }
                    };
                    data.set_nonblocking(false).unwrap();
                    data.write_all(body.as_bytes()).unwrap();
                    drop(data);
                    stream.write_all(b"226 Done\r\n").unwrap();
                } else {
                    stream.write_all(response.as_bytes()).unwrap();
                }
            }
        });
        Self { port, worker }
    }

    fn site(&self) -> Site {
        Site {
            id: 0,
            group_id: None,
            name: "fixture".into(),
            host: "127.0.0.1".into(),
            port: self.port,
            protocol: "ftp".into(),
            username: Some("test".into()),
            password: Some("secret".into()),
            account: None,
            encoding: "auto".into(),
            passive_mode: true,
            login_cmds: None,
            proxy_id: None,
            tls_accept_invalid: false,
            local_path: None,
            remote_path: None,
            notes: String::new(),
            login_type: "normal".into(),
            timezone_offset_minutes: None,
        }
    }

    fn finish(self) {
        self.worker.join().unwrap();
    }
}

#[tokio::test]
async fn acct_after_password_challenge() {
    let server = Server::start(vec![
        ("USER test", "331 Password\r\n"),
        ("PASS secret", "332 Account required\r\n"),
        ("ACCT billing", "230 Logged in\r\n"),
        ("TYPE I", "200 Binary\r\n"),
    ]);
    let mut site = server.site();
    site.account = Some("billing".into());
    let result = FtpConn::open(&site, None).await;
    assert!(result.is_ok(), "{:?}", result.err());
    server.finish();
}

#[tokio::test]
async fn acct_after_username_challenge() {
    let server = Server::start(vec![
        ("USER test", "332 Account required\r\n"),
        ("ACCT billing", "230 Logged in\r\n"),
        ("TYPE I", "200 Binary\r\n"),
    ]);
    let mut site = server.site();
    site.account = Some("billing".into());
    let result = FtpConn::open(&site, None).await;
    assert!(result.is_ok(), "{:?}", result.err());
    server.finish();
}

#[tokio::test]
async fn configured_acct_after_successful_login() {
    let server = Server::start(vec![
        ("USER test", "331 Password\r\n"),
        ("PASS secret", "230 Logged in\r\n"),
        ("ACCT billing", "202 Account unnecessary\r\n"),
        ("TYPE I", "200 Binary\r\n"),
    ]);
    let mut site = server.site();
    site.account = Some("billing".into());
    let result = FtpConn::open(&site, None).await;
    assert!(result.is_ok(), "{:?}", result.err());
    server.finish();
}

#[tokio::test]
async fn acct_missing_or_rejected_fails_before_setup() {
    for account in [None, Some("wrong")] {
        let mut steps = vec![
            ("USER test", "331 Password\r\n"),
            ("PASS secret", "332 Account required\r\n"),
        ];
        if account.is_some() {
            steps.push(("ACCT wrong", "530 Rejected\r\n"));
        }
        let server = Server::start(steps);
        let mut site = server.site();
        site.account = account.map(str::to_string);
        let error = FtpConn::open(&site, None)
            .await
            .err()
            .expect("must reject login");
        assert!(error.contains("ACCT"), "{error}");
        server.finish();
    }
}

#[tokio::test]
async fn regular_login_does_not_send_acct() {
    let server = Server::start(vec![
        ("USER test", "331 Password\r\n"),
        ("PASS secret", "230 Logged in\r\n"),
        ("TYPE I", "200 Binary\r\n"),
    ]);
    let result = FtpConn::open(&server.site(), None).await;
    assert!(result.is_ok(), "{:?}", result.err());
    server.finish();
}

async fn next_listing(rx: &std::sync::mpsc::Receiver<UiEvent>) -> String {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(4);
    loop {
        while let Ok(event) = rx.try_recv() {
            match event {
                UiEvent::RemoteList { path, .. } => return path,
                UiEvent::Notify { text, .. } => panic!("{text}"),
                _ => {}
            }
        }
        assert!(tokio::time::Instant::now() < deadline, "listing timed out");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
}

#[tokio::test]
async fn relative_initial_path_is_absolute_on_refresh_and_transfer() {
    let server = Server::start(vec![
        ("USER test", "331 Password\r\n"),
        ("PASS secret", "230 Logged in\r\n"),
        ("TYPE I", "200 Binary\r\n"),
        ("PWD", "257 \"/home/test\"\r\n"),
        ("CWD uploads", "250 Changed\r\n"),
        ("PWD", "257 \"/home/test/uploads\"\r\n"),
        (
            "FEAT",
            "211-Features\r\n MLST type*;size*;modify*;\r\n211 End\r\n",
        ),
        ("PASV", ""),
        ("MLSD", "DATA:type=file;size=5; report.txt\r\n"),
        ("CWD /home/test/uploads", "250 Changed\r\n"),
        ("PWD", "257 \"/home/test/uploads\"\r\n"),
        ("PASV", ""),
        ("MLSD", "DATA:type=file;size=5; report.txt\r\n"),
    ]);
    let mut site = server.site();
    site.remote_path = Some("uploads".into());
    let (tx, rx) = unbounded_channel();
    let (events, received) = std::sync::mpsc::channel();
    let task = tokio::spawn(run_session(rx, events, site, None));
    let path = next_listing(&received).await;
    assert_eq!(path, "/home/test/uploads");
    tx.send(SessionCmd::List { path: path.clone() }).unwrap();
    assert_eq!(next_listing(&received).await, path);
    drop(tx);
    task.await.unwrap();
    server.finish();

    // A fresh transfer connection starts in its login directory, so RETR must be absolute.
    let transfer_server = Server::start(vec![
        ("USER test", "331 Password\r\n"),
        ("PASS secret", "230 Logged in\r\n"),
        ("TYPE I", "200 Binary\r\n"),
        ("PASV", ""),
        ("RETR /home/test/uploads/report.txt", "DATA:hello"),
    ]);
    let mut session = FtpSession::connect(&transfer_server.site(), None)
        .await
        .unwrap();
    let file = std::env::temp_dir().join(format!(
        "rustftp-review-{}-{}.txt",
        std::process::id(),
        transfer_server.port
    ));
    let (events, _) = std::sync::mpsc::channel();
    session
        .download_file(&remote_join(&path, "report.txt"), &file, 1, 5, 0, &events)
        .await
        .unwrap();
    assert_eq!(std::fs::read(&file).unwrap(), b"hello");
    std::fs::remove_file(file).unwrap();
    drop(session);
    transfer_server.finish();
}

#[tokio::test]
async fn password_rejection_does_not_send_acct() {
    let server = Server::start(vec![
        ("USER test", "331 Password\r\n"),
        ("PASS secret", "530 Wrong password\r\n"),
    ]);
    let mut site = server.site();
    site.account = Some("billing".into());
    let error = FtpConn::open(&site, None)
        .await
        .err()
        .expect("must fail login");
    assert!(error.contains("登录失败"), "{error}");
    server.finish();
}

#[tokio::test]
async fn required_acct_must_complete_authentication() {
    let server = Server::start(vec![
        ("USER test", "332 Account required\r\n"),
        ("ACCT billing", "202 Not implemented\r\n"),
    ]);
    let mut site = server.site();
    site.account = Some("billing".into());
    let error = FtpConn::open(&site, None)
        .await
        .err()
        .expect("202 cannot complete required authentication");
    assert!(error.contains("ACCT"), "{error}");
    server.finish();
}

#[tokio::test]
async fn failed_initial_listing_restores_login_directory() {
    let server = Server::start(vec![
        ("USER test", "331 Password\r\n"),
        ("PASS secret", "230 Logged in\r\n"),
        ("TYPE I", "200 Binary\r\n"),
        ("PWD", "257 \"/home/test\"\r\n"),
        ("CWD uploads", "250 Changed\r\n"),
        ("PWD", "257 \"/home/test/uploads\"\r\n"),
        (
            "FEAT",
            "211-Features\r\n MLST type*;size*;modify*;\r\n211 End\r\n",
        ),
        ("PASV", ""),
        ("MLSD", "550 Cannot list\r\n"),
        ("CWD /home/test", "250 Restored\r\n"),
        ("PWD", "257 \"/home/test\"\r\n"),
        ("PASV", ""),
        ("MLSD", "DATA:"),
    ]);
    let mut site = server.site();
    site.remote_path = Some("uploads".into());
    let (tx, rx) = unbounded_channel();
    let (events, received) = std::sync::mpsc::channel();
    let task = tokio::spawn(run_session(rx, events, site, None));
    let mut notices = Vec::new();
    let path = tokio::time::timeout(Duration::from_secs(4), async {
        loop {
            while let Ok(event) = received.try_recv() {
                match event {
                    UiEvent::Notify { text, .. } => notices.push(text),
                    UiEvent::RemoteList { path, .. } => return path,
                    _ => {}
                }
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(path, "/home/test");
    assert_eq!(notices.len(), 1);
    assert!(notices[0].contains("uploads"));
    drop(tx);
    task.await.unwrap();
    server.finish();
}
