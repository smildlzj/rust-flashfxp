import messages from './messages.json' with { type: 'json' }

export const normalizeLocale = value => value === 'en' ? 'en' : 'zh-CN'
export function readLocale(storage = globalThis.localStorage) {
  try { return normalizeLocale(JSON.parse(storage.getItem('fx.ui.language'))) } catch { return 'zh-CN' }
}
export function persistLocale(language, storage = globalThis.localStorage) {
  try { storage.setItem('fx.ui.language', JSON.stringify(normalizeLocale(language))) } catch {}
}
let currentLocale = readLocale()
export const getLocale = () => currentLocale
export const setCurrentLocale = language => { currentLocale = normalizeLocale(language) }
export function translate(id, values = [], language = currentLocale) {
  const message = messages[id]
  const text = message ? (language === 'en' ? message.en || message.zh : message.zh) : id
  return text.replace(/\{(\d+)\}/g, (match, index) => values[index] === undefined ? match : typeof values[index] === 'number' ? formatNumber(values[index], language) : String(values[index]))
}
export const t = translate
export function formatNumber(value, language = currentLocale, options = {}) {
  return new Intl.NumberFormat(language, options).format(value)
}
export function errorMessage(error) {
  if (error && typeof error === 'object' && error.messageId) return t(error.messageId, error.params || [])
  return String(error?.message || error)
}
