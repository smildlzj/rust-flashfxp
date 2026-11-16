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
  return <WinDialog open={!!request} title={`连接 ${request?.siteName || ''}`} width={420} onClose={() => finish(null)}
    footer={<><WinButton variant="outline" onClick={() => finish(null)}>取消</WinButton>
      <WinButton disabled={!username.trim()} onClick={submit}>连接</WinButton></>}>
    <form className="fx-form-grid" onSubmit={e => { e.preventDefault(); submit() }}>
      <label htmlFor="credential-user">用户名</label>
      <WinInput id="credential-user" autoFocus={!username} value={username} onChange={e => setUsername(e.target.value)} />
      <label htmlFor="credential-pass">密码</label>
      <WinInput id="credential-pass" autoFocus={!!username} type="password" value={password} onChange={e => setPassword(e.target.value)} />
      <button type="submit" hidden />
    </form>
    <p className="fx-hint mt-3">本次输入的凭证不会保存到站点配置。</p>
  </WinDialog>
}
