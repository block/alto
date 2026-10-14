const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

async function check() {
  await app.whenReady()
  const staged = process.env.ALTO_NOTIFICATIONS_STAGED
  const plugins = staged ? [{
    name: 'staged-chat-notifications',
    setup(builder) {
      builder.onLoad({ filter: /[/\\]chat-notifications\.(?:client\.tsx|css)$/ }, async args => {
        const candidate = path.resolve(staged, path.basename(args.path))
        try {
          return {
            contents: await fs.readFile(candidate, 'utf8'),
            loader: args.path.endsWith('.css') ? 'text' : 'tsx',
            resolveDir: path.resolve('program/plugins'),
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
          return undefined
        }
      })
    },
  }] : []
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'chat-notification-navigation.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import layoutPlugin from './program/plugins/workspace-layout.client';
      import groupsPlugin from './program/plugins/workspace-tab-groups.client';
      import {RoutedSessionService} from './program/plugins/session.client';
      import {ChatNotificationBanner,ChatNotificationsController} from './program/plugins/chat-notifications.client';
      import notificationCss from './program/plugins/chat-notifications.css';
      import {parseWorkspaceLayout} from './program/plugins/workspace-layout-state';

      const thread=id=>({id,title:'Chat '+id,preview:'Chat '+id,cwd:'/repo',createdAt:1,updatedAt:2});
      const threads=['a','b','grouped','sibling','fullscreen'].map(thread);
      const pane=id=>({type:'pane',id:'pane-'+id,kind:'chat',workspace:'/repo',thread:threads.find(t=>t.id===id)});
      const view=id=>({id,name:'Tab '+id,workspace:'/repo',focusedPaneId:'pane-'+id,root:pane(id)});
      let saved={version:2,activeViewId:'a',views:[view('a'),view('b'),{...view('grouped'),groupId:'later'},
        {...view('fullscreen'),focusedPaneId:'pane-sibling',maximizedPaneId:'pane-sibling',root:{
          type:'split',id:'split-fullscreen',direction:'horizontal',ratio:0.5,first:pane('sibling'),second:pane('fullscreen')
        }}],groups:[{id:'later',name:'Later',color:'purple',collapsed:true}]};
      localStorage.setItem('codex-cordis.workspace-layout',JSON.stringify(saved));
      let focused=true,visibility='visible';
      Object.defineProperty(document,'hasFocus',{value:()=>focused});
      Object.defineProperty(document,'visibilityState',{get:()=>visibility});
      window.setWindowState=next=>{
        if(next.focused!==undefined){focused=next.focused;window.dispatchEvent(new Event(focused?'focus':'blur'))}
        if(next.visibility!==undefined){visibility=next.visibility;document.dispatchEvent(new Event('visibilitychange'))}
      };
      window.focusCalls=0;
      window.focus=()=>{window.focusCalls++;window.setWindowState({focused:true,visibility:'visible'})};
      window.notifications=[];
      class FakeNotification extends EventTarget {
        static permission='granted';
        closed=false;
        constructor(title,options){
          super();this.title=title;this.options=options;window.notifications.push(this);
          this.addEventListener('click',event=>this.onclick?.(event));
        }
        close(){this.closed=true;this.onclose?.(new Event('close'))}
      }
      window.Notification=FakeNotification;

      const initial={revision:0,connected:true,session:{workspace:'/repo',permissionMode:'full'},
        projects:[],threads,skills:[],turn:{tag:'idle'},activities:[],history:{tag:'ready',entries:[]},
        harness:{extensions:{},codex:{status:'ready',models:[]},ui:{surfaces:[],contributions:[],regions:[]}}};
      const opened=[];
      const makeSession=()=>{
        let snapshot={...initial};const listeners=new Set();
        const session={snapshot:()=>snapshot,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},
          openThread:async target=>{
            opened.push(target.id);snapshot={...snapshot,revision:snapshot.revision+1,threadId:target.id};
            for(const listener of listeners)listener();
          },selectProject:()=>{},refreshHistory:async()=>{}};
        return {session,dispose:()=>listeners.clear()};
      };
      const router=new RoutedSessionService(makeSession().session);
      let statusSnapshot={revision:0,running:threads.map(t=>t.id),finished:[]};
      const statusListeners=new Set();
      const status={snapshot:()=>statusSnapshot,subscribe:listener=>{statusListeners.add(listener);return()=>statusListeners.delete(listener)},acknowledge:()=>{}};
      const host={subscribe:()=>()=>{},snapshot:()=>({connectionEpoch:1}),call:async(method,payload)=>{
        if(method.endsWith('.read'))return structuredClone(saved);
        if(method.endsWith('.write')){saved=parseWorkspaceLayout(payload);return null}
        throw Error('Unexpected call '+method);
      }};
      const effects=[];
      let Surface,registry;
      const Composer=({session})=><textarea aria-label={'Composer '+session.snapshot().threadId} defaultValue={'Draft '+session.snapshot().threadId}/>;
      const Conversation=({session})=><p>{'Conversation '+session.snapshot().threadId}</p>;
      const ui={subscribe:()=>()=>{},snapshot:()=>0,
        component:id=>id==='chat.composer'?Composer:Conversation,renderer:()=>undefined,contributionRenderer:()=>undefined,
        overlays:{open:()=>{},close:()=>{}},registerSurface:(_owner,_id,renderer)=>{Surface=renderer},
        registerStyle:(_owner,_id,css)=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);effects.push(()=>style.remove())}};
      const ctx={provide:(_name,value)=>{registry=value},effect:fn=>{const dispose=fn();effects.push(dispose);return dispose},
        clientHost:host,clientUi:ui,clientSession:router,clientSessionRouter:router,clientSessionFactory:{create:makeSession}};
      const disposeLayout=layoutPlugin(ctx);
      groupsPlugin({...ctx,clientWorkspaceLayout:registry});
      const notifications=new ChatNotificationsController(status,router,registry);
      const disposeNotifications=notifications.activate();
      const root=createRoot(document.getElementById('root'));
      flushSync(()=>root.render(<><style>{notificationCss}</style><Surface surface={{id:'workspace-layout',kind:'workspace-layout'}}/><ChatNotificationBanner controller={notifications}/></>));
      window.frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.select=id=>flushSync(()=>registry.selectTab(registry.tabs().findIndex(tab=>tab.id===id)));
      window.focusComposer=id=>document.querySelector('[aria-label="Composer '+id+'"]').focus();
      window.complete=id=>{
        statusSnapshot={revision:statusSnapshot.revision+1,running:[...statusSnapshot.running.filter(t=>t!==id),id],finished:statusSnapshot.finished.filter(t=>t!==id)};
        for(const listener of statusListeners)listener();
        statusSnapshot={revision:statusSnapshot.revision+1,running:statusSnapshot.running.filter(t=>t!==id),finished:[...statusSnapshot.finished,id]};
        for(const listener of statusListeners)listener();
      };
      window.clickNotification=()=>window.notifications.at(-1).dispatchEvent(new Event('click',{cancelable:true}));
      window.observe=()=>({
        tabs:registry.tabs(),saved,opened,activeKey:router.activeKey(),threadId:router.snapshot().threadId,
        focusedComposer:document.activeElement?.getAttribute('aria-label'),
        panes:[...document.querySelectorAll('[data-workspace-pane-id]')].map(element=>({id:element.dataset.workspacePaneId,
          visible:element.checkVisibility(),focused:element.classList.contains('is-focused')})),
        groupExpanded:document.querySelector('[data-workspace-group="later"]')?.getAttribute('aria-expanded'),
        notifications:window.notifications.map(notification=>({title:notification.title,body:notification.options.body,closed:notification.closed})),
        banner:document.querySelector('.chat-notification-banner')?.textContent,
        focusCalls:window.focusCalls
      });
      window.teardown=()=>{disposeNotifications();flushSync(()=>root.unmount());disposeLayout?.();router.dispose();for(const dispose of effects.reverse())dispose?.()};
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, plugins,
  })
  const css = (await Promise.all([
    'src/client/styles.css', 'program/plugins/ui/default.css', 'program/plugins/theme.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((_request, response) => response.end(
    '<!doctype html><style>' + css + '#root{height:100vh}textarea{min-height:80px;width:100%}</style><main id="root"></main>',
  ))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const win = new BrowserWindow({ show: false, width: 1100, height: 760, webPreferences: {
    offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false,
  } })
  const run = code => win.webContents.executeJavaScript(code)
  const until = async expression => {
    for (let index = 0; index < 100; index++) {
      if (await run(expression)) return
      await run('frame()')
    }
    throw Error('Timed out: ' + expression + '\n' + JSON.stringify(await run('observe()')))
  }
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    await until('observe().opened.length===5 && observe().threadId==="a"')
    await run('focusComposer("a");window.originalDraft=document.activeElement')
    assert.equal((await run('observe()')).focusedComposer, 'Composer a')
    assert.equal((await run('observe()')).groupExpanded, 'false')

    for (const id of ['b', 'grouped', 'fullscreen']) {
      await run('select("a");focusComposer("a")')
      await until('observe().threadId==="a"')
      const before = await run('observe()')
      assert.equal(before.panes.find(pane => pane.id === 'pane-' + id).visible, false)
      await run(`complete(${JSON.stringify(id)})`)
      await until('!!observe().banner')
      assert.match((await run('observe()')).banner, new RegExp('Chat ' + id))
      assert.equal((await run('observe()')).focusedComposer, 'Composer a', 'A banner does not steal typing focus')
      assert.equal((await run('observe()')).notifications.length, 0, 'Focused Alto uses a clickable in-app banner')
      if (id === 'b') {
        for (const theme of ['light', 'dark']) {
          for (const width of [1100, 360]) {
            win.setContentSize(width, 760)
            await run(`document.documentElement.dataset.altoTheme=${JSON.stringify(theme)}`)
            await run('frame()')
            const metrics = await run(`(()=>{
              const banner=document.querySelector('.chat-notification-banner'),bounds=banner.getBoundingClientRect(),style=getComputedStyle(banner);
              return {left:bounds.left,right:bounds.right,top:bounds.top,bottom:bounds.bottom,tabBarBottom:document.querySelector('.workspace-tabbar').getBoundingClientRect().bottom,width:innerWidth,scroll:document.documentElement.scrollWidth,
                background:style.backgroundColor,font:style.fontFamily,buttons:[...banner.querySelectorAll('button')].map(button=>{
                  const b=button.getBoundingClientRect();return {width:b.width,height:b.height,right:b.right}
                })};
            })()`)
            assert.ok(metrics.left >= 0 && metrics.right <= metrics.width && metrics.scroll <= metrics.width, JSON.stringify(metrics))
            assert.ok(metrics.top >= 0 && metrics.bottom <= metrics.tabBarBottom, 'A banner stays above native-pane content: ' + JSON.stringify(metrics))
            assert.ok(metrics.buttons.every(button => button.width > 0 && button.height > 0 && button.right <= metrics.width), JSON.stringify(metrics))
            if (process.env.ALTO_NOTIFICATIONS_ARTIFACT_DIR) {
              await fs.mkdir(process.env.ALTO_NOTIFICATIONS_ARTIFACT_DIR, { recursive: true })
              await fs.writeFile(path.join(process.env.ALTO_NOTIFICATIONS_ARTIFACT_DIR, `chat-notification-${theme}-${width}.png`),
                (await win.webContents.capturePage({ x: Math.max(0, width - 500), y: 0, width: Math.min(width, 500), height: 220 })).toPNG())
            }
          }
        }
        win.setContentSize(1100, 760)
      }
      await run('document.querySelector(".chat-notification-open").click()')
      await until(`observe().saved.activeViewId===${JSON.stringify(id)} && observe().threadId===${JSON.stringify(id)}`)
      const after = await run('observe()')
      assert.equal(after.tabs.find(tab => tab.active).id, id)
      assert.equal(after.saved.views.find(view => view.id === id).focusedPaneId, 'pane-' + id)
      assert.equal(after.activeKey, id + ':pane-' + id)
      assert.equal(after.tabs.length, 4, 'Clicking a notification reuses its existing tab')
      assert.deepEqual(after.opened, before.opened, 'Navigation does not reopen the chat in a second session')
      assert.ok(after.panes.some(pane => pane.id === 'pane-' + id && pane.visible && pane.focused))
      assert.equal(after.banner, undefined, 'Opening the completed chat dismisses its banner')
      assert.equal(await run('originalDraft.isConnected && originalDraft.value==="Draft a"'), true)
      if (id === 'grouped') assert.equal(after.groupExpanded, 'true', 'The target group expands')
      if (id === 'fullscreen') {
        assert.equal(after.saved.views.find(view => view.id === id).maximizedPaneId, 'pane-fullscreen')
        assert.equal(after.panes.find(pane => pane.id === 'pane-sibling').visible, false)
      }
    }

    await run('select("a");focusComposer("a");complete("b")')
    await until('!!observe().banner')
    await run('document.querySelector(".chat-notification-dismiss").click()')
    await until('!observe().banner')
    assert.equal((await run('observe()')).threadId, 'a', 'Dismissing a banner does not navigate')
    assert.equal((await run('observe()')).tabs.find(tab => tab.active).id, 'a')

    await run('setWindowState({focused:false,visibility:"hidden"});complete("b")')
    await until('observe().notifications.length===1')
    assert.equal((await run('observe()')).banner, undefined, 'Background Alto keeps using native notifications')
    assert.equal((await run('observe()')).notifications[0].body, 'Chat b')
    await run('clickNotification()')
    await until('observe().saved.activeViewId==="b" && observe().threadId==="b"')
    const background = await run('observe()')
    assert.equal(background.activeKey, 'b:pane-b')
    assert.equal(background.tabs.length, 4)
    assert.equal(background.opened.length, 5)
    assert.equal(background.notifications[0].closed, true)
    assert.ok(background.focusCalls > 0)
    await run('teardown()')
    console.log('Chat notification navigation browser checks passed')
  } finally {
    win.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}

check().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
