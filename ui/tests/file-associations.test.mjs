import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import { transformWithEsbuild } from 'vite'
import * as i18n from '../src/i18n.js'
import * as highlights from '../src/highlights.js'

test('selecting an editor and saving preserves the association when preferences reopen', async () => {
  const source = await readFile(new URL('../src/components/OptionsDialog.jsx', import.meta.url), 'utf8')
  const { code } = await transformWithEsbuild(source, 'OptionsDialog.jsx', { loader: 'jsx', format: 'esm' })
  const context = vm.createContext({})
  const module = new vm.SourceTextModule(code, { context })
  const states = []
  let index = 0
  let effect
  let wasOpen
  let selected = '/Applications/Visual Studio Code.app'
  const stub = () => null
  const react = {
    ...React,
    useState(initial) {
      const slot = index++
      if (!(slot in states)) states[slot] = initial
      return [states[slot], value => { states[slot] = typeof value === 'function' ? value(states[slot]) : value }]
    },
    useEffect(fn, deps) {
      if (deps[0] !== wasOpen) {
        wasOpen = deps[0]
        effect = fn
      }
    },
  }
  await module.link(async name => {
    const values = name === 'react' ? { ...react, default: react }
      : name.includes('i18n.js') ? i18n
      : name.includes('highlights.js') ? highlights
      : name.includes('api.js') ? { api: { pickAssociatedApp: async () => selected } }
      : Object.fromEntries(['Ico', 'WinButton', 'WinInput', 'WinCheck', 'WinCombo', 'WinTabs', 'WinFieldset', 'WinDialog']
        .map(key => [key, stub]))
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  const prefs = new Map()
  const props = {
    open: true,
    uiPref: { get: (key, fallback) => prefs.has(key) ? JSON.parse(prefs.get(key)) : fallback,
      set: (key, value) => prefs.set(key, JSON.stringify(value)) },
    setters: { setShowQuick: stub, setShowHeader: stub, setShowTree: stub, setShowBottom: stub },
    onOpenChange: value => { props.open = value },
  }
  const render = () => {
    index = 0
    const tree = module.namespace.default(props)
    const flush = effect
    effect = null
    flush?.()
    return tree
  }
  const nodes = node => node && typeof node === 'object' ? [
    node, ...React.Children.toArray(node.props?.children).flatMap(nodes),
  ] : []
  const control = label => nodes(render()).find(node => node.props?.['aria-label'] === label || node.props?.children === label)
  const save = () => nodes(render().props.footer).find(node => node.props?.children === i18n.t('ok_o'))

  nodes(render()).find(node => node.props?.tabs).props.onChange('viewEdit')
  control(i18n.t('file_edit_add_association')).props.onClick()
  const editorPicker = i18n.t('browse') + ' ' + i18n.t('edit_file')
  await control(editorPicker).props.onClick()
  selected = null
  await control(editorPicker).props.onClick()
  save().props.onClick()
  assert.deepEqual(JSON.parse(prefs.get('fileAssociations')), [
    { pattern: '*', view: '', edit: '/Applications/Visual Studio Code.app', policy: '' },
  ])
  render()
  props.open = true
  render()
  assert.equal(control(i18n.t('edit_file')).props.value, '/Applications/Visual Studio Code.app')
  control(i18n.t('file_edit_pattern')).props.onChange({ target: { value: ' ' } })
  assert.equal(save().props.disabled, true)
})
