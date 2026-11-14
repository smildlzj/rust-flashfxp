use crate::bus::Entry;

/// 解析服务器目录列表。优先 MLSD（RFC3659 事实行），回退解析 UNIX/Windows LIST 文本格式。
/// "." ".." 过滤，返回按名称排序的条目。
pub fn parse_dir_listing(raw: &[u8], decode: &dyn Fn(&[u8]) -> String) -> Vec<Entry> {
    let text = decode(raw);
    let mut entries: Vec<Entry> = Vec::new();
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            continue;
        }
        if let Some(e) = parse_mlsx(line) {
            entries.push(e);
        } else if let Some(e) = parse_unix_list(line) {
            entries.push(e);
        } else if let Some(e) = parse_dos_list(line) {
            entries.push(e);
        }
    }
    entries.retain(|e| e.name != "." && e.name != "..");
    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

/// MLSD 事实行。两种风格都要兼容：
/// - 事实间无空格：`type=dir;size=0; docs`
/// - 事实间带空格（pyftpdlib）：`modify=...; size=64;type=dir; 测试`
/// 用最后一个 "; " 定位 entryname；名字本身含 "; " 也不受影响（rfind）。
fn parse_mlsx(line: &str) -> Option<Entry> {
    let facts_end = line.rfind("; ")?;
    let facts_str = &line[..facts_end];
    let mut entry = Entry {
        name: String::new(),
        is_dir: false,
        size: 0,
        mtime: None,
        is_symlink: false,
        perms: None,
    };
    let mut saw_fact = false;
    for fact in facts_str.split(';') {
        let fact = fact.trim();
        if fact.is_empty() {
            continue;
        }
        let (key, val) = fact.split_once('=')?;
        saw_fact = true;
        match key.to_ascii_lowercase().as_str() {
            "type" => match val {
                "dir" | "cdir" | "pdir" => entry.is_dir = true,
                "os.unix=symlink" | "os.unix=link" => entry.is_symlink = true,
                _ => {}
            },
            "size" => entry.size = val.parse().unwrap_or(0),
            "modify" => entry.mtime = parse_mlsx_time(val),
            "unix.mode" => entry.perms = Some(format_mode(val)),
            "unique" => {}
            _ => {}
        }
    }
    if !saw_fact {
        return None;
    }
    let name = &line[facts_end + 2..];
    if name.is_empty() {
        return None;
    }
    entry.name = name.to_string();
    Some(entry)
}

/// "0755" → "drwxr-xr-x"（首字符由调用方 is_dir 决定，这里只给 rwx 串）
fn format_mode(mode: &str) -> String {
    let m = if let Some(stripped) = mode.strip_prefix('0') {
        stripped
    } else {
        mode
    };
    let bits: u32 = m.parse().unwrap_or(0);
    let bit = |i: u32| ((bits >> i) & 1) != 0;
    let tri = |o| {
        let r = if bit(o + 2) { 'r' } else { '-' };
        let w = if bit(o + 1) { 'w' } else { '-' };
        let x = if bit(o) { 'x' } else { '-' };
        [r, w, x].iter().collect::<String>()
    };
    format!("{}{}{}", tri(6), tri(3), tri(0))
}

fn parse_mlsx_time(s: &str) -> Option<i64> {
    if s.len() < 14 || !s.as_bytes()[..14].iter().all(|b| b.is_ascii_digit()) {
        return None;
    }
    chrono::NaiveDateTime::parse_from_str(&s[..14], "%Y%m%d%H%M%S")
        .ok()
        .map(|dt| dt.and_utc().timestamp())
}

