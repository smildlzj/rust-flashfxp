import React, { useEffect, useState } from 'react'
import { Ico } from '../winicons.jsx'
import { api } from '../api.js'

/* 展开状态持久化 */
function loadExpanded() {
  try { return new Set(JSON.parse(localStorage.getItem('fx.tree.expanded3') || '[]')) } catch { return new Set() }
}
function saveExpanded(set) {
  try { localStorage.setItem('fx.tree.expanded3', JSON.stringify([...set])) } catch {}
}

function TreeNode({ node, expandedSet, onToggle, onNavigate, currentPath, onContextMenu }) {
  const key = node.key || node.path
  const expanded = expandedSet.has(key)
  const [children, setChildren] = useState(node.children || (node.load ? null : []))

  useEffect(() => {
    if (!expanded || children != null) return
    let alive = true
    api.treeList(node.path)
      .then(items => {
        if (!alive) return
        setChildren(items.filter(i => !i.hidden && i.isDir !== false).map(i => ({
          name: i.name, path: i.path, icon: 'folder', load: true,
        })))
      })
      .catch(() => alive && setChildren([]))
    return () => { alive = false }
  }, [expanded, children, node.path])

  const expandable = node.load || (node.children && node.children.length > 0)
  const hasKids = children && children.length > 0

  return (
    <div className="fx-tree-node fx-tree-child-line">
      <div className={`fx-tree-row ${node.selectable !== false && currentPath === node.path ? 'fx-selected' : ''}`}
           onClick={() => onNavigate(node.path)}
           onContextMenu={(e) => onContextMenu && onContextMenu(e, [
             { label: '打开', act: () => onNavigate(node.path) },
             { label: expanded ? '折叠' : '展开', disabled: !expandable, act: () => onToggle(key) },
             { sep: true },
             { label: '刷新', key: 'F5', act: () => onNavigate(node.path) },
             { label: '上级目录', act: () => onNavigate(node.path.replace(/\/[^/]+\/?$/, '') || '/') },
             { sep: true },
             { label: '复制路径', act: () => navigator.clipboard?.writeText(node.path) },
           ])}>
        <button className="fx-tree-arrow" title={expanded ? '折叠' : '展开'}
                onClick={(e) => { e.stopPropagation(); onToggle(key) }}>
          {expandable && (expanded ? '▼' : '▶')}
        </button>
        <span className="fx-tree-icon">
          <Ico name={node.icon || (expanded ? 'folderOpen' : 'folder')} size={16} />
        </span>
        <span className="fx-tree-label">{node.name}</span>
      </div>
      {expanded && children && children.length > 0 && (
        <div className="fx-tree-children">
          {children.map(c => (
            <TreeNode key={c.path} node={c} expandedSet={expandedSet} onToggle={onToggle}
                      onNavigate={onNavigate} currentPath={currentPath} onContextMenu={onContextMenu} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function DirTree({ home, onNavigate, currentPath, onContextMenu }) {
  const [roots, setRoots] = useState([])
  const [expandedSet, setExpandedSet] = useState(loadExpanded)

  useEffect(() => {
    if (!home) return
    const user = home.split('/').pop() || '用户'
    const q = (name, dir, icon, tag = 'top') => ({
      name, path: `${home}/${dir}`, icon, load: true, key: `${tag}:${dir}`,
    })
    const nodes = [
      q('桌面', 'Desktop', 'desktop'),
      { name: '云盘', path: home, icon: 'cloud', load: false, key: 'cloud', selectable: false },
      { name: user, path: home, icon: 'user', load: true, key: 'user' },
      {
        name: '此电脑', path: '/', icon: 'computer', load: false, key: 'computer',
        children: [
          q('桌面', 'Desktop', 'desktop', 'pc'),
          q('下载', 'Downloads', 'folder', 'pc'),
          q('文稿', 'Documents', 'folder', 'pc'),
          q('图片', 'Pictures', 'folder', 'pc'),
          q('音乐', 'Music', 'folder', 'pc'),
          q('影片', 'Movies', 'folder', 'pc'),
          { name: '本地磁盘 (C:)', path: '/', icon: 'drive', load: true, key: 'driveC' },
          { name: '本地磁盘 (D:)', path: '/Volumes', icon: 'drive', load: true, key: 'driveD' },
        ],
      },
      { name: '库', path: `${home}/Library`, icon: 'library', load: true },
      { name: '网络', path: '/Volumes', icon: 'network', load: true },
    ]
    setRoots(nodes)
    setExpandedSet(prev => {
      if (prev.size === 0) { const n = new Set(['computer']); saveExpanded(n); return n }
      return prev
    })
    // 主目录下的真实子文件夹（置于树底部，可继续展开）
    api.treeList(home).then(items => {
      const dirs = items.filter(i => !i.hidden && i.isDir !== false).map(i => ({
        name: i.name, path: i.path, icon: 'folder', load: true,
      }))
      setRoots(prev => [...prev, ...dirs])
    }).catch(() => {})
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
    <div className="fx-tree fx-scroll"
         onContextMenu={(e) => onContextMenu && onContextMenu(e, [
           { label: '刷新目录树', key: 'F5', act: () => onNavigate(currentPath || home) },
           { label: '主目录', act: () => onNavigate(home) },
           { sep: true },
           { label: '此电脑 (根目录)', act: () => onNavigate('/') },
         ])}>
      {roots.map(n => (
        <TreeNode key={n.path + n.name} node={n} expandedSet={expandedSet}
                  onToggle={onToggle} onNavigate={onNavigate} currentPath={currentPath}
                  onContextMenu={onContextMenu} />
      ))}
    </div>
  )
}
