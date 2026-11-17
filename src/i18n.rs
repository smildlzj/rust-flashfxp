//! Language for newly generated application messages. Opaque server errors and paths
//! are interpolated unchanged; existing event/log strings are never rewritten.
use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

/// Unknown values fall back to Simplified Chinese, matching the default UI.
pub fn set_language(language: &str) {
    ENGLISH.store(language_is_english(language), Ordering::Relaxed);
}

fn language_is_english(language: &str) -> bool {
    language == "en"
}

#[cfg(test)]
std::thread_local! {
    // Translation tests must not change language for concurrently running protocol tests.
    static TEST_LANGUAGE: std::cell::Cell<Option<bool>> = const { std::cell::Cell::new(None) };
}

pub fn is_english() -> bool {
    #[cfg(test)]
    if let Some(english) = TEST_LANGUAGE.with(|language| language.get()) {
        return english;
    }
    ENGLISH.load(Ordering::Relaxed)
}

/// Compile-time paired message templates. Both variants are checked by `format!`;
/// callers keep raw error details and user data as formatting parameters.
#[macro_export]
macro_rules! localized {
    ($zh:literal, $en:literal $(, $args:expr)* $(,)?) => {
        if $crate::i18n::is_english() {
            format!($en $(, $args)*)
        } else {
            format!($zh $(, $args)*)
        }
    };
}

#[cfg(test)]
mod tests {
    struct LanguageOverride(Option<bool>);

    impl LanguageOverride {
        fn set(language: &str) -> Self {
            Self(super::TEST_LANGUAGE.with(|value| value.replace(Some(super::language_is_english(language)))))
        }
    }

    impl Drop for LanguageOverride {
        fn drop(&mut self) {
            super::TEST_LANGUAGE.with(|value| value.set(self.0));
        }
    }

    #[test]
    fn generated_messages_follow_language_and_preserve_parameters() {
        let detail = "服务器原文 /中文/文件.txt";
        let _english = LanguageOverride::set("en");
        assert!(!std::thread::spawn(super::is_english).join().unwrap());
        let previous = crate::localized!("连接失败: {detail}", "Connection failed: {detail}");
        assert_eq!(previous, "Connection failed: 服务器原文 /中文/文件.txt");
        let _chinese = LanguageOverride::set("zh-CN");
        assert_eq!(crate::localized!("连接失败: {detail}", "Connection failed: {detail}"), "连接失败: 服务器原文 /中文/文件.txt");
        assert_eq!(previous, "Connection failed: 服务器原文 /中文/文件.txt");
        let _fallback = LanguageOverride::set("unsupported");
        assert_eq!(crate::localized!("已取消", "Cancelled"), "已取消");
    }
}
