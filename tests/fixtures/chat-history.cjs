const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'history-check.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import plugin from './program/plugins/chat-history.client';
      import shortcuts from './program/plugins/chat-history-hotkeys.client';
      let Kind; const cleanup=[]; const root=createRoot(document.getElementById('root'));
      let visible=true, mounted=true, failOlder=true;
      window.requests=[]; window.opened=[]; window.tabs=[]; window.pendingSearches=[];
      const names=['Alto UI adjustments','Review the workspace changes','Security review of cryptographic boundary checks with a deliberately long title','Fix the history scroll position','Explore plugin architecture'];
      const now=Math.floor(Date.now()/1000);
      const chats=Array.from({length:85},(_,i)=>({id:String(i),title:names[i%names.length],preview:'First prompt',cwd:'/repo/alto',projectId:i%3===0?undefined:'alto',createdAt:now-i*1800,updatedAt:now-i*1800,gitInfo:{branch:i%2?'main':'feature/history'}}));
      const namedHistory=[{thread:{id:'closed',title:'A saved trip',preview:'Japan planning',cwd:'/repo/alto',createdAt:now,updatedAt:now},titles:['jptrv']}];
      const status={revision:0,running:['0'],finished:['1']};
      const threadStatus={snapshot:()=>status,subscribe:()=>()=>{},acknowledge:()=>{}};
      const sessionState={projects:[{id:'alto',name:'Alto'}]};
      const layout={subscribe:()=>()=>{},snapshot:()=>0,tabs:()=>[{id:'custom',title:'Release checklist',threadIds:['0','1'],threads:chats.slice(0,2)}],registerPaneKind:(_owner,kind)=>{Kind=kind.renderer},focusThread:id=>id==='0',openPane:request=>window.opened.push(request),newTab:kind=>window.tabs.push(kind),available:()=>true};
      const ctx={
        clientHost:{subscribe:()=>()=>{},snapshot:()=>({snapshot:{extensions:{'workspace-layout.history':namedHistory}}}),call:async(method,payload)=>{if(method==='chat-history.search')return new Promise(resolve=>window.pendingSearches.push({payload,resolve}));window.requests.push({method,payload});if(payload.cursor&&failOlder)throw new Error('Disconnected');return {threads:payload.cursor?chats.slice(80):chats.slice(0,80),nextCursor:payload.cursor?null:'older'}}},
        clientSession:{snapshot:()=>sessionState,subscribe:()=>()=>{}},clientWorkspaceLayout:layout,
        clientUi:{registerStyle:(_owner,_id,css)=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);cleanup.push(()=>style.remove())}},
        clientHotkeys:{registerAction:(_owner,action)=>{window.historyShortcut=()=>action.run()}},
        get:name=>name==='clientThreadStatus'?threadStatus:undefined,on:()=>()=>{},effect:fn=>{const dispose=fn();cleanup.push(dispose);return dispose}
      };
      plugin(ctx,{});shortcuts(ctx,{});
      const render=()=>flushSync(()=>root.render(mounted?<Kind visible={visible} focused={true} workspaceId="w" pane={{id:'history',kind:'history',type:'pane',workspace:'/repo'}}/>:null));
      window.mount=value=>{mounted=value;render()};window.setVisible=value=>{visible=value;render()};
      window.allowOlder=()=>{failOlder=false};
      window.finishSearch=()=>window.pendingSearches.shift().resolve({threads:[chats[84]],snippets:{84:'Assistant mentions a message-only needle here.'},nextCursor:null});
      window.searchFor=value=>{const input=document.querySelector('[aria-label="Search history"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))};
      window.scrollEnd=()=>{const element=document.querySelector('.chat-history-scroll');element.scrollTop=element.scrollHeight};
      window.teardown=()=>{root.unmount();for(const dispose of cleanup.reverse())dispose?.()};
      document.getElementById('draft').focus();render();
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all([
    'src/client/pane-toolbar.css', 'src/client/styles.css', 'program/plugins/theme.css', 'program/plugins/thread-status.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer(async (request, response) => {
    if (request.url?.startsWith('/fonts/')) {
      const filename = path.basename(decodeURIComponent(request.url))
      try { response.end(await fs.readFile(path.join('public/fonts', filename))); return }
      catch { response.statusCode = 404; response.end(); return }
    }
    response.end('<!doctype html><style>' + css + '</style><body style="margin:0;background:var(--canvas)"><input id="draft" aria-label="Other composer" style="position:fixed;left:-1000px"><div id="root" style="height:100vh;display:flex;min-width:0"></div></body>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const window = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = code => window.webContents.executeJavaScript(code)
  const frames = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const until = async expression => {
    for (let i = 0; i < 100; i++) { if (await run(expression)) return; await frames() }
    throw new Error('Timed out: ' + expression)
  }
  try {
    await window.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    await until("document.querySelectorAll('.chat-history-row').length===80")
    assert.equal(await run('document.activeElement.id'), 'draft', 'mounting history must not steal editor focus')
    assert.equal(await run('requests.length'), 1)
    await run('historyShortcut()')
    assert.deepEqual(await run('tabs'), ['history'])
    for (const theme of ['light', 'dark']) {
      for (const width of [1100, 360]) {
        window.setContentSize(width, 760)
        await run(`document.documentElement.dataset.altoTheme='${theme}'`)
        await frames()
        const metrics = await run(`(()=>{const scroll=document.querySelector('.chat-history-scroll'),header=document.querySelector('.chat-history-toolbar'),row=document.querySelector('.chat-history-row'),title=document.querySelector('.chat-history-row-title'),refresh=document.querySelector('[aria-label="Refresh history"]');return {width:innerWidth,overflow:scroll.scrollWidth>scroll.clientWidth,scrollable:scroll.scrollHeight>scroll.clientHeight,headerHeight:header.getBoundingClientRect().height,font:getComputedStyle(row).fontSize,shadow:getComputedStyle(row).boxShadow,radius:getComputedStyle(row).borderRadius,truncated:!!document.querySelector('.chat-history-row[title]'),headingVisible:getComputedStyle(header.querySelector('h1')).display!=='none',refreshRight:refresh.getBoundingClientRect().right,spinners:document.querySelectorAll('[data-thread-status=running]').length,dots:document.querySelectorAll('[data-thread-status=finished]').length}})()`)
        assert.equal(metrics.width, width)
        assert.equal(metrics.overflow, false, JSON.stringify(metrics))
        assert.equal(metrics.scrollable, true)
        assert.equal(metrics.headerHeight, 35)
        assert.equal(metrics.font, '14px')
        assert.equal(metrics.shadow, 'none')
        assert.equal(metrics.radius, '12px')
        assert.equal(metrics.headingVisible, true)
        assert.ok(metrics.refreshRight <= width - 150, JSON.stringify(metrics))
        assert.equal(metrics.spinners, 1)
        assert.equal(metrics.dots, 1)
        const search = await run(`(()=>{const form=document.querySelector('.chat-history-search'),input=form.querySelector('input'),submit=form.querySelector('[type=submit]');return {overflow:form.scrollWidth>form.clientWidth,inputWidth:input.getBoundingClientRect().width,right:submit.getBoundingClientRect().right}})()`)
        assert.equal(search.overflow, false)
        assert.ok(search.inputWidth > 120)
        assert.ok(search.right <= width)
        if (process.env.ALTO_HISTORY_ARTIFACT_DIR) {
          await fs.mkdir(process.env.ALTO_HISTORY_ARTIFACT_DIR, { recursive: true })
          await fs.writeFile(path.join(process.env.ALTO_HISTORY_ARTIFACT_DIR, `${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
        }
      }
    }
    await run('setVisible(false);scrollEnd()')
    await frames()
    assert.equal(await run('requests.length'), 1, 'hidden panes must not load more pages')
    await run('setVisible(true)')
    await until("!!document.querySelector('[role=alert]')")
    assert.equal(await run('requests.length'), 2)
    await frames()
    assert.equal(await run('requests.length'), 2, 'failed infinite scroll must not retry in a loop')
    await run("allowOlder();document.querySelector('.chat-history-more button').click()")
    await until("document.querySelectorAll('.chat-history-row').length===85")
    assert.deepEqual(await run('requests.map(request=>request.payload)'), [{}, { cursor: 'older' }, { cursor: 'older' }])
    assert.equal(await run("document.querySelector('.chat-history-more').textContent"), 'Beginning of your history')
    await run("document.querySelector('.chat-history-row').click();document.querySelectorAll('.chat-history-row')[1].click()")
    assert.equal(await run('opened.length'), 1)
    assert.equal(await run('opened[0].thread.id'), '1')
    await run('mount(false);mount(true)')
    await frames()
    assert.equal(await run('requests.length'), 3, 'reopening retains cached history pages')
    assert.equal(await run("document.querySelectorAll('.chat-history-row').length"), 85)
    await run("searchFor('  RELEASE checklist  ')")
    await until("document.querySelectorAll('.chat-history-row').length===2")
    assert.equal(await run('pendingSearches.length'), 0, 'typing must not scan message contents')
    assert.equal(await run("document.querySelectorAll('.chat-history-row-tab').length"), 2, 'a tab title finds all chats in a split tab')
    await run("searchFor('jptrv')")
    await until("document.querySelectorAll('.chat-history-row').length===1")
    assert.equal(await run("document.querySelector('.chat-history-row-title').textContent"), 'A saved trip', 'closed tab aliases stay searchable')
    assert.ok((await run("document.querySelector('.chat-history-row-tab').textContent")).includes('jptrv'))
    await run("document.querySelector('.chat-history-row').click()")
    assert.equal(await run('opened.at(-1).thread.id'), 'closed', 'a saved alias opens the exact conversation')
    await run("searchFor('message-only needle')")
    await until("document.querySelectorAll('.chat-history-row').length===0")
    await run("document.querySelector('[aria-label=\"Search messages\"]').click()")
    await until('pendingSearches.length===1')
    await run('finishSearch()')
    await until("document.querySelectorAll('.chat-history-row').length===1")
    assert.equal(await run("document.querySelector('.chat-history-row-snippet').textContent"), 'Assistant mentions a message-only needle here.')
    for (const width of [1100, 360]) {
      window.setContentSize(width, 760)
      await frames()
      assert.equal(await run("document.querySelector('.chat-history').scrollWidth > document.querySelector('.chat-history').clientWidth"), false, 'search excerpts and controls must fit the pane')
      if (process.env.ALTO_HISTORY_ARTIFACT_DIR) await fs.writeFile(path.join(process.env.ALTO_HISTORY_ARTIFACT_DIR, `search-${width}.png`), (await window.webContents.capturePage()).toPNG())
    }
    await run("searchFor('stale query')")
    await frames()
    await run("document.querySelector('[aria-label=\"Search messages\"]').click()")
    await until('pendingSearches.length===1')
    await run("searchFor('RELEASE checklist')")
    await frames()
    await run('finishSearch()')
    await frames()
    assert.equal(await run("document.querySelectorAll('.chat-history-row').length"), 2, 'an old message response must not replace a newer query')
    assert.equal(await run("document.querySelectorAll('.chat-history-row-snippet').length"), 0)
    await run("document.querySelector('[aria-label=\"Clear history search\"]').click()")
    await until("document.querySelectorAll('.chat-history-row').length===85")
    assert.equal(await run('document.activeElement.getAttribute("aria-label")'), 'Search history')
    await run('teardown()')
    assert.equal(await run("document.querySelectorAll('.chat-history').length"), 0)
    console.log('Chat history browser checks passed')
  } finally {
    window.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
