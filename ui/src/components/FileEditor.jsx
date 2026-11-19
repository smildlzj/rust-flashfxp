import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { errorMessage, t } from '../i18n.js'
import { matchesHighlightMask } from '../highlights.js'
import { WinButton, WinContextMenu, useWinContextMenu } from '../win32.jsx'

function associationFor(name, action, rules) {
  for (const rule of rules) {
    const pattern = rule.pattern.trim()
    const program = rule[action]?.trim()
    if (!pattern || (!program && !(action === 'edit' && rule.policy))) continue
    if (matchesHighlightMask(name, pattern)) return { program: program || null, policy: rule.policy }
  }
  return {}
}

function historyStorage(key, value) {
  const storageKey = 'fx.editHistory.' + key
  if (value === undefined) {
    try {
      const entries = JSON.parse(localStorage.getItem(storageKey) || '[]')
      return Array.isArray(entries) ? entries : []
    } catch { return [] }
  }
  localStorage.setItem(storageKey, JSON.stringify(value))
}

function fileStatus(file) {
  if (file.historical) return t('edit_history_inactive')
  if (file.busy) return t('saving_open_file')
  if (file.watchError) return t('edit_status_error')
  if (file.fingerprint || file.staged != null) return t('file_changes_pending_upload')
  if (file.draft !== file.uploaded) return t('edit_status_modified')
  if (file.saved) return t('file_edit_uploaded')
  return t(file.editable ? 'edit_status_active' : 'view_file')
}

