const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'workspace-rendering-check.tsx', loader: 'tsx', contents: `
      import React,{Profiler,useEffect} from 'react';
      import {createRoot,flushSync} from 'react-dom/profiling';
      import layoutPlugin from './program/plugins/workspace-layout.client';
      import groupsPlugin from './program/plugins/workspace-tab-groups.client';
      import verticalPlugin from './program/plugins/vertical-tabs.client';
      import statusPlugin from './program/plugins/workspace-thread-status.client';
      import {parseWorkspaceLayout} from './program/plugins/workspace-layout-state';
      const thread=id=>({id,title:id,preview:'',cwd:'/repo',createdAt:1,updatedAt:1});
      let saved={version:2,activeViewId:'tab-99',groups:Array.from({length:10},(_,index)=>({id:'group-'+index,name:'Group '+index,color:'purple',collapsed:true})),
        views:Array.from({length:100},(_,index)=>({id:'tab-'+index,name:'Chat '+index,workspace:'/repo',groupId:'group-'+Math.floor(index/10),focusedPaneId:'pane-'+index,
          root:{type:'pane',id:'pane-'+index,kind:'test',workspace:'/repo',thread:thread('thread-'+index)}}))};
      localStorage.setItem('codex-cordis.workspace-layout',JSON.stringify(saved));
      localStorage.setItem('codex-cordis.vertical-tabs',JSON.stringify({orientation:'vertical',width:232,collapsed:false}));
      const state={connected:true,session:{workspace:'/repo',permissionMode:'full'},projects:[],threads:[],skills:[],turn:{tag:'idle'},activities:[],history:{tag:'ready',entries:[]},harness:{codex:{status:'ready',models:[]},ui:{surfaces:[],contributions:[],regions:[]}}};
      const host={subscribe:()=>()=>{},snapshot:()=>({connectionEpoch:1}),call:async(method,payload)=>{
        if(method.endsWith('.read'))return structuredClone(saved);
        if(method.endsWith('.write')){saved=parseWorkspaceLayout(payload);return null;}
      }};
      let Surface,registry,vertical,root;
      const listeners=new Set();let status={revision:0,running:[],finished:[]};
      const statusStore={snapshot:()=>status,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)}};
      const publish=(running,finished)=>flushSync(()=>{status={revision:status.revision+1,running,finished};for(const listener of listeners)listener()});
      const Placeholder=()=>null;
      const ui={subscribe:()=>()=>{},snapshot:()=>0,component:()=>Placeholder,renderer:()=>undefined,contributionRenderer:()=>undefined,
        overlays:{open:()=>{},close:()=>{}},registerSurface:(_owner,_id,component)=>{Surface=component},
        registerStyle:(owner,id,css)=>owner.effect(()=>{const element=document.createElement('style');element.dataset.pluginStyle=id;element.textContent=css;document.head.append(element);return()=>element.remove()})};
      const ctx={provide:(name,value)=>{if(name==='clientVerticalTabs')vertical=value;else registry=value},clientUi:ui,clientHost:host,
        clientSession:{snapshot:()=>state,subscribe:()=>()=>{}},clientThreadStatus:statusStore,
        clientSessionRouter:{setActive:()=>{},clearActive:()=>{}},clientSessionFactory:{create:()=>{throw new Error('Unexpected chat creation')}}};
      const cleanups=[];const owner=()=>({...ctx,clientWorkspaceLayout:registry,effect:fn=>{const cleanup=fn();cleanups.push(cleanup);return cleanup}});
      layoutPlugin(owner());
      let metrics;window.reset=()=>{metrics={paneRenders:0,tabCommits:0,groupCommits:0,renderMs:0}};window.reset();
      const register=registry.registerTabAddon.bind(registry);
      registry.registerTabAddon=(owner,addon)=>{
        const Tab=addon.renderer,Group=addon.groupRenderer;
        return register(owner,{...addon,renderer:props=><Profiler id={'tab:'+props.workspaceId} onRender={(_id,_phase,duration)=>{metrics.tabCommits++;metrics.renderMs+=duration}}><Tab {...props}/></Profiler>,
          ...(Group?{groupRenderer:props=><Profiler id={'group:'+props.groupId} onRender={(_id,_phase,duration)=>{metrics.groupCommits++;metrics.renderMs+=duration}}><Group {...props}/></Profiler>}:{})});
      };
      groupsPlugin(owner());verticalPlugin(owner());statusPlugin(owner());
      window.mounts=0;window.disposals=0;
      const Pane=({pane})=>{metrics.paneRenders++;useEffect(()=>{window.mounts++;return()=>window.disposals++},[]);return <main><p>{pane.id}</p><textarea id={'draft-'+pane.id} defaultValue={'Draft for '+pane.id}/></main>};
      registry.registerPaneKind(owner(),{id:'test',label:'Test chat',renderer:Pane});
      root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<Surface surface={{id:'workspace-layout',kind:'workspace-layout'}}/>));
      window.originalDraft=document.getElementById('draft-pane-99');originalDraft.value='Keep this message';originalDraft.focus();
      window.probe=(kind,iterations)=>{
        window.reset();const started=performance.now();
        for(let index=0;index<iterations;index++){
          if(kind==='unrelated-status')publish(['not-open-'+index],[]);
          else if(kind==='related-status')publish(index%2?[]:['thread-0'],['thread-1']);
          else if(kind==='group')flushSync(()=>document.querySelector('[data-workspace-group=group-0]').click());
          else if(kind==='select')flushSync(()=>registry.selectTab(99-index%2));
        }
        return {...metrics,elapsedMs:performance.now()-started};
      };
      window.inspect=()=>({mounts:window.mounts,disposals:window.disposals,listeners:listeners.size,
        draft:originalDraft===document.getElementById('draft-pane-99')&&originalDraft.value==='Keep this message',focused:document.activeElement===originalDraft,
        visible:[...document.querySelectorAll('.workspace-view:not([hidden]) textarea')].map(element=>element.id),
        groupCounts:[...document.querySelector('[data-workspace-group=group-0]').querySelectorAll('.workspace-tab-group-status-count')].map(element=>element.textContent)});
      window.teardown=()=>{flushSync(()=>root.unmount());for(const cleanup of cleanups.reverse())cleanup();return {listeners:listeners.size,disposals:window.disposals}};
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all(['src/client/styles.css', 'program/plugins/ui/default.css', 'program/plugins/theme.css', 'program/plugins/thread-status.css'].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((_request, response) => response.end('<!doctype html><style>' + css + '\n#root{height:100vh}textarea{width:100%}</style><div id="root"></div>'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const window = new BrowserWindow({ show: false, width: 1200, height: 760, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  window.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message) })
  const run = code => window.webContents.executeJavaScript(code)
  const settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  try {
    await window.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    await settle()
    const observations = {}
    for (const kind of ['unrelated-status', 'related-status', 'group', 'select']) {
      observations[kind] = await run(`probe('${kind}',30)`)
      await settle()
      if (kind !== 'select') assert.equal((await run('inspect()')).focused, true, 'Background updates retain focus in the visible draft')
    }
    const state = await run('inspect()')
    assert.equal(state.mounts, 100)
    assert.equal(state.disposals, 0)
    assert.equal(state.draft, true)
    assert.deepEqual(state.visible, ['draft-pane-98'])
    assert.deepEqual(state.groupCounts, ['1'])
    if (!process.env.ALTO_WORKSPACE_BASELINE) {
      assert.equal(observations['unrelated-status'].tabCommits, 0, 'Unrelated chat statuses do not rerender mounted tab badges')
      assert.equal(observations['unrelated-status'].groupCommits, 0, 'Unrelated chat statuses do not rerender collapsed group summaries')
      assert.ok(observations['related-status'].tabCommits <= 31, 'Only the tabs whose status changes render')
      assert.equal(observations.group.paneRenders, 0, 'Collapsing groups does not rerender unrelated mounted panes')
      assert.ok(observations.select.paneRenders <= 60, 'Switching tabs updates only the two views whose visibility changes')
    }
    console.log('Workspace rendering observations ' + JSON.stringify(observations))
    assert.deepEqual(await run('teardown()'), { listeners: 0, disposals: 100 })
    console.log('Workspace rendering browser checks passed')
  } finally {
    window.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
