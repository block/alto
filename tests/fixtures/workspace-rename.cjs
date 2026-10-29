const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'workspace-rename.tsx', loader: 'tsx', contents: `
      import React,{useEffect,useState,useSyncExternalStore} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import workspace from './program/plugins/workspace-layout.client';
      import groups from './program/plugins/workspace-tab-groups.client';
      import vertical from './program/plugins/vertical-tabs.client';
      import material from './program/plugins/workspace-material.client';
      import appearance from './program/plugins/workspace-tabs-appearance.client';
      import controls from './program/plugins/interface-appearance.client';
      import shortcuts from './program/plugins/hotkeys-workspace.client';
      import {HotkeysService} from './program/plugins/hotkeys.client';
      import {parseWorkspaceLayout} from './program/plugins/workspace-layout-state';
      const cleanups=[],sessionListeners=new Set(),nameListeners=new Set();
      const owner={effect:fn=>{const cleanup=fn();if(cleanup)cleanups.push(cleanup);return cleanup}};
      let saved={version:2,activeViewId:'t0',groups:[{id:'g0',name:'Work',color:'green',collapsed:false}],views:Array.from({length:200},(_,index)=>({id:'t'+index,name:'Conversation '+index,groupId:index<20?'g0':undefined,workspace:'/repo',focusedPaneId:'p'+index,root:{type:'pane',id:'p'+index,workspace:'/repo',kind:'test'},...(index===0?{nameBinding:{source:'fixture',id:'name'}}:{})}))};
      localStorage.setItem('codex-cordis.workspace-layout',JSON.stringify(saved));localStorage.removeItem('codex-cordis.vertical-tabs');
      let state={connected:true,session:{workspace:'/repo',permissionMode:'full'},projects:[],threads:[],skills:[],turn:{tag:'running'},activities:[],history:{tag:'ready',entries:[]},harness:{codex:{status:'ready',models:[]},ui:{surfaces:[],contributions:[],regions:[]}}};
      const session={snapshot:()=>state,subscribe:listener=>{sessionListeners.add(listener);return()=>sessionListeners.delete(listener)}};
      const host={subscribe:()=>()=>{},snapshot:()=>({connectionEpoch:1}),call:async(method,payload)=>{if(method.endsWith('.read'))return structuredClone(saved);if(method.endsWith('.write'))saved=parseWorkspaceLayout(payload)}};
      let Surface,registry,hotkeys;
      const ui={subscribe:()=>()=>{},snapshot:()=>0,component:()=>()=>null,renderer:()=>undefined,contributionRenderer:()=>undefined,
        overlays:{open:()=>{},close:()=>{}},registerSurface:(_owner,_id,component)=>{Surface=component},
        registerStyle:(scope,id,css)=>scope.effect(()=>{const style=document.createElement('style');style.dataset.pluginStyle=id;style.textContent=css;document.head.append(style);return()=>style.remove()})};
      const ctx={...owner,clientUi:ui,clientHost:host,clientSession:session,provide:(name,value)=>{if(name==='clientWorkspaceLayout')registry=value},
        clientSessionRouter:{setActive:()=>{},clearActive:()=>{}},clientSessionFactory:{create:()=>{throw Error('Unexpected chat creation')}}};
      workspace(ctx);hotkeys=new HotkeysService(ui,{leader:'Alt'});
      for(const plugin of [controls,appearance,material,groups,vertical])plugin({...ctx,clientWorkspaceLayout:registry});
      shortcuts({...ctx,clientWorkspaceLayout:registry,clientHotkeys:{registerAction:(scope,action)=>hotkeys.registerAction(scope,action)}});
      let boundName='Conversation 0';
      registry.registerTabNameSource(owner,{id:'fixture',name:()=>boundName,rename:async(_id,name)=>{boundName=name;for(const listener of nameListeners)listener()},subscribe:listener=>{nameListeners.add(listener);return()=>nameListeners.delete(listener)}});
      window.mounts=0;
      function Draft({pane}){const current=useSyncExternalStore(session.subscribe,session.snapshot),[draft,setDraft]=useState('Draft '+pane.id);useEffect(()=>{window.mounts++},[]);return <div className="test-pane"><p>{current.activities[0]?.text??'Conversation'}</p><textarea id={'draft-'+pane.id} value={draft} onChange={event=>setDraft(event.target.value)}/></div>}
      const Pane=({pane})=>Number(pane.id.slice(1))<24?<Draft pane={pane}/>:<div>Inactive typed pane</div>;
      registry.registerPaneKind(owner,{id:'test',label:'Test',renderer:Pane});
      const root=createRoot(document.getElementById('workspace-mount'));flushSync(()=>root.render(<Surface surface={{id:'workspace-layout',kind:'workspace-layout'}}/>));
      window.frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.publish=()=>flushSync(()=>{state={...state,activities:[{id:'stream',text:(state.activities[0]?.text??'Reply')+'.'}]};for(const listener of sessionListeners)listener()});
      window.metadata=()=>flushSync(()=>{boundName='Updated metadata';for(const listener of nameListeners)listener()});
      window.tabName=id=>saved.views.find(view=>view.id===id).name;
      window.rememberDrafts=()=>{window.drafts=[...document.querySelectorAll('textarea')].map(node=>({node,value:node.value}));window.initialMounts=mounts};
      window.retained=()=>drafts.length===24&&mounts===initialMounts&&drafts.every(({node,value})=>node.isConnected&&document.getElementById(node.id)===node&&node.value===value);
      window.teardown=()=>{hotkeys.dispose();root.unmount();for(const cleanup of cleanups.reverse())cleanup()};
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all(['src/client/styles.css', 'program/plugins/ui/default.css', 'program/plugins/theme.css'].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((_request, response) => response.end('<!doctype html><html data-alto-theme="light" data-alto-theme-plugin="active" data-desktop-platform="darwin"><style>' + css + '#root{height:100vh}#workspace-mount{display:flex;flex:1;min-width:0;min-height:0}.test-pane{padding:24px;width:100%}.test-pane textarea{width:100%;min-height:100px}</style><div id="root"><div class="shell-kernel"><div class="shell-box shell-direction-row shell-grow"><main class="shell-box shell-direction-column shell-grow"><div id="workspace-mount"></div></main></div></div></div>'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const win = new BrowserWindow({ show: false, width: 1200, height: 760,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = code => win.webContents.executeJavaScript(code).catch(error => { throw new Error('Renderer check failed: ' + code.slice(0, 120), { cause: error }) })
  const frames = () => run('frames()')
  const command = (method, params) => win.webContents.debugger.sendCommand(method, params)
  const key = async (key, code, windowsVirtualKeyCode) => {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode })
  }
  const click = async (selector, clickCount = 1) => {
    const point = await run(`(()=>{const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`)
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount, ...point })
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount, ...point })
    await frames()
  }
  const insert = text => command('Input.insertText', { text })
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    await frames()
    win.webContents.debugger.attach('1.3')
    assert.equal(await run('document.querySelectorAll("[data-workspace-tab]").length'), 200)
    await run('document.querySelector("#draft-p0").focus()')
    await insert('Retain this native draft')
    await run('rememberDrafts()')
    for (const tab of [1, 2, 0, 1]) { await run('publish()'); await click(`[data-workspace-tab=t${tab}]`) }
    await click('[data-workspace-tab=t1]', 2)
    assert.equal(await run('document.activeElement.value'), 'Conversation 1', 'Rename begins from the current saved name')
    await insert('Rename draft')
    await run('window.originalInput=document.activeElement;originalInput.setSelectionRange(7,12);metadata();publish()')
    assert.equal(await run('document.activeElement===originalInput && originalInput.value==="Rename draft" && originalInput.selectionStart===7 && originalInput.selectionEnd===12'), true, 'Metadata and streaming retain the native rename draft, focus, and selection')
    await insert('saved')
    await run("document.execCommand('undo')")
    assert.equal(await run('originalInput.value'), 'Rename draft', 'Metadata updates preserve native undo')
    await run("document.execCommand('redo')")
    assert.equal(await run('originalInput.value'), 'Rename saved')
    await key('Enter', 'Enter', 13); await frames()
    assert.equal(await run('tabName("t1")'), 'Rename saved', 'Enter saves the latest native input')
    await click('[data-workspace-tab=t1]', 2)
    assert.equal(await run('document.activeElement.value'), 'Rename saved', 'Reopening starts a fresh draft from the saved name')
    await insert('Discard me'); await key('Escape', 'Escape', 27); await frames()
    assert.equal(await run('tabName("t1")'), 'Rename saved', 'Escape discards the native edit')
    await click('[data-workspace-tab=t1]', 2)
    assert.equal(await run('document.activeElement.value'), 'Rename saved')
    await insert('Blur saved'); await click('#draft-p1')
    assert.equal(await run('tabName("t1")'), 'Blur saved', 'Blur saves the latest native input')
    await run('document.querySelector(".vertical-tab-rail-resize").focus()')
    await key('ArrowRight', 'ArrowRight', 39); await frames()
    assert.equal(await run('document.querySelector(".vertical-tab-rail-resize").getAttribute("aria-valuenow")'), '248', 'Native keyboard resizing changes the rail width')
    assert.equal(await run('retained()'), true, 'Hover, select, rename, metadata, and resize preserve all 24 pane drafts and mounts')
    await run('teardown()')
    console.log('Workspace rename browser checks passed')
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach()
    win.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
