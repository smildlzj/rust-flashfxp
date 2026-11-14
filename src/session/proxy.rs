use async_std::io::{ReadExt, WriteExt};
use base64::Engine as _;

use crate::store::Proxy;

/// 经代理建立到目标的 TCP 连接（返回 async_std TcpStream，供 connect_with_stream 使用）
pub async fn dial_via_proxy(
    proxy: &Proxy,
    target_host: &str,
    target_port: u16,
) -> Result<async_std::net::TcpStream, String> {
    let stream = async_std::net::TcpStream::connect((proxy.host.as_str(), proxy.port))
        .await
        .map_err(|e| format!("连接代理 {}:{} 失败: {e}", proxy.host, proxy.port))?;
    match proxy.kind.as_str() {
        "socks5" => socks5_handshake(stream, proxy, target_host, target_port).await,
        "http" => http_connect(stream, proxy, target_host, target_port).await,
        other => Err(format!("不支持的代理类型: {other}")),
    }
}

async fn socks5_handshake(
    mut stream: async_std::net::TcpStream,
    proxy: &Proxy,
    target_host: &str,
    target_port: u16,
) -> Result<async_std::net::TcpStream, String> {
    let has_auth = proxy.username.as_deref().is_some_and(|u| !u.is_empty());
    stream
        .write_all(if has_auth { &[0x05, 0x02, 0x00, 0x02] } else { &[0x05, 0x01, 0x00] })
        .await
        .map_err(|e| format!("代理握手失败: {e}"))?;
    let mut b = [0u8; 2];
    stream
        .read_exact(&mut b)
        .await
        .map_err(|e| format!("代理握手失败: {e}"))?;
    if b[0] != 0x05 {
        return Err("代理协议版本不符".into());
    }
    match b[1] {
        0x00 => {}
        0x02 => {
            let user = proxy.username.as_deref().unwrap_or("");
            let pass = proxy.password.as_deref().unwrap_or("");
            let mut auth = vec![0x01, user.len() as u8];
            auth.extend_from_slice(user.as_bytes());
            auth.push(pass.len() as u8);
            auth.extend_from_slice(pass.as_bytes());
            stream
                .write_all(&auth)
                .await
                .map_err(|e| format!("代理认证失败: {e}"))?;
            let mut r = [0u8; 2];
            stream
                .read_exact(&mut r)
                .await
                .map_err(|e| format!("代理认证失败: {e}"))?;
            if r[1] != 0x00 {
                return Err("代理认证被拒绝".into());
            }
        }
        other => return Err(format!("代理要求不支持的认证方式: {other}")),
    }
    // CONNECT 请求（域名形式，远端 DNS）
    let host_bytes = target_host.as_bytes();
    if host_bytes.is_empty() || host_bytes.len() > 255 {
        return Err("目标主机名非法".into());
    }
    let mut req = vec![0x05, 0x01, 0x00, 0x03, host_bytes.len() as u8];
    req.extend_from_slice(host_bytes);
    req.extend_from_slice(&target_port.to_be_bytes());
    stream
        .write_all(&req)
        .await
        .map_err(|e| format!("发送代理请求失败: {e}"))?;
    let mut head = [0u8; 4];
    stream
        .read_exact(&mut head)
        .await
        .map_err(|e| format!("代理响应失败: {e}"))?;
    if head[1] != 0x00 {
        return Err(format!("代理连接被拒绝: 状态码 {}", head[1]));
    }
    let skip = match head[3] {
        0x01 => 6,
        0x03 => {
            let mut l = [0u8; 1];
            stream
                .read_exact(&mut l)
                .await
                .map_err(|e| format!("代理响应失败: {e}"))?;
            l[0] as usize + 2
        }
        0x04 => 18,
        other => return Err(format!("代理地址类型非法: {other}")),
    };
    let mut sink = vec![0u8; skip];
    stream
        .read_exact(&mut sink)
        .await
        .map_err(|e| format!("代理响应失败: {e}"))?;
    Ok(stream)
}

async fn http_connect(
    mut stream: async_std::net::TcpStream,
    proxy: &Proxy,
    target_host: &str,
    target_port: u16,
) -> Result<async_std::net::TcpStream, String> {
    let mut req = format!(
        "CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\n"
    );
    if let Some(user) = proxy.username.as_deref().filter(|u| !u.is_empty()) {
        let creds = base64::engine::general_purpose::STANDARD.encode(format!(
            "{user}:{}",
            proxy.password.as_deref().unwrap_or("")
        ));
        req.push_str(&format!("Proxy-Authorization: Basic {creds}\r\n"));
    }
    req.push_str("\r\n");
    stream
        .write_all(req.as_bytes())
        .await
        .map_err(|e| format!("发送 CONNECT 失败: {e}"))?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1];
    loop {
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|e| format!("读取代理响应失败: {e}"))?;
        if n == 0 {
            return Err("代理提前断开".into());
        }
        buf.push(chunk[0]);
        if buf.ends_with(b"\r\n\r\n") {
            break;
        }
        if buf.len() > 8192 {
            return Err("代理响应过长".into());
        }
    }
    let head = String::from_utf8_lossy(&buf);
    let first = head.lines().next().unwrap_or_default();
    if !first.contains(" 200 ") && !first.ends_with(" 200") {
        return Err(format!("代理 CONNECT 失败: {first}"));
    }
    Ok(stream)
}
