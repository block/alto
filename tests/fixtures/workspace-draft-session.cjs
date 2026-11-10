const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'workspace-draft-session.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import sessionPlugin from './program/plugins/session.client';
      import composerPlugin from './program/plugins/composer.client';
      import layoutPlugin from './program/plugins/workspace-layout.client';
      import {CONVERSATION_COMPONENT} from './program/plugins/chat-surfaces-api';
      import {initialAgentConfig} from './program/plugins/agent-model-options';
      import {MODEL_DEFAULTS_SET,applyModelDefaultsUpdate} from './program/plugins/model-defaults-api';
      import {WORKSPACE_LAYOUT_READ_METHOD,WORKSPACE_LAYOUT_WRITE_METHOD,parseWorkspaceLayout} from './program/plugins/workspace-layout-state';
      const projects=[{id:'atlas',name:'Atlas',primaryRoot:'/repo/atlas',roots:['/repo/atlas'],source:'manual'},
        {id:'other',name:'Other',primaryRoot:'/repo/other',roots:['/repo/other'],source:'manual'}];
      let saved={version:2,activeViewId:'draft-tab',views:[{id:'draft-tab',name:'Unsent chat',workspace:projects[0].primaryRoot,
        projectId:'atlas',focusedPaneId:'draft-pane',root:{type:'pane',id:'draft-pane',workspace:projects[0].primaryRoot,projectId:'atlas'}}]};
      localStorage.setItem('codex-cordis.workspace-layout',JSON.stringify(saved));
      const efforts=values=>values.map(reasoningEffort=>({reasoningEffort}));
      const models=[{id:'native-one',displayName:'Native One',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:efforts(['low','high'])},
        {id:'native-two',displayName:'Native Two',defaultReasoningEffort:'low',supportedReasoningEfforts:efforts(['low','high'])}];
      let harness={codex:{status:'stopped',models,activeThreadIds:[],threadStates:{},threadSettings:{}},
        program:{revision:1,profileText:'',plugins:[],files:[],tools:[],proposals:[]},projects:{revision:1,projects},
        ui:{regions:[],surfaces:[],contributions:[]},pendingRequests:[],
        extensions:{'session.defaults':{permissionMode:'ask',model:'native-one',effort:'low'},'session.workspace':'/repo/scratch',
          'model-defaults':{providerId:'codex',choices:{codex:{model:'native-one',effort:'low'}}},
          'agent-chats':{providers:[{id:'claude',label:'Claude',agentId:'claude',capabilities:{images:true},configOptions:initialAgentConfig('claude')}],threads:[]}},
        server:{host:'127.0.0.1',port:4317,projectRoot:'/repo/alto'}};
      let hostState={revision:0,connectionEpoch:1,connected:true,connection:'online',snapshot:harness};
      const listeners=new Set(),events=new Set(),calls=[],commands=[],cleanups=[];
      const host={snapshot:()=>hostState,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
        onEvent:fn=>{events.add(fn);return()=>events.delete(fn)},journal:()=>[],programActivated:()=>{},
        command:async(type)=>{commands.push(type);if(type==='thread.list'||type==='skill.list')return [];throw Error('Unexpected process command: '+type)},
        call:async(method,payload)=>{calls.push(method);
          if(method===WORKSPACE_LAYOUT_READ_METHOD)return structuredClone(saved);
          if(method===WORKSPACE_LAYOUT_WRITE_METHOD){saved=parseWorkspaceLayout(payload);return null;}
          if(method===MODEL_DEFAULTS_SET){const next=applyModelDefaultsUpdate(harness.extensions['model-defaults'],payload);
            harness={...harness,extensions:{...harness.extensions,'model-defaults':next}};
            hostState={...hostState,revision:hostState.revision+1,snapshot:harness};for(const fn of listeners)fn();return next;}
          throw Error('Unexpected external operation: '+method);
        }};
      const components=new Map([[CONVERSATION_COMPONENT,()=>null]]),surfaces=new Map();
      const owner={effect:fn=>{const cleanup=fn();if(cleanup)cleanups.push(cleanup);return cleanup}};
      const ui={subscribe:()=>()=>{},snapshot:()=>0,component:id=>components.get(id),renderer:()=>undefined,contributionRenderer:()=>undefined,
        overlays:{open:()=>{},close:()=>{},closeAll:()=>{}},canSubmitDuringTurn:()=>true,
        registerComponent:(_owner,id,component)=>components.set(id,component),registerSurface:(_owner,id,component)=>surfaces.set(id,component),registerSettingsPage:()=>{},
        registerStyle:(_owner,_id,css)=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);cleanups.push(()=>style.remove())}};
      const ctx={...owner,clientHost:host,clientUi:ui,provide:(name,value)=>{ctx[name]=value}};
      const stopSession=sessionPlugin(ctx),factory=ctx.clientSessionFactory;
      let created=0,disposed=0;
      ctx.clientSessionFactory={create:options=>{created++;const handle=factory.create(options);return {session:handle.session,dispose:()=>{disposed++;handle.dispose()}}}};
      composerPlugin(ctx,{});
      ctx.clientComposer.registerAttachmentProvider(owner,{id:'fixture-files',accepts:()=>true,
        upload:async file=>({name:file.name,path:'/fixture/'+file.name,mediaType:file.type,size:file.size})});
      const stopLayout=layoutPlugin(ctx),workspace=ctx.clientWorkspaceLayout;
      workspace.registerPaneKind(owner,{id:'terminal',label:'Terminal',renderer:()=> <button data-fixture-terminal>Terminal placeholder</button>});
      const Layout=surfaces.get('workspace-layout'),root=createRoot(document.getElementById('root'));
      flushSync(()=>root.render(<Layout/>));
      const pane=id=>document.querySelector('[data-workspace-pane-id="'+id+'"]');
      const target=id=>workspace.paneTargets().find(target=>target.paneId===id);
      const read=id=>{const state=target(id)?.session.snapshot(),node=pane(id);return state&&{
        providerId:state.providerId,model:state.session.model,effort:state.session.effort,threadId:state.threadId,
        workspace:state.session.workspace,projectId:state.activeProjectId,text:node?.querySelector('[data-cordis-composer-editor]')?.textContent,
        attachments:[...node?.querySelectorAll('.composer-file')??[]].map(file=>({name:file.querySelector('span').textContent,path:file.title}))}};
      window.inspect=()=>({available:workspace.available(),panes:workspace.paneTargets().map(target=>({id:target.paneId,...read(target.paneId)})),
        saved,created,disposed,calls:[...calls],commands:[...commands],activeKey:ctx.clientSessionRouter.activeKey(),focused:document.activeElement?.closest('[data-workspace-pane-id]')?.dataset.workspacePaneId});
      window.read=read;
      window.rememberSession=id=>{window.rememberedSession=target(id).session};
      window.sameSession=id=>target(id)?.session===window.rememberedSession;
      window.focusPane=id=>flushSync(()=>workspace.focusPane('draft-tab',id));
      window.splitTerminal=()=>flushSync(()=>workspace.splitFocused('horizontal','terminal'));
      window.closeFocused=()=>flushSync(()=>workspace.closeFocusedPane());
      window.addChat=()=>flushSync(()=>workspace.openPane({kind:'chat',direction:'vertical',anchor:{workspaceId:'draft-tab',paneId:'draft-pane'}}));
      window.changeProject=id=>flushSync(()=>target(id).session.selectProject(projects[1]));
      window.attach=(id,name)=>{const transfer=new DataTransfer();transfer.items.add(new File(['Fixture attachment'],name,{type:'text/plain'}));
        const input=pane(id).querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))};
      window.teardown=()=>{flushSync(()=>root.unmount());stopLayout();for(const cleanup of cleanups.reverse())cleanup();stopSession();return {created,disposed,listeners:listeners.size,events:events.size}};
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all([
    'src/client/styles.css', 'program/plugins/ui/appearance-tokens.css', 'program/plugins/ui/default.css',
    'program/plugins/ui/controls.css', 'program/plugins/ui/focus.css', 'program/plugins/theme.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((_request, response) => response.end('<!doctype html><html data-alto-theme="light"><style>' + css + '#root{height:100vh}</style><main id="root"></main></html>'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = code => win.webContents.executeJavaScript(code)
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const until = async expression => {
    for (let index = 0; index < 100; index++) { if (await run(expression)) return; await frames() }
    throw Error('Timed out: ' + expression + '\n' + JSON.stringify(await run('inspect()')))
  }
  const click = async expression => {
    const point = await run(`(()=>{const node=${expression};if(!node)throw Error('Missing click target');node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`)
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    await frames()
  }
  const pane = id => `document.querySelector('[data-workspace-pane-id="${id}"]')`
  const button = label => `([...document.querySelectorAll('.composer-model-picker button')].find(button=>button.textContent.trim()===${JSON.stringify(label)}||button.firstElementChild?.textContent===${JSON.stringify(label)}))`
  const escape = async () => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await frames()
  }
  const enterDraft = async (id, text, filename) => {
    await click(pane(id) + '.querySelector("[data-cordis-composer-editor]")')
    await win.webContents.debugger.sendCommand('Input.insertText', { text })
    await run(`attach(${JSON.stringify(id)},${JSON.stringify(filename)})`)
    await until(`read(${JSON.stringify(id)})?.attachments.length===1`)
  }
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}`)
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await run(bundle.outputFiles[0].text)
    await until('inspect().available&&read("draft-pane")?.projectId==="atlas"')
    await enterDraft('draft-pane', 'First unsent chat', 'first.txt')
    await click(pane('draft-pane') + '.querySelector(".composer-model-trigger")')
    await click(button('Agent')); await click(button('Claude'))
    await click(button('Opus (latest)')); await click(button('Max'))
    await escape()
    const first = await run('read("draft-pane")')
    assert.equal(first.providerId, 'claude')
    assert.equal(first.model, 'opus')
    assert.equal(first.effort, 'max')
    assert.equal(first.threadId, undefined)
    assert.equal(first.text, 'First unsent chat')
    assert.deepEqual(first.attachments, [{ name: 'first.txt', path: '/fixture/first.txt' }])
    await run('rememberSession("draft-pane")')
    const lifetimeBefore = await run('({created:inspect().created,disposed:inspect().disposed})')

    await run('splitTerminal()')
    await until('document.querySelector("[data-fixture-terminal]")&&read("draft-pane")')
    await click('document.querySelector("[data-fixture-terminal]")')
    await click(pane('draft-pane') + '.querySelector("[data-cordis-composer-editor]")')
    const afterTerminal = await run('read("draft-pane")')
    console.log('Unsent chat terminal round-trip ' + JSON.stringify({ before: first, after: afterTerminal, lifetime: await run('({created:inspect().created,disposed:inspect().disposed})') }))
    assert.deepEqual(afterTerminal, first, 'Opening a terminal split and returning preserves the unsent agent, model, effort, text, and attachment')
    assert.equal(await run('sameSession("draft-pane")'), true, 'Reparenting a chat into a terminal split retains its session')
    assert.deepEqual(await run('({created:inspect().created,disposed:inspect().disposed})'), lifetimeBefore)
    await click('document.querySelector("[data-fixture-terminal]")')
    await run('closeFocused()')
    await until('!document.querySelector("[data-fixture-terminal]")&&read("draft-pane")')
    assert.deepEqual(await run('read("draft-pane")'), first, 'Closing a terminal split also preserves the unsent chat')
    assert.equal(await run('sameSession("draft-pane")'), true)
    assert.deepEqual(await run('({created:inspect().created,disposed:inspect().disposed})'), lifetimeBefore)

    const secondPane = (await run('addChat()')).paneId
    await until(`read(${JSON.stringify(secondPane)})`)
    await enterDraft(secondPane, 'Independent second chat', 'second.txt')
    await click(pane(secondPane) + '.querySelector(".composer-model-trigger")')
    await click(button('Native Two')); await click(button('High'))
    await escape()
    const second = await run(`read(${JSON.stringify(secondPane)})`)
    assert.equal(second.providerId, 'codex')
    assert.equal(second.model, 'native-two')
    assert.equal(second.effort, 'high')
    assert.deepEqual(await run('read("draft-pane")'), first, 'A separate new chat cannot replace the first draft agent choices')
    const createdBeforeFocus = await run('inspect().created')
    for (const id of ['draft-pane', secondPane, 'draft-pane', secondPane]) await click(pane(id) + '.querySelector("[data-cordis-composer-editor]")')
    assert.equal(await run('inspect().created'), createdBeforeFocus, 'Focusing existing panes does not create new chat sessions')
    assert.deepEqual(await run('read("draft-pane")'), first)
    assert.deepEqual(await run(`read(${JSON.stringify(secondPane)})`), second)
    await run('splitTerminal()')
    await until('document.querySelector("[data-fixture-terminal]")')
    await click(pane(secondPane) + '.querySelector("[data-cordis-composer-editor]")')
    assert.deepEqual(await run(`read(${JSON.stringify(secondPane)})`), second)
    assert.deepEqual(await run('read("draft-pane")'), first)
    await click('document.querySelector("[data-fixture-terminal]")'); await run('closeFocused()')
    await until('!document.querySelector("[data-fixture-terminal]")')
    assert.deepEqual(await run(`read(${JSON.stringify(secondPane)})`), second)

    await run('changeProject("draft-pane")')
    await until('read("draft-pane").projectId==="other"')
    assert.equal((await run('read("draft-pane")')).workspace, '/repo/other', 'An explicit project change still changes the chat work target')
    assert.equal((await run('read("draft-pane")')).text, first.text)
    assert.deepEqual((await run('read("draft-pane")')).attachments, first.attachments)
    assert.deepEqual(await run(`read(${JSON.stringify(secondPane)})`), second, 'Changing one chat project leaves the other draft independent')
    await run(`focusPane(${JSON.stringify(secondPane)})`)
    const disposedBeforeClose = await run('inspect().disposed')
    await run('closeFocused()')
    await until(`!read(${JSON.stringify(secondPane)})`)
    assert.equal(await run('inspect().disposed'), disposedBeforeClose + 1, 'Closing a chat releases its retained session')
    const observation = await run('inspect()')
    assert.equal(observation.calls.some(method => method.startsWith('agent-chats.')), false, 'Unsent pane navigation does not start an ACP session')
    assert.equal(observation.commands.some(type => !['thread.list', 'skill.list'].includes(type)), false, 'The fixture never starts a model or terminal process')
    const final = await run('teardown()')
    assert.equal(final.created, final.disposed, 'Closing the workspace disposes every owned session')
    assert.equal(final.listeners, 0)
    assert.equal(final.events, 0)
    console.log('Workspace draft session browser checks passed')
  } catch (error) {
    console.error(await run('JSON.stringify(inspect())'))
    throw error
  } finally {
    win.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
