import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, Pencil, Trash2 } from 'lucide-react'

export default function ProxyManager({ open, onOpenChange }) {
  const [proxies, setProxies] = useState([])
  const [edit, setEdit] = useState(null)

  const reload = async () => setProxies(await api.proxies())
  useEffect(() => { if (open) reload() }, [open])

  const set = (k, v) => setEdit(e => ({ ...e, [k]: v }))

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
    await reload()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>代理设置</DialogTitle></DialogHeader>
        <ScrollArea className="h-40 rounded-md border p-1">
          {!proxies.length && <div className="p-3 text-sm text-muted-foreground text-center">（暂无代理）</div>}
          {proxies.map(p => (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-accent text-sm">
              <b>{p.name}</b>
              <span className="text-muted-foreground">{p.kind === 'socks5' ? 'SOCKS5' : 'HTTP'} {p.host}:{p.port}</span>
              <span className="flex-1" />
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEdit({ ...p })}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => remove(p)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </ScrollArea>
        {edit && (
          <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-2.5 items-center mt-2">
            <Label>名称:</Label><Input value={edit.name} onChange={(e) => set('name', e.target.value)} />
            <Label>类型:</Label>
            <Select value={edit.kind} onValueChange={(v) => set('kind', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="socks5">SOCKS5</SelectItem>
                <SelectItem value="http">HTTP (CONNECT)</SelectItem>
              </SelectContent>
            </Select>
            <Label>主机:</Label><Input value={edit.host} onChange={(e) => set('host', e.target.value)} />
            <Label>端口:</Label><Input className="w-24" value={edit.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} />
            <Label>用户名:</Label><Input value={edit.username} onChange={(e) => set('username', e.target.value)} />
            <Label>密码:</Label><Input type="password" value={edit.password} onChange={(e) => set('password', e.target.value)} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setEdit({ id: 0, name: '', kind: 'socks5', host: '', port: 1080, username: '', password: '' })}>
            <Plus className="mr-1 h-4 w-4" />新增
          </Button>
          <span className="flex-1" />
          {edit && <Button variant="outline" onClick={save}>保存</Button>}
          {edit && <Button variant="outline" onClick={() => setEdit(null)}>取消</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭(X)</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
