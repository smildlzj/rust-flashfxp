import test from 'node:test'
import assert from 'node:assert/strict'
import { parseQuickConnect, rememberQuickConnect } from '../src/quick-connect.js'

test('quick connect URL supplies protocol, port, credentials and initial directory', () => {
  assert.deepEqual(parseQuickConnect({ host: 'sftp://alice:p%40ss@[::1]:8022/release%20files', port: '21' }), {
    host: '::1', protocol: 'sftp', port: 8022, user: 'alice', pass: 'p@ss', remotePath: '/release files',
  })
  assert.equal(parseQuickConnect({ host: 'ftp.example.com', protocol: 'ftps_implicit', port: '' }).port, 990)
  assert.throws(() => parseQuickConnect({ host: 'http://example.com' }))
  assert.throws(() => parseQuickConnect({ host: 'ftp://example.com/%0d%0a' }))
})

test('history strips passwords, deduplicates matching connections and keeps recent entries first', () => {
  const connection = parseQuickConnect({ host: 'ftp://user:secret@example.com/docs' })
  const first = rememberQuickConnect([], connection)
  assert.deepEqual(first, [{ host: 'example.com', protocol: 'ftp', port: 21, user: 'user', remotePath: '/docs' }])
  assert.deepEqual(rememberQuickConnect(first, { ...connection, pass: 'new password' }), first)
  assert.equal(rememberQuickConnect(first, parseQuickConnect({ host: 'example.net' }))[0].host, 'example.net')
})
