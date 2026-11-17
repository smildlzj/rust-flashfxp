import { t } from '../i18n.js'
import { BookmarkPanel } from './BookmarkManager.jsx'
import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Ico } from '../winicons.jsx'
import { WinButton, WinInput, WinCheck, WinCombo, WinTabs, WinFieldset, WinDialog } from '../win32.jsx'

function blankSite() {
  return {
    id: 0, groupId: null, name: '', host: '', port: 21, protocol: 'ftp',
    username: '', password: '', account: '', encoding: 'auto', passiveMode: true,
    proxyId: null, tlsAcceptInvalid: false,
    localPath: '', remotePath: '', notes: '', loginType: 'normal', timezoneOffsetMinutes: null,
  }
}

/* 带「浏览…」按钮的路径输入行：本地路径用系统目录选择器，远程路径给常用快捷按钮。 */
function PathField({ value, onChange, placeholder, remote }) {
  const browseLocal = async () => {
    try {
      const picked = await api.pickFolder()
      if (picked) onChange(picked)
    } catch { /* 用户取消或系统不支持时忽略 */ }
  }
  return (
    <div className="flex items-center gap-1.5">
      <WinInput id={remote ? "site-remote-path" : "site-local-path"} className="min-w-0 flex-1" value={value || ''} placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)} />
      {remote ? (
        <WinButton compact variant="outline" title={t("use_root_directory")}
                   onClick={() => onChange('/')}>/</WinButton>
      ) : (
        <WinButton compact variant="outline" title={t("browse_local_directory")} onClick={browseLocal}>{t("browse")}</WinButton>
      )}
    </div>
  )
}

