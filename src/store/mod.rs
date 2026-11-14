mod crypto;

use rusqlite::Connection;

use crypto::Cipher;

const DB_DIR_NAME: &str = ".rust-flashfxp";

pub fn open_db() -> anyhow::Result<Connection> {
    let db_dir = db_dir()?;
    std::fs::create_dir_all(&db_dir)?;
    let db_path = db_dir.join("flashfxp.db");
    let conn = Connection::open(&db_path)?;
    init_schema(&conn)?;
    Ok(conn)
}

fn db_dir() -> anyhow::Result<std::path::PathBuf> {
    std::env::home_dir()
        .map(|h| h.join(DB_DIR_NAME))
        .ok_or_else(|| anyhow::anyhow!("无法定位用户主目录"))
}

fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY,
            parent_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
            name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sites (
            id INTEGER PRIMARY KEY,
            group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 21,
            protocol TEXT NOT NULL DEFAULT 'ftp',
            username TEXT,
            password_enc BLOB,
            encoding TEXT NOT NULL DEFAULT 'auto',
            passive_mode INTEGER NOT NULL DEFAULT 1,
            proxy_id INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
            login_cmds TEXT,
            tls_accept_invalid INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS proxies (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER NOT NULL,
            username TEXT,
            password_enc BLOB
        );
        CREATE TABLE IF NOT EXISTS queue_items (
            id INTEGER PRIMARY KEY,
            kind TEXT NOT NULL,
            src TEXT NOT NULL,
            dst TEXT NOT NULL,
            size INTEGER NOT NULL DEFAULT 0,
            offset INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            error TEXT,
            retries INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS app_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )
}

pub struct SiteRepo {
    conn: Connection,
    cipher: Cipher,
}

#[derive(Debug, Clone)]
pub struct Site {
    pub id: i64,
    pub group_id: Option<i64>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub protocol: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub encoding: String,
    pub passive_mode: bool,
    pub login_cmds: Option<String>,
    pub proxy_id: Option<i64>,
    pub tls_accept_invalid: bool,
}

#[derive(Debug, Clone)]
pub struct Proxy {
    pub id: i64,
    pub name: String,
    pub kind: String, // "socks5" | "http"
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct Group {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
}

impl SiteRepo {
    pub fn open() -> anyhow::Result<Self> {
        Ok(Self {
            conn: open_db()?,
            cipher: Cipher::new(),
        })
    }

