import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import { transformWithEsbuild } from 'vite'
import * as i18n from '../src/i18n.js'
import * as highlights from '../src/highlights.js'

const source = await readFile(new URL('../src/components/FileEditor.jsx', import.meta.url), 'utf8')
const { code } = await transformWithEsbuild(source, 'FileEditor.jsx', { loader: 'jsx', format: 'esm' })

test('remote editor stages saves, keeps failed uploads, and applies the matching view association', async () => {
  const storage = new Map()
  const context = vm.createContext({
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  })
  const module = new vm.SourceTextModule(code, { context })
  const state = []
  const refs = []
  const dependencies = new Map()
  const effects = []
  const opens = []
  const uploads = []
  let stateIndex = 0
  let refIndex = 0
  let effectIndex = 0
  let fail = true
  let fileChanged
  const stub = () => null
  const react = {
    ...React,
    useState(initial) {
      const index = stateIndex++
      if (!(index in state)) state[index] = initial
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
    },
    useRef(initial) {
      const index = refIndex++
      return refs[index] ??= { current: initial }
    },
    useEffect(effect, deps) {
      const index = effectIndex++
      const previous = dependencies.get(index)
      if (!previous || deps.some((value, i) => value !== previous[i])) {
        effects.push(effect)
        dependencies.set(index, deps)
      }
    },
  }
  const api = {
    async onFileEditorChange(handler) { fileChanged = handler; return stub },
    async fileEditOpen(...args) {
      opens.push(args)
      const [path, , editable] = args
      return { id: opens.length, path, site: 'Test FTP', text: editable ? 'old' : null, external: !editable }
    },
    async fileEditClose() {},
    async fileEditReopen(id, redownload) { return redownload ? 'fresh server contents' : null },
    async fileEditSave(...args) {
      uploads.push(args)
      if (fail) throw new Error('upload failed')
    },
  }
  await module.link(async name => {
    const values = name === 'react' ? { ...react, default: react }
      : name.includes('api.js') ? { api }
      : name.includes('i18n.js') ? i18n
      : name.includes('highlights.js') ? highlights
      : { WinButton: stub, WinContextMenu: stub, useWinContextMenu: () => ({}) }
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()

  const entries = [{ name: 'Test.TXT', path: '/test/Test.TXT' }]
  const props = {
    request: { action: 'edit', remote: true, entries, policy: 'manual', siteKey: 'site', remember: true,
      associations: [{ pattern: '*.txt', view: '/Applications/Preview.app' }] },
    onSaved: stub, onRequestDone: stub,
  }
  const render = () => {
    stateIndex = refIndex = effectIndex = 0
    const tree = module.namespace.default(props)
    for (const effect of effects.splice(0)) effect()
    return tree
  }
  const htmlNodes = node => !node || typeof node !== 'object' ? [] : [
    node, ...React.Children.toArray(node.props?.children).flatMap(htmlNodes),
  ]
  const button = (tree, key) => htmlNodes(tree).find(node => node.props?.children === i18n.t(key))

  render()
  await new Promise(resolve => setImmediate(resolve))
  const editor = htmlNodes(render()).find(node => node.type === 'textarea')
  editor.props.onChange({ target: { value: 'new content' } })
  button(render(), 'save').props.onClick()
  assert.equal(uploads.length, 0)
  await button(render(), 'upload').props.onClick()
  assert.equal(htmlNodes(render()).find(node => node.type === 'textarea').props.value, 'new content')
  fail = false
  await button(render(), 'upload').props.onClick()
  assert.deepEqual(uploads, [[1, 'new content', undefined], [1, 'new content', undefined]])
  assert.equal(button(render(), 'upload'), undefined)

  button(render(), 'redownload_edit').props.onClick()
  const confirmation = htmlNodes(render()).find(node => node.props?.children === i18n.t('confirm_redownload_edit'))
  assert.ok(confirmation)
  const [confirmRedownload] = htmlNodes(render()).filter(node => node.props?.children === i18n.t('redownload_edit'))
  await confirmRedownload.props.onClick()
  assert.equal(htmlNodes(render()).find(node => node.type === 'textarea').props.value, 'fresh server contents')

  assert.equal(JSON.parse(storage.get('fx.editHistory.site'))[0].path, '/test/Test.TXT')
  button(render(), 'close_open_file').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  button(render(), 'all_file_edits').props.onClick()
  assert.ok(button(render(), 'remove_edit_history'))
  assert.equal(htmlNodes(render()).find(node => node.type === 'textarea'), undefined)

  props.request = { ...props.request, action: 'view' }
  render()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(opens, [
    ['/test/Test.TXT', true, true, null, 'manual', 'site'],
    ['/test/Test.TXT', true, false, '/Applications/Preview.app', 'manual', 'site'],
  ])
  fileChanged({ id: 2, prompt: true, fingerprint: 'external-checksum' })
  await button(render(), 'upload').props.onClick()
  assert.deepEqual(uploads.at(-1), [2, undefined, 'external-checksum'])
})
