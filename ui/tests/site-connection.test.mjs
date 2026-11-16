import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function setup(site, answer) {
  const calls = []
  const prompts = []
  const context = vm.createContext({
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail } },
    window: { dispatchEvent(event) { prompts.push(event.detail); event.detail.resolve(answer); return true } },
  })
  const source = await readFile(new URL('../src/api.js', import.meta.url), 'utf8')
  const module = new vm.SourceTextModule(source, { context })
  await module.link(async specifier => {
    const key = specifier.endsWith('/core') ? 'invoke' : 'listen'
    const dependency = new vm.SyntheticModule([key], function () {
      this.setExport(key, async (command, args) => {
        calls.push({ command, args })
        if (command === 'sites_list') return site ? [site] : []
      })
    }, { context })
    return dependency
  })
  await module.evaluate()
  return { api: module.namespace.api, calls, prompts }
}

test('saved password connects without prompting or writing a site', async () => {
  const { api, calls, prompts } = await setup({ id: 7, username: 'user', password: 'saved' })
  assert.equal(await api.connectSite(7), true)
  assert.equal(prompts.length, 0)
  assert.deepEqual(calls.map(c => c.command), ['sites_list', 'connect_site'])
})

test('prompt credentials reach only the session, not persistent storage', async () => {
  const site = { id: 7, name: 'Test', username: 'user', password: '', loginType: 'prompt' }
  const { api, calls } = await setup(site, { username: 'temporary-user', password: 'temporary-password' })
  assert.equal(await api.connectSite(7), true)
  assert.equal(calls[1].args.usernameOverride, 'temporary-user')
  assert.equal(calls[1].args.passwordOverride, 'temporary-password')
  assert.equal(site.password, '')
  assert.ok(calls.every(c => c.command !== 'site_save'))
})

test('canceling credentials sends no connection command', async () => {
  const { api, calls } = await setup({ id: 7, username: 'user', loginType: 'prompt' }, null)
  assert.equal(await api.connectSite(7), false)
  assert.deepEqual(calls.map(c => c.command), ['sites_list'])
})

test('anonymous login does not prompt for an empty password', async () => {
  const { api, prompts } = await setup({ id: 7, username: 'anonymous', password: '' })
  assert.equal(await api.connectSite(7), true)
  assert.equal(prompts.length, 0)
})

test('deleted sites report an error before connecting', async () => {
  const { api, calls } = await setup(null)
  await assert.rejects(api.connectSite(7), /站点不存在/)
  assert.deepEqual(calls.map(c => c.command), ['sites_list'])
})
