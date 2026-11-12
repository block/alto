const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'agent-switcher-check.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import switcher from './program/plugins/agent-switcher.client';
      const listeners=new Set(),overlayListeners=new Set(),uiListeners=new Set(),actions=new Map();
      const efforts=['low','high'].map(reasoningEffort=>({reasoningEffort,description:reasoningEffort}));
      const native=[{id:'model-a',displayName:'Model A',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:efforts},
        {id:'model-b',displayName:'Model B',defaultReasoningEffort:'low',supportedReasoningEfforts:efforts}];
      const worker={id:'worker',name:'Agent',category:'agent',currentValue:'one',options:[{value:'one',name:'First worker'},{value:'two',name:'Second worker'}]};
      const providers=[{id:'codex',label:'Codex'},{id:'claude',label:'Claude'},
        {id:'hosted',label:'Hosted',location:{id:'hosted',label:'Hosted'},configOptions:[worker]}];
      const catalog={codex:native,claude:[{id:'agent-model',displayName:'Agent model',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:efforts}],
        hosted:[{id:'hosted-model',displayName:'Hosted model',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:efforts}]};
      const initial=id=>({revision:1,connected:true,providerId:'codex',providers,models:native,agentConfig:[],
        session:{workspace:'/repo/'+id,model:'model-a',effort:'high',permissionMode:'full'},turn:{tag:'idle'},activities:[],harness:{codex:{status:'ready',models:native}},
        agentStatus:'ready',hasEarlierActivities:false,loadingEarlierActivities:false,history:{},threads:[],projects:[],skills:[]});
      const panes={a:initial('a'),b:initial('b')};let active='a',overlay,uiRevision=0;
      window.calls=[];window.overlayEvents=[];
      const emit=()=>flushSync(()=>{for(const listener of listeners)listener()});
      const publish=change=>{panes[active]={...panes[active],...change,revision:panes[active].revision+1};emit()};
      const overlays={snapshot:()=>overlay,subscribe:listener=>{overlayListeners.add(listener);return()=>overlayListeners.delete(listener)},
        toggle:id=>{overlay=overlay===id?undefined:id;overlayEvents.push(['toggle',id]);flushSync(()=>{for(const listener of overlayListeners)listener()})},
        close:id=>{if(overlay!==id)return;overlay=undefined;overlayEvents.push(['close',id]);flushSync(()=>{for(const listener of overlayListeners)listener()})}};
      const session={snapshot:()=>panes[active],subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},
        setModel:model=>{calls.push([active,'model',model]);const current=panes[active];const selected=current.models.find(option=>option.id===model)??current.models.find(option=>option.isDefault);
          publish({session:{...current.session,model,effort:selected?.defaultReasoningEffort}})},
        setEffort:effort=>{calls.push([active,'effort',effort]);publish({session:{...panes[active].session,effort}})},
        setProvider:(id,selection)=>{calls.push([active,'provider',id,selection]);const models=catalog[id],selected=models[0];
          let agentConfig=id==='hosted'?[{...worker,currentValue:selection?.value??worker.currentValue}]:[];
          publish({providerId:id,models,agentConfig,session:{...panes[active].session,model:selected.id,effort:selected.defaultReasoningEffort}})},
        setAgentConfig:(id,value)=>{calls.push([active,'config',id,value]);publish({agentConfig:panes[active].agentConfig.map(option=>option.id===id?{...option,currentValue:value}:option)})},
        loadModels:async()=>calls.push([active,'load']),send:()=>{throw new Error('Picker must never send a prompt')}};
      let Root,disposed=false;
      const ui={snapshot:()=>uiRevision,subscribe:listener=>{uiListeners.add(listener);return()=>uiListeners.delete(listener)},overlays,
        registerRoot:(_owner,_id,component)=>{Root=component},registerStyle:()=>{}};
      const dispose=switcher({clientUi:ui,clientSession:session,clientComposer:{},clientHotkeys:{registerAction:(_owner,action)=>actions.set(action.id,action)}});
      const root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<Root/>));
      window.hotkey=()=>actions.get('agent.switcher.open').run();
      window.bindings=()=>actions.get('agent.switcher.open');
      window.route=id=>{active=id;emit()};
      window.patch=publish;
      window.read=()=>({active,providerId:panes[active].providerId,model:panes[active].session.model,effort:panes[active].session.effort,
        config:panes[active].agentConfig,calls:[...calls],open:!!document.querySelector('.composer-model-picker'),
        draft:document.getElementById('draft').value,focus:document.activeElement?.getAttribute('aria-label')??document.activeElement?.id});
      window.bounds=()=>{const picker=document.querySelector('.composer-model-picker'),layer=document.querySelector('.agent-switcher-layer');
        const box=node=>{const rect=node.getBoundingClientRect();return{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height}};
        return{picker:box(picker),layer:box(layer),pane:box(document.getElementById('pane')),width:innerWidth,height:innerHeight}};
      window.teardown=()=>{flushSync(()=>root.unmount());dispose();disposed=true};
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all([
    'src/client/styles.css', 'program/plugins/ui/appearance-tokens.css', 'program/plugins/ui/default.css',
    'program/plugins/ui/controls.css', 'program/plugins/ui/focus.css', 'program/plugins/theme.css', 'program/plugins/agent-switcher.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const html = '<!doctype html><html data-alto-theme="light"><style>' + css + '\nbody{margin:0;background:var(--canvas)}.shell-kernel{position:fixed;inset:0}#chrome{position:fixed;top:8px;left:8px;z-index:1}#pane{position:fixed;top:0;bottom:0;left:160px;right:0}#draft{position:fixed;bottom:20px;left:180px;width:220px;height:64px} @media(max-width:620px){#pane{left:0}#draft{left:20px}}</style><div class="shell-kernel"><div id="chrome" data-ui-contribution="agent-switcher-toggle"></div><div data-shell-node="workspace"><main id="pane"><textarea id="draft">Draft stays in its pane.</textarea></main></div><div id="root"></div></div></html>'
  const server = http.createServer((_req, response) => response.end(html))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: {
    offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false,
  } })
  const run = code => win.webContents.executeJavaScript(code)
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const click = async expression => {
    const point = await run(`(()=>{const node=${expression};if(!node)throw new Error('Missing click target: '+${JSON.stringify(expression)});node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    await frames()
  }
  const key = async keyCode => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
    await frames()
  }
  const model = name => `([...document.querySelectorAll('[data-composer-models] [role=option]')].find(node=>node.textContent.trim()===${JSON.stringify(name)}))`
  const agent = label => `document.querySelector('[data-composer-agents] [aria-label="${label}"]')`
  const capture = async name => {
    const dir = process.env.ALTO_MODEL_PICKER_ARTIFACT_DIR
    if (!dir) return
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, name + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}`)
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await run(bundle.outputFiles[0].text)
    await frames()
    assert.deepEqual(await run('bindings().aliases'), [{ kind: 'global', key: 'm', meta: true, shift: true }])
    assert.deepEqual(await run('bindings().binding'), { kind: 'leader', key: 'm' })
    await click('document.querySelector(".agent-switcher-trigger")')
    assert.equal((await run('read()')).open, true)
    assert.equal(await run('document.querySelector(".composer-model-picker").dataset.presentation'), 'dialog')
    assert.equal(await run('document.querySelector(".composer-model-picker").getAttribute("aria-modal")'), 'true')
    assert.equal(await run('!!document.querySelector(".composer-model-trigger")'), false, 'The overlay does not duplicate the composer trigger')
    assert.equal(await run('!!document.querySelector("input[placeholder],.agent-switcher-actions")'), false, 'No search or apply-selection flow remains')
    await click(model('Model B'))
    assert.equal((await run('read()')).model, 'model-b')
    assert.equal((await run('read()')).open, true)
    await click('document.querySelector("[aria-label=Reasoning] button[aria-pressed=false]")')
    assert.equal((await run('read()')).effort, 'high')
    await click(agent('Second worker · Hosted'))
    assert.deepEqual((await run('read()')).calls.at(-1), ['a', 'provider', 'hosted', { configId: 'worker', value: 'two' }])
    assert.equal((await run('read()')).config[0].currentValue, 'two')
    assert.equal((await run('read()')).open, true)
    assert.equal((await run('read()')).draft, 'Draft stays in its pane.')
    let geometry = await run('bounds()')
    assert.ok(geometry.picker.left >= geometry.pane.left && geometry.picker.right <= geometry.pane.right)
    assert.ok(geometry.picker.top >= 0 && geometry.picker.bottom <= geometry.height)
    await capture('shortcut-wide')
    await key('Escape')
    assert.equal((await run('read()')).open, false)
    assert.equal(await run('document.activeElement.classList.contains("agent-switcher-trigger")'), true, 'Escape restores the topbar opener')

    await run('document.getElementById("draft").focus();document.getElementById("draft").setSelectionRange(6,11);hotkey()')
    await frames()
    assert.equal((await run('read()')).open, true)
    await run('route("b")')
    await frames()
    await click(model('Model B'))
    assert.deepEqual((await run('read()')).calls.at(-1), ['b', 'model', 'model-b'], 'Selection routes to the currently focused pane')
    await run('patch({threadId:"saved",activities:[{id:"one",kind:"user",content:"Saved"}]})')
    await frames()
    assert.equal(await run('document.querySelector(".composer-model-picker").dataset.agentLocked'), 'true')
    assert.equal(await run('document.querySelector(".composer-picker-agents-rail").getClientRects().length'), 0)
    assert.equal(await run('document.querySelector(".composer-picker-agent-select").textContent.includes("Codex")'), true)
    geometry = await run('bounds()')
    assert.ok(Math.abs((geometry.picker.left + geometry.picker.right) / 2 - (geometry.pane.left + geometry.pane.right) / 2) < 1,
      'The narrower bound-chat picker stays centered in the conversation area')
    await click(model('Model A'))
    assert.equal((await run('read()')).open, true)
    assert.equal((await run('read()')).model, 'model-a')
    await key('Escape')
    assert.equal((await run('read()')).focus, 'draft', 'Hotkey close restores the pane editor')
    assert.deepEqual(await run('({start:document.getElementById("draft").selectionStart,end:document.getElementById("draft").selectionEnd})'), { start: 6, end: 11 })

    await run('patch({threadId:undefined,activities:[]})')
    win.setSize(420, 540); await frames()
    await run('hotkey()'); await frames()
    assert.equal(await run('document.querySelector("select[aria-label=Agent]").getClientRects().length>0'), true)
    await run('(()=>{const select=document.querySelector("select[aria-label=Agent]");select.value="claude";select.dispatchEvent(new Event("change",{bubbles:true}))})()')
    await frames()
    assert.equal((await run('read()')).providerId, 'claude')
    assert.equal((await run('read()')).open, true)
    await capture('shortcut-compact')
    geometry = await run('bounds()')
    assert.ok(geometry.picker.left >= 0 && geometry.picker.right <= geometry.width)
    assert.ok(geometry.picker.top >= 0 && geometry.picker.bottom <= geometry.height)
    win.setSize(320, 360); await frames()
    geometry = await run('bounds()')
    assert.ok(geometry.picker.left >= 0 && geometry.picker.right <= geometry.width)
    assert.ok(geometry.picker.top >= 0 && geometry.picker.bottom <= geometry.height)
    await capture('shortcut-short')
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 3, y: 3 })
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 3, y: 3 })
    await frames()
    assert.equal((await run('read()')).open, false)
    await run('teardown()')
    console.log('Shared agent switcher browser checks passed')
  } catch (error) {
    await capture('shortcut-failure')
    throw error
  } finally {
    await new Promise(resolve => server.close(resolve))
    win.destroy()
  }
}
check().then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1) })
