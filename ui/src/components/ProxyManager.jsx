import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Ico } from '../winicons.jsx'
import { WinButton, WinInput, WinCombo, WinFieldset, WinDialog } from '../win32.jsx'

export default function ProxyManager({ open, onOpenChange }) {
  const [proxies, setProxies] = useState([])
  const [edit, setEdit] = useState(null)

  const reload = async () => setProxies(await api.proxies())
  useEffect(() => { if (open) reload() }, [open])

  const set = (k, v) => setEdit(e => ({ ...e, [k]: v }))
  const close = () => onOpenChange(false)

  const blank = () => ({ id: 0, name: '', kind: 'socks5', host: '', port: 1080, username: '', password: '' })

  const save = async () => {
    if (!edit || !edit.name.trim() || !edit.host.trim()) return
    await api.saveProxy({
      ...edit, id: edit.id || 0, port: Number(edit.port) || 1080,
      username: edit.username || '', password: edit.password || '',
    })
    setEdit(null)
    await reload()
  }

  const remove = async (p) => {
    if (!window.confirm(`删除代理「${p.name}」？`)) return
    await api.deleteProxy(p.id)
    if (edit && edit.id === p.id) setEdit(null)
    await reload()
  }

  const footer = (
    <>
      <WinButton className="left" onClick={() => setEdit(blank())}>新增(N)</WinButton>
      {edit && <WinButton onClick={save}>保存(S)</WinButton>}
      {edit && <WinButton variant="outline" onClick={() => setEdit(null)}>取消</WinButton>}
      <WinButton variant="outline" onClick={close}>关闭(X)</WinButton>
    </>
  )

  return (
    <WinDialog open={open} title="代理设置" width={520} onClose={close} footer={footer}>
      <WinFieldset legend="代理服务器列表">
        <div className="fx-panel" style={{ height: 132 }}>
          {!proxies.length && <div className="fx-hint" style={{ padding: 8 }}>（暂无代理）</div>}
          {proxies.map(p => (
            <div key={p.id} className={`fx-listbox-row ${edit && edit.id === p.id ? 'fx-selected' : ''}`}
                 onClick={() => setEdit({ ...p })}>
              <Ico name="network" size={14} />
              <b>{p.name}</b>
              <span className="fx-muted" style={{ marginLeft: 10 }}>
                {p.kind === 'socks5' ? 'SOCKS5' : 'HTTP'}　{p.host}:{p.port}
              </span>
              <span style={{ flex: 1 }} />
              <button className="fx-dialog-x" title="编辑" onClick={(e) => { e.stopPropagation(); setEdit({ ...p }) }}>✎</button>
              <button className="fx-dialog-x" title="删除" onClick={(e) => { e.stopPropagation(); remove(p) }}>✕</button>
            </div>
          ))}
        </div>
      </WinFieldset>
      {edit ? (
        <WinFieldset legend="代理设置">
          <div className="fx-form-grid">
            <label>名称:</label>
            <WinInput value={edit.name} onChange={(e) => set('name', e.target.value)} />
            <label>类型:</label>
            <WinCombo value={edit.kind} onChange={(v) => set('kind', v)}
                      options={[{ value: 'socks5', label: 'SOCKS5' }, { value: 'http', label: 'HTTP (CONNECT)' }]} />
            <label>主机地址:</label>
            <WinInput value={edit.host} onChange={(e) => set('host', e.target.value)} />
            <label>端口:</label>
            <div><WinInput className="w-short" value={edit.port}
                           onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} /></div>
            <label>用户名:</label>
            <WinInput value={edit.username || ''} onChange={(e) => set('username', e.target.value)} />
            <label>密码:</label>
            <WinInput type="password" value={edit.password || ''} onChange={(e) => set('password', e.target.value)} />
          </div>
        </WinFieldset>
      ) : (
        <div className="fx-hint">选择上方代理进行编辑，或点击「新增」创建新的代理服务器配置。</div>
      )}
    </WinDialog>
  )
}
