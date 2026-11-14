import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Folder, FileText, Plus, X } from 'lucide-react'

function blankSite() {
  return {
    id: 0, groupId: null, name: '', host: '', port: 21, protocol: 'ftp',
    username: '', password: '', encoding: 'auto', passiveMode: true,
    proxyId: null, tlsAcceptInvalid: false,
  }
}

export default function SiteManager({ open, onOpenChange, onConnected }) {
  const [sites, setSites] = useState([])
  const [groups, setGroups] = useState([])
  const [proxies, setProxies] = useState([])
  const [edit, setEdit] = useState(null)
  const [tab, setTab] = useState('general')
  const [newGroupName, setNewGroupName] = useState('')

  const reload = async () => {
    setSites(await api.sites())
    setGroups(await api.groups())
    setProxies(await api.proxies())
  }

  useEffect(() => {
    if (open) reload()
  }, [open])

  const set = (k, v) => setEdit(e => ({ ...e, [k]: v }))

  const toRaw = (s) => ({
    id: s.id || 0,
    groupId: s.groupId ?? null,
    name: s.name, host: s.host, port: Number(s.port) || 21,
    protocol: s.protocol,
    username: s.username || '', password: s.password || '',
    encoding: s.encoding, passiveMode: !!s.passiveMode,
    loginCmds: null, proxyId: s.proxyId ?? null,
    tlsAcceptInvalid: !!s.tlsAcceptInvalid,
  })

  const save = async (siteArg) => {
    const s = siteArg || edit
    if (!s || !s.name.trim() || !s.host.trim()) return null
    const id = await api.saveSite(toRaw(s))
    await reload()
    return id
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
    await api.connectSite(id)
    onConnected({ ...s, id })
    onOpenChange(false)
  }

  const addGroup = async () => {
    const n = newGroupName.trim()
    if (!n) return
    await api.addGroup(n)
    setNewGroupName('')
    await reload()
  }

  const renderTree = () => (
    <ScrollArea className="h-[340px] rounded-md border bg-background p-1.5">
      {groups.map(g => (
        <React.Fragment key={'g' + g.id}>
          <div className="flex items-center gap-1.5 px-1 py-1 font-medium text-sm">
            <Folder className="h-4 w-4 text-amber-500" />{g.name}
          </div>
          {sites.filter(x => x.groupId === g.id).map(s => (
            <div key={s.id}
                 className={`flex items-center gap-1.5 pl-5 pr-1 py-1 rounded-sm cursor-default text-sm ${edit && edit.id === s.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                 onClick={() => setEdit({ ...s })}
                 onDoubleClick={() => { setEdit({ ...s }); connect({ ...s }) }}>
              <FileText className="h-3.5 w-3.5" />{s.name}
            </div>
          ))}
        </React.Fragment>
      ))}
      {sites.filter(x => x.groupId == null).map(s => (
        <div key={'u' + s.id}
             className={`flex items-center gap-1.5 px-1.5 py-1 rounded-sm cursor-default text-sm ${edit && edit.id === s.id ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
             onClick={() => setEdit({ ...s })}
             onDoubleClick={() => { setEdit({ ...s }); connect({ ...s }) }}>
          <FileText className="h-3.5 w-3.5" />{s.name}
        </div>
      ))}
    </ScrollArea>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>站点管理器</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Button onClick={() => connect()} disabled={!edit || !edit.id}><Plus className="mr-1" />连接(C)</Button>
          <Button variant="outline" onClick={() => { setEdit(blankSite()); setTab('general') }}>新建站点(N)</Button>
          <Button variant="outline" onClick={addGroup}>新建组(G)</Button>
          <Button variant="outline" onClick={remove} disabled={!edit || !edit.id}>删除(D)</Button>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            <Input className="h-8 w-32" placeholder="新分组名称" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} />
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={addGroup}><Plus className="h-4 w-4" /></Button>
          </div>
        </div>
        <div className="flex gap-3 min-h-[380px]">
          <div className="w-60 flex-none flex flex-col gap-2">
            {renderTree()}
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="general">常规</TabsTrigger>
                <TabsTrigger value="advanced">高级</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex-1 rounded-md border bg-background p-4 mt-2 overflow-auto">
              {edit ? (tab === 'general' ? (
                <div className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-3 items-center max-w-md">
                  <Label>站点名称:</Label><Input value={edit.name} onChange={(e) => set('name', e.target.value)} />
                  <Label>IP 地址:</Label><Input value={edit.host} onChange={(e) => set('host', e.target.value)} placeholder="ftp.example.com 或 192.168.1.1" />
                  <Label>端口:</Label><Input className="w-20" value={edit.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} />
                  <Label>用户名:</Label><Input value={edit.username} onChange={(e) => set('username', e.target.value)} />
                  <Label>密码:</Label><Input type="password" value={edit.password} onChange={(e) => set('password', e.target.value)} />
                </div>
              ) : (
                <div className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-3 items-center max-w-md">
                  <Label>协议:</Label>
                  <Select value={edit.protocol} onValueChange={(v) => set('protocol', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ftp">FTP</SelectItem>
                      <SelectItem value="ftps_explicit">FTPS (显式 TLS)</SelectItem>
                      <SelectItem value="ftps_implicit">FTPS (隐式 SSL)</SelectItem>
                      <SelectItem value="sftp">SFTP (SSH)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Label>编码:</Label>
                  <Select value={edit.encoding} onValueChange={(v) => set('encoding', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">自动检测</SelectItem>
                      <SelectItem value="utf-8">UTF-8</SelectItem>
                      <SelectItem value="gbk">GBK (简体中文)</SelectItem>
                      <SelectItem value="big5">Big5 (繁体中文)</SelectItem>
                      <SelectItem value="shift-jis">Shift-JIS (日文)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Label>传输模式:</Label>
                  <Select value={edit.passiveMode ? 'passive' : 'active'} onValueChange={(v) => set('passiveMode', v === 'passive')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="passive">被动模式 (PASV)</SelectItem>
                      <SelectItem value="active">主动模式 (PORT)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Label>证书校验:</Label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={edit.tlsAcceptInvalid} onCheckedChange={(v) => set('tlsAcceptInvalid', !!v)} />
                    忽略证书错误（自签名服务器）
                  </label>
                  <Label>代理:</Label>
                  <Select value={String(edit.proxyId ?? '')} onValueChange={(v) => set('proxyId', v === '' ? null : Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">（无）</SelectItem>
                      {proxies.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Label>分组:</Label>
                  <Select value={String(edit.groupId ?? '')} onValueChange={(v) => set('groupId', v === '' ? null : Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">（无）</SelectItem>
                      {groups.map(g => <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )) : (
                <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                  选择左侧站点，或点击「新建站点」；<b className="ml-1">双击站点名可直接连接</b>
                </div>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭(X)</Button>
          <Button variant="outline" onClick={() => save()}>应用(A)</Button>
          <Button onClick={() => connect()} disabled={!edit || !edit.host}>连接(C)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
