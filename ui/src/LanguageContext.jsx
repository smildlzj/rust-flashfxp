import React, { createContext, useContext, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { api } from './api.js'
import { getLocale, normalizeLocale, persistLocale, setCurrentLocale } from './i18n.js'
const LanguageContext = createContext(null)
export function LanguageProvider({ children }) {
  const [language, updateLanguage] = useState(getLocale)
  const applyLanguage = value => {
    const next = normalizeLocale(value)
    setCurrentLocale(next)
    persistLocale(next)
    updateLanguage(next)
    document.documentElement.lang = next
    return next
  }
  useEffect(() => {
    let disposed = false
    let unlisten
    listen('language-changed', event => {
      if (!disposed) applyLanguage(event.payload)
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    }).catch(console.error)
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])
  const setLanguage = value => {
    api.setLanguage(applyLanguage(value)).catch(console.error)
  }
  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>
}
export const useLanguage = () => useContext(LanguageContext)
