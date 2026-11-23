import { afterEach, describe, expect, it, vi } from 'vitest'
import registerServers, { mcpEnvironment } from '../vendor/pi-acp/mcp-extension.js'

const http = { type: 'http' as const, name: 'alto', url: 'http://127.0.0.1:12345/mcp',
  headers: [{ name: 'Authorization', value: 'Bearer test-token' }] }

afterEach(() => vi.unstubAllEnvs())

describe('ACP MCP extension', () => {
  it('preserves literal credentials and maps stdio without changing the parent environment', () => {
    vi.stubEnv('PI_ACP_MCP_SERVERS', 'parent')
    const env = mcpEnvironment([http, { name: 'local', command: 'server', args: ['--flag'],
      env: [{ name: 'TOKEN', value: '!command ${DO_NOT_EXPAND}' }] }])
    expect(process.env.PI_ACP_MCP_SERVERS).toBe('parent')
    expect(env.PI_ACP_MCP_VALUE_0).toBe('Bearer test-token')
    expect(env.PI_ACP_MCP_VALUE_1).toBe('!command ${DO_NOT_EXPAND}')
    expect(JSON.parse(env.PI_ACP_MCP_SERVERS!)).toEqual([
      { name: 'alto', config: { exposure: 'direct', url: http.url,
        headers: { Authorization: '${PI_ACP_MCP_VALUE_0}' } } },
      { name: 'local', config: { exposure: 'direct', command: 'server', args: ['--flag'],
        env: { TOKEN: '${PI_ACP_MCP_VALUE_1}' } } },
    ])
    expect(mcpEnvironment([]).PI_ACP_MCP_SERVERS).toBe('[]')
  })

  it('rejects unsupported transports and invalid or colliding names', () => {
    expect(() => mcpEnvironment([{ ...http, type: 'sse' }])).toThrow('SSE')
    expect(() => mcpEnvironment([{ ...http, name: 'invalid.name' }])).toThrow('name')
    expect(() => mcpEnvironment([{ ...http, name: 'a-b' }, { ...http, name: 'a_b' }])).toThrow('Duplicate')
  })

  it('registers all servers through the existing Pi API', () => {
    vi.stubEnv('PI_ACP_MCP_SERVERS', mcpEnvironment([http]).PI_ACP_MCP_SERVERS!)
    const registerMcpServer = vi.fn()
    registerServers({ registerMcpServer })
    expect(registerMcpServer).toHaveBeenCalledWith('alto', {
      exposure: 'direct', url: http.url, headers: { Authorization: '${PI_ACP_MCP_VALUE_0}' },
    })
    expect(() => registerServers({})).toThrow('Pi 1.6.0')
  })
})
