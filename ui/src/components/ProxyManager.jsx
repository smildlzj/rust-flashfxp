import { t } from '../i18n.js'
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
    if (!window.confirm(t("delete_proxy_value", [p.name]))) return
    await api.deleteProxy(p.id)
    if (edit && edit.id === p.id) setEdit(null)
    await reload()
  }

  const footer = (
    <>
      <WinButton className="left" onClick={() => setEdit(blank())}>{t("add_n")}</WinButton>
      {edit && <WinButton onClick={save}>{t("save_s")}</WinButton>}
      {edit && <WinButton variant="outline" onClick={() => setEdit(null)}>{t("cancel")}</WinButton>}
      <WinButton variant="outline" onClick={close}>{t("close_x")}</WinButton>
    </>
  )

  return (
    <WinDialog open={open} title={t("proxy_settings")} width={520} onClose={close} footer={footer}>
      <WinFieldset legend={t("proxy_server_list")}>
        <div className="fx-panel" style={{ height: 132 }}>
          {!proxies.length && <div className="fx-hint" style={{ padding: 8 }}>{t("no_proxies")}</div>}
          {proxies.map(p => (
            <div key={p.id} className={`fx-listbox-row ${edit && edit.id === p.id ? 'fx-selected' : ''}`}
                 onClick={() => setEdit({ ...p })}>
              <Ico name="network" size={14} />
              <b>{p.name}</b>
              <span className="fx-muted" style={{ marginLeft: 10 }}>
                {p.kind === 'socks5' ? 'SOCKS5' : 'HTTP'}　{p.host}:{p.port}
              </span>
              <span style={{ flex: 1 }} />
              <button className="fx-dialog-x" title={t("edit")} onClick={(e) => { e.stopPropagation(); setEdit({ ...p }) }}>✎</button>
              <button className="fx-dialog-x" title={t("delete")} onClick={(e) => { e.stopPropagation(); remove(p) }}>✕</button>
            </div>
          ))}
        </div>
      </WinFieldset>
      {edit ? (
        <WinFieldset legend={t("proxy_settings")}>
          <div className="fx-form-grid">
            <label>{t("name_2")}</label>
            <WinInput value={edit.name} onChange={(e) => set('name', e.target.value)} />
            <label>{t("type")}</label>
            <WinCombo value={edit.kind} onChange={(v) => set('kind', v)}
                      options={[{ value: 'socks5', label: 'SOCKS5' }, { value: 'http', label: 'HTTP (CONNECT)' }]} />
            <label>{t("host_address")}</label>
            <WinInput value={edit.host} onChange={(e) => set('host', e.target.value)} />
            <label>{t("port")}</label>
            <div><WinInput className="w-short" value={edit.port}
                           onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} /></div>
            <label>{t("username_3")}</label>
            <WinInput value={edit.username || ''} onChange={(e) => set('username', e.target.value)} />
            <label>{t("password")}</label>
            <WinInput type="password" value={edit.password || ''} onChange={(e) => set('password', e.target.value)} />
          </div>
        </WinFieldset>
      ) : (
        <div className="fx-hint">{t("select_a_proxy_to_edit_or_click_add_to_create_a_proxy_server_configuration")}</div>
      )}
    </WinDialog>
  )
}
