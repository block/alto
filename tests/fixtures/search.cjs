const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'search-check.tsx', loader: 'tsx', contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import layoutPlugin from './program/plugins/workspace-layout.client';
      import searchPlugin from './program/plugins/search.client';
      const thread=(id,updatedAt)=>({id,title:id,preview:'Conversation '+id,cwd:'/repo',createdAt:1,updatedAt});
      const current=thread('current',100),newest=thread('newest-unread',1),older=thread('older-unread',90),read=thread('read',95);
      const view=(id,name,t)=>({id,name,workspace:'/repo',focusedPaneId:'pane-'+id,root:{type:'pane',id:'pane-'+id,workspace:'/repo',thread:t}});
      let saved={version:2,activeViewId:'current-tab',views:[view('current-tab','Current work',current),view('unread-tab','Unread work',newest),view('read-tab','Read work',read)]};
      localStorage.setItem('codex-cordis.workspace-layout',JSON.stringify(saved));
      let statuses={revision:0,running:[],finished:['current','newest-unread','older-unread']};
      const statusListeners=new Set(),layoutListeners=new Set(),overlayListeners=new Set();let overlay;
      const status={subscribe:fn=>{statusListeners.add(fn);return()=>statusListeners.delete(fn)},snapshot:()=>statuses,acknowledge:id=>{statuses={...statuses,revision:statuses.revision+1,finished:statuses.finished.filter(t=>t!==id)};for(const fn of statusListeners)fn()}};
      const state={connected:true,threadId:'current',session:{workspace:'/repo',permissionMode:'full'},projects:[],threads:[current,older,read],skills:[],turn:{tag:'running'},activities:[],history:{tag:'ready',entries:[]},harness:{extensions:{'session.workspace':'/tmp/alto-scratch'},server:{projectRoot:'/repo'},codex:{status:'ready',models:[]},ui:{surfaces:[],contributions:[],regions:[]}}};
      const session={snapshot:()=>state,subscribe:()=>()=>{},openThread:()=>{throw Error('Must not replace current chat')},newThread:()=>{throw Error('Must not replace current chat')}};
      const host={snapshot:()=>({connectionEpoch:1}),subscribe:()=>()=>{},call:async(method,payload)=>{if(method.endsWith('.read'))return saved;if(method.endsWith('.write'))saved=structuredClone(payload)}};
      const overlays={subscribe:fn=>{overlayListeners.add(fn);return()=>overlayListeners.delete(fn)},snapshot:()=>overlay,open:id=>{overlay=id;for(const fn of overlayListeners)fn()},close:id=>{if(overlay===id){overlay=undefined;for(const fn of overlayListeners)fn()}},toggle:id=>{overlay===id?overlays.close(id):overlays.open(id)}};
      let Surface,SearchRoot,registry;const effects=[];
      const Placeholder=()=> <textarea aria-label="Chat draft" defaultValue="Keep my draft"/>;
      const ui={subscribe:()=>()=>{},snapshot:()=>0,overlays,component:()=>Placeholder,renderer:()=>()=>null,contributionRenderer:()=>undefined,
        registerSurface:(_owner,_id,component)=>{Surface=component},registerRoot:(_owner,_id,component)=>{SearchRoot=component},registerStyle:(_owner,_id,css)=>{const e=document.createElement('style');e.textContent=css;document.head.append(e)}};
      const ctx={effect:fn=>{const cleanup=fn();effects.push(cleanup);return cleanup},provide:(_name,value)=>{registry=value},clientUi:ui,clientSession:session,clientHost:host,
        clientSessionRouter:{setActive:()=>{},clearActive:()=>{}},clientSessionFactory:{create:()=>{let snap={...state,threadId:undefined};const listeners=new Set();return {session:{snapshot:()=>snap,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},openThread:async thread=>{snap={...snap,threadId:thread.id,threads:[thread]};for(const fn of listeners)fn()},selectProject:()=>{}},dispose:()=>listeners.clear()}}},
        get:name=>name==='clientThreadStatus'?status:undefined,on:()=>()=>{}};
      layoutPlugin(ctx);searchPlugin({...ctx,clientWorkspaceLayout:registry});
      const root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<><Surface surface={{id:'workspace-layout',kind:'workspace-layout'}}/><SearchRoot/></>));
      window.frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.cmdK=()=>flushSync(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true,cancelable:true})));
      window.key=key=>flushSync(()=>document.querySelector('.search-palette input').dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})));
      window.query=value=>flushSync(()=>{const e=document.querySelector('.search-palette input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,value);e.dispatchEvent(new Event('input',{bubbles:true}))});
      window.inspect=()=>({tabs:registry.tabs(),saved,overlay,finished:statuses.finished,results:[...document.querySelectorAll('.search-result')].map(e=>({label:e.querySelector('strong').textContent,selected:e.getAttribute('aria-selected'),disabled:e.disabled}))});
      window.select=id=>flushSync(()=>registry.selectTab(registry.tabs().findIndex(tab=>tab.id===id)));
      window.teardown=()=>{flushSync(()=>root.unmount());for(const cleanup of effects.reverse())cleanup?.()};
    ` }, bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'},
  })
  const css=(await Promise.all(['src/client/styles.css','src/client/pane-toolbar.css','program/plugins/ui/default.css'].map(file=>fs.readFile(file,'utf8')))).join('\n').replace(/@import[^;]+;/g,'')
  const server=http.createServer((_request,response)=>response.end('<!doctype html><style>'+css+'#root{height:100vh}</style><div id="root"></div>'))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const win=new BrowserWindow({show:false,width:1100,height:760,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,backgroundThrottling:false}})
  const run=code=>win.webContents.executeJavaScript(code)
  const until=async expression=>{for(let i=0;i<100;i++){if(await run(expression))return;await run('frame()')}throw Error('Timed out: '+expression)}
  try {
    await win.loadURL('http://127.0.0.1:'+server.address().port);await run(bundle.outputFiles[0].text)
    await until('inspect().tabs.length===3')
    await run('window.originalDraft=document.querySelector(".workspace-view:not([hidden]) textarea");cmdK()');await run('frame()')
    let result=await run('inspect()');assert.equal(result.results[0].label,'Unread work');assert.equal(result.results[0].selected,'true');assert.equal(result.results[0].disabled,false,'Navigation remains enabled while the current agent works')
    assert.equal(await run('document.activeElement===document.querySelector(".search-palette input")'),true)
    await run('key("Enter")');await until('inspect().tabs.find(t=>t.active)?.id==="unread-tab"')
    result=await run('inspect()');assert.equal(result.tabs.length,3,'Existing tab is reused');assert.equal(result.finished.includes('newest-unread'),false);assert.equal(result.overlay,undefined)
    assert.ok(await run('originalDraft.isConnected && originalDraft.value==="Keep my draft"'))
    assert.equal(result.tabs.find(t=>t.id==='current-tab').threadIds[0],'current')
    await run('cmdK()');await run('frame()');assert.equal((await run('inspect()')).results[0].label,'older-unread');await run('key("Enter")')
    await until('inspect().tabs.length===4');assert.ok((await run('inspect()')).tabs.some(t=>t.active&&t.threadIds.includes('older-unread')))
    assert.ok(await run('originalDraft.isConnected && originalDraft.value==="Keep my draft"'))
    await run('cmdK();query("Read work")');await run('frame()');assert.equal((await run('inspect()')).results[0].label,'Read work');await run('key("Enter")');await until('inspect().tabs.find(t=>t.active)?.id==="read-tab"')
    assert.equal((await run('inspect()')).tabs.length,4,'Read chats also switch to their existing tabs')
    await run('cmdK();query("New chat")');await run('frame()');await run('key("Enter")');await until('inspect().tabs.length===5')
    assert.ok(await run('originalDraft.isConnected && originalDraft.value==="Keep my draft"'))
    await run('teardown()');console.log('Search browser checks passed: Cmd+K, Enter, newest unread, existing and new tabs, running agent, and preserved draft')
  } finally {win.destroy();await new Promise(resolve=>server.close(resolve))}
}
check().then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1)})
