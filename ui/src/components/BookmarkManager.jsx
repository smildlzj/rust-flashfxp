import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { t } from '../i18n.js'
import { WinButton, WinInput, WinCombo, WinDialog } from '../win32.jsx'

const draftBookmark = (localPath, remotePath) => ({ id: 0, caption: '', localPath, remotePath, syncBrowsing: 'default' })

export function BookmarkPanel({ siteId = null, localPath = '', remotePath = '', onChanged = () => {}, initialAdd = false }) {
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [draft, setDraft] = useState(() => initialAdd ? draftBookmark(localPath, remotePath) : null)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const reload = async () => setItems(await api.bookmarks(siteId))
  useEffect(() => {
    let active = true
    api.bookmarks(siteId).then(list => { if (active) setItems(list) }).catch(e => { if (active) setError(String(e)) })
    return () => { active = false }
  }, [siteId])
  useEffect(() => {
    let active = true
    let unlisten
    api.onBrowsingChanged(kind => {
      if (kind === 'bookmarks') api.bookmarks(siteId).then(list => { if (active) setItems(list) }).catch(e => { if (active) setError(String(e)) })
    }).then(stop => { if (active) unlisten = stop; else stop() }).catch(e => { if (active) setError(String(e)) })
    return () => { active = false; unlisten?.() }
  }, [siteId])
  const current = items.find(item => item.id === selected)
  const set = (key, value) => setDraft(previous => ({ ...previous, [key]: value }))
  const perform = async action => {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const save = () => perform(async () => {
    const bookmark = { ...draft, caption: draft.caption.trim(), localPath: draft.localPath.trim(), remotePath: draft.remotePath.trim() }
    if (!bookmark.caption) throw new Error(t('bookmark_caption_required'))
    if (!bookmark.localPath && !bookmark.remotePath) throw new Error(t('bookmark_path_required'))
    await api.saveBookmark(bookmark, siteId)
    setDraft(null)
    await reload()
    onChanged()
  })
  const remove = () => perform(async () => {
    await api.deleteBookmark(selected, siteId)
    setDeleting(false); setSelected(null)
    await reload()
    onChanged()
  })
  const browse = () => perform(async () => { const path = await api.pickFolder(); if (path) set('localPath', path) })
  return <div className="flex flex-col gap-3">
    <div className="text-xs text-muted-foreground">{t('bookmark_scope_hint')}</div>
    <div className="overflow-auto rounded-md border border-border max-h-52 min-h-24" role="listbox" aria-label={t('bookmarks')}>
      {!items.length && <div className="p-4 text-sm text-muted-foreground">{t('bookmark_empty')}</div>}
      {items.map(item => <button key={item.id} type="button" role="option" aria-selected={selected === item.id}
        disabled={!!draft || deleting || busy} onClick={() => setSelected(item.id)}
        onDoubleClick={() => { setSelected(item.id); setDraft({ ...item }); setError('') }}
        className={`block w-full px-3 py-2 text-left text-sm border-b last:border-b-0 ${selected === item.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted'}`}>
        <div className="font-medium truncate">{item.caption}</div>
        <div className="text-xs text-muted-foreground truncate">{[item.remotePath, item.localPath].filter(Boolean).join(' ↔ ')}</div>
      </button>)}
    </div>
    <div className="flex gap-2">
      <WinButton compact variant="outline" disabled={!!draft || deleting || busy} onClick={() => { setDraft(draftBookmark(localPath, remotePath)); setError('') }}>{t('bookmark_new')}</WinButton>
      <WinButton compact variant="outline" disabled={!current || !!draft || deleting || busy} onClick={() => { setDraft({ ...current }); setError('') }}>{t('bookmark_edit')}</WinButton>
      <WinButton compact variant="outline" disabled={!current || !!draft || deleting || busy} onClick={() => { setDeleting(true); setError('') }}>{t('bookmark_delete')}</WinButton>
    </div>
    {deleting && <div className="rounded-md border border-border p-3 text-sm">
      <p>{t('bookmark_delete_question')} “{current?.caption}”</p>
      <div className="mt-2 flex gap-2"><WinButton compact disabled={busy} onClick={remove}>{t('bookmark_confirm_delete')}</WinButton><WinButton compact variant="outline" disabled={busy} onClick={() => setDeleting(false)}>{t('cancel')}</WinButton></div>
    </div>}
    {draft && <div className="rounded-md border border-border p-3 flex flex-col gap-3">
      <label className="text-sm" htmlFor="bookmark-caption">{t('bookmark_caption')}</label>
      <WinInput id="bookmark-caption" autoFocus disabled={busy} value={draft.caption} onChange={e => set('caption', e.target.value)} />
      <label className="text-sm" htmlFor="bookmark-remote">{t('bookmark_remote_path')}</label>
      <WinInput id="bookmark-remote" disabled={busy} value={draft.remotePath} onChange={e => set('remotePath', e.target.value)} />
      <label className="text-sm" htmlFor="bookmark-local">{t('bookmark_local_path')}</label>
      <div className="flex gap-2"><WinInput id="bookmark-local" className="min-w-0 flex-1" disabled={busy} value={draft.localPath} onChange={e => set('localPath', e.target.value)} /><WinButton variant="outline" disabled={busy} onClick={browse}>{t('browse')}</WinButton></div>
      <label className="text-sm" htmlFor="bookmark-sync">{t('bookmark_sync')}</label>
      <WinCombo id="bookmark-sync" disabled={busy} value={draft.syncBrowsing} onChange={value => set('syncBrowsing', value)} options={['default', 'enabled', 'disabled'].map(value => ({ value, label: t(`bookmark_sync_${value}`) }))} />
      <div className="flex justify-end gap-2"><WinButton variant="outline" disabled={busy} onClick={() => { setDraft(null); setError('') }}>{t('cancel')}</WinButton><WinButton disabled={busy} onClick={save}>{t('save')}</WinButton></div>
    </div>}
    {error && <div role="alert" className="text-sm text-destructive">{error}</div>}
  </div>
}

export default function BookmarkManager({ open, onOpenChange, ...props }) {
  return <WinDialog open={open} title={t('bookmarks')} width={600} onClose={() => onOpenChange(false)}
    footer={<WinButton variant="outline" onClick={() => onOpenChange(false)}>{t('close_x')}</WinButton>}>
    {open && <BookmarkPanel {...props} />}
  </WinDialog>
}
