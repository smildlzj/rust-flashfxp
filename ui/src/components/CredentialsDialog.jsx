import { t } from '../i18n.js'
import React, { useEffect, useState } from 'react'
import { WinDialog, WinInput, WinButton } from '../win32.jsx'

// 临时凭证只存在于此弹窗与本次连接命令中，不写入站点配置。
export default function CredentialsDialog() {
  const [request, setRequest] = useState(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  useEffect(() => {
    let pending = null
    const receive = e => {
      pending?.resolve(null)
      pending = e.detail
      setUsername(pending.username); setPassword(''); setRequest(pending)
    }
    window.addEventListener('fx-credentials', receive)
    return () => { window.removeEventListener('fx-credentials', receive); pending?.resolve(null) }
  }, [])
  const finish = answer => {
    request?.resolve(answer)
    setRequest(null); setPassword('')
  }
  const submit = () => { if (username.trim()) finish({ username: username.trim(), password }) }
  return <WinDialog open={!!request} title={t("connect_to_value", [request?.siteName || ''])} width={420} onClose={() => finish(null)}
    footer={<><WinButton variant="outline" onClick={() => finish(null)}>{t("cancel")}</WinButton>
      <WinButton disabled={!username.trim()} onClick={submit}>{t("connect")}</WinButton></>}>
    <form className="fx-form-grid" onSubmit={e => { e.preventDefault(); submit() }}>
      <label htmlFor="credential-user">{t("username_2")}</label>
      <WinInput id="credential-user" autoFocus={!username} value={username} onChange={e => setUsername(e.target.value)} />
      <label htmlFor="credential-pass">{t("password_2")}</label>
      <WinInput id="credential-pass" autoFocus={!!username} type="password" value={password} onChange={e => setPassword(e.target.value)} />
      <button type="submit" hidden />
    </form>
    <p className="fx-hint mt-3">{t("these_credentials_will_not_be_saved_to_the_site_configuration")}</p>
  </WinDialog>
}
