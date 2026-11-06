const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'app-rendering.tsx', loader: 'tsx', contents: `
      import React,{useSyncExternalStore} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {App} from './src/client/App';
      import {clientHost} from './src/client/host';
      import {browserProgram} from './src/client/plugin-runtime';
      const cleanups=[],owner={fiber:{name:'fixture'},effect:fn=>{const dispose=fn();if(dispose)cleanups.push(dispose);return dispose}};
      window.renders={surface:0,root:0};
      let liveValue='Initial service value';const listeners=new Set();
      function Feature({surface}) { renders.surface++; return <section data-surface={surface.id}><h2>{surface.label}</h2><input aria-label={surface.id} defaultValue="Unsent draft"/><ul>{Array.from({length:40},(_,i)=><li key={i}>Row {i}: retained application content</li>)}</ul></section> }
      function Root() { renders.root++; const value=useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>liveValue);return <aside data-fixture-root>{value}</aside> }
      const registration=browserProgram.ui.registerKind(owner,'fixture',Feature);
      const rootRegistration=browserProgram.ui.registerRoot(owner,'fixture-root',Root);
      const ui={shell:{id:'fixture',root:{type:'box',children:Array.from({length:40},(_,i)=>({type:'surface',id:'pane:'+i}))}},
        regions:[],contributions:[],surfaces:Array.from({length:40},(_,i)=>({id:'pane:'+i,kind:'fixture',label:'Pane '+i}))};
      const snapshot={codex:{status:'ready',models:[],activeThreadIds:[]},program:{revision:1,plugins:[],files:[],tools:[],proposals:[],profileText:''},
        ui,extensions:{noise:{value:0}},projects:{revision:0,projects:[]},pendingRequests:[],server:{port:4317,host:'127.0.0.1',projectRoot:'/repo'}};
      class Socket {
        static OPEN=1;readyState=0;handlers=new Map();
        constructor(){window.socket=this;queueMicrotask(()=>{this.readyState=1;this.emit('open');this.receive({type:'snapshot',payload:snapshot})})}
        addEventListener(type,fn){const group=this.handlers.get(type)??[];group.push(fn);this.handlers.set(type,group)}
        emit(type,event={}){for(const fn of this.handlers.get(type)??[])fn(event)}
        receive(event){this.emit('message',{data:JSON.stringify(event)})}
        send(){}
        close(){this.readyState=3;this.emit('close')}
      }
      window.WebSocket=Socket;
      const root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<App/>));
      window.ready=async()=>{const until=performance.now()+5000;while(browserProgram.snapshot().status!=='active'){if(performance.now()>until)throw Error('App did not activate: '+JSON.stringify(browserProgram.snapshot()));await new Promise(resolve=>setTimeout(resolve,5))}await frames()};
      window.frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.publishNoise=()=>flushSync(()=>socket.receive({type:'extensions.updated',partial:true,payload:{noise:{value:Math.random()}}}));
      window.publishUi=()=>flushSync(()=>socket.receive({type:'ui.updated',payload:{...ui,surfaces:ui.surfaces.map((surface,index)=>index?surface:{...surface,label:'Updated pane title'})}}));
      window.publishService=()=>flushSync(()=>{liveValue='Updated service value';for(const fn of listeners)fn()});
      window.replaceRenderer=()=>flushSync(()=>registration.update(({surface})=><section data-surface={surface.id}>Replacement renderer: {surface.label}</section>));
      window.replaceRoot=()=>flushSync(()=>rootRegistration.update(()=><aside data-fixture-root>Replacement root renderer</aside>));
      window.disconnect=()=>flushSync(()=>socket.close());
      window.teardown=async()=>{flushSync(()=>root.unmount());for(const cleanup of cleanups.reverse())cleanup();await browserProgram.dispose()};
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const server = http.createServer((request, response) => {
    if (request.url === '/__cordis/session') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ protocol: 'alto.fixture' }))
    } else response.end('<!doctype html><style>body{font:14px system-ui}section{content-visibility:auto;contain-intrinsic-size:auto 1000px}</style><div id="root"></div>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const win = new BrowserWindow({ show: false, width: 1000, height: 800,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = code => win.webContents.executeJavaScript(code)
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}/#alto-control=fixture-only`)
    await run(bundle.outputFiles[0].text)
    await run('ready()')
    assert.equal(await run('document.querySelectorAll("[data-surface]").length'), 40)
    await run('window.originalInput=document.querySelector("input");originalInput.focus();originalInput.value="Keep this unsent draft";originalInput.setSelectionRange(5,9)')
    const before = await run('({...renders})')
    const work = await run('(()=>{const start=performance.now();for(let i=0;i<20;i++)publishNoise();return performance.now()-start})()')
    const after = await run('({...renders})')
    const measurements = { before, after, updates: 20, workMs: work }
    console.log('App rendering measurements: ' + JSON.stringify(measurements))
    if (process.env.ALTO_APP_RENDER_METRICS) await fs.writeFile(process.env.ALTO_APP_RENDER_METRICS, JSON.stringify(measurements, null, 2))
    assert.deepEqual(after, before, 'Unrelated host updates do not render shell features or global roots')
    assert.equal(await run('originalInput===document.querySelector("input") && document.activeElement===originalInput && originalInput.value==="Keep this unsent draft" && originalInput.selectionStart===5 && originalInput.selectionEnd===9'), true, 'Unrelated host updates preserve native draft, focus, and selection')
    await run('publishService()')
    assert.equal(await run('document.querySelector("[data-fixture-root]").textContent'), 'Updated service value', 'Root renderers keep their own reactive subscriptions')
    await run('publishUi()')
    assert.equal(await run('document.querySelector("[data-surface] h2").textContent'), 'Updated pane title', 'Declarative UI updates still render')
    await run('replaceRenderer()')
    assert.equal(await run('document.querySelector("[data-surface]").textContent'), 'Replacement renderer: Updated pane title', 'Renderer replacements still propagate')
    await run('replaceRoot()')
    assert.equal(await run('document.querySelector("[data-fixture-root]").textContent'), 'Replacement root renderer', 'Root registration changes still propagate')
    await run("disconnect();window.dispatchEvent(new KeyboardEvent('keydown',{key:'p',metaKey:true,shiftKey:true}));frames()")
    assert.equal(await run('!!document.querySelector("[aria-label=\\"Cordis recovery\\"]")'), true, 'Recovery remains available after connection loss')
    await run('teardown()')
    console.log('App rendering browser checks passed')
  } finally {
    win.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