const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/// UNIX ls -l：`-rw-r--r-- 1 owner group 123456 Jan 01 12:00 文件名`（可有/无 group，名字可含空格，日期可为年份）
fn parse_unix_list(line: &str) -> Option<Entry> {
    let mut it = line.chars();
    let c0 = it.next()?;
    if !"-dlpcb".contains(c0) {
        return None;
    }
    let perm: String = line.chars().take(10).collect();
    if perm.chars().count() < 10 || perm.chars().any(|c| c.is_whitespace()) {
        return None;
    }
    let perm: String = line.chars().take(10).collect();
    let fields: Vec<&str> = line[10..].split_whitespace().collect();

    // 从权限后字段里定位“size 月 日 时间”四元组，适配有无 group 列
    for i in 0..fields.len() {
        if i + 4 > fields.len() {
            break;
        }
        let size: Option<u64> = fields[i].parse().ok();
        let month_ok = MONTHS.contains(&fields[i + 1]);
        let day_ok = fields[i + 2].parse::<u32>().map(|d| (1..=31).contains(&d)).unwrap_or(false);
        let time_ok = is_unix_time_field(fields[i + 3]);
        if let (Some(size), true, true, true) = (size, month_ok, day_ok, time_ok) {
            let name = fields[i + 4..].join(" ");
            if name.is_empty() {
                return None;
            }
            return Some(Entry {
                name: strip_link_target(&name),
                is_dir: c0 == 'd',
                is_symlink: c0 == 'l',
                size,
                mtime: parse_unix_time(fields[i + 1], fields[i + 2], fields[i + 3]),
                perms: Some(perm.clone()),
            });
        }
    }
    None
}

fn is_unix_time_field(s: &str) -> bool {
    (s.len() == 5 && s.as_bytes()[2] == b':') || s.parse::<i32>().is_ok()
}

fn strip_link_target(name: &str) -> String {
    match name.find(" -> ") {
        Some(i) => name[..i].to_string(),
        None => name.to_string(),
    }
}

fn parse_unix_time(month: &str, day: &str, hm_or_year: &str) -> Option<i64> {
    let mon: u32 = (1..=12).find(|&m| MONTHS[m - 1] == month)? as u32;
    let day: u32 = day.parse().ok()?;
    if let Ok(year) = hm_or_year.parse::<i32>() {
        return chrono::NaiveDate::from_ymd_opt(year, mon, day)?
            .and_hms_opt(0, 0, 0)?
            .and_utc()
            .timestamp()
            .into();
    }
    // 近期文件显示 HH:MM，按当前年份估（跨年误差可接受）
    let year: i32 = chrono::Utc::now().format("%Y").to_string().parse().ok()?;
    let h: u32 = hm_or_year.get(0..2)?.parse().ok()?;
    let m: u32 = hm_or_year.get(3..5)?.parse().ok()?;
    chrono::NaiveDate::from_ymd_opt(year, mon, day)?
        .and_hms_opt(h, m, 0)?
        .and_utc()
        .timestamp()
        .into()
}

/// Windows/MS-DOS：`01-01-24  12:00PM <DIR> docs` 或 `01-01-24  12:00PM 1024 file.txt`
fn parse_dos_list(line: &str) -> Option<Entry> {
    let fields: Vec<&str> = line.split_whitespace().collect();
    if fields.len() < 4 {
        return None;
    }
    let date_ok = {
        let d = fields[0];
        d.len() == 8
            && d.as_bytes()[2] == b'-'
            && d.as_bytes()[5] == b'-'
            && d.replace('-', "").bytes().all(|b| b.is_ascii_digit())
    };
    let time_ok = {
        let t = fields[1];
        (t.len() == 7 && t.as_bytes()[2] == b':')
            && (t.ends_with("AM") || t.ends_with("PM"))
    };
    if !date_ok || !time_ok {
        return None;
    }
    let is_dir = fields[2] == "<DIR>";
    let size: u64 = if is_dir { 0 } else { fields[2].parse().ok()? };
    // 名字取第三个 token 之后，保留后续空格（按剩余原始串）
    let name = remainder_after(line, 3);
    if name.is_empty() {
        return None;
    }
    Some(Entry {
        name,
        is_dir,
        size,
        mtime: parse_dos_time(fields[0], fields[1]),
        is_symlink: false,
        perms: None,
    })
}

/// 返回前 n 个空白分隔 token 之后的原始字符串（保留名字中的空格）
fn remainder_after(line: &str, n: usize) -> String {
    let mut idx = 0;
    let mut count = 0;
    let bytes = line.as_bytes();
    while idx < bytes.len() {
        while idx < bytes.len() && bytes[idx] == b' ' {
            idx += 1;
        }
        if idx >= bytes.len() {
            break;
        }
        count += 1;
        while idx < bytes.len() && bytes[idx] != b' ' {
            idx += 1;
        }
        if count == n {
            return line[idx..].trim().to_string();
        }
    }
    String::new()
}

