const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

async function check() {
  await app.whenReady()
  const staged = process.env.ALTO_PR_WATCHER_STAGED
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'pr-watcher-browser.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import watcher from './program/plugins/pr-watcher.client';
      import gitStatus from './program/plugins/git-pane-status.client';
      const listeners=new Set(),addons=[],components=new Map();
      const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener)};
      const emit=()=>listeners.forEach(listener=>listener());
      let revision=0,threadId='source-chat',scope='pr',watches=[],alerts=[],fail=false,uiRevision=0;
      let hostState,sessionState,gitSnapshot,gitState;
      const cwd='/Users/test/alto',url='https://github.com/block/alto/pull/42';
      const member=(number=42)=>({number,url:'https://github.com/block/alto/pull/'+number,title:'Improve conversation updates with a deliberately long title',autoAddressFeedback:false});
      const pr=(number=42)=>({number,url:'https://github.com/block/alto/pull/'+number,title:'Improve conversation updates',state:'OPEN',draft:false,headBranch:'feature/watch',baseBranch:'main',checks:'passing',checkDetails:[]});
      const update=()=>{
        const request=pr();
        if(scope==='stack')request.stack={id:'PS_stack',number:8,baseBranch:'main',size:2,entries:[{position:1,pullRequest:pr(41)},{position:2,pullRequest:pr(42)}]};
        sessionState={threadId,threads:[],history:{entries:[]},session:{workspace:cwd}};
        hostState={revision:++revision,connected:true,snapshot:{extensions:{'pr-watcher':{available:true,watches,alerts}}}};
        gitState={root:cwd,branch:'feature/watch',head:'abc',ahead:0,behind:0,files:[],pullRequests:[request],updatedAt:'now'};
        gitSnapshot={version:1,revision,aliases:{},repositories:{[cwd]:gitState},updatedAt:'now'};
        emit();
      };
      update();
      window.calls=[];
      const host={subscribe,snapshot:()=>hostState,call:async(method,args)=>{
        window.calls.push({method,args});
        if(fail)throw new Error('The watch setting could not be saved.');
        if(method==='pr-watcher.start'){
          const watch={id:'watch-1',scope:args.scope,pullRequestUrl:args.pullRequestUrl,label:scope==='stack'?'Stack of 2 PRs':'block/alto #42',threadId:'watch-chat',status:'watching',members:scope==='stack'?[member(41),member(42)]:[member()],updatedAt:'now'};
          watches=[watch];update();return watch;
        }
        if(method==='pr-watcher.feedback')watches=watches.map(w=>({...w,members:w.members.map(m=>m.number===args.number?{...m,autoAddressFeedback:args.enabled}:m)}));
        if(method==='pr-watcher.pause'||method==='pr-watcher.resume')watches=watches.map(w=>({...w,status:method==='pr-watcher.pause'?'paused':'watching'}));
        update();return{};
      }};
      const session={subscribe,snapshot:()=>sessionState};
      const ui={subscribe,snapshot:()=>uiRevision,component:id=>components.get(id),registerComponent:(_owner,id,component)=>{components.set(id,component);uiRevision++},
        registerStyle:(_owner,_id,css)=>{const node=document.createElement('style');node.textContent=css;document.head.append(node)}};
      const contexts={subscribe,snapshot:()=>hostState,localCheckoutForPath:()=>({kind:'local',location:cwd,branch:'feature/watch'}),targetForThread:()=>undefined};
      const git={subscribe,snapshot:()=>gitSnapshot,repositoryFor:()=>gitState,inspect:async()=>gitState,inspectBranch:async()=>({branch:'feature/watch',pullRequests:gitState.pullRequests,updatedAt:'now'})};
      window.notified=[];window.suppressed=[];
      const cleanups=[];
      const ctx={clientHost:host,clientUi:ui,clientGitSupport:git,clientWorkContexts:contexts,clientWorkspaceLayout:{registerPaneAddon:(_owner,addon)=>{if(!addons.some(existing=>existing.id===addon.id))addons.push(addon)}},
        effect:effect=>{const cleanup=effect();cleanups.push(cleanup);return cleanup},
        clientNotifications:{notify:async alert=>{window.notified.push(alert)},suppressCompletion:(_owner,id)=>{window.suppressed.push(id);return()=>{window.suppressed=window.suppressed.filter(value=>value!==id)}}}};
      watcher(ctx);gitStatus(ctx);
      const root=createRoot(document.getElementById('root'));
      const render=()=>flushSync(()=>root.render(<section className="workspace-chat-pane is-focused">
        <header className="workspace-pane-header"><span className="fixture-title">Review changes</span>
        {addons.filter(a=>a.placement==='pane-title').map(a=>{const C=a.renderer;return <C key={a.id+scope} workspaceId="tab" paneId="pane" focused visible session={session}/>})}</header>
        {addons.filter(a=>a.placement==='after-header').map(a=>{const C=a.renderer;return <C key={a.id} workspaceId="tab" paneId="pane" focused visible session={session}/>})}
        <main className="fixture-content"><p>The watcher follows this pull request.</p><div className="fixture-composer">Ask Alto…</div></main>
      </section>));
      window.setScenario=(next)=>{
        scope=next;threadId='source-chat';watches=[];alerts=[];fail=false;window.calls=[];update();render();
      };
      window.showThread=id=>{threadId=id;update()};
      window.setFailure=value=>{fail=value};
      window.setLaunchFailure=()=>{watches=[{id:'watch-1',scope,pullRequestUrl:url,label:'block/alto #42',status:'blocked',members:[member()],updatedAt:0}];update()};
      window.setWatchStatus=value=>{watches=watches.map(w=>({...w,status:value}));update()};
      window.addAlert=()=>{alerts=[{id:'alert-1',threadId:'watch-chat',title:'Feedback needs attention',body:'A new review arrived.'}];update()};
      window.addForeignAlert=()=>{alerts.push({id:'alert-other',threadId:'other-watch',title:'Unrelated feedback',body:'Another PR changed.'});update()};
      window.restartWatcher=()=>{cleanups.splice(0).forEach(cleanup=>cleanup());watcher(ctx)};
      window.removeComponent=()=>{components.delete('pr-watcher.action');uiRevision++;emit()};
      window.observe=()=>({text:document.body.innerText,calls:window.calls,overflow:document.documentElement.scrollWidth>innerWidth,
        controls:[...document.querySelectorAll('.pr-watcher-controls button,.pr-watcher-controls summary')].map(el=>({width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right})),
        switches:[...document.querySelectorAll('[role=switch]')].map(el=>({label:el.getAttribute('aria-label'),checked:el.getAttribute('aria-checked')}))});
      render();window.ready=true;
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: staged ? [{ name: 'staged-watcher', setup(plugin) {
      plugin.onResolve({ filter: /pr-watcher\.client$|git-pane-status\.client$|pr-watcher\.css$/ }, args => {
        const name = path.basename(args.path)
        const file = name.endsWith('.css') ? name : name + '.tsx'
        return { path: path.resolve(staged, file), namespace: 'staged-watcher' }
      })
      plugin.onLoad({ filter: /.*/, namespace: 'staged-watcher' }, async args => ({
        contents: await fs.readFile(args.path, 'utf8'), resolveDir: path.resolve('program/plugins'),
        loader: args.path.endsWith('.css') ? 'text' : 'tsx',
      }))
    } }] : [],
  })
  const css=(await Promise.all(['src/client/styles.css','src/client/pane-toolbar.css','program/plugins/ui/default.css','program/plugins/theme.css','program/plugins/workspace-layout.css','program/plugins/git-support.css'].map(file=>fs.readFile(file,'utf8')))).join('\n').replace(/@import[^;]+;/g,'')
  const server=http.createServer((_request,response)=>response.end('<!doctype html><meta charset="utf-8"><style>'+css+`
    html,body{height:100%;margin:0;overflow:hidden}body{background:var(--canvas);font-family:var(--sans)}#root{height:100%;display:flex}
    .fixture-title{flex:1;min-width:0;font-size:12px}.fixture-content{flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:28px;color:var(--muted);font-size:14px}
    .fixture-composer{padding:18px;border:1px solid var(--border);border-radius:24px;background:var(--panel);color:var(--muted-soft)}
  </style><div id="root"></div>`))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const win=new BrowserWindow({show:false,width:900,height:500,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,backgroundThrottling:false}})
  const run=code=>win.webContents.executeJavaScript(code)
  const settle=()=>run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const until=async expression=>{
    for(let i=0;i<100;i++){if(await run(expression))return;await new Promise(resolve=>setTimeout(resolve,20))}
    throw new Error('Timed out: '+expression+' '+JSON.stringify(await run('observe()')))
  }
  const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const openPopover=async()=>{
    await settle()
    if(await run("document.querySelector('.git-pane-pr').tagName==='BUTTON'")){
      await click('.git-pane-pr');await until("!!document.querySelector('.git-pane-popover')");return
    }
    win.webContents.sendInputEvent({type:'mouseMove',x:2,y:490})
    await settle()
    const point=await run("(()=>{const box=document.querySelector('.git-pane-pr').getBoundingClientRect();return{x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2)}})()")
    win.webContents.sendInputEvent({type:'mouseMove',...point})
    await until("!!document.querySelector('.git-pane-popover')")
  }
  const closePopover=async()=>{await run("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");await settle()}
  try{
    await win.loadURL('http://127.0.0.1:'+server.address().port)
    await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
    await until('window.ready===true')
    await openPopover()
    assert.equal(await run("document.querySelector('.pr-watcher-start').textContent"),'Watch on Blox')
    await run('setLaunchFailure()');await settle()
    assert.match(await run("document.querySelector('.pr-watcher-start').textContent"),/Retry on Blox/)
    await click('.pr-watcher-start')
    await until("calls.length===1&&document.querySelector('.pr-watcher-start').textContent.includes('Open watcher')")
    assert.deepEqual(await run('calls[0]'),{method:'pr-watcher.start',args:{pullRequestUrl:'https://github.com/block/alto/pull/42',scope:'pr',sourceCwd:'/Users/test/alto',sourceThreadId:'source-chat'}})
    await click('.pr-watcher-start')
    await until('calls.length===2')
    assert.deepEqual(await run('calls[1]'),{method:'pr-watcher.open',args:{id:'watch-1'}})
    assert.equal(await run("!!document.querySelector('.pr-watcher-controls')"),false,'Source chat must not get watcher controls')
    await closePopover();await run("showThread('watch-chat')");await settle()
    assert.equal(await run("document.querySelector('[role=switch]').getAttribute('aria-checked')"),'false')
    await click('[role=switch]');await settle()
    assert.deepEqual(await run('calls.at(-1)'),{method:'pr-watcher.feedback',args:{id:'watch-1',number:42,enabled:true}})
    assert.equal(await run("document.querySelector('[role=switch]').getAttribute('aria-checked')"),'true')
    await run('setFailure(true)');await click('[role=switch]');await settle()
    assert.equal(await run("document.querySelector('[role=switch]').getAttribute('aria-checked')"),'true','Failed save must preserve the persisted mode')
    assert.match(await run('document.body.innerText'),/could not be saved/)
    await run('setFailure(false)');await click('[aria-label="Pause PR watcher"]');await settle()
    assert.equal(await run('calls.at(-1).method'),'pr-watcher.pause')
    assert.deepEqual(await run('suppressed'),[],'Paused watches do not suppress manual chat completions')
    await click('[aria-label="Resume PR watcher"]');await settle()
    assert.equal(await run('calls.at(-1).method'),'pr-watcher.resume')
    await run("setWatchStatus('working');addAlert()");await settle()
    assert.deepEqual(await run('suppressed'),['watch-chat'])
    assert.equal(await run("document.querySelector('.pr-watcher-latest').textContent"),'Feedback needs attention')
    assert.equal(await run("document.querySelector('.pr-watcher-latest').getAttribute('href')"),'https://github.com/block/alto/pull/42')
    assert.equal(await run('notified.length'),1,'A new review must notify while its agent is working')
    assert.deepEqual(await run('notified[0]'),{id:'alert-1',threadId:'watch-chat',title:'Feedback needs attention',body:'A new review arrived.',tag:'alto-pr-watcher-watch-chat'})
    await run('restartWatcher();addAlert()');await settle()
    assert.equal(await run('notified.length'),1,'Seen notifications must survive plugin reload')
    await run('addForeignAlert()');await settle()
    assert.equal(await run("document.querySelector('.pr-watcher-latest').textContent"),'Feedback needs attention','Other chats do not replace this watch’s latest feedback')
    await run("showThread('unrelated-chat')");await settle()
    assert.equal(await run("!!document.querySelector('.pr-watcher-controls')"),false)

    await run("setScenario('stack')");await settle();await openPopover()
    assert.equal(await run("document.querySelector('.pr-watcher-start').textContent"),'Watch stack on Blox')
    assert.equal(await run("document.querySelectorAll('.pr-watcher-start').length"),1)
    await settle()
    if(process.env.ALTO_PR_WATCHER_ARTIFACT_DIR){
      await fs.mkdir(process.env.ALTO_PR_WATCHER_ARTIFACT_DIR,{recursive:true})
      await fs.writeFile(path.join(process.env.ALTO_PR_WATCHER_ARTIFACT_DIR,'watch-action.png'),(await win.webContents.capturePage()).toPNG())
    }
    await click('.pr-watcher-start');await settle()
    assert.equal(await run('calls[0].args.scope'),'stack')
    await closePopover();await run("showThread('watch-chat')");await settle()
    assert.match(await run('document.body.innerText'),/Notify only/)
    await click('.pr-watcher-feedback summary');await settle()
    await click('[aria-label="Automatically address feedback for PR #42"]');await settle()
    assert.deepEqual(await run('observe().switches.map(s=>s.checked)'),['false','true'])
    assert.match(await run('document.body.innerText'),/1 of 2 automatic/)
    for(const width of [900,360]){
      win.setSize(width,500);await settle()
      const observation=await run('observe()')
      assert.equal(observation.overflow,false,JSON.stringify(observation))
      assert.ok(observation.controls.every(control=>control.width>0&&control.right<=width),JSON.stringify(observation))
      if(process.env.ALTO_PR_WATCHER_ARTIFACT_DIR){
        await fs.mkdir(process.env.ALTO_PR_WATCHER_ARTIFACT_DIR,{recursive:true})
        await fs.writeFile(path.join(process.env.ALTO_PR_WATCHER_ARTIFACT_DIR,'watcher-'+width+'.png'),(await win.webContents.capturePage()).toPNG())
      }
    }
    await run("document.documentElement.dataset.altoTheme='dark'");await settle()
    assert.equal(await run('observe().overflow'),false)
    if(process.env.ALTO_PR_WATCHER_ARTIFACT_DIR)await fs.writeFile(path.join(process.env.ALTO_PR_WATCHER_ARTIFACT_DIR,'watcher-dark-360.png'),(await win.webContents.capturePage()).toPNG())
    await run("setWatchStatus('done')");await settle()
    assert.equal(await run("!!document.querySelector('.pr-watcher-pause')"),false)
    assert.equal(await run("[...document.querySelectorAll('[role=switch]')].every(button=>button.disabled)"),true)
    await run("showThread('source-chat')");await settle();await openPopover()
    await run('removeComponent()');await settle()
    assert.equal(await run("!!document.querySelector('.pr-watcher-start')"),false,'Disabling watcher preserves Git without its action')
    assert.ok(await run("document.querySelectorAll('.git-pane-pr-row').length===2"))
    console.log('PR watcher browser checks passed')
  }finally{win.destroy();await new Promise(resolve=>server.close(resolve))}
}
check().then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1)})
