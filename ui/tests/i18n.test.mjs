import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { translate, normalizeLocale, readLocale, persistLocale, formatNumber } from '../src/i18n.js'
const messages = JSON.parse(readFileSync(new URL('../src/messages.json', import.meta.url)))
test('every UI message has both languages and identical interpolation parameters', () => {
  for (const [id, m] of Object.entries(messages)) {
    assert.equal(typeof m.zh, 'string', id); assert.equal(typeof m.en, 'string', id)
    assert.deepEqual(m.zh.match(/\{\d+\}/g) || [], m.en.match(/\{\d+\}/g) || [], id)
  }
})
test('locale defaults to Chinese and rejects unsupported saved preferences', () => {
  assert.equal(normalizeLocale('fr'), 'zh-CN')
  assert.equal(readLocale({ getItem: () => '"en"' }), 'en')
  assert.equal(readLocale({ getItem: () => '{broken' }), 'zh-CN')
})
test('translation interpolates raw user data without translating it', () => {
  const name = '中文站点 / 文件.txt'
  assert.equal(translate('delete_value', [name], 'en'), `Delete “${name}”?`)
  assert.equal(translate('missing', [], 'en'), 'missing')
})
test('language persistence and number formatting follow selected locale', () => {
  let saved
  persistLocale('en', { setItem: (k,v) => { saved = [k,v] } })
  assert.deepEqual(saved, ['fx.ui.language', '"en"'])
  assert.equal(formatNumber(1234.5, 'en'), '1,234.5')
})