export default function FileEditor({ request, onRequestDone }) {
  const [files, setFiles] = useState([])
  const [history, setHistory] = useState([])
  const [historyScope, setHistoryScope] = useState(null)
  const [allEdits, setAllEdits] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [loading, setLoading] = useState(0)
  const [confirmation, setConfirmation] = useState(null)
  const [error, setError] = useState('')
  const handled = useRef(null)
  const writing = useRef(new Set())
  const sessionHistory = useRef(new Map())
  const context = useWinContextMenu()
  const rows = allEdits
    ? [...files, ...history.filter(item => !files.some(active => active.editable && active.siteKey === historyScope?.siteKey && active.path === item.path))]
    : files
  const file = rows.find(item => item.id === activeId) ?? rows[0]
  const update = (id, patch) => setFiles(items => items.map(item => item.id === id ? { ...item, ...patch } : item))

  const select = item => {
    setActiveId(item.id)
    setConfirmation(null)
    setError('')
  }

  const remember = (scope, item, remove = false) => {
    const apply = rows => {
      const others = rows.filter(row => row.path !== item.path)
      if (remove) return others
      return [{ id: 'history:' + item.path, historical: true, path: item.path, site: item.site }, ...others].slice(0, 200)
    }
    const entries = apply(scope.remember ? historyStorage(scope.siteKey) : sessionHistory.current.get(scope.siteKey) ?? [])
    sessionHistory.current.set(scope.siteKey, entries)
    if (scope.remember) historyStorage(scope.siteKey, entries)
    setHistory(entries)
  }

  const openEntry = async (entry, config) => {
    const rule = associationFor(entry.name, config.action, config.associations)
    const editable = config.action === 'edit'
    const savePolicy = rule.policy || config.policy
    const result = await api.fileEditOpen(entry.path, config.remote, editable, rule.program ?? null, savePolicy, config.siteKey)
    if (!result.id) return null
    const opened = { ...result, editable, siteKey: config.siteKey, policy: savePolicy, draft: result.text, uploaded: result.text }
    setFiles(items => [...items, opened])
    if (editable && opened.site && config.siteKey) {
      remember(config, opened)
    }
    if (!opened.external && config.show === false) await api.focusFileEditor()
    return opened
  }

  useEffect(() => {
    if (!request || request === handled.current) return
    handled.current = request
    setError('')
    setConfirmation(null)
    if (request.siteKey || request.action === 'manage') {
      setHistoryScope(request)
      const records = request.siteKey && request.remember
        ? historyStorage(request.siteKey)
        : sessionHistory.current.get(request.siteKey) ?? []
      setHistory(records)
    }
    if (request.action === 'manage') {
      onRequestDone()
      return
    }
    setLoading(count => count + 1)
    const openFiles = async () => {
      let first = true
      for (const entry of request.entries) {
        try {
          const existing = files.find(item => item.path === entry.path && item.siteKey === request.siteKey &&
            item.editable === (request.action === 'edit'))
          const opened = existing ?? await openEntry(entry, request)
          if (existing?.external) await api.fileEditReopen(existing.id)
          if (existing && !existing.external && request.show === false) await api.focusFileEditor()
          if (opened && first) {
            setActiveId(opened.id)
            first = false
          }
        } catch (problem) {
          setError(entry.name + ' — ' + errorMessage(problem))
          if (request.show === false) await api.focusFileEditor().catch(() => {})
        }
      }
      setLoading(count => count - 1)
      onRequestDone()
    }
    void openFiles()
  }, [request])

  const upload = async (item, text, fingerprint) => {
    if (writing.current.has(item.id)) return
    writing.current.add(item.id)
    setError('')
    update(item.id, { busy: true, prompt: false, watchError: null })
    try {
      await api.fileEditSave(item.id, text, fingerprint)
      update(item.id, { uploaded: text, staged: null, fingerprint: null, saved: !!item.site })
    } catch (problem) {
      const message = errorMessage(problem)
      setError(message)
    } finally {
      writing.current.delete(item.id)
      update(item.id, { busy: false })
    }
  }

  useEffect(() => {
    let disposed = false
    let unlisten
    api.onFileEditorChange(({ id, ...change }) => {
      if (disposed) return
      update(id, change)
      if (change.prompt) {
        setActiveId(id)
        setConfirmation(null)
      }
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    }).catch(problem => { if (!disposed) setError(errorMessage(problem)) })
    return () => { disposed = true; unlisten?.() }
  }, [])

  const save = () => {
    if (!file.site || file.policy === 'upload') {
      void upload(file, file.draft, null)
      return
    }
    update(file.id, { staged: file.draft, prompt: file.policy === 'prompt' })
  }

  const closeFile = async (item, force = false) => {
    if (writing.current.has(item.id)) return
    writing.current.add(item.id)
    try {
      if (!force && item.site && item.external && item.editable) {
        const fingerprint = await api.fileEditModified(item.id)
        if (fingerprint) {
          update(item.id, { fingerprint })
          setConfirmation({ id: item.id, action: 'close' })
          return
        }
      }
      await api.fileEditClose(item.id)
      setFiles(items => items.filter(file => file.id !== item.id))
      setConfirmation(null)
      setError('')
    } catch (problem) {
      setError(errorMessage(problem))
    } finally {
      writing.current.delete(item.id)
    }
  }

  const reopen = async (item, redownload = false) => {
    if (writing.current.has(item.id)) return
    writing.current.add(item.id)
    setError('')
    setConfirmation(null)
    update(item.id, { busy: true })
    try {
      if (item.historical) {
        const opened = await openEntry({ name: item.path.split('/').at(-1), path: item.path },
          { ...historyScope, remote: true, action: 'edit' })
        if (opened) setActiveId(opened.id)
      } else if (redownload || item.external) {
        const text = await api.fileEditReopen(item.id, redownload)
        if (redownload) {
          update(item.id, { draft: text, uploaded: text, staged: null, fingerprint: null, prompt: false, saved: false, watchError: null })
        }
      }
    } catch (problem) {
      setError(errorMessage(problem))
    } finally {
      writing.current.delete(item.id)
      update(item.id, { busy: false })
    }
  }

  const hasPending = item => item.staged != null || !!item.fingerprint
  const isDirty = item => item.draft !== item.uploaded || hasPending(item)
  const requestClose = item => isDirty(item)
    ? setConfirmation({ id: item.id, action: 'close' })
    : void closeFile(item)
  const requestRedownload = item => setConfirmation({ id: item.id, action: 'redownload' })
  const removeHistory = item => {
    try { remember(historyScope, item, true) }
    catch (problem) { setError(errorMessage(problem)) }
  }
  const uploadItem = item => upload(item, item.staged, item.fingerprint)
  const pending = file && hasPending(file)
  const unsaved = !!file && file.draft !== (file.staged ?? file.uploaded)
  const confirmedAction = confirmation?.id === file?.id ? confirmation?.action : null

  const rowMenu = (event, item) => {
    select(item)
    if (item.historical) {
      context.openMenu(event, [
        { label: t('reopen_edit'), act: () => reopen(item) },
        { label: t('remove_edit_history'), act: () => removeHistory(item) },
      ])
      return
    }
    context.openMenu(event, [
      { label: t('reopen_edit'), disabled: !!item.busy, act: () => reopen(item) },
      { label: t('upload'), disabled: !item.editable || !item.site || !hasPending(item) || !!item.busy, act: () => uploadItem(item) },
      { label: t('redownload_edit'), disabled: !item.site || !!item.busy, act: () => requestRedownload(item) },
      { sep: true },
      { label: t('close_open_file'), disabled: !!item.busy, act: () => requestClose(item) },
    ])
  }

  return (
    <main className="flex h-screen min-h-0 flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        <div className="flex gap-2">
          <WinButton compact variant={allEdits ? 'outline' : 'default'} aria-pressed={!allEdits}
            onClick={() => { setAllEdits(false); setConfirmation(null) }}>{t('active_file_edits')}</WinButton>
          <WinButton compact variant={allEdits ? 'default' : 'outline'} aria-pressed={allEdits}
            onClick={() => { setAllEdits(true); setConfirmation(null) }}>{t('all_file_edits')}</WinButton>
        </div>
        {rows.length > 0 && <table className="fx-list w-full">
          <thead><tr>
            <th>{t('edit_file_path')}</th><th>{t('edit_file_site')}</th><th>{t('edit_file_status')}</th>
          </tr></thead>
          <tbody>{rows.map(item => (
            <tr key={item.id} tabIndex={0} aria-selected={item.id === file?.id}
              className={item.id === file?.id ? 'fx-selected' : ''}
              onClick={() => select(item)}
              onDoubleClick={() => { if (!item.busy) void reopen(item) }}
              onKeyDown={event => { if (event.key === 'Enter' && !item.busy) void reopen(item) }}
              onContextMenu={event => rowMenu(event, item)}>
              <td title={item.path}>{item.path}</td><td>{item.site || '—'}</td><td>{fileStatus(item)}</td>
            </tr>
          ))}</tbody>
        </table>}
        {loading > 0 && <p role="status">{t('opening_file')}</p>}
        {(file?.watchError || error) && <p role="alert" className="text-destructive">{file?.watchError || error}</p>}
        {!file && !loading && !error && <p>{t('no_open_files')}</p>}
        {file?.external && <p>{t('external_file_open')}</p>}
        {file && !file.historical && !file.external && <textarea aria-label={file.path} spellCheck={false} readOnly={!file.editable}
          className="min-h-72 w-full resize-y rounded border border-input bg-background p-2 font-mono"
          value={file.draft} onChange={event => update(file.id, { draft: event.target.value })} />}
        {file?.busy && <p role="status">{t('saving_open_file')}</p>}
        {file?.saved && !pending && !file.busy && <p role="status">{t('file_edit_uploaded')}</p>}
        {pending && !file?.busy && !file?.prompt && <p role="status">{t('file_changes_pending_upload')}</p>}
        {file?.prompt && <div className="flex items-center gap-2">
          <span>{t('upload_edited_file')}</span>
          <WinButton onClick={() => upload(file, file.staged, file.fingerprint)}>{t('upload')}</WinButton>
          <WinButton variant="outline" onClick={() => update(file.id, { prompt: false })}>{t('cancel')}</WinButton>
        </div>}
        {file && confirmedAction && <div className="flex items-center gap-2">
          <span>{t(confirmedAction === 'close' ? 'discard_open_file_changes' : 'confirm_redownload_edit')}</span>
          <WinButton disabled={!!file.busy} onClick={() => confirmedAction === 'close' ? closeFile(file, true) : reopen(file, true)}>
            {t(confirmedAction === 'close' ? 'close_open_file' : 'redownload_edit')}
          </WinButton>
          <WinButton variant="outline" onClick={() => setConfirmation(null)}>{t('cancel')}</WinButton>
        </div>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-border p-3">
        {file?.historical && <WinButton variant="outline" onClick={() => removeHistory(file)}>{t('remove_edit_history')}</WinButton>}
        {file && (file.external || file.historical) && <WinButton variant="outline" disabled={!!file.busy || !!loading}
          onClick={() => reopen(file)}>{t('reopen_edit')}</WinButton>}
        {file?.site && !file.historical && <WinButton variant="outline" disabled={!!file.busy}
          onClick={() => requestRedownload(file)}>{t('redownload_edit')}</WinButton>}
        {file && !file.historical && <WinButton variant="outline" disabled={!!file.busy} onClick={() => requestClose(file)}>
          {t('close_open_file')}
        </WinButton>}
        {file?.editable && !file.external && <WinButton disabled={!unsaved || !!file.busy} onClick={save}>{t('save')}</WinButton>}
        {file?.editable && file.site && pending && !file.prompt && <WinButton disabled={!!file.busy}
          onClick={() => upload(file, file.staged, file.fingerprint)}>{t('upload')}</WinButton>}
      </footer>
      <WinContextMenu menu={context.menu} onClose={context.closeMenu} />
    </main>
  )
}
