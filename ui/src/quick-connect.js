export const quickProtocols = [
  { value: 'ftp', label: 'ftp', port: 21 },
  { value: 'sftp', label: 'sftp_over_ssh', port: 22 },
  { value: 'ftps_implicit', label: 'ftp_with_implicit_ssl_tls', port: 990 },
  { value: 'ftps_explicit', label: 'ftp_with_explicit_tls_auth_tls', port: 21 },
]

const urlProtocols = { 'ftp:': 'ftp', 'sftp:': 'sftp', 'ftps:': 'ftps_implicit' }
export const quickPort = protocol => quickProtocols.find(option => option.value === protocol)?.port ?? 21

export function parseQuickConnect(fields) {
  let { host, port, protocol = 'ftp', user = '', pass = '', remotePath = null } = fields
  host = host?.trim()
  if (!host) throw new Error('enter_a_server_address')
  user = user.trim()
  if (host.includes('://')) {
    try {
      const url = new URL(host)
      const urlProtocol = Object.hasOwn(urlProtocols, url.protocol) ? urlProtocols[url.protocol] : null
      if (!urlProtocol || !url.hostname || url.search || url.hash) throw new Error()
      if (url.protocol !== 'ftps:' || protocol !== 'ftps_explicit') protocol = urlProtocol
      host = url.hostname
      port = url.port || quickPort(protocol)
      if (url.username) user = decodeURIComponent(url.username)
      if (url.password) pass = decodeURIComponent(url.password)
      if (url.pathname && url.pathname !== '/') remotePath = decodeURIComponent(url.pathname)
      else remotePath = null
    } catch {
      throw new Error('quick_connect_invalid_address')
    }
  }
  host = host.replace(/^\[([^\]]+)\]$/, '$1')
  if (!host || /[\s/@?#]/.test(host) || !quickProtocols.some(option => option.value === protocol) ||
      [host, user, pass, remotePath].some(value => /[\r\n\0]/.test(value ?? ''))) {
    throw new Error('quick_connect_invalid_address')
  }
  port = port === '' || port == null ? quickPort(protocol) : Number(port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port_must_be_between_1_and_65535')
  return { host, protocol, port, user, pass, remotePath }
}

export const quickHistoryKey = ({ host, protocol, port, user, remotePath }) =>
  JSON.stringify([host.toLowerCase(), protocol, port, user, remotePath || null])

export function rememberQuickConnect(history, { host, protocol, port, user, remotePath }) {
  const entry = { host, protocol, port, user, remotePath }
  return [entry, ...history.filter(item => quickHistoryKey(item) !== quickHistoryKey(entry))].slice(0, 50)
}

export function quickAddress({ host, port }) {
  return (host.includes(':') ? '[' + host + ']' : host) + ':' + port
}
