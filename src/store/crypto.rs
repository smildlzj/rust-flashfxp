use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};

const KEY_BYTES: &[u8; 32] = b"rust-flashfxp-static-key-0000000";
const NONCE_LEN: usize = 12;

pub struct Cipher {
    aead: Aes256Gcm,
}

impl Cipher {
    pub fn new() -> Self {
        Self {
            aead: Aes256Gcm::new_from_slice(KEY_BYTES).expect("密钥长度固定为 32 字节"),
        }
    }

    pub fn encrypt(&self, plain: &str) -> anyhow::Result<Vec<u8>> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let ct = self.aead.encrypt(&nonce, plain.as_bytes()).map_err(|e| anyhow::anyhow!("加密失败: {e:?}"))?;
        let mut out = nonce.to_vec();
        out.extend_from_slice(&ct);
        Ok(out)
    }

    pub fn decrypt(&self, blob: &[u8]) -> anyhow::Result<String> {
        if blob.len() < NONCE_LEN {
            anyhow::bail!("密码密文格式非法");
        }
        let (nonce, ct) = blob.split_at(NONCE_LEN);
        let plain = self.aead.decrypt(Nonce::from_slice(nonce), ct).map_err(|e| anyhow::anyhow!("解密失败: {e:?}"))?;
        Ok(String::from_utf8(plain)?)
    }
}

impl Default for Cipher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::Cipher;

    #[test]
    fn roundtrip() {
        let c = Cipher::new();
        let blob = c.encrypt("p@ss中文密码").unwrap();
        assert_eq!(c.decrypt(&blob).unwrap(), "p@ss中文密码");
    }

    #[test]
    fn reject_short_blob() {
        let c = Cipher::new();
        assert!(c.decrypt(b"short").is_err());
    }
}
