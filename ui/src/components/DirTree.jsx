import React, { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Folder, FolderOpen, FileText, Image, Music, Film, Monitor, Download, ChevronRight,
} from 'lucide-react'
import { api } from '../api.js'
import { ScrollArea } from '@/components/ui/scroll-area'

function TreeNode({ node, onNavigate }) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState(node.children || null)

  const toggle = async (e) => {
    e.stopPropagation()
    const next = !expanded
    setExpanded(next)
    if (next && children == null) {
      try {
        const items = await api.treeList(node.path)
        setChildren(items.filter(i => !i.hidden).map(i => ({ name: i.name, path: i.path })))
      } catch {
        setChildren([])
      }
    }
  }

  return (
    <div>
      <div
        className="flex items-center gap-1 px-1 py-0.5 rounded-sm cursor-default hover:bg-accent text-sm"
        onClick={() => onNavigate(node.path)}
      >
        <button className="w-3.5 flex items-center justify-center text-muted-foreground" onClick={toggle}>
          {children && children.length > 0 ? <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} /> : null}
        </button>
        {expanded ? <FolderOpen className="h-3.5 w-3.5 text-amber-500" /> : <Folder className="h-3.5 w-3.5 text-amber-500" />}
        <span className="truncate">{node.name}</span>
      </div>
      {expanded && children && (
        <div className="pl-3">
          {children.map((c) => (
            <TreeNode key={c.path} node={c} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  )
}

const QUICK = [
  ['桌面', 'Desktop', Monitor], ['下载', 'Downloads', Download], ['文档', 'Documents', FileText],
  ['图片', 'Pictures', Image], ['音乐', 'Music', Music], ['影片', 'Movies', Film],
]

export default function DirTree({ home, onNavigate }) {
  const [quickLinks, setQuickLinks] = useState([])
  const [roots, setRoots] = useState([])

  useEffect(() => {
    ;(async () => {
      const links = []
      for (const [label, dir, Icon] of QUICK) {
        const path = `${home}/${dir}`
        try {
          await api.treeList(path)
          links.push({ label, path, Icon })
        } catch {}
      }
      setQuickLinks(links)
      try {
        const items = await api.treeList(home)
        setRoots([{
          name: '主目录', path: home,
          children: items.filter(i => !i.hidden).map(i => ({ name: i.name, path: i.path })),
        }])
      } catch {}
    })()
  }, [home])

  return (
    <div className="w-48 flex-none flex flex-col border rounded-md bg-card overflow-hidden">
      <ScrollArea className="flex-1 p-1.5">
        {quickLinks.map((q) => (
          <div key={q.path}
               className="flex items-center gap-2 px-2 py-1 rounded-sm cursor-default hover:bg-accent text-sm"
               onClick={() => onNavigate(q.path)}>
            <q.Icon className="h-3.5 w-3.5 text-muted-foreground" />
            {q.label}
          </div>
        ))}
        <div className="h-px bg-border my-1.5" />
        {roots.map((n) => (
          <TreeNode key={n.path} node={n} onNavigate={onNavigate} />
        ))}
      </ScrollArea>
    </div>
  )
}
