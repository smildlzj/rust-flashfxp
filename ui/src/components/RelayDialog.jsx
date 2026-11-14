import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export default function RelayDialog({ open, onOpenChange, currentSite, remoteDir, onStart }) {
  const [sites, setSites] = useState([])
  const [srcSiteId, setSrcSiteId] = useState('')
  const [srcPath, setSrcPath] = useState('/')

  useEffect(() => {
    if (open) api.sites().then(setSites).catch(() => {})
  }, [open])

  const ready = srcSiteId !== '' && srcPath.trim() && currentSite

  const start = () => {
    const site = sites.find(s => s.id === Number(srcSiteId))
    if (!site) return
    onStart({ site, path: srcPath.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>站点互传（内存流水线，不落盘）</DialogTitle>
          <DialogDescription>
            目标：{currentSite ? `${currentSite.host}:${currentSite.port}` : '（未连接）'} → {remoteDir || '/'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-3 items-center">
          <Label>源站点:</Label>
          <Select value={srcSiteId} onValueChange={setSrcSiteId}>
            <SelectTrigger><SelectValue placeholder="选择站点" /></SelectTrigger>
            <SelectContent>
              {sites.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.host}:{s.port})</SelectItem>)}
            </SelectContent>
          </Select>
          <Label>源路径:</Label>
          <Input value={srcPath} onChange={(e) => setSrcPath(e.target.value)} placeholder="/tmp" />
        </div>
        <p className="text-xs text-muted-foreground">
          数据在内存中从源站点直转目标站点（8×256KB 缓冲流水线）。目录将递归复制。
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={start} disabled={!ready}>开始互传</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
