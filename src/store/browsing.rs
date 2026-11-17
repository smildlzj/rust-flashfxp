use super::SiteRepo;
use rusqlite::params;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: i64,
    pub caption: String,
    pub remote_path: String,
    pub local_path: String,
    pub sync_browsing: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HighlightRule {
    pub id: i64,
    pub mask: String,
    pub color: String,
    pub position: i64,
}

impl SiteRepo {
    pub fn bookmarks_list(&self, scope: &str) -> anyhow::Result<Vec<Bookmark>> {
        Ok(self.conn.prepare("SELECT id,caption,remote_path,local_path,sync_browsing FROM bookmarks WHERE scope=?1 ORDER BY id")?
            .query_map([scope], |r| Ok(Bookmark { id: r.get(0)?, caption: r.get(1)?, remote_path: r.get(2)?, local_path: r.get(3)?, sync_browsing: r.get(4)? }))?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn bookmark_save(&self, scope: &str, bookmark: &Bookmark) -> anyhow::Result<i64> {
        let caption = bookmark.caption.trim();
        let remote = bookmark.remote_path.trim();
        let local = bookmark.local_path.trim();
        anyhow::ensure!(!scope.is_empty(), "Bookmark scope is required");
        anyhow::ensure!(bookmark.id >= 0, "Invalid bookmark ID");
        anyhow::ensure!(!caption.is_empty(), "Bookmark caption is required");
        anyhow::ensure!(
            !remote.is_empty() || !local.is_empty(),
            "A bookmark path is required"
        );
        anyhow::ensure!(
            matches!(
                bookmark.sync_browsing.as_str(),
                "default" | "enabled" | "disabled"
            ),
            "Invalid synchronization setting"
        );
        if bookmark.id == 0 {
            self.conn.execute("INSERT INTO bookmarks (scope,caption,remote_path,local_path,sync_browsing) VALUES (?1,?2,?3,?4,?5)", params![scope,caption,remote,local,bookmark.sync_browsing])?;
            Ok(self.conn.last_insert_rowid())
        } else {
            let changed = self.conn.execute("UPDATE bookmarks SET caption=?1,remote_path=?2,local_path=?3,sync_browsing=?4 WHERE id=?5 AND scope=?6", params![caption,remote,local,bookmark.sync_browsing,bookmark.id,scope])?;
            anyhow::ensure!(changed == 1, "Bookmark no longer exists in this scope");
            Ok(bookmark.id)
        }
    }

    pub fn bookmark_delete(&self, scope: &str, id: i64) -> anyhow::Result<()> {
        let changed = self.conn.execute(
            "DELETE FROM bookmarks WHERE scope=?1 AND id=?2",
            params![scope, id],
        )?;
        anyhow::ensure!(changed == 1, "Bookmark no longer exists in this scope");
        Ok(())
    }

    pub fn highlight_rules(&self) -> anyhow::Result<Vec<HighlightRule>> {
        Ok(self
            .conn
            .prepare("SELECT id,mask,color,position FROM highlight_rules ORDER BY position,id")?
            .query_map([], |r| {
                Ok(HighlightRule {
                    id: r.get(0)?,
                    mask: r.get(1)?,
                    color: r.get(2)?,
                    position: r.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?)
    }

    pub fn highlight_rules_save(&self, rules: &[HighlightRule]) -> anyhow::Result<()> {
        self.highlight_rules_save_inner(rules, None)
    }

    pub fn highlight_rules_save_checked(
        &self,
        rules: &[HighlightRule],
        expected: &[HighlightRule],
    ) -> anyhow::Result<()> {
        self.highlight_rules_save_inner(rules, Some(expected))
    }

    fn highlight_rules_save_inner(
        &self,
        rules: &[HighlightRule],
        expected: Option<&[HighlightRule]>,
    ) -> anyhow::Result<()> {
        // Serialize writers before reading the baseline, so another window cannot
        // change the rules between this comparison and the replacement.
        let tx = rusqlite::Transaction::new_unchecked(
            &self.conn,
            rusqlite::TransactionBehavior::Immediate,
        )?;
        if let Some(expected) = expected {
            anyhow::ensure!(
                self.highlight_rules()?.as_slice() == expected,
                crate::localized!(
                    "高亮规则已在其他窗口更改，请重新打开后再编辑。",
                    "Highlight rules changed in another window. Reopen the editor before saving."
                )
            );
        }
        let mut ids = std::collections::HashSet::new();
        for rule in rules {
            anyhow::ensure!(rule.id >= 0, "Invalid highlight rule ID");
            anyhow::ensure!(!rule.mask.trim().is_empty(), "Highlight mask is required");
            anyhow::ensure!(
                rule.color.len() == 7
                    && rule.color.starts_with('#')
                    && rule.color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit),
                "Highlight color must be #RRGGBB"
            );
            if rule.id > 0 {
                anyhow::ensure!(ids.insert(rule.id), "Duplicate highlight rule ID");
                let exists: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM highlight_rules WHERE id=?1)",
                    [rule.id],
                    |r| r.get(0),
                )?;
                anyhow::ensure!(exists, "Highlight rule no longer exists");
            }
        }
        tx.execute("DELETE FROM highlight_rules", [])?;
        for (position, rule) in rules.iter().enumerate() {
            if rule.id == 0 {
                tx.execute(
                    "INSERT INTO highlight_rules (mask,color,position) VALUES (?1,?2,?3)",
                    params![rule.mask, rule.color, position as i64],
                )?;
            } else {
                tx.execute(
                    "INSERT INTO highlight_rules (id,mask,color,position) VALUES (?1,?2,?3,?4)",
                    params![rule.id, rule.mask, rule.color, position as i64],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::memory_repo;
    use super::*;

    fn bookmark() -> Bookmark {
        Bookmark {
            id: 0,
            caption: " Work ".into(),
            remote_path: " /remote ".into(),
            local_path: " ".into(),
            sync_browsing: "default".into(),
        }
    }

    #[test]
    fn bookmarks_crud_is_scoped_and_trimmed() {
        let repo = memory_repo();
        let mut value = bookmark();
        value.id = repo.bookmark_save("site:1", &value).unwrap();
        let loaded = repo.bookmarks_list("site:1").unwrap();
        assert_eq!(loaded[0].caption, "Work");
        assert_eq!(loaded[0].remote_path, "/remote");
        assert_eq!(loaded[0].local_path, "");
        assert!(repo.bookmarks_list("local").unwrap().is_empty());
        assert!(repo.bookmark_save("local", &value).is_err());
        assert!(repo.bookmark_delete("local", value.id).is_err());
        value.caption = "Updated".into();
        repo.bookmark_save("site:1", &value).unwrap();
        assert_eq!(repo.bookmarks_list("site:1").unwrap()[0].caption, "Updated");
        repo.bookmark_save("local", &bookmark()).unwrap();
        repo.delete_site(1).unwrap();
        assert!(repo.bookmarks_list("site:1").unwrap().is_empty());
        assert_eq!(repo.bookmarks_list("local").unwrap().len(), 1);
        let id = repo.bookmarks_list("local").unwrap()[0].id;
        repo.bookmark_delete("local", id).unwrap();
        assert!(repo.bookmarks_list("local").unwrap().is_empty());
        assert!(repo.bookmark_save("site:1", &value).is_err());
    }

    #[test]
    fn bookmarks_validate_before_writing() {
        let repo = memory_repo();
        for invalid in [
            Bookmark {
                caption: " ".into(),
                ..bookmark()
            },
            Bookmark {
                remote_path: "".into(),
                ..bookmark()
            },
            Bookmark {
                sync_browsing: "other".into(),
                ..bookmark()
            },
            Bookmark {
                id: -1,
                ..bookmark()
            },
        ] {
            assert!(repo.bookmark_save("local", &invalid).is_err());
        }
        assert!(repo.bookmarks_list("local").unwrap().is_empty());
        for sync in ["default", "enabled", "disabled"] {
            repo.bookmark_save(
                "local",
                &Bookmark {
                    sync_browsing: sync.into(),
                    ..bookmark()
                },
            )
            .unwrap();
        }
    }

    fn rule(mask: &str) -> HighlightRule {
        HighlightRule {
            id: 0,
            mask: mask.into(),
            color: "#123aBc".into(),
            position: 99,
        }
    }

    #[test]
    fn highlights_reject_stale_window_snapshot_without_losing_newer_rules() {
        let repo = memory_repo();
        repo.highlight_rules_save(&[rule("*.rs")]).unwrap();
        let window_a = repo.highlight_rules().unwrap();
        let window_b = repo.highlight_rules().unwrap();
        let mut edited = window_b[0].clone();
        edited.color = "#FFFFFF".into();
        repo.highlight_rules_save_checked(&[edited, rule("*.txt")], &window_b)
            .unwrap();
        let newer = repo.highlight_rules().unwrap();
        assert!(repo.highlight_rules_save_checked(&[], &window_a).is_err());
        assert_eq!(repo.highlight_rules().unwrap(), newer);
        assert!(repo
            .highlight_rules_save_checked(&window_a, &window_a)
            .is_err());
        assert_eq!(repo.highlight_rules().unwrap(), newer);
        repo.highlight_rules_save_checked(&[], &newer).unwrap();
        assert!(repo.highlight_rules().unwrap().is_empty());
    }

    #[test]
    fn highlights_rollback_when_database_rejects_replacement() {
        let repo = memory_repo();
        repo.highlight_rules_save(&[rule("*.rs")]).unwrap();
        let original = repo.highlight_rules().unwrap();
        repo.conn.execute_batch("CREATE TRIGGER reject_test_mask BEFORE INSERT ON highlight_rules WHEN NEW.mask='reject' BEGIN SELECT RAISE(ABORT, 'test rejection'); END;").unwrap();
        assert!(repo
            .highlight_rules_save(&[rule("*.txt"), rule("reject")])
            .is_err());
        assert_eq!(repo.highlight_rules().unwrap(), original);
    }

    #[test]
    fn highlights_preserve_order_ids_and_replace_atomically() {
        let repo = memory_repo();
        repo.highlight_rules_save(&[rule("*.rs"), rule("*.txt")])
            .unwrap();
        let original = repo.highlight_rules().unwrap();
        assert!(original[0].id > 0);
        assert_eq!(
            original.iter().map(|r| r.position).collect::<Vec<_>>(),
            vec![0, 1]
        );
        for invalid in [
            vec![
                original[0].clone(),
                HighlightRule {
                    color: "red".into(),
                    ..rule("*.md")
                },
            ],
            vec![original[0].clone(), original[0].clone()],
            vec![HighlightRule {
                id: i64::MAX,
                ..rule("*")
            }],
            vec![rule(" ")],
            vec![HighlightRule {
                id: -1,
                ..rule("*")
            }],
        ] {
            assert!(repo.highlight_rules_save(&invalid).is_err());
            assert_eq!(repo.highlight_rules().unwrap(), original);
        }
        repo.highlight_rules_save(&[original[1].clone(), original[0].clone(), rule("*.md")])
            .unwrap();
        let reordered = repo.highlight_rules().unwrap();
        assert_eq!(reordered[0].id, original[1].id);
        assert_eq!(reordered[1].id, original[0].id);
        assert_eq!(reordered[2].position, 2);
        repo.highlight_rules_save(&[]).unwrap();
        assert!(repo.highlight_rules().unwrap().is_empty());
    }
}
