import type { McpServer } from '@agentclientprotocol/sdk'

const CONFIG_KEY = 'PI_ACP_MCP_SERVERS'

type McpConfig = {
  exposure: 'direct'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

type Registration = { name: string; config: McpConfig }
type PiMcpApi = { registerMcpServer?: (name: string, config: McpConfig) => void }

export function mcpEnvironment(servers: McpServer[]): Record<string, string> {
  const env: Record<string, string> = {}
  const names = new Set<string>()
  let valueIndex = 0
  // Pi expands these references once, keeping ACP values literal (including !commands and $vars).
  const values = (entries: { name: string; value: string }[]) =>
    Object.fromEntries(
      entries.map(entry => {
        const key = `PI_ACP_MCP_VALUE_${valueIndex++}`
        env[key] = entry.value
        return [entry.name, '${' + key + '}']
      })
    )
  const registrations: Registration[] = servers.map(server => {
    if (!/^[a-zA-Z0-9_-]+$/.test(server.name)) throw new Error('Invalid ACP MCP server name')
    const normalized = server.name.replaceAll('-', '_')
    if (names.has(normalized)) throw new Error('Duplicate ACP MCP server name')
    names.add(normalized)
    if ('type' in server && server.type === 'sse') throw new Error('Pi does not support SSE MCP servers')
    if (!('url' in server) && !('command' in server)) throw new Error('Unsupported ACP MCP transport')
    const config: McpConfig =
      'url' in server
        ? { exposure: 'direct', url: server.url, headers: values(server.headers) }
        : { exposure: 'direct', command: server.command, args: server.args, env: values(server.env) }
    return { name: server.name, config }
  })
  // Always replace inherited configuration; sessions must never borrow another session's servers.
  env[CONFIG_KEY] = JSON.stringify(registrations)
  return env
}

export default function registerAcpMcpServers(pi: PiMcpApi): void {
  const registrations = JSON.parse(process.env[CONFIG_KEY] ?? '[]') as Registration[]
  if (!registrations.length) return
  if (!pi.registerMcpServer) throw new Error('ACP MCP servers require Pi 1.6.0+ with built-in MCP support')
  for (const { name, config } of registrations) pi.registerMcpServer(name, config)
}