export default function SiteManager({ open, onOpenChange, onConnected }) {
  const [sites, setSites] = useState([])
  const [groups, setGroups] = useState([])
  const [proxies, setProxies] = useState([])
  const [edit, setEdit] = useState(null)
  const [tab, setTab] = useState('general')
  const [newGroupName, setNewGroupName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = async () => {
    const list = await api.sites()
    setSites(list)
    setGroups(await api.groups())
    setProxies(await api.proxies())
    // 原版打开站点管理器默认选中首个站点并显示「常规」表单
    setEdit(prev => prev || (list.length ? { ...list[0] } : null))
  }
  useEffect(() => { if (open) { setTab('general'); setError(''); reload().catch(e => setError(String(e))) } }, [open])

  const set = (k, v) => setEdit(e => ({ ...e, [k]: v }))
  const close = () => onOpenChange(false)

  const toRaw = (s) => ({
    id: s.id || 0,
    groupId: s.groupId ?? null,
    name: s.name, host: s.host, port: Number(s.port) || 21,
    protocol: s.protocol,
    username: s.loginType === 'anonymous' ? 'anonymous' : (s.username || ''),
    password: s.loginType === 'prompt' ? '' : (s.password || ''),
    account: s.account || '',
    encoding: s.encoding, passiveMode: !!s.passiveMode,
    notes: s.notes || '', loginType: s.loginType || 'normal',
    timezoneOffsetMinutes: s.timezoneOffsetMinutes ?? null,
    loginCmds: s.loginCmds ?? null, proxyId: s.proxyId ?? null,
    tlsAcceptInvalid: !!s.tlsAcceptInvalid,
    localPath: s.localPath || '', remotePath: s.remotePath || '',
  })

  const save = async (siteArg) => {
    const s = siteArg || edit
    if (!s?.name?.trim() || !s?.host?.trim()) throw new Error(t("enter_a_site_name_and_server_address"))
    if (!Number.isInteger(Number(s.port)) || Number(s.port) < 1 || Number(s.port) > 65535) throw new Error(t("port_must_be_between_1_and_65535"))
    const id = await api.saveSite(toRaw(s))
    setEdit({ ...s, id })
    await reload()
    return id
  }

  const perform = async (action) => {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(String(e.message || e)) }
    finally { setBusy(false) }
  }

  const remove = async () => {
    if (!edit || !edit.id) return
    if (!window.confirm(t("delete_site_value", [edit.name]))) return
    await api.deleteSite(edit.id)
    setEdit(null)
    await reload()
  }

  const connect = async (siteArg) => {
    const s = siteArg || edit
    if (!s || !s.host.trim()) return
    const id = await save(s)
    if (!await api.connectSite(id)) return
    onConnected({ ...s, id })
    close()
  }

  const addGroup = async () => {
    const n = newGroupName.trim()
    if (!n) return
    await api.addGroup(n)
    setNewGroupName('')
    await reload()
  }

  const siteRow = (s, indent) => (
    <div key={s.id}
      className={`fx-listbox-row ${edit && edit.id === s.id ? 'fx-selected' : ''}`}
      style={{ paddingLeft: indent ? 20 : 5 }}
      onClick={() => setEdit({ ...s })}
      onDoubleClick={() => { setEdit({ ...s }); perform(() => connect({ ...s })) }}>
      <Ico name="file" size={14} /><span>{s.name}</span>
    </div>
  )

  const tree = (
    <div className="fx-panel h-full overflow-auto">
      {groups.map(g => (
        <React.Fragment key={'g' + g.id}>
          <div className="fx-listbox-row" style={{ fontWeight: 'bold' }}>
            <Ico name="folderOpen" size={15} /><span>{g.name}</span>
          </div>
          {sites.filter(x => x.groupId === g.id).map(s => siteRow(s, true))}
        </React.Fragment>
      ))}
      {sites.filter(x => x.groupId == null).map(s => siteRow(s, false))}
      {!sites.length && <div className="fx-hint" style={{ padding: 8 }}>{t("no_sites_click_new_site_to_create_one")}</div>}
    </div>
  )

  // 必须是惰性函数：edit 为 null 时不能提前求值（否则读取 edit.name 崩溃）
  const general = () => {
    const loginType = edit.loginType === 'prompt' ? 'prompt' :
      (edit.loginType === 'anonymous' || edit.username === 'anonymous' ? 'anonymous' : 'normal')
    const changeProtocol = (protocol) => setEdit(e => ({ ...e, protocol,
      port: [21, 22, 990].includes(Number(e.port)) ? (protocol === 'sftp' ? 22 : protocol === 'ftps_implicit' ? 990 : 21) : e.port,
      loginType: protocol === 'sftp' && loginType === 'anonymous' ? 'normal' : loginType,
      username: protocol === 'sftp' && loginType === 'anonymous' ? '' : e.username,
    }))
    return (
      <div className="fx-site-general fx-form-grid">
        <label htmlFor="site-name">{t("site_name")}</label>
        <WinInput id="site-name" value={edit.name || ''} onChange={e => set('name', e.target.value)} />
        <label htmlFor="site-protocol">{t("connection_type")}</label>
        <WinCombo id="site-protocol" value={edit.protocol || 'ftp'} onChange={changeProtocol} options={[
          { value: 'ftp', label: 'FTP' }, { value: 'sftp', label: 'SFTP over SSH' },
          { value: 'ftps_implicit', label: t("ftp_with_implicit_ssl_tls") },
          { value: 'ftps_explicit', label: t("ftp_with_explicit_tls_auth_tls") },
        ]} />
        <label htmlFor="site-host">{t("address")}</label>
        <div className="fx-site-host">
          <WinInput id="site-host" placeholder="ftp.example.com" value={edit.host || ''} onChange={e => set('host', e.target.value)} />
          <label htmlFor="site-port">{t("port_2")}</label>
          <WinInput id="site-port" inputMode="numeric" value={edit.port} onChange={e => set('port', e.target.value.replace(/\D/g, ''))} />
        </div>
        <label htmlFor="site-login">{t("login_type")}</label>
        <WinCombo id="site-login" value={loginType} onChange={v => setEdit(e => ({ ...e, loginType: v,
          username: v === 'anonymous' ? 'anonymous' : e.username === 'anonymous' ? '' : e.username,
          password: v === 'prompt' || v === 'anonymous' ? '' : e.password,
        }))} options={[
          { value: 'normal', label: t("normal") },
          ...(edit.protocol !== 'sftp' ? [{ value: 'anonymous', label: t("anonymous") }] : []),
          { value: 'prompt', label: t("prompt_for_password_when_connecting") },
        ]} />
        <label htmlFor="site-user">{t("username_2")}</label>
        <WinInput id="site-user" disabled={loginType === 'anonymous'} value={edit.username || ''} onChange={e => set('username', e.target.value)} />
        <label htmlFor="site-password">{t("password_2")}</label>
        <WinInput id="site-password" type="password" autoComplete="new-password" disabled={loginType === 'prompt'}
          placeholder={loginType === 'prompt' ? t("ask_when_connecting_do_not_save_password") : ''}
          value={loginType === 'prompt' ? '' : edit.password || ''} onChange={e => set('password', e.target.value)} />
        <label htmlFor="site-remote-path">{t("remote_path")}</label>
        <PathField remote value={edit.remotePath} placeholder={t("leave_blank_for_the_server_default_directory")} onChange={v => set('remotePath', v)} />
        <label htmlFor="site-local-path">{t("local_path")}</label>
        <PathField value={edit.localPath} placeholder={t("leave_blank_to_keep_the_current_local_directory")} onChange={v => set('localPath', v)} />
        <label htmlFor="site-proxy">{t("proxy_server")}</label>
        <WinCombo id="site-proxy" value={String(edit.proxyId ?? '')} onChange={v => set('proxyId', v === '' ? null : Number(v))}
          options={[{ value: '', label: t("no_proxy") }, ...proxies.map(p => ({ value: String(p.id), label: p.name }))]} />
        <label htmlFor="site-timezone">{t("server_time_zone")}</label>
        <WinCombo id="site-timezone" value={edit.timezoneOffsetMinutes == null ? '' : String(edit.timezoneOffsetMinutes)}
          onChange={v => set('timezoneOffsetMinutes', v === '' ? null : Number(v))} options={[
            { value: '', label: t("automatic_prefer_server_utc_time") },
            ...Array.from({ length: 105 }, (_, i) => (i - 48) * 15).map(m => ({ value: String(m),
              label: `UTC${m < 0 ? '−' : '+'}${String(Math.floor(Math.abs(m) / 60)).padStart(2, '0')}:${String(Math.abs(m) % 60).padStart(2, '0')}` })),
          ]} />
        <label htmlFor="site-notes" className="self-start pt-2">{t("notes")}</label>
        <textarea id="site-notes" className="fx-input fx-site-notes" placeholder={t("saved_locally_never_sent_to_the_server")}
          value={edit.notes || ''} onChange={e => set('notes', e.target.value)} />
      </div>
    )
  }

  const advanced = () => (
    <WinFieldset legend={t("advanced_settings")}>
      <div className="fx-form-grid">
        <label>{t("account_acct")}</label>
        <WinInput value={edit.account || ''} onChange={e => set('account', e.target.value)} placeholder={t("optional_ftp_account")} />
        <label>{t("filename_encoding")}</label>
        <WinCombo value={edit.encoding} onChange={(v) => set('encoding', v)} options={[
          { value: 'auto', label: t("auto_detect") }, { value: 'utf-8', label: 'UTF-8' },
          { value: 'gbk', label: t("gbk_simplified_chinese") }, { value: 'big5', label: t("big5_traditional_chinese") },
          { value: 'shift-jis', label: t("shift_jis_japanese") },
        ]} />
        <label>{t("transfer_mode")}</label>
        <WinCombo value={edit.passiveMode ? 'passive' : 'active'}
                  onChange={(v) => set('passiveMode', v === 'passive')}
                  options={[{ value: 'passive', label: t("passive_mode_pasv") }, { value: 'active', label: t("active_mode_port") }]} />
        <label>{t("proxy_2")}</label>
        <WinCombo value={String(edit.proxyId ?? '')}
                  onChange={(v) => set('proxyId', v === '' ? null : Number(v))}
                  options={[{ value: '', label: t("none") }, ...proxies.map(p => ({ value: String(p.id), label: p.name }))]} />
        <label>{t("group")}</label>
        <WinCombo value={String(edit.groupId ?? '')}
                  onChange={(v) => set('groupId', v === '' ? null : Number(v))}
                  options={[{ value: '', label: t("none") }, ...groups.map(g => ({ value: String(g.id), label: g.name }))]} />
      </div>
    </WinFieldset>
  )

  const options = () => (
    <WinFieldset legend={t("options")}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
        <WinCheck checked={!!edit.passiveMode} onChange={(v) => set('passiveMode', v)} label={t("use_passive_mode_pasv")} />
        <WinCheck checked={!!edit.tlsAcceptInvalid} onChange={(v) => set('tlsAcceptInvalid', v)} label={t("accept_invalid_ssl_certificates_self_signed_servers")} />
        <WinCheck checked={String(edit.username).toLowerCase() === 'anonymous'}
                  onChange={(v) => setEdit(e => ({ ...e, username: v ? 'anonymous' : '', password: '', loginType: v ? 'anonymous' : 'normal' }))}
                  label={t("anonymous_login")} />
        <div className="fx-hint" style={{ marginTop: 4 }}> {t("site_name_2")}{edit.name || '—'} {t("address_2")}{edit.host || '—'}<br /> {t("protocol")}{String(edit.protocol || 'ftp').toUpperCase()} {t("port_3")}{edit.port}
        </div>
      </div>
    </WinFieldset>
  )

  return (
    <WinDialog open={open} title={t("site_manager_2")} width={860} height={740} fixedHeight onClose={close}
      contentClassName="overflow-hidden flex flex-col"
      footer={<>
        <WinButton variant="outline" onClick={close}>{t("close_x")}</WinButton>
        <WinButton variant="outline" onClick={() => perform(() => save())} disabled={!edit || busy}>{t("apply_a")}</WinButton>
        <WinButton onClick={() => perform(() => connect())} disabled={!edit || !edit.host || busy}>{t("connect_c")}</WinButton>
      </>}>
      <div className="fx-toolbar-row shrink-0">
        <WinButton compact variant="outline" onClick={() => perform(() => connect())} disabled={!edit || !edit.id || busy}><Ico name="connect" size={14} /> {t("connect_c")}</WinButton>
        <WinButton compact onClick={() => { setEdit(blankSite()); setTab('general') }}>{t("new_site_n")}</WinButton>
        <WinButton compact variant="outline" onClick={() => perform(addGroup)}>{t("new_group_g")}</WinButton>
        <WinButton compact variant="outline" onClick={() => perform(remove)} disabled={!edit || !edit.id}>{t("delete_d")}</WinButton>
        <span style={{ flex: 1 }} />
        <WinInput className="w-short" style={{ width: 120, height: 21 }} placeholder={t("new_group_name")}
                  value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
        <WinButton compact variant="outline" onClick={() => perform(addGroup)}>+</WinButton>
      </div>
      <div className="flex min-h-0 flex-1 gap-2.5" style={{ marginTop: 6 }}>
        <div className="fx-site-tree shrink-0 min-h-0">{tree}</div>
        <div className="flex min-h-0 flex-1 flex-col" style={{ minWidth: 0 }}>
          <WinTabs value={tab} onChange={setTab} tabs={[
            { value: 'general', label: t("general") },
            { value: 'advanced', label: t("advanced") },
            { value: 'options', label: t("options") },
            { value: 'bookmarks', label: t('bookmarks') },
          ]} />
          <div className="fx-tab-content min-h-0 flex-1 overflow-auto">
            {edit
              ? (tab === 'general' ? general() : tab === 'advanced' ? advanced() : tab === 'bookmarks'
                ? (edit.id ? <BookmarkPanel key={edit.id} siteId={edit.id} localPath={edit.localPath || ''} remotePath={edit.remotePath || ''} />
                  : <div className="fx-center-hint">{t('bookmark_save_site_first')}</div>) : options())
              : <div className="fx-center-hint">{t("select_a_site_on_the_left_or_click_new_site")}<br />{t("double_click_a_site_to_connect")}</div>}
          </div>
        </div>
      </div>
      {error && <div role="alert" className="text-destructive text-xs pt-2">{error}</div>}
      <div className="fx-hint shrink-0" style={{ marginTop: 8 }}> {t("apply_saves_the_site_settings_connect_saves_and_connects_immediately_press_f4_to_open_this_window")} </div>
    </WinDialog>
  )
}
