import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { t, errorMessage } from '../i18n.js'
import { useLanguage } from '../LanguageContext.jsx'
import FileEditor from './FileEditor.jsx'

export default function FileEditorWindow() {
  const [requests, setRequests] = useState([])
  const [error, setError] = useState('')
  const { language } = useLanguage()

  useEffect(() => {
    api.setWindowTitle(t('active_file_edits')).catch(problem => setError(errorMessage(problem)))
  }, [language])

  useEffect(() => {
    let disposed = false
    let unlisten
    let receiving = Promise.resolve()
    const receive = () => {
      receiving = receiving.then(async () => {
        if (disposed) return
        try {
          const incoming = await api.takeFileEditorRequests()
          if (!disposed && incoming.length) setRequests(queue => [...queue, ...incoming])
        } catch (problem) {
          if (!disposed) setError(errorMessage(problem))
        }
      })
    }
    api.onFileEditorRequest(receive).then(stop => {
      if (disposed) stop()
      else {
        unlisten = stop
        void receive()
      }
    }).catch(problem => { if (!disposed) setError(errorMessage(problem)) })
    return () => { disposed = true; unlisten?.() }
  }, [])

  return <>
    {error && <p role="alert" className="p-4 text-destructive">{error}</p>}
    <FileEditor request={requests[0]} onRequestDone={() => setRequests(queue => queue.slice(1))} />
  </>
}