    pub fn list_groups(&self) -> anyhow::Result<Vec<Group>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, parent_id, name FROM groups ORDER BY name")?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Group {
                    id: r.get(0)?,
                    parent_id: r.get(1)?,
                    name: r.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn list_sites(&self) -> anyhow::Result<Vec<Site>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, group_id, name, host, port, protocol, username, password_enc, encoding, passive_mode, login_cmds, proxy_id, tls_accept_invalid FROM sites ORDER BY name",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let enc: Option<Vec<u8>> = r.get(7)?;
                let password = enc.and_then(|b| self.cipher.decrypt(&b).ok());
                Ok(Site {
                    id: r.get(0)?,
                    group_id: r.get(1)?,
                    name: r.get(2)?,
                    host: r.get(3)?,
                    port: r.get(4)?,
                    protocol: r.get(5)?,
                    username: r.get(6)?,
                    password,
                    encoding: r.get(8)?,
                    passive_mode: r.get::<_, i64>(9)? == 1,
                    login_cmds: r.get(10)?,
                    proxy_id: r.get(11)?,
                    tls_accept_invalid: r.get::<_, i64>(12)? == 1,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn upsert_site(&self, site: &Site) -> anyhow::Result<i64> {
        let enc: Option<Vec<u8>> = site
            .password
            .as_deref()
            .filter(|p| !p.is_empty())
            .map(|p| self.cipher.encrypt(p))
            .transpose()?;
        if site.id == 0 {
            self.conn.execute(
                "INSERT INTO sites (group_id, name, host, port, protocol, username, password_enc, encoding, passive_mode, login_cmds, proxy_id, tls_accept_invalid, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                rusqlite::params![
                    site.group_id,
                    site.name,
                    site.host,
                    site.port,
                    site.protocol,
                    site.username,
                    enc,
                    site.encoding,
                    site.passive_mode as i64,
                    site.login_cmds,
                    site.proxy_id,
                    site.tls_accept_invalid as i64,
                    chrono::Utc::now().timestamp(),
                ],
            )?;
            Ok(self.conn.last_insert_rowid())
        } else {
            self.conn.execute(
                "UPDATE sites SET group_id=?1, name=?2, host=?3, port=?4, protocol=?5, username=?6, password_enc=?7, encoding=?8, passive_mode=?9, login_cmds=?10, proxy_id=?11, tls_accept_invalid=?12 WHERE id=?13",
                rusqlite::params![
                    site.group_id,
                    site.name,
                    site.host,
                    site.port,
                    site.protocol,
                    site.username,
                    enc,
                    site.encoding,
                    site.passive_mode as i64,
                    site.login_cmds,
                    site.proxy_id,
                    site.tls_accept_invalid as i64,
                    site.id,
                ],
            )?;
            Ok(site.id)
        }
    }

    pub fn delete_site(&self, id: i64) -> anyhow::Result<()> {
        self.conn.execute("DELETE FROM sites WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn add_group(&self, parent_id: Option<i64>, name: &str) -> anyhow::Result<i64> {
        self.conn.execute(
            "INSERT INTO groups (parent_id, name) VALUES (?1, ?2)",
            rusqlite::params![parent_id, name],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    #[allow(dead_code)]
    pub fn rename_group(&self, id: i64, name: &str) -> anyhow::Result<()> {
        self.conn.execute(
            "UPDATE groups SET name=?1 WHERE id=?2",
            rusqlite::params![name, id],
        )?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn delete_group(&self, id: i64) -> anyhow::Result<()> {
        self.conn.execute("DELETE FROM groups WHERE id=?1", [id])?;
        Ok(())
    }

    #[allow(dead_code)]
    pub fn get_config(&self, key: &str) -> anyhow::Result<Option<String>> {
        let mut stmt = self.conn.prepare("SELECT value FROM app_config WHERE key=?1")?;
        let mut rows = stmt.query([key])?;
        Ok(rows.next()?.map(|r| r.get(0)).transpose()?)
    }

    #[allow(dead_code)]
    pub fn set_config(&self, key: &str, value: &str) -> anyhow::Result<()> {
        self.conn.execute(
            "INSERT INTO app_config (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=?2",
            [key, value],
        )?;
        Ok(())
    }
}

impl SiteRepo {
    pub fn list_proxies(&self) -> anyhow::Result<Vec<Proxy>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, kind, host, port, username, password_enc FROM proxies ORDER BY name",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let enc: Option<Vec<u8>> = r.get(6)?;
                let password = enc.and_then(|b| self.cipher.decrypt(&b).ok());
                Ok(Proxy {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    kind: r.get(2)?,
                    host: r.get(3)?,
                    port: r.get(4)?,
                    username: r.get(5)?,
                    password,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn upsert_proxy(&self, proxy: &Proxy) -> anyhow::Result<i64> {
        let enc: Option<Vec<u8>> = proxy
            .password
            .as_deref()
            .filter(|p| !p.is_empty())
            .map(|p| self.cipher.encrypt(p))
            .transpose()?;
        if proxy.id == 0 {
            self.conn.execute(
                "INSERT INTO proxies (name, kind, host, port, username, password_enc) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![proxy.name, proxy.kind, proxy.host, proxy.port, proxy.username, enc],
            )?;
            Ok(self.conn.last_insert_rowid())
        } else {
            self.conn.execute(
                "UPDATE proxies SET name=?1, kind=?2, host=?3, port=?4, username=?5, password_enc=?6 WHERE id=?7",
                rusqlite::params![proxy.name, proxy.kind, proxy.host, proxy.port, proxy.username, enc, proxy.id],
            )?;
            Ok(proxy.id)
        }
    }

    pub fn delete_proxy(&self, id: i64) -> anyhow::Result<()> {
        self.conn.execute("DELETE FROM proxies WHERE id=?1", [id])?;
        Ok(())
    }

    // ---- 队列持久化 ----
    pub fn queue_add(&self, kind: &str, src: &str, dst: &str, size: u64) -> anyhow::Result<i64> {
        self.conn.execute(
            "INSERT INTO queue_items (kind, src, dst, size, offset, status) VALUES (?1, ?2, ?3, ?4, 0, 'pending')",
            rusqlite::params![kind, src, dst, size as i64],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn queue_finish(&self, id: i64) -> anyhow::Result<()> {
        self.conn.execute("UPDATE queue_items SET status='done' WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn queue_fail(&self, id: i64, err: &str) -> anyhow::Result<()> {
        self.conn.execute(
            "UPDATE queue_items SET status='failed', error=?1 WHERE id=?2",
            rusqlite::params![err, id],
        )?;
        Ok(())
    }

    pub fn queue_pending(&self) -> anyhow::Result<Vec<(i64, String, String, String)>> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, kind, src, dst FROM queue_items WHERE status='pending'")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn queue_clear_finished(&self) -> anyhow::Result<()> {
        self.conn.execute("DELETE FROM queue_items WHERE status != 'pending'", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn site_crud_roundtrip() {
        let repo = SiteRepo::open().unwrap();
        let site = Site {
            id: 0,
            group_id: None,
            name: "测试站点".into(),
            host: "127.0.0.1".into(),
            port: 21,
            protocol: "ftp".into(),
            username: Some("user".into()),
            password: Some("中文密码".into()),
            encoding: "auto".into(),
            passive_mode: true,
            login_cmds: None,
            proxy_id: None,
            tls_accept_invalid: false,
        };
        let id = repo.upsert_site(&site).unwrap();
        assert!(id > 0);

        let loaded = repo.list_sites().unwrap().into_iter().find(|s| s.id == id).unwrap();
        assert_eq!(loaded.password.as_deref(), Some("中文密码"));
        assert_eq!(loaded.name, "测试站点");

        repo.delete_site(id).unwrap();
        assert!(repo.list_sites().unwrap().into_iter().all(|s| s.id != id));
    }

    #[test]
    fn config_roundtrip() {
        let repo = SiteRepo::open().unwrap();
        repo.set_config("test_key", "值").unwrap();
        assert_eq!(repo.get_config("test_key").unwrap().as_deref(), Some("值"));
        repo.set_config("test_key", "新值").unwrap();
        assert_eq!(repo.get_config("test_key").unwrap().as_deref(), Some("新值"));
    }
}
