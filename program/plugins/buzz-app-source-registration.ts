import type { HarnessPlugin } from '../../src/server/plugin-api.js'
import type {} from './work-contexts-api.js'

const ROOT = '/Users/jm/development/buzz-app'

const buzzAppSourceRegistration: HarnessPlugin = (ctx) => {
  ctx.tools.register(ctx, {
    namespace: 'work',
    name: 'register-buzz-app-source',
    description: 'Register the existing local buzz-app folder as an Alto source for work/create. Requires Full access and reuses an existing project for this folder.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  }, async (call) => {
    const permissionMode = ctx.codex.permissionModeForTurn(call.threadId, call.turnId) ?? call.permissionMode
    if (permissionMode !== 'full') {
      throw new Error('Registering the buzz-app source requires a turn that started with Full access.')
    }

    const existing = ctx.projects.snapshot().projects.find((project) => project.roots.includes(ROOT))
    const project = existing ?? (await ctx.projects.save({
      name: 'buzz-app',
      primaryRoot: ROOT,
      roots: [ROOT],
    })).projects.find((candidate) => candidate.roots.includes(ROOT))
    if (!project) throw new Error('The buzz-app workspace was saved but could not be found.')

    const snapshot = await ctx.workContexts.refresh()
    return {
      created: !existing,
      project,
      checkouts: snapshot.workstreams
        .filter((workstream) => workstream.projectId === project.id)
        .flatMap((workstream) => workstream.checkouts),
      ...(snapshot.problem ? { problem: snapshot.problem } : {}),
    }
  })
}

buzzAppSourceRegistration.inject = ['tools', 'codex', 'projects', 'workContexts']

export default buzzAppSourceRegistration
