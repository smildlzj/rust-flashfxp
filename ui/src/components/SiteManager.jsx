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
        <WinButton compact variant="outline" title="填入根目录 /"
                   onClick={() => onChange('/')}>/</WinButton>
      ) : (
        <WinButton compact variant="outline" title="浏览本地目录…" onClick={browseLocal}>浏览…</WinButton>
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
    if (!s?.name?.trim() || !s?.host?.trim()) throw new Error('请填写站点名称和服务器地址')
    if (!Number.isInteger(Number(s.port)) || Number(s.port) < 1 || Number(s.port) > 65535) throw new Error('端口须为 1–65535')
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
    if (!window.confirm(`删除站点「${edit.name}」？`)) return
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
      {!sites.length && <div className="fx-hint" style={{ padding: 8 }}>（暂无站点，请点击「新建站点」）</div>}
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
        <label htmlFor="site-name">站点名称</label>
        <WinInput id="site-name" value={edit.name || ''} onChange={e => set('name', e.target.value)} />
        <label htmlFor="site-protocol">连接类型</label>
        <WinCombo id="site-protocol" value={edit.protocol || 'ftp'} onChange={changeProtocol} options={[
          { value: 'ftp', label: 'FTP' }, { value: 'sftp', label: 'SFTP over SSH' },
          { value: 'ftps_implicit', label: 'FTP 使用隐式 SSL/TLS' },
          { value: 'ftps_explicit', label: 'FTP 使用显式 TLS (AUTH TLS)' },
        ]} />
        <label htmlFor="site-host">地址</label>
        <div className="fx-site-host">
          <WinInput id="site-host" placeholder="ftp.example.com" value={edit.host || ''} onChange={e => set('host', e.target.value)} />
          <label htmlFor="site-port">端口</label>
          <WinInput id="site-port" inputMode="numeric" value={edit.port} onChange={e => set('port', e.target.value.replace(/\D/g, ''))} />
        </div>
        <label htmlFor="site-login">登录类型</label>
        <WinCombo id="site-login" value={loginType} onChange={v => setEdit(e => ({ ...e, loginType: v,
          username: v === 'anonymous' ? 'anonymous' : e.username === 'anonymous' ? '' : e.username,
          password: v === 'prompt' || v === 'anonymous' ? '' : e.password,
        }))} options={[
          { value: 'normal', label: '普通' },
          ...(edit.protocol !== 'sftp' ? [{ value: 'anonymous', label: '匿名' }] : []),
          { value: 'prompt', label: '连接时提示输入密码' },
        ]} />
        <label htmlFor="site-user">用户名</label>
        <WinInput id="site-user" disabled={loginType === 'anonymous'} value={edit.username || ''} onChange={e => set('username', e.target.value)} />
        <label htmlFor="site-password">密码</label>
        <WinInput id="site-password" type="password" autoComplete="new-password" disabled={loginType === 'prompt'}
          placeholder={loginType === 'prompt' ? '连接时询问，不保存密码' : ''}
          value={loginType === 'prompt' ? '' : edit.password || ''} onChange={e => set('password', e.target.value)} />
        <label htmlFor="site-remote-path">远程路径</label>
        <PathField remote value={edit.remotePath} placeholder="留空使用服务器默认目录" onChange={v => set('remotePath', v)} />
        <label htmlFor="site-local-path">本地路径</label>
        <PathField value={edit.localPath} placeholder="留空保留当前本地目录" onChange={v => set('localPath', v)} />
        <label htmlFor="site-proxy">代理服务器</label>
        <WinCombo id="site-proxy" value={String(edit.proxyId ?? '')} onChange={v => set('proxyId', v === '' ? null : Number(v))}
          options={[{ value: '', label: '不使用代理' }, ...proxies.map(p => ({ value: String(p.id), label: p.name }))]} />
        <label htmlFor="site-timezone">服务器时区</label>
        <WinCombo id="site-timezone" value={edit.timezoneOffsetMinutes == null ? '' : String(edit.timezoneOffsetMinutes)}
          onChange={v => set('timezoneOffsetMinutes', v === '' ? null : Number(v))} options={[
            { value: '', label: '自动（优先使用服务器 UTC 时间）' },
            ...Array.from({ length: 105 }, (_, i) => (i - 48) * 15).map(m => ({ value: String(m),
              label: `UTC${m < 0 ? '−' : '+'}${String(Math.floor(Math.abs(m) / 60)).padStart(2, '0')}:${String(Math.abs(m) % 60).padStart(2, '0')}` })),
          ]} />
        <label htmlFor="site-notes" className="self-start pt-2">备注</label>
        <textarea id="site-notes" className="fx-input fx-site-notes" placeholder="仅保存在本地，不发送给服务器"
          value={edit.notes || ''} onChange={e => set('notes', e.target.value)} />
      </div>
    )
  }

  const advanced = () => (
    <WinFieldset legend="高级设置">
      <div className="fx-form-grid">
        <label>账号 (ACCT):</label>
        <WinInput value={edit.account || ''} onChange={e => set('account', e.target.value)} placeholder="可选 FTP 账号" />
        <label>文件名编码:</label>
        <WinCombo value={edit.encoding} onChange={(v) => set('encoding', v)} options={[
          { value: 'auto', label: '自动检测' }, { value: 'utf-8', label: 'UTF-8' },
          { value: 'gbk', label: 'GBK (简体中文)' }, { value: 'big5', label: 'Big5 (繁体中文)' },
          { value: 'shift-jis', label: 'Shift-JIS (日文)' },
        ]} />
        <label>传输模式:</label>
        <WinCombo value={edit.passiveMode ? 'passive' : 'active'}
                  onChange={(v) => set('passiveMode', v === 'passive')}
                  options={[{ value: 'passive', label: '被动模式 (PASV)' }, { value: 'active', label: '主动模式 (PORT)' }]} />
        <label>代理:</label>
        <WinCombo value={String(edit.proxyId ?? '')}
                  onChange={(v) => set('proxyId', v === '' ? null : Number(v))}
                  options={[{ value: '', label: '（无）' }, ...proxies.map(p => ({ value: String(p.id), label: p.name }))]} />
        <label>分组:</label>
        <WinCombo value={String(edit.groupId ?? '')}
                  onChange={(v) => set('groupId', v === '' ? null : Number(v))}
                  options={[{ value: '', label: '（无）' }, ...groups.map(g => ({ value: String(g.id), label: g.name }))]} />
      </div>
    </WinFieldset>
  )

  const options = () => (
    <WinFieldset legend="选项">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 0' }}>
        <WinCheck checked={!!edit.passiveMode} onChange={(v) => set('passiveMode', v)} label="使用被动模式 (PASV)" />
        <WinCheck checked={!!edit.tlsAcceptInvalid} onChange={(v) => set('tlsAcceptInvalid', v)} label="接受无效 SSL 证书（自签名服务器）" />
        <WinCheck checked={String(edit.username).toLowerCase() === 'anonymous'}
                  onChange={(v) => setEdit(e => ({ ...e, username: v ? 'anonymous' : '', password: '', loginType: v ? 'anonymous' : 'normal' }))}
                  label="匿名登录" />
        <div className="fx-hint" style={{ marginTop: 4 }}>
          站点名称：{edit.name || '—'}　地址：{edit.host || '—'}<br />
          协议：{String(edit.protocol || 'ftp').toUpperCase()}　端口：{edit.port}
        </div>
      </div>
    </WinFieldset>
  )

  return (
    <WinDialog open={open} title="站点管理器" width={860} height={740} fixedHeight onClose={close}
      contentClassName="overflow-hidden flex flex-col"
      footer={<>
        <WinButton variant="outline" onClick={close}>关闭(X)</WinButton>
        <WinButton variant="outline" onClick={() => perform(() => save())} disabled={!edit || busy}>应用(A)</WinButton>
        <WinButton onClick={() => perform(() => connect())} disabled={!edit || !edit.host || busy}>连接(C)</WinButton>
      </>}>
      <div className="fx-toolbar-row shrink-0">
        <WinButton compact variant="outline" onClick={() => perform(() => connect())} disabled={!edit || !edit.id || busy}><Ico name="connect" size={14} /> 连接(C)</WinButton>
        <WinButton compact onClick={() => { setEdit(blankSite()); setTab('general') }}>新建站点(N)</WinButton>
        <WinButton compact variant="outline" onClick={() => perform(addGroup)}>新建组(G)</WinButton>
        <WinButton compact variant="outline" onClick={() => perform(remove)} disabled={!edit || !edit.id}>删除(D)</WinButton>
        <span style={{ flex: 1 }} />
        <WinInput className="w-short" style={{ width: 120, height: 21 }} placeholder="新分组名称"
                  value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
        <WinButton compact variant="outline" onClick={() => perform(addGroup)}>+</WinButton>
      </div>
      <div className="flex min-h-0 flex-1 gap-2.5" style={{ marginTop: 6 }}>
        <div className="fx-site-tree shrink-0 min-h-0">{tree}</div>
        <div className="flex min-h-0 flex-1 flex-col" style={{ minWidth: 0 }}>
          <WinTabs value={tab} onChange={setTab} tabs={[
            { value: 'general', label: '常规' },
            { value: 'advanced', label: '高级' },
            { value: 'options', label: '选项' },
          ]} />
          <div className="fx-tab-content min-h-0 flex-1 overflow-auto">
            {edit
              ? (tab === 'general' ? general() : tab === 'advanced' ? advanced() : options())
              : <div className="fx-center-hint">选择左侧站点，或点击「新建站点」<br />双击站点名可直接连接</div>}
          </div>
        </div>
      </div>
      {error && <div role="alert" className="text-destructive text-xs pt-2">{error}</div>}
      <div className="fx-hint shrink-0" style={{ marginTop: 8 }}>
        提示：「应用」保存站点设置；「连接」保存并立即连接。快捷键 F4 打开本窗口。
      </div>
    </WinDialog>
  )
}
