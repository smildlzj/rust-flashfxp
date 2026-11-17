import React, { useEffect, useRef, useState } from 'react'
import { t, errorMessage } from '../i18n.js'
import { api } from '../api.js'
import { validateHighlightMask } from '../highlights.js'
import { WinButton, WinInput, WinDialog, WinTabs } from '../win32.jsx'

export default function FiltersDialog({ open, onOpenChange, onChanged }) {
  const [rules, setRules] = useState([])
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const status = useRef({ dirty: false, saving: false, conflict: false, baseline: [] })
  useEffect(() => {
    if (!open) return
    let active = true, unlisten, revision = 0
    status.current = { dirty: false, saving: false, conflict: false, baseline: [] }
    setConflict(false); setLoaded(false); setError(''); setBusy(true)
    const markConflict = () => { status.current.conflict = true; setConflict(true) }
    const reload = async () => {
      if (!active || status.current.saving) return
      if (status.current.dirty) { markConflict(); return }
      const request = ++revision
      try {
        const value = await api.highlights()
        if (!active || request !== revision || status.current.saving) return
        if (status.current.dirty) { markConflict(); return }
        status.current.baseline = value.map(rule => ({ ...rule }))
        setRules(value.map(rule => ({ ...rule }))); setLoaded(true)
      } catch (err) { if (active) { setError(errorMessage(err)); setLoaded(false) } }
      finally { if (active) setBusy(false) }
    }
    // Subscribe before the first read; read again after registration to close the gap.
    Promise.resolve(api.onBrowsingChanged(kind => kind === 'highlights' ? reload() : undefined))
      .then(dispose => { if (active) { unlisten = dispose; return reload() } else dispose() })
      .catch(err => { if (active) { setError(errorMessage(err)); setBusy(false) } })
    reload()
    return () => { active = false; unlisten?.() }
  }, [open])
  const edit = updater => { status.current.dirty = true; setRules(updater) }
  const update = (index, key, value) => edit(old => old.map((rule, i) => i === index ? { ...rule, [key]: value } : rule))
  const move = (index, step) => edit(old => {
    const next = [...old]
    ;[next[index], next[index + step]] = [next[index + step], next[index]]
    return next
  })
  const invalid = rules.some(rule => validateHighlightMask(rule.mask) || !/^#[\da-f]{6}$/i.test(rule.color))
  const close = () => { if (!busy) onOpenChange(false) }
  const save = async (andClose = false) => {
    if (busy || !loaded || invalid || status.current.conflict) return
    setBusy(true); setError(''); status.current.saving = true
    try {
      const result = await api.saveHighlights(rules.map((rule, position) => ({ ...rule, position })), status.current.baseline)
      // Preserve generated IDs after Apply so the next save updates the same rules.
      const saved = Array.isArray(result) ? result : await api.highlights()
      status.current.baseline = saved.map(rule => ({ ...rule }))
      status.current.dirty = false
      setRules(saved)
      onChanged?.()
      if (andClose) onOpenChange(false)
    } catch (err) { setError(errorMessage(err)) }
    finally { status.current.saving = false; setBusy(false) }
  }
  return <WinDialog open={open} title={t('filters')} width={700} height={600} onClose={close}
    footer={<>
      <WinButton variant="outline" onClick={close} disabled={busy}>{t('cancel')}</WinButton>
      <WinButton variant="outline" onClick={() => save()} disabled={busy || !loaded || invalid || conflict}>{t('apply')}</WinButton>
      <WinButton onClick={() => save(true)} disabled={busy || !loaded || invalid || conflict}>{t('ok_o')}</WinButton>
    </>}>
    <WinTabs value="highlights" onChange={() => {}} tabs={[{ value: 'highlights', label: t('highlights') }]} />
    <p className="fx-hint" style={{ margin: '12px 0' }}>{t('highlight_priority')}</p>
    <fieldset disabled={busy || !loaded} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="fx-scroll" style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={{ textAlign: 'left' }}>{t('highlight_mask')}</th><th>{t('highlight_color')}</th><th>{t('highlight_order')}</th></tr></thead>
          <tbody>{rules.map((rule, index) => {
            const maskError = validateHighlightMask(rule.mask)
            return <tr key={index}>
              <td style={{ padding: '6px 6px 6px 0', minWidth: 180 }}>
                <WinInput value={rule.mask} maxLength={1024} aria-label={`${t('highlight_mask')} ${index + 1}`}
                  aria-invalid={!!maskError} onChange={event => update(index, 'mask', event.target.value)} />
                {maskError && <p role="alert" style={{ color: 'var(--destructive)', margin: '4px 0' }}>{t(maskError)}</p>}
              </td>
              <td style={{ padding: 6, textAlign: 'center' }}>
                <input type="color" value={rule.color} aria-label={`${t('highlight_color')} ${index + 1}`}
                  onChange={event => update(index, 'color', event.target.value)} style={{ width: 44, height: 30, cursor: 'pointer' }} />
              </td>
              <td style={{ padding: '6px 0', whiteSpace: 'nowrap' }}>
                <WinButton compact variant="outline" aria-label={`${t('highlight_move_up')} ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</WinButton>{' '}
                <WinButton compact variant="outline" aria-label={`${t('highlight_move_down')} ${index + 1}`} disabled={index === rules.length - 1} onClick={() => move(index, 1)}>↓</WinButton>{' '}
                <WinButton compact variant="outline" aria-label={`${t('highlight_delete')} ${index + 1}`} onClick={() => edit(old => old.filter((_, i) => i !== index))}>{t('delete')}</WinButton>
              </td>
            </tr>
          })}</tbody>
        </table>
      </div>
      {!rules.length && <p className="fx-hint" style={{ padding: '12px 0' }}>{t('highlight_empty')}</p>}
      <WinButton compact variant="outline" onClick={() => edit(old => [...old, { id: 0, mask: '*', color: '#2563eb', position: old.length }])}>{t('highlight_add')}</WinButton>
    </fieldset>
    <p className="fx-hint" style={{ marginTop: 12, lineHeight: 1.6 }}>{t('highlight_syntax')}</p>
    {conflict && <p role="alert" style={{ color: 'var(--destructive)', marginTop: 10 }}>{t('highlight_external_conflict')}</p>}
    {error && <p role="alert" style={{ color: 'var(--destructive)', marginTop: 10 }}>{error}</p>}
  </WinDialog>
}
