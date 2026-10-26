const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'conversation-visibility.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {ConversationSurface} from './program/plugins/ui-surfaces.client';

      let focused=true,visibility='visible',selected=0;
      Object.defineProperty(document,'hasFocus',{value:()=>focused});
      Object.defineProperty(document,'visibilityState',{get:()=>visibility});
      const panes=[0,1].map(index=>{
        let state={revision:0,threadId:'chat-'+index,turn:{tag:'running'},connected:true,
          projects:[],skills:[],session:{workspace:'/tmp',permissionMode:'full'},
          activities:[
            {id:'user',kind:'user',title:'You',content:'Inspect the change',timestamp:'',createdAtMs:Date.now()},
            {id:'trace',kind:'reasoning',title:'Thinking',content:'Checking pane '+index,status:'running',timestamp:''}
          ]
        };
        const listeners=new Set();
        return {visible:true,listeners,session:{snapshot:()=>state,
          subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},
          loadEarlierActivities:async()=>{}
        },update:text=>{
          state={...state,revision:state.revision+1,activities:state.activities.map(item=>item.id==='trace'?{...item,content:text}:item)};
          for(const listener of listeners)listener();
        }};
      });
      const ui={subscribe:()=>()=>{},snapshot:()=>0,component:()=>undefined};
      const markdownState={codeBlocks:[],fileLinks:[]};
      const markdown={subscribe:()=>()=>{},snapshot:()=>markdownState};
      const root=createRoot(document.getElementById('root'));
      const render=()=>root.render(<>{panes.map((pane,index)=><section data-pane={index} hidden={!pane.visible} key={index}>
        <input aria-label={'Composer '+index} onFocus={()=>{selected=index;render()}}/>
        <ConversationSurface surface={{id:'conversation-'+index,kind:'conversation'}} session={pane.session}
          ui={ui} markdown={markdown} visible={pane.visible} showUnscopedRequests={selected===index}/>
      </section>)}</>);
      window.focusPane=index=>flushSync(()=>document.querySelector('[data-pane="'+index+'"] input').focus());
      window.setWindowState=next=>flushSync(()=>{
        // Focusing an embedded native browser or terminal can blur the host
        // document without hiding either of the adjacent conversation panes.
        if(next.focused!==undefined){focused=next.focused;window.dispatchEvent(new Event(focused?'focus':'blur'))}
        if(next.visibility!==undefined){visibility=next.visibility;document.dispatchEvent(new Event('visibilitychange'))}
      });
      window.setPaneVisible=(index,visible)=>flushSync(()=>{panes[index].visible=visible;render()});
      window.updatePane=(index,text)=>flushSync(()=>panes[index].update(text));
      window.observe=()=>panes.map((pane,index)=>{
        const element=document.querySelector('[data-pane="'+index+'"]');
        return {subscribers:pane.listeners.size,text:element.textContent,
          overlays:element.querySelectorAll('.activity-shimmer-sweep').length,
          animating:[...element.querySelectorAll('.activity-shimmer-sweep')].some(e=>getComputedStyle(e).animationName==='activity-shimmer-sweep')};
      });
      window.teardown=()=>flushSync(()=>root.unmount());
      flushSync(render);
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all([
    'src/client/styles.css', 'program/plugins/ui/default.css', 'program/plugins/theme.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((_request, response) => response.end('<!doctype html><style>' + css + `
    #root{display:flex;height:600px}#root>section{display:flex;flex:1;min-width:0;flex-direction:column}
    #root>section[hidden]{display:none}
  </style><main id="root"></main>`))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const win = new BrowserWindow({ show: false, width: 1100, height: 700, webPreferences: {
    offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false,
  } })
  const run = code => win.webContents.executeJavaScript(code)
  const until = async expression => {
    for (let i = 0; i < 100; i++) {
      if (await run(expression)) return
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error('Timed out: ' + expression)
  }
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    await run('focusPane(1)')
    await until('observe().every(pane=>pane.animating)')

    await run('setWindowState({focused:false})')
    assert.equal(await run('observe().every(pane=>pane.overlays>0 && pane.subscribers===1)'), true,
      'Both visible chats remain live when the host document loses focus')
    await run("updatePane(0,'Progress while the other pane has focus')")
    assert.match((await run('observe()'))[0].text, /Progress while the other pane has focus/)
    await until('observe().every(pane=>pane.animating)')

    await run("setPaneVisible(0,false);updatePane(0,'Progress while tab is hidden')")
    let state = await run('observe()')
    assert.equal(state[0].overlays, 0)
    assert.equal(state[0].subscribers, 0)
    assert.doesNotMatch(state[0].text, /Progress while tab is hidden/)
    assert.ok(state[1].overlays > 0, 'The remaining visible pane keeps its shimmer')

    await run("setWindowState({visibility:'hidden'});updatePane(1,'Progress while window is hidden')")
    state = await run('observe()')
    assert.ok(state.every(pane => pane.overlays === 0 && pane.subscribers === 0))
    assert.doesNotMatch(state[1].text, /Progress while window is hidden/)

    await run("setWindowState({visibility:'visible'})")
    state = await run('observe()')
    assert.equal(state[0].subscribers, 0, 'Returning to the window does not wake hidden tabs')
    assert.match(state[1].text, /Progress while window is hidden/)
    await until('observe()[1].animating')
    await run('setPaneVisible(0,true)')
    assert.match((await run('observe()'))[0].text, /Progress while tab is hidden/)
    await until('observe()[0].animating')
    await run('teardown()')
    console.log('Conversation visibility browser checks passed')
  } finally {
    win.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
