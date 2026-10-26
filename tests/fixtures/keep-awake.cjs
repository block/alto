const { app, BrowserWindow, powerSaveBlocker } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs/promises')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

async function check() {
  await app.whenReady()
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alto-keep-awake-'))
  const { Context } = await import('cordis')
  const backendPath = path.join(directory, 'backend.mjs')
  await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'keep-awake-backend.ts', contents: `
      export { default as plugin } from './program/plugins/keep-awake';
      export { clientExtensionRegistryPlugin } from './src/server/services/client-extension-registry';
    ` },
    bundle: true, outfile: backendPath, platform: 'node', format: 'esm', packages: 'external',
  })
  const { plugin, clientExtensionRegistryPlugin } = await import(pathToFileURL(backendPath).href)
  const ctx = new Context()
  const extensionsFiber = await ctx.plugin(clientExtensionRegistryPlugin)
  const codex = new EventEmitter()
  let nativeState = { status: 'ready', models: [], activeThreadIds: ['local'],
    threadStates: { local: { status: { type: 'active' } } }, threadSettings: {} }
  codex.snapshot = () => nativeState
  codex.pendingRequests = () => []
  ctx.provide('codex', codex)
  ctx.provide('program', { projectRoot: directory })
  const setNative = (ids, flags = []) => {
    nativeState = { ...nativeState, activeThreadIds: ids,
      threadStates: Object.fromEntries(ids.map(id => [id, { status: { type: 'active', activeFlags: flags } }])) }
    codex.emit('status', nativeState)
  }
  const started = []
  const nativeStart = powerSaveBlocker.start.bind(powerSaveBlocker)
  powerSaveBlocker.start = type => {
    const id = nativeStart(type)
    started.push({ id, type })
    return id
  }
  let fiber
  let window
  let server
  const state = () => ctx.clientExtensions.snapshot()['keep-awake']
  const toggle = enabled => ctx.clientExtensions.call('keep-awake.set', { enabled })
  try {
    fiber = await ctx.plugin(plugin)
    assert.deepEqual(state(), { enabled: false, available: true, active: false })
    await assert.rejects(ctx.clientExtensions.call('keep-awake.set', { enabled: 'yes' }), /boolean/)
    await toggle(true)
    assert.equal(state().active, true)
    assert.equal(started.at(-1).type, 'prevent-app-suspension')
    assert.equal(powerSaveBlocker.isStarted(started.at(-1).id), true)
    const firstId = started.at(-1).id
    setNative(['local'], ['waitingOnUserInput'])
    assert.equal(state().active, false)
    assert.equal(powerSaveBlocker.isStarted(firstId), false)
    setNative(['background-child'])
    assert.equal(state().active, true)
    const childId = started.at(-1).id
    setNative([])
    assert.equal(powerSaveBlocker.isStarted(childId), false)

    const provider = ctx.clientExtensions.registerState(ctx, 'agent-chats', {
      providers: [{ id: 'remote-codex', protocol: 'remote', status: 'ready' }],
    })
    const chat = ctx.clientExtensions.registerState(ctx, 'agent-chats.example', {
      summary: { providerId: 'remote-codex', providerSessionId: 'session' }, turn: 'running', requests: [],
    })
    assert.equal(state().active, false, 'Remote work must not acquire an assertion')
    provider.update({ providers: [{ id: 'claude', protocol: 'acp', status: 'ready' }] })
    chat.update({ summary: { providerId: 'claude', providerSessionId: 'session' }, turn: 'running', requests: [] })
    assert.equal(state().active, true)
    const beforeReload = started.at(-1).id
    await fiber.dispose()
    assert.equal(powerSaveBlocker.isStarted(beforeReload), false)
    assert.equal(codex.listenerCount('status'), 0)
    fiber = await ctx.plugin(plugin)
    assert.equal(state().enabled, true, 'Setting survives a plugin reload')
    assert.equal(state().active, true, 'Reload observes work already in progress')
    await toggle(false)
    assert.equal(state().active, false)
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, '.codex-cordis/keep-awake.json'), 'utf8')),
      { version: 1, enabled: false })

    const client = await build({
      stdin: { resolveDir: process.cwd(), sourcefile: 'keep-awake-ui.tsx', loader: 'tsx', contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {flushSync} from 'react-dom';
        import plugin from './program/plugins/keep-awake.client';
        let snapshot={snapshot:{extensions:{}}};
        const listeners=new Set();
        window.refresh=async()=>{
          snapshot={snapshot:{extensions:await(await fetch('/state')).json()}};
          flushSync(()=>{for(const listener of listeners)listener()});
        };
        const host={snapshot:()=>snapshot,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
          call:async(method,args)=>{
            const response=await fetch('/toggle',{method:'POST',body:JSON.stringify(args)});
            if(!response.ok)throw new Error(await response.text());
            const value=await response.json();await window.refresh();return value;
          }};
        plugin({clientHost:host,clientUi:{registerSettingsPage:(_owner,page)=>window.page=page}});
        const Settings=window.page.renderer;
        flushSync(()=>createRoot(document.getElementById('root')).render(<main className="program-modal-content">
          <header className="program-modal-titlebar"><h1>General</h1></header>
          <div className="settings-page"><Settings/></div>
        </main>));
        window.ready=window.refresh();
      ` },
      bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    })
    const css = (await Promise.all(['src/client/styles.css', 'program/plugins/ui/default.css', 'program/plugins/theme.css']
      .map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
    server = http.createServer(async (request, response) => {
      try {
        if (request.url === '/state') return response.end(JSON.stringify(ctx.clientExtensions.snapshot()))
        if (request.url === '/toggle') {
          let body = ''
          for await (const chunk of request) body += chunk
          return response.end(JSON.stringify(await toggle(JSON.parse(body).enabled)))
        }
        if (request.url.startsWith('/fonts/')) return response.end(await fs.readFile('public/fonts/Inter[opsz,wght].ttf'))
        response.end('<!doctype html><style>' + css + '\nhtml,body{margin:0}#root{max-width:850px;margin:auto;padding:24px}.program-modal-content{padding:0}</style><body><div id="root"></div></body>')
      } catch (error) { response.statusCode = 500; response.end(error.message) }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    window = new BrowserWindow({ show: false, width: 850, height: 500,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
    const run = code => window.webContents.executeJavaScript(code)
    const settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    await window.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(client.outputFiles[0].text)
    await run('window.ready')
    assert.equal(await run('page.placement'), 'general')
    assert.equal(await run("document.querySelector('[role=switch]').getAttribute('aria-checked')"), 'false')
    await run("document.querySelector('[role=switch]').click()")
    for (let attempt = 0; attempt < 50 && !state().enabled; attempt++) await new Promise(resolve => setTimeout(resolve, 20))
    await settle()
    assert.equal(state().active, true, 'Settings click activates the real native blocker')
    assert.equal(await run("document.querySelector('[role=switch]').getAttribute('aria-checked')"), 'true')
    for (const width of [850, 360]) {
      window.setContentSize(width, 500)
      await settle()
      const bounds = await run(`(()=>{const r=document.querySelector('[role=switch]').getBoundingClientRect();
        return {left:r.left,right:r.right,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
      assert.equal(bounds.overflow, false)
      assert.ok(bounds.left >= 0 && bounds.right <= width)
      if (process.env.ALTO_KEEP_AWAKE_ARTIFACT_DIR) {
        await fs.mkdir(process.env.ALTO_KEEP_AWAKE_ARTIFACT_DIR, { recursive: true })
        await fs.writeFile(path.join(process.env.ALTO_KEEP_AWAKE_ARTIFACT_DIR, `settings-${width}.png`),
          (await window.webContents.capturePage()).toPNG())
      }
    }
    await toggle(false)
    assert.ok(started.every(({ id, type }) => !powerSaveBlocker.isStarted(id) && type === 'prevent-app-suspension'))
    console.log('Keep Awake: real native assertions, persistence, local/remote work, unload, and responsive settings passed')
  } finally {
    window?.destroy()
    if (server) await new Promise(resolve => server.close(resolve))
    await fiber?.dispose()
    await extensionsFiber.dispose()
    powerSaveBlocker.start = nativeStart
    for (const { id } of started) if (powerSaveBlocker.isStarted(id)) powerSaveBlocker.stop(id)
    await fs.rm(directory, { recursive: true, force: true })
  }
}

check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
