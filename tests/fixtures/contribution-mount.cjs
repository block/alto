const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'contribution-mount.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {PullRequestsChrome} from './program/plugins/pull-requests.client';
      import {AgentsChrome} from './program/plugins/orchestrator.client';
      import {AgentsPanelController} from './program/plugins/orchestrator-panel';
      const noSubscribe=()=>()=>{},state={connected:true,snapshot:{extensions:{}}};
      const host={snapshot:()=>state,subscribe:noSubscribe,call:async()=>({})};
      const overlays={snapshot:()=>undefined,subscribe:noSubscribe,open(){},close(){},toggle(){}};
      const ui={subscribe:noSubscribe,snapshot:()=>0,overlays};
      const controller=new AgentsPanelController(overlays,'agents');
      const session={subscribe:noSubscribe,snapshot:()=>({})};
      window.lookups=0;
      const query=document.querySelector.bind(document);
      document.querySelector=selector=>{if(selector.includes('data-ui-contribution='))lookups++;return query(selector)};
      const root=createRoot(document.getElementById('root'));
      flushSync(()=>root.render(<><PullRequestsChrome host={host} ui={ui}/><AgentsChrome host={host} ui={ui} session={session} markdown={{}} controller={controller}/></>));
      window.frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.backgroundMutations=async()=>{const chat=document.getElementById('chat');for(let i=0;i<30;i++){const row=document.createElement('p');row.textContent='Streamed reply '+i;chat.append(row);await Promise.resolve()}};
      window.replaceToolbar=()=>{document.getElementById('toolbar').innerHTML='<div data-ui-contribution="pull-requests-toggle"></div><div data-ui-contribution="orchestrator-toggle"></div>'};
      window.buttons=()=>['pull-requests-toggle','orchestrator-toggle'].map(id=>query('[data-ui-contribution="'+id+'"]').querySelectorAll('button').length);
      window.teardown=()=>{flushSync(()=>root.unmount());controller.dispose()};
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const server = http.createServer((_request, response) => response.end('<!doctype html><div class="shell-kernel"><header id="toolbar"><div data-ui-contribution="pull-requests-toggle"></div><div data-ui-contribution="orchestrator-toggle"></div></header><div id="chat" contenteditable="true">Unsent draft</div><div id="root"></div></div>'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const win = new BrowserWindow({ show: false, width: 1000, height: 800,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = code => win.webContents.executeJavaScript(code)
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    await run('frames()')
    assert.deepEqual(await run('buttons()'), [1, 1], 'Both plugin buttons mount')
    await run('lookups=0;backgroundMutations();frames()')
    const lookups = await run('lookups')
    console.log('Contribution mount measurements: ' + JSON.stringify({ mutations: 30, documentLookups: lookups }))
    if (process.env.ALTO_CONTRIBUTION_MOUNT_METRICS) await fs.writeFile(process.env.ALTO_CONTRIBUTION_MOUNT_METRICS, JSON.stringify({ mutations: 30, documentLookups: lookups }, null, 2))
    assert.equal(lookups, 0, 'Streaming replies do not trigger toolbar document searches')
    await run('window.oldButtons=[...document.querySelectorAll("#toolbar button")];replaceToolbar();frames()')
    assert.deepEqual(await run('buttons()'), [1, 1], 'Both buttons follow a replaced toolbar')
    assert.equal(await run('oldButtons.every(button=>!button.isConnected)'), true, 'Old toolbar buttons are removed')
    await run('window.slot=document.querySelector("[data-ui-contribution=\\"pull-requests-toggle\\"]");slot.dataset.uiContribution="temporarily-hidden";frames()')
    assert.equal(await run('document.querySelectorAll(".pr-dashboard-toggle").length'), 0, 'An in-place contribution rename removes its button')
    await run('lookups=0;backgroundMutations();frames()')
    assert.equal(await run('lookups'), 0, 'Absent contributions do not search on chat edits')
    await run('slot.dataset.uiContribution="pull-requests-toggle";frames()')
    assert.deepEqual(await run('buttons()'), [1, 1], 'A restored contribution remounts its button')
    await run('teardown()')
    console.log('Contribution mount browser checks passed')
  } finally {
    win.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
