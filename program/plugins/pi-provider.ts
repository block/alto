import path from 'node:path'
import type { HarnessPlugin } from '../../src/server/plugin-api.js'
import type { AgentConfigOption } from '../../src/server/services/agent-registry.js'
import { AcpProcessProvider, type AcpProcessProviderOptions } from './acp-provider.js'

interface PiProviderConfig {
  id?: string
  label?: string
  env?: Record<string, string>
  initialConfig?: AgentConfigOption[]
}

export function bundledPiOptions(projectRoot: string, config: PiProviderConfig = {}): AcpProcessProviderOptions {
  return {
    id: config.id?.trim() || 'pi',
    label: config.label?.trim() || 'Pi',
    command: process.execPath,
    args: [path.join(projectRoot, 'dist/node/adapters/pi-acp/index.js')],
    env: { ...config.env, ELECTRON_RUN_AS_NODE: '1' },
    setupHint: 'Install Pi 1.6.0+ and run npm run build:pi-adapter in Alto if its bundled adapter is missing.',
    ...(config.initialConfig ? { initialConfig: structuredClone(config.initialConfig) } : {}),
  }
}

const plugin: HarnessPlugin<PiProviderConfig> = (ctx, config) => {
  ctx.agents.register(ctx, new AcpProcessProvider(bundledPiOptions(ctx.program.projectRoot, config)))
}

plugin.inject = ['agents', 'program']
export default plugin
