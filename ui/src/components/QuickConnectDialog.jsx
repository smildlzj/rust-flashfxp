import React, { useEffect, useState } from 'react'
import { t, errorMessage } from '../i18n.js'
import { quickAddress, quickHistoryKey, quickPort, quickProtocols } from '../quick-connect.js'
import { WinButton, WinCombo, WinDialog, WinInput } from '../win32.jsx'

export default function QuickConnectDialog({ initial, history, onConnect, onClose, onRemoveHistory, onSiteDraft }) {
  const [draft, setDraft] = useState(null)
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    setDraft(initial && { protocol: 'ftp', remotePath: null, ...initial })
    setSelected(initial?.historyKey || '')
    setError('')
  }, [initial])
  if (!initial || !draft) return null

  const set = (key, value) => setDraft(fields => ({ ...fields, [key]: value }))
  const selectHistory = key => {
    setSelected(key)
    const entry = history.find(item => quickHistoryKey(item) === key)
    if (entry) setDraft({ ...entry, pass: '' })
  }
  const connect = async event => {
    event?.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onConnect(draft)
      onClose()
    } catch (problem) {
      setError(errorMessage(problem))
    } finally {
      setBusy(false)
    }
  }

  return (
    <WinDialog open title={t('quick_connect_title')} width={520} onClose={busy ? undefined : onClose}
      footer={<>
        <WinButton variant="outline" disabled={busy} onClick={onClose}>{t('cancel')}</WinButton>
        <WinButton type="submit" form="quick-connect-form" disabled={busy || !draft.host.trim()}>{t('connect')}</WinButton>
      </>}>
      <form id="quick-connect-form" className="flex flex-col gap-3" onSubmit={connect}>
        <label className="flex flex-col gap-1">
          {t('quick_connect_history')}
          <WinCombo value={selected} onChange={selectHistory} disabled={busy}
            options={[{ value: '', label: t('quick_connect_history_prompt') }, ...history.map(entry => ({
              value: quickHistoryKey(entry),
              label: [quickAddress(entry), entry.user, entry.remotePath].filter(Boolean).join(' · '),
            }))]} />
        </label>
        {selected && <div className="flex flex-wrap gap-2">
          <WinButton type="button" compact variant="outline" disabled={busy} onClick={() => {
            try { onSiteDraft(draft) } catch (problem) { setError(errorMessage(problem)) }
          }}>{t('quick_connect_add_site')}</WinButton>
          <WinButton type="button" compact variant="outline" disabled={busy} onClick={() => {
            onRemoveHistory(selected)
            setSelected('')
          }}>{t('quick_connect_remove_history')}</WinButton>
        </div>}
        <label className="flex flex-col gap-1">
          {t('protocol')}
          <WinCombo value={draft.protocol} disabled={busy} onChange={protocol => setDraft(fields => ({
            ...fields, protocol, port: !fields.port || Number(fields.port) === quickPort(fields.protocol) ? quickPort(protocol) : fields.port,
          }))} options={quickProtocols.map(option => ({ value: option.value, label: t(option.label) }))} />
        </label>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
          <label className="flex flex-col gap-1">
            {t('server_or_url')}
            <WinInput autoFocus disabled={busy} value={draft.host} placeholder="ftp.example.com"
              onChange={event => setDraft(fields => ({ ...fields, host: event.target.value, remotePath: null }))} />
          </label>
          <label className="flex flex-col gap-1">
            {t('port')}
            <WinInput inputMode="numeric" disabled={busy} value={draft.port}
              onChange={event => set('port', event.target.value.replace(/\D/g, ''))} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            {t('username')}
            <WinInput autoComplete="off" disabled={busy} value={draft.user} onChange={event => set('user', event.target.value)} />
          </label>
          <label className="flex flex-col gap-1">
            {t('password')}
            <WinInput type="password" autoComplete="off" disabled={busy} value={draft.pass} onChange={event => set('pass', event.target.value)} />
          </label>
        </div>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </form>
    </WinDialog>
  )
}