fn parse_dos_time(date: &str, time: &str) -> Option<i64> {
    let mut it = date.split('-');
    let a: u32 = it.next()?.parse().ok()?;
    let b: u32 = it.next()?.parse().ok()?;
    let c: u32 = it.next()?.parse().ok()?;
    let (mon, day, yy) = (a, b, c);
    let year = if yy < 100 { yy + if yy < 80 { 2000 } else { 1900 } } else { yy };
    let ampm = &time[5..7];
    let core = &time[..5];
    let mut hh: u32 = core.get(0..2)?.parse().ok()?;
    let mm: u32 = core.get(3..5)?.parse().ok()?;
    if ampm == "PM" && hh != 12 {
        hh += 12;
    }
    if ampm == "AM" && hh == 12 {
        hh = 0;
    }
    chrono::NaiveDate::from_ymd_opt(year as i32, mon, day)?
        .and_hms_opt(hh, mm, 0)?
        .and_utc()
        .timestamp()
        .into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(s: &[u8]) -> String {
        String::from_utf8_lossy(s).into_owned()
    }

    #[test]
    fn mlsd() {
        let raw = b"type=dir;size=0;modify=20240101120000; docs\r\ntype=file;size=1024;modify=20240203040506; a b.txt\r\n";
        let entries = parse_dir_listing(raw, &id);
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().any(|e| e.name == "docs" && e.is_dir && e.mtime.is_some()));
        assert!(entries.iter().any(|e| e.name == "a b.txt" && e.size == 1024 && !e.is_dir));
    }

    #[test]
    fn unix_with_group() {
        let raw = b"total 3\r\ndrwxr-xr-x  2 user group    4096 Jan 01 12:00 .\r\ndrwxr-xr-x  2 user group    4096 Feb 13 09:30 ..\r\n-rw-r--r--  1 user group  123456 Jan 01 12:00 file name.txt\r\nlrwxrwxrwx  1 user group      11 Jan 01 12:00 link -> target\r\n";
        let entries = parse_dir_listing(raw, &id);
        assert_eq!(entries.len(), 2);
        let f = entries.iter().find(|e| e.name == "file name.txt").unwrap();
        assert_eq!(f.size, 123456);
        assert!(!f.is_dir);
        let l = entries.iter().find(|e| e.name == "link").unwrap();
        assert!(l.is_symlink);
    }

    #[test]
    fn unix_without_group_and_year() {
        let raw = b"-rw-r--r-- 1 owner 5 Jan 01 2023 old.txt\r\n-rw-r--r-- 1 owner 5 Jan 01 12:00 new.txt\r\n";
        let entries = parse_dir_listing(raw, &id);
        assert_eq!(entries.len(), 2);
        let old = entries.iter().find(|e| e.name == "old.txt").unwrap();
        assert!(old.mtime.unwrap() > 0);
        let new_ = entries.iter().find(|e| e.name == "new.txt").unwrap();
        assert!(new_.mtime.unwrap() > 0);
    }

    #[test]
    fn dos() {
        let raw = b"01-01-24  12:00PM       <DIR>          docs\r\n01-01-24  12:00PM               1024 file.txt\r\n";
        let entries = parse_dir_listing(raw, &id);
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().any(|e| e.name == "docs" && e.is_dir));
        assert!(entries.iter().any(|e| e.name == "file.txt" && e.size == 1024));
    }

    #[test]
    fn gbk_names() {
        // "-rw-r--r-- 1 u g 1 Jan 01 12:00 中文.txt" 用 GBK 编码
        let prefix = b"-rw-r--r-- 1 u g 1 Jan 01 12:00 ";
        let mut raw: Vec<u8> = prefix.to_vec();
        let (gbk, _, _) = encoding_rs::GBK.encode("中文.txt");
        raw.extend_from_slice(&gbk);
        raw.extend_from_slice(b"\r\n");
        let entries = parse_dir_listing(&raw, &decode_gbk);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "中文.txt");
    }

    fn decode_gbk(b: &[u8]) -> String {
        encoding_rs::GBK.decode(b).0.into_owned()
    }

    #[test]
    fn junk_ignored() {
        let raw = b"total 3\r\nsome random line without meaning\r\nanother\r\n";
        assert!(parse_dir_listing(raw, &id).is_empty());
    }
}

