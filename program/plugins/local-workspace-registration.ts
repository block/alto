import path from 'node:path'
import type { HarnessPlugin } from '../../src/server/plugin-api.js'

const plugin: HarnessPlugin = (ctx) => {
  ctx.tools.register(ctx, {
    namespace: 'work',
    name: 'register_local',
    description: 'Register an existing absolute local folder as an Alto workspace. Requires Full access. Returns the project; call work/list and work/select to select its checkout.',
    inputSchema: {
      type: 'object',
      required: ['path', 'name'],
      properties: { path: { type: 'string' }, name: { type: 'string' } },
      additionalProperties: false,
    },
  }, async (call) => {
    const permission = ctx.codex.permissionModeForTurn(call.threadId, call.turnId) ?? call.permissionMode
    if (permission !== 'full') throw new Error('Registering a workspace requires a turn that started with Full access.')
    const args = call.arguments as Record<string, unknown>
    if (!args || typeof args.path !== 'string' || !path.isAbsolute(args.path)
        || typeof args.name !== 'string' || !args.name.trim()) throw new Error('An absolute path and workspace name are required.')
    const root = path.resolve(args.path)
    const existing = ctx.projects.snapshot().projects.find((project) => project.roots.includes(root))
    if (existing) return { project: existing, created: false }
    const snapshot = await ctx.projects.save({ name: args.name.trim(), primaryRoot: root, roots: [root] })
    return { project: snapshot.projects.find((project) => project.roots.includes(root)), created: true }
  })
}
plugin.inject = ['codex', 'projects', 'tools']
export default plugin
