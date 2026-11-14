import React, { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  ChevronUp, RotateCw, Home, FolderPlus, Pencil, Trash2, Upload, Download, GitCompareArrows,
  FileText, Folder,
} from 'lucide-react'
import { humanSize, fmtTime } from '../api.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu'

function IconBtn({ icon: Icon, title, disabled, onClick, className }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={disabled} onClick={onClick}>
          <Icon className={cn('h-4 w-4', className)} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">{title}</TooltipContent>
    </Tooltip>
  )
}

/** 地址栏：本地缓冲，回车/失焦变更后导航 */
function AddressBar({ address, connected, onGo }) {
  const [buf, setBuf] = useState(address || '')
  useEffect(() => { setBuf(address || '') }, [address])
  return (
    <Input
      className="h-7 flex-1 font-mono text-xs"
      value={buf}
      disabled={!connected}
      placeholder="输入路径后回车"
      onChange={(e) => setBuf(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && buf) { onGo(buf); e.currentTarget.blur() }
      }}
      onBlur={() => { if (buf && buf !== address) onGo(buf) }}
    />
  )
}

const MARK_CLS = { same: 'text-green-600', only: 'text-blue-600', diff: 'text-amber-600' }
const MARK_TXT = { same: '·', only: '＋', diff: '▲' }

