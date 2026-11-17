import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import { transformWithEsbuild } from 'vite'
import * as i18n from '../src/i18n.js'

function dependency(context, exports) {
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
  }, { context })
}

test('session and drop listeners subscribe only to the current window, once', async () => {
  const subscriptions = []
  const context = vm.createContext({})
  const module = new vm.SourceTextModule(await readFile(new URL('../src/api.js', import.meta.url), 'utf8'), { context })
  await module.link(name => dependency(context, name.includes('i18n') ? i18n : name.endsWith('/core') ? { invoke() {} } : {
    getCurrentWebviewWindow: () => ({ listen: async (event, callback) => subscriptions.push({ event, callback, target: 'session-2' }) }),
  }))
  await module.evaluate()
  const received = []
  module.namespace.onEvent(event => received.push(event))
  await Promise.all([module.namespace.init(), module.namespace.init()])
  assert.deepEqual(subscriptions.map(s => [s.target, s.event]), [['session-2', 'fx-event'], ['session-2', 'tauri://drag-drop']])
  subscriptions[0].callback({ payload: { id: 1 } })
  subscriptions[1].callback({ payload: { paths: ['/tmp/upload'] } })
  assert.equal(received[0].id, 1)
  assert.deepEqual(Array.from(received[1].__dropped.paths), ['/tmp/upload'])
})

test('language broadcasts update the provider without invoking the backend and clean up StrictMode mounts', async () => {
  const pending = []
  const calls = []
  const effects = []
  const states = []
  const document = { documentElement: {} }
  const context = vm.createContext({ document, console })
  const react = { ...React, useState: initial => [typeof initial === 'function' ? initial() : initial, value => states.push(value)], useEffect: effect => effects.push(effect) }
  const { code } = await transformWithEsbuild(await readFile(new URL('../src/LanguageContext.jsx', import.meta.url), 'utf8'), 'LanguageContext.jsx', { loader: 'jsx', format: 'esm', jsx: 'transform' })
  const module = new vm.SourceTextModule(code, { context })
  await module.link(name => dependency(context, name === 'react' ? { ...react, default: react } : name.includes('i18n') ? i18n : name.includes('api.js') ? { api: { setLanguage: async locale => calls.push(locale) } } : {
    listen: (event, callback) => new Promise(resolve => pending.push({ event, callback, resolve })),
  }))
  await module.evaluate()
  i18n.setCurrentLocale('zh-CN')
  const tree = module.namespace.LanguageProvider({ children: null })
  const cleanupFirst = effects[0]()
  cleanupFirst()
  const cleanupSecond = effects[0]()
  let stopped = 0
  pending[0].resolve(() => stopped++)
  pending[1].resolve(() => stopped++)
  await Promise.resolve()
  assert.equal(stopped, 1)
  assert.equal(pending[1].event, 'language-changed')
  pending[0].callback({ payload: 'en' })
  assert.equal(states.length, 0)
  pending[1].callback({ payload: 'en' })
  assert.equal(i18n.getLocale(), 'en')
  assert.equal(document.documentElement.lang, 'en')
  assert.deepEqual(states, ['en'])
  assert.deepEqual(calls, [])
  tree.props.value.setLanguage('zh-CN')
  assert.deepEqual(calls, ['zh-CN'])
  cleanupSecond()
  assert.equal(stopped, 2)
  pending[1].callback({ payload: 'en' })
  assert.equal(i18n.getLocale(), 'zh-CN')
})
