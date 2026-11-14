import React, { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  Folder, FolderOpen, FileText, Image, Music, Film, Monitor, Download, ChevronRight,
} from 'lucide-react'
import { api } from '../api.js'
import { ScrollArea } from '@/components/ui/scroll-area'

/** 展开状态持久化 */
function loadExpanded() {
  try { return new Set(JSON.parse(localStorage.getItem('fx.tree.expanded') || '[]')) } catch { return new Set() }
}
function saveExpanded(set) {
  try { localStorage.setItem('fx.tree.expanded', JSON.stringify([...set])) } catch {}
}

function TreeNode({ node, expandedSet, onToggle, onNavigate }) {
  const expanded = expandedSet.has(node.path)
  const [children, setChildren] = useState(node.children || null)

  useEffect(() => {
    if (expanded && children == null) {
      api.treeList(node.path)
        .then(items => setChildren(items.filter(i => !i.hidden).map(i => ({ name: i.name, path: i.path }))))
        .catch(() => setChildren([]))
    }
  }, [expanded]) // eslint-disable-line

  return (
    <div className="min-w-0">
      <div
        className="flex items-center gap-1 px-1 py-0.5 rounded-sm cursor-default hover:bg-accent text-sm min-w-0"
        onClick={() => onNavigate(node.path)}
      >
        <button className="w-3.5 h-4 flex-none flex items-center justify-center text-muted-foreground"
                onClick={(e) => { e.stopPropagation(); onToggle(node.path) }}>
          {children && children.length > 0
            ? <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
            : null}
        </button>
        {expanded
          ? <FolderOpen className="h-3.5 w-3.5 flex-none text-amber-500" />
          : <Folder className="h-3.5 w-3.5 flex-none text-amber-500" />}
        <span className="truncate whitespace-nowrap min-w-0 flex-1">{node.name}</span>
      </div>
      {expanded && children && (
        <div className="pl-3 min-w-0">
          {children.map((c) => (
            <TreeNode key={c.path} node={c} expandedSet={expandedSet} onToggle={onToggle} onNavigate={onNavigate} />
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
  const [expandedSet, setExpandedSet] = useState(loadExpanded)

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
        // 首次使用默认展开主目录
        setExpandedSet(prev => {
          if (prev.size === 0) {
            const next = new Set([home])
            saveExpanded(next)
            return next
          }
          return prev
        })
      } catch {}
    })()
  }, [home])

  const onToggle = (path) => {
    setExpandedSet(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      saveExpanded(next)
      return next
    })
  }

  return (
    <div className="w-48 flex-none min-h-0 flex flex-col border rounded-md bg-card overflow-hidden">
      <ScrollArea className="flex-1 min-h-0 p-1.5">
        <div className="min-w-0">
          {quickLinks.map((q) => (
            <div key={q.path}
                 className="flex items-center gap-2 px-2 py-1 rounded-sm cursor-default hover:bg-accent text-sm min-w-0"
                 onClick={() => onNavigate(q.path)}>
              <q.Icon className="h-3.5 w-3.5 flex-none text-muted-foreground" />
              <span className="truncate whitespace-nowrap">{q.label}</span>
            </div>
          ))}
          <div className="h-px bg-border my-1.5" />
          {roots.map((n) => (
            <TreeNode key={n.path} node={n} expandedSet={expandedSet} onToggle={onToggle} onNavigate={onNavigate} />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