export default function FilePane({
  pane, title, entries, selected, marks, address, connected, diskFree, host,
  onNavigate, onRefresh, onSelect, onActivate, onAction, onAddressGo, onHome, onDropTransfer,
}) {
  const [dragOver, setDragOver] = useState(false)
  const files = entries.filter(e => !e.isDir).length
  const dirs = entries.filter(e => e.isDir).length
  const total = entries.reduce((s, e) => s + (e.size || 0), 0)
  const hasMarks = marks && Object.keys(marks).length > 0
  const TransferIcon = pane === 'local' ? Upload : Download

  // 栏间拖放：本地 → 远程 = 上传；远程 → 本地 = 下载
  const handleDrop = (ev) => {
    ev.preventDefault()
    setDragOver(false)
    let payload = null
    try {
      payload = JSON.parse(ev.dataTransfer.getData('application/x-fx-drag'))
    } catch {}
    if (!payload || payload.pane === pane || !connected) return
    const direction = pane === 'remote' ? 'upload' : 'download'
    onDropTransfer && onDropTransfer(direction, payload.name, payload.isDir)
  }

  return (
    <div
      className={cn(
        'flex-1 min-w-0 flex flex-col border rounded-md bg-card overflow-hidden',
        dragOver && 'ring-2 ring-primary/60 border-primary',
      )}
      onDragOver={(ev) => {
        if (!connected) return
        ev.preventDefault()
        ev.dataTransfer.dropEffect = 'copy'
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* 页签 + 导航 + 地址栏 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-muted/40 flex-none">
        <span className={cn(
          'px-3 py-0.5 rounded-t-md text-xs font-semibold border-b-2',
          pane === 'local' ? 'border-green-600 text-green-800 bg-green-500/10' : 'border-blue-600 text-blue-800 bg-blue-500/10',
        )}>{title}</span>
        <IconBtn icon={ChevronUp} title="上级目录" onClick={onNavigate} />
        <IconBtn icon={RotateCw} title="刷新" onClick={onRefresh} />
        <IconBtn icon={Home} title="主目录" onClick={onHome} />
        <AddressBar address={address} connected={connected} onGo={onAddressGo} />
      </div>
      {/* 操作按钮 */}
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b flex-none">
        <IconBtn icon={FolderPlus} title="新建目录" onClick={() => onAction('mkdir')} />
        <IconBtn icon={Pencil} title="重命名" disabled={selected == null} onClick={() => onAction('rename')} />
        <IconBtn icon={Trash2} title="删除" disabled={selected == null} onClick={() => onAction('delete')} className="text-red-600" />
        <IconBtn icon={TransferIcon} title={pane === 'local' ? '上传到远程' : '下载到本地'}
                 disabled={selected == null || !connected} onClick={() => onAction('transfer')} />
        <IconBtn icon={GitCompareArrows} title="与对侧比较" disabled={!connected} onClick={() => onAction('compare')} />
        {hasMarks && (
          <span className="ml-2 text-xs text-muted-foreground">
            <span className="text-green-600">· 相同</span>
            <span className="mx-1 text-blue-600">＋ 仅本侧</span>
            <span className="text-amber-600">▲ 大小不同</span>
            <button className="ml-2 underline" onClick={() => onAction('clear-compare')}>清除比较</button>
          </span>
        )}
      </div>
      {/* 文件列表（右键菜单） */}
      <ContextMenu>
      <ContextMenuTrigger asChild>
      <ScrollArea className="flex-1 min-h-0">
        {entries.length > 0 ? (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-7 cursor-default select-none" onClick={() => onAction('sort-name')}>名称</TableHead>
                <TableHead className="h-7 w-24 text-right cursor-default select-none" onClick={() => onAction('sort-size')}>大小</TableHead>
                <TableHead className="h-7 w-32 cursor-default select-none" onClick={() => onAction('sort-time')}>修改时间</TableHead>
                {pane === 'remote' && <TableHead className="h-7 w-28">属性</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e, i) => (
                <ContextMenu key={e.name}>
                <ContextMenuTrigger asChild>
                <TableRow
                  draggable
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData('application/x-fx-drag', JSON.stringify({ pane, name: e.name, isDir: e.isDir }))
                    ev.dataTransfer.setData('text/plain', e.name)
                    ev.dataTransfer.effectAllowed = 'copy'
                  }}
                  className={cn('cursor-default', selected === i && 'bg-primary text-primary-foreground hover:bg-primary')}
                  onClick={() => onSelect(i)}
                  onDoubleClick={() => onActivate(i)}
                >
                  <TableCell className="py-0.5 max-w-0 truncate">
                    <span className={cn(
                      'flex items-center gap-1.5',
                      e.isDir && 'font-medium text-blue-600',
                      selected === i && 'text-primary-foreground',
                    )}>
                      {e.isDir
                        ? <Folder className="h-3.5 w-3.5 flex-none text-amber-500" />
                        : <FileText className={cn('h-3.5 w-3.5 flex-none', e.isSymlink ? 'text-teal-600' : 'text-muted-foreground')} />}
                      <span className="truncate">{e.name}</span>
                      {marks && marks[e.name] && (
                        <span className={cn('text-xs', MARK_CLS[marks[e.name]], selected === i && 'text-primary-foreground')}>
                          {MARK_TXT[marks[e.name]]}
                        </span>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="py-0.5 text-right text-xs text-muted-foreground">{e.isDir ? '' : humanSize(e.size)}</TableCell>
                  <TableCell className="py-0.5 text-xs text-muted-foreground">{fmtTime(e.mtime)}</TableCell>
                  {pane === 'remote' && (
                    <TableCell className="py-0.5 font-mono text-xs text-muted-foreground">
                      {e.perms ? (e.isDir ? 'd' : '-') + e.perms : ''}
                    </TableCell>
                  )}
                </TableRow>
                </ContextMenuTrigger>
                <ContextMenuContent className="text-xs">
                  <ContextMenuItem disabled={!connected} onClick={() => onAction('transfer')}>
                    {pane === 'local' ? '⇧ 上传到远程' : '⇩ 下载到本地'}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => onAction('rename')}>✎ 重命名</ContextMenuItem>
                  <ContextMenuItem className="text-red-600" onClick={() => onAction('delete')}>✖ 删除</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => navigator.clipboard?.writeText(
                    pane === 'local' ? `${address}/${e.name}` : (address || '') + '/' + e.name,
                  )}>复制路径</ContextMenuItem>
                </ContextMenuContent>
                </ContextMenu>
              ))}
            </TableBody>
          </Table>
        ) : !connected && pane === 'remote' ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-8">
            未连接 — 请在上方快速连接或在站点管理器中选择站点
          </div>
        ) : (
          <div className="h-24 flex items-center justify-center text-sm text-muted-foreground">（空目录）</div>
        )}
      </ScrollArea>
      </ContextMenuTrigger>
      <ContextMenuContent className="text-xs">
        <ContextMenuItem onClick={onRefresh}>⟳ 刷新</ContextMenuItem>
        <ContextMenuItem onClick={() => onAction('mkdir')}>＋ 新建目录</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!connected} onClick={() => onAction('compare')}>⇋ 与对侧比较</ContextMenuItem>
      </ContextMenuContent>
      </ContextMenu>
      {/* 栏底统计条 */}
      <div className={cn(
        'flex items-center justify-between px-3 py-1 text-xs border-t flex-none',
        pane === 'local' ? 'bg-green-500/15 text-green-900' : 'bg-muted text-muted-foreground',
      )}>
        <span>
          {files} 个文件, {dirs} 个文件夹, 共计 {files + dirs} 项 ({humanSize(total)}
          {pane === 'local' && diskFree ? ` / ${humanSize(diskFree)} 可用` : ''})
        </span>
        <span className="font-medium">{pane === 'local' ? '本地浏览器' : (host || '')}</span>
      </div>
    </div>
  )
}
