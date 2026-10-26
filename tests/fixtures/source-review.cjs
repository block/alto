const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

async function check() {
  await app.whenReady()
  const staged = process.env.SOURCE_VIM_STAGED
  const plugins = staged ? [{
    name: 'staged-source-review',
    setup(builder) {
      builder.onLoad({ filter: /[/\\]source-[\w.-]+\.(?:ts|tsx|css)$/ }, async args => {
        const candidate = path.resolve(staged, path.basename(args.path))
        try { return { contents: await fs.readFile(candidate, 'utf8'), loader: args.path.endsWith('.css') ? 'text' : 'tsx', resolveDir: path.resolve('program/plugins') } }
        catch (error) { if (error.code !== 'ENOENT') throw error; return undefined }
      })
      builder.onResolve({ filter: /^\.\/source-[\w.-]+\.(?:js|css)$/ }, async args => {
        for (const extension of args.path.endsWith('.css') ? ['.css'] : ['.tsx', '.ts']) {
          const candidate = path.resolve(staged, path.basename(args.path).replace(/\.(?:js|css)$/, extension))
          try { await fs.access(candidate); return { path: candidate } }
          catch (error) { if (error.code !== 'ENOENT') throw error }
        }
        return undefined
      })
    },
  }] : []
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'source-review.tsx', loader: 'tsx', contents: String.raw`
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import sourcePlugin from './program/plugins/source-viewer.client';
      import {sourceViewerResource,parseSourceViewerResource} from './program/plugins/source-viewer-api';
      const kinds=new Map(),cleanup=[],root=createRoot(document.getElementById('root'));
      const layoutListeners=new Set(),sessionListeners={a:new Set(),b:new Set()};
      let active='main',focusedChat='a',layoutState={revision:0},version=1,serial=0;
      let source='const count = 1;\nexport const doubled = count * 2;\nexport const label = "Count";\n'+Array.from({length:30},(_,i)=>'// Context line '+i).join('\n');
      const states={a:{threadId:'thread-a',providerId:'codex',activeProjectId:'project-a',threads:[{id:'thread-a',title:'Implementation'}],session:{workspace:'/repo',model:'test-model',effort:'high'},turn:{tag:'idle'}},b:{threadId:'thread-b',providerId:'codex',activeProjectId:'project-b',threads:[{id:'thread-b',title:'Design review'}],session:{workspace:'/repo',model:'test-model',effort:'high'},turn:{tag:'idle'}}};
      window.requests=[];window.submissions=[];window.sent=[];window.opens=[];window.ensured=[];window.queued=[];window.deferredSubmits=[];
      window.holdStatus=false;window.holdApply=false;window.failNextSend=false;window.deferSubmit=false;window.pendingStatus=[];window.pendingApply=[];
      const proposals=new Map(),prompts=new Map(),delivered=new Set();
      const notifySession=id=>{sessionListeners[id].forEach(listener=>listener());layoutState={revision:layoutState.revision+1};layoutListeners.forEach(listener=>listener())};
      const sessions=Object.fromEntries(Object.keys(states).map(id=>[id,{
        snapshot:()=>states[id],subscribe:listener=>{sessionListeners[id].add(listener);return()=>sessionListeners[id].delete(listener)},
        ensureThread:async workspace=>{window.ensured.push({id,workspace});if(!states[id].threadId){states[id]={...states[id],threadId:'new-thread-'+id};notifySession(id)}return states[id].threadId},
        send:async draft=>{if(window.failNextSend){window.failNextSend=false;throw new Error('Could not send comment')}window.sent.push({id,threadId:states[id].threadId,draft});const editId=prompts.get(draft.text);if(editId)delivered.add(editId)},
        steer:async()=>{throw new Error('Unexpected steer')},
      }]));
      const targets=Object.keys(states).map(id=>({workspaceId:'workspace',paneId:'chat-'+id,session:sessions[id]}));
      const destination=id=>({workspaceId:'workspace',paneId:'chat-'+id,threadId:states[id].threadId,workspace:'/repo'});
      const resources={main:sourceViewerResource({path:'/repo/main.ts',destination:destination('b')}),other:sourceViewerResource({path:'/repo/other.ts',destination:destination('a')}),alias:sourceViewerResource({path:'/repo/link.ts',destination:destination('a')})};
      const documentFor=filePath=>({path:filePath==='/repo/link.ts'?'/repo/main.ts':filePath,name:filePath.split('/').at(-1),source,revision:'rev:'+version,modifiedAt:version,lineCount:source.split('\n').length});
      const host={call:async(method,payload)=>{
        window.requests.push({method,payload});
        if(method==='source-viewer.read')return documentFor(payload.path);
        if(method==='source-edit.start'){
          const id='edit-'+(++serial),lines=source.split('\n'),original=lines.slice(payload.start-1,payload.end).join('\n')+'\n';
          const replacement=original.replace(/\b(count|total|sum)\b/,name=>({count:'total',total:'sum',sum:'value'})[name]);
          proposals.set(id,{id,path:payload.path,revision:payload.revision,start:payload.start,end:payload.end,original,replacement});
          const prompt='Inline edit '+id+'\n'+payload.instruction;
          prompts.set(prompt,id);
          return {id,prompt};
        }
        if(method==='source-edit.status'){
          const result=()=>delivered.has(payload.id)?{status:'ready',proposal:proposals.get(payload.id)}:{status:'pending'};
          if(window.holdStatus)return new Promise(resolve=>window.pendingStatus.push(()=>resolve(result())));
          return result();
        }
        if(method==='source-edit.discard'){proposals.delete(payload.id);return {discarded:true}}
        if(method==='source-edit.apply'){
          const apply=()=>{const proposal=proposals.get(payload.id);source=source.replace(proposal.original,proposal.replacement);version++;return {path:proposal.path,revision:'rev:'+version}};
          if(window.holdApply)return new Promise(resolve=>window.pendingApply.push(()=>resolve(apply())));
          return apply();
        }
        throw new Error('Unexpected request '+method);
      }};
      const markdown={revision:0,codeBlocks:[],fileLinks:[]},explorers={revision:0};
      let fileLink;
      const layout={
        registerPaneKind:(_owner,kind)=>kinds.set(kind.id,kind.renderer),
        paneTargets:()=>[...targets].sort(target=>target.paneId==='chat-'+focusedChat?-1:1),
        snapshot:()=>layoutState,subscribe:listener=>{layoutListeners.add(listener);return()=>layoutListeners.delete(listener)},
        openPane:request=>window.opens.push(request),
      };
      const ui={submit:async(draft,send,options)=>{
          window.submissions.push({draft,mode:options.mode,activeTurn:options.target.activeTurn,target:{id:options.target.id,threadId:options.target.threadId}});
          if(window.deferSubmit){window.deferredSubmits.push(()=>send(draft));return}
          if(options.mode==='queue'&&options.target.activeTurn){window.queued.push({draft,threadId:options.target.threadId});return}
          await send(draft);
        },
        registerStyle:(_owner,_id,css)=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);cleanup.push(()=>style.remove())}};
      const ctx={clientHost:host,clientUi:ui,
        clientMarkdown:{subscribe:()=>()=>{},snapshot:()=>markdown,registerFileLink:(_owner,handler)=>{fileLink=handler}},
        clientCodeExplorer:{subscribe:()=>()=>{},snapshot:()=>explorers},clientWorkspaceLayout:layout};
      const dispose=sourcePlugin(ctx);if(dispose)cleanup.push(dispose);
      const render=()=>flushSync(()=>root.render(<>
        {Object.entries(resources).map(([id,resource])=>{const Pane=kinds.get('source-viewer');return <div key={id} className="test-workspace" data-test-viewer={id} hidden={active!==id}>
          <Pane workspaceId="workspace" pane={{type:'pane',id,kind:'source-viewer',workspace:'/repo',resource}} visible={active===id} focused={active===id}/>
        </div>})}
      </>));
      window.pane=()=>document.querySelector('[data-test-viewer="'+active+'"] .source-viewer-pane');
      window.switchTo=id=>{active=id;render();pane().focus()};
      window.focusChat=id=>flushSync(()=>{focusedChat=id;layoutState={revision:layoutState.revision+1};layoutListeners.forEach(listener=>listener())});
      window.replaceChat=id=>flushSync(()=>{states[id]={...states[id],threadId:'replacement-'+id};sessionListeners[id].forEach(listener=>listener());layoutState={revision:layoutState.revision+1};layoutListeners.forEach(listener=>listener())});
      window.setBusy=(id,busy)=>flushSync(()=>{states[id]={...states[id],turn:{tag:busy?'running':'idle'}};notifySession(id)});
      window.clearChat=id=>flushSync(()=>{states[id]={...states[id],threadId:undefined};notifySession(id)});
      window.deliverQueued=async()=>{for(const item of window.queued.splice(0)){const id=Object.keys(states).find(id=>states[id].threadId===item.threadId);if(!id)throw new Error('Queued chat disappeared');await sessions[id].send(item.draft)}};
      window.releaseDeferred=async()=>{window.deferSubmit=false;for(const send of window.deferredSubmits.splice(0)){try{await send()}catch{}}};
      window.key=(key,modifiers={})=>flushSync(()=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,composed:true,...modifiers})));
      window.focusPane=()=>pane().focus();
      window.cursor=()=>pane().querySelector('.source-viewer-file small')?.textContent;
      window.deepQuery=selector=>{const find=root=>{const match=root.querySelector(selector);if(match)return match;for(const element of root.querySelectorAll('*')){if(element.shadowRoot){const nested=find(element.shadowRoot);if(nested)return nested}}return null};return find(pane())};
      window.visualHighlights=()=>{const first=deepQuery('[data-alto-vim-selection]');return first?[...first.getRootNode().querySelectorAll('[data-alto-vim-selection]')].map(element=>({line:Number(element.parentElement.dataset.line),left:element.style.left,top:element.style.top,width:element.style.width,height:element.style.height})):[]};
      window.deepText=()=>{const collect=root=>root.textContent+[...root.querySelectorAll('*')].filter(element=>element.shadowRoot).map(element=>collect(element.shadowRoot)).join('');return collect(pane())};
      window.openOrigin=id=>{const parent=document.createElement('div');parent.dataset.workspacePaneId='chat-'+id;const origin=document.createElement('a');parent.append(origin);document.body.append(parent);fileLink.open({path:'/repo/opened.ts',line:2,endLine:3},origin);parent.remove();return {...opens.at(-1),location:parseSourceViewerResource(opens.at(-1).resource)}};
      window.selectDestination=id=>flushSync(()=>{const select=pane().querySelector('[aria-label="Destination chat"]');select.value='chat-'+id;select.dispatchEvent(new Event('change',{bubbles:true}))});
      window.bumpSource=()=>{source=source.replace('"Count"','"Changed"');version++};
      window.resolveStatuses=()=>{window.holdStatus=false;window.pendingStatus.splice(0).forEach(resolve=>resolve())};
      window.resolveApplies=()=>{window.holdApply=false;window.pendingApply.splice(0).forEach(resolve=>resolve())};
      window.teardown=()=>{flushSync(()=>root.unmount());for(const dispose of cleanup.reverse())dispose()};
      render();
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', plugins,
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all([
    'src/client/styles.css', 'src/client/pane-toolbar.css', 'program/plugins/ui/default.css', 'program/plugins/theme.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer(async (request, response) => {
    if (request.url?.startsWith('/fonts/')) {
      try { response.end(await fs.readFile(path.join('public/fonts', path.basename(decodeURIComponent(request.url))))); return }
      catch { response.statusCode = 404; response.end(); return }
    }
    response.end('<!doctype html><html data-alto-theme="light" data-alto-code-theme="alto"><style>'+css+'\n#root{height:100vh;display:flex;min-width:0}.test-workspace{display:flex;flex:1;min-height:0;min-width:0}.test-workspace[hidden]{display:none}</style><div id="root"></div>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const window = new BrowserWindow({ show: false, width: 1100, height: 760, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = code => window.webContents.executeJavaScript(code)
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const until = async expression => {
    for(let attempt=0;attempt<100;attempt++){if(await run(expression))return;await frames()}
    throw new Error('Timed out: '+expression)
  }
  const key = async (value, modifiers = {}) => { await run(`key(${JSON.stringify(value)},${JSON.stringify(modifiers)})`);await frames() }
  const click = async selector => { await run(`deepQuery(${JSON.stringify(selector)}).click()`);await frames() }
  const count = method => run(`requests.filter(request=>request.method===${JSON.stringify(method)}).length`)
  const compose = async (text, mode = 'comment') => {
    await run('focusPane()')
    await key(mode==='edit'?'e':'c')
    await until("document.activeElement===pane().querySelector('.source-review-draft textarea')")
    assert.equal(await run(`pane().querySelector('.source-review-modes button:nth-child(${mode==='edit'?2:1})').getAttribute('aria-pressed')`),'true','The keyboard shortcut opens the requested mode')
    await run("pane().querySelector('.source-review-draft textarea').focus()")
    await window.webContents.insertText(text)
    await frames()
  }
  const submit = async () => {
    await run("pane().querySelector('.source-review-draft textarea').focus()")
    await key('Enter',{metaKey:true})
  }
  const artifact = async name => {
    if(!process.env.ALTO_SOURCE_VIM_ARTIFACT_DIR)return
    await fs.mkdir(process.env.ALTO_SOURCE_VIM_ARTIFACT_DIR,{recursive:true})
    await fs.writeFile(path.join(process.env.ALTO_SOURCE_VIM_ARTIFACT_DIR,`source-review-${name}.png`),(await window.webContents.capturePage()).toPNG())
  }
  try {
    await window.loadURL(`http://127.0.0.1:${server.address().port}`)
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    await run(bundle.outputFiles[0].text)
    await until("!!pane().querySelector('.source-viewer-code')")

    const opened=await run("openOrigin('b')")
    assert.deepEqual(opened.anchor,{workspaceId:'workspace',paneId:'chat-b'},'Source opens beside the link origin, even when another chat is focused')
    assert.equal(opened.projectId,'project-b')
    assert.deepEqual(opened.location,{path:'/repo/opened.ts',line:2,endLine:3,destination:{workspaceId:'workspace',paneId:'chat-b',threadId:'thread-b',workspace:'/repo'}})

    await run('focusPane()')
    for(const value of ['g','g','v','j'])await key(value)
    await until("!!deepQuery('[data-alto-vim-selection]')")
    const selectedForEdit=await run('visualHighlights()')
    assert.deepEqual([...new Set(selectedForEdit.map(highlight=>highlight.line))],[1,2],'The edit shortcut regression starts with a multiline character selection')
    await key('e')
    await until("document.activeElement===pane().querySelector('.source-review-draft textarea')")
    assert.equal(await run("pane().querySelector('.source-review-modes button:nth-child(2)').getAttribute('aria-pressed')"),'true','e opens Edit directly for a visual selection')
    assert.deepEqual(await run('visualHighlights()'),selectedForEdit,'Opening Edit preserves the selected source range')
    assert.equal(await run("(()=>{const event=new KeyboardEvent('keydown',{key:'e',bubbles:true,cancelable:true,composed:true});document.activeElement.dispatchEvent(event);return event.defaultPrevented})()"),false,'Typing e in Ask is not intercepted as a source shortcut')
    await window.webContents.insertText('e')
    await frames()
    assert.equal(await run("pane().querySelector('.source-review-draft textarea').value"),'e')
    assert.deepEqual(await run('visualHighlights()'),selectedForEdit,'Typing in Edit retains the selected source range')
    await key('Escape')
    await key('Escape')
    await key('g')
    await key('g')

    await compose('Explain why this starts at one.')
    const composerFont=await run("getComputedStyle(pane().querySelector('.source-review-draft textarea')).fontFamily")
    assert.equal(await run("pane().querySelector('[aria-label=\"Destination chat\"]').value"),'chat-b','The opening chat is initially selected')
    assert.equal(await run("pane().querySelector('.source-review-modes button').getAttribute('aria-pressed')"),'true')
    await run("focusChat('a')")
    await submit()
    await until("!pane().querySelector('.source-review-draft')")
    assert.deepEqual(await run('submissions.at(-1).target'),{id:'workspace:chat-b',threadId:'thread-b'})
    assert.equal(await run('sent.at(-1).id'),'b','Changing chat focus must not reroute a comment')
    assert.match(await run('sent.at(-1).draft.text'),/Explain why this starts at one\.[\s\S]*"path":"\/repo\/main\.ts"[\s\S]*const count = 1;/)
    assert.equal(await run('submissions.at(-1).mode'),'queue')
    await until('!!deepQuery(\'[aria-label="Remove source comment"]\')')
    for(const theme of ['light','dark']) {
      await run(`document.documentElement.dataset.altoTheme=${JSON.stringify(theme)}`)
      for(const width of [1100,390]) {
        window.setContentSize(width,760)
        await frames()
        const annotation=await run("(()=>{const card=deepQuery('.source-review-comment'),body=card.querySelector('p'),remove=card.querySelector('[aria-label=\"Remove source comment\"]'),cardStyle=getComputedStyle(card),removeStyle=getComputedStyle(remove),bounds=card.getBoundingClientRect(),button=remove.getBoundingClientRect();return {font:getComputedStyle(body).fontFamily,background:cardStyle.backgroundColor,backgroundImage:cardStyle.backgroundImage,radius:parseFloat(cardStyle.borderRadius),left:bounds.left,right:bounds.right,height:bounds.height,buttonWidth:button.width,buttonHeight:button.height,buttonRadius:parseFloat(removeStyle.borderRadius),buttonBorder:removeStyle.borderWidth,buttonRight:button.right}})()")
        assert.equal(annotation.font,composerFont,'Slotted comments use the same UI font as Ask instead of inheriting the source code font')
        assert.ok(annotation.background!=='rgba(0, 0, 0, 0)'||annotation.backgroundImage!=='none','The slotted annotation receives its themed surface style')
        assert.ok(annotation.radius>0,'The annotation receives its rounded card style')
        assert.ok(annotation.left>=0&&annotation.right<=width&&annotation.buttonRight<=width,'The comment and its remove control remain visible in narrow panes')
        assert.ok(annotation.height<=(width===390?112:80),'Short comments retain a compact layout')
        assert.equal(annotation.buttonWidth,annotation.buttonHeight,'The remove control is circular')
        assert.ok(annotation.buttonRadius>=annotation.buttonWidth/2,'The remove control does not fall back to a square browser button')
        assert.equal(annotation.buttonBorder,'0px','The remove control does not have the default browser border')
        await artifact(`sent-comment-${theme}-${width}`)
      }
    }
    await run("document.documentElement.dataset.altoTheme='light'")
    window.setContentSize(1100,760)
    await frames()
    await run("deepQuery('[aria-label=\"Remove source comment\"]').focus()")
    await until("getComputedStyle(deepQuery('[aria-label=\"Remove source comment\"]')).opacity==='1'")
    await click('[aria-label="Remove source comment"]')
    assert.equal(await run("!!deepQuery('.source-review-comment')"),false,'Removing a sent comment still dismisses its annotation')

    await compose('Keep this if sending fails.')
    await run("selectDestination('a');window.failNextSend=true")
    await submit()
    await until("pane().querySelector('.source-review-problem')?.textContent==='Could not send comment'")
    assert.equal(await run("pane().querySelector('.source-review-draft textarea').value"),'Keep this if sending fails.')
    await submit()
    await until("!pane().querySelector('.source-review-draft')")
    assert.equal(await run('sent.at(-1).id'),'a','An explicit destination overrides the opening chat')
    await click('[aria-label="Remove source comment"]')
    await run("switchTo('other')")
    await until("!!pane().querySelector('.source-viewer-code')")
    await compose('Other pane')
    assert.equal(await run("pane().querySelector('[aria-label=\"Destination chat\"]').value"),'chat-a')
    await run("selectDestination('b')")
    await key('Escape')
    await run("switchTo('main')")
    await compose('Remember this destination')
    assert.equal(await run("pane().querySelector('[aria-label=\"Destination chat\"]').value"),'chat-a','Destination choices belong to each retained Source pane')
    const beforePicker=await run('cursor()')
    await run("pane().querySelector('[aria-label=\"Destination chat\"]').focus()")
    await key('j')
    assert.equal(await run('cursor()'),beforePicker,'Destination keyboard input must not navigate source')
    await run("pane().querySelector('[aria-label=\"Destination chat\"]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,composed:true}))")
    await frames()
    assert.equal(await run("document.activeElement===pane().querySelector('[aria-label=\"Destination chat\"]')"),true,'Pointer interaction with the picker must retain its focus')
    await run("pane().querySelector('.source-review-draft textarea').focus()")
    await key('Escape')

    const sentBeforeEdit=await run('sent.length')
    const submissionsBeforeEdit=await run('submissions.length')
    await run("setBusy('a',true)")
    await compose('Rename the local count to total.','edit')
    assert.equal(await run("pane().querySelector('[aria-label=\"Request edit\"]')?.disabled"),false)
    await submit()
    await until('!!deepQuery(\'.source-edit-status\')')
    assert.equal(await count('source-edit.start'),1)
    assert.deepEqual(await run("requests.find(request=>request.method==='source-edit.start').payload"),{path:'/repo/main.ts',revision:'rev:1',start:1,end:1,instruction:'Rename the local count to total.',workspace:'/repo',threadId:'thread-a'})
    assert.equal(await run('submissions.length'),submissionsBeforeEdit+1,'An edit submits one request through the normal chat pipeline')
    assert.deepEqual(await run('submissions.at(-1).target'),{id:'workspace:chat-a',threadId:'thread-a'},'The edit uses the exact existing linked conversation')
    assert.equal(await run('submissions.at(-1).mode'),'queue','An edit respects the normal busy-chat queue')
    assert.equal(await run('submissions.at(-1).activeTurn'),true)
    assert.equal(await run('sent.length'),sentBeforeEdit,'A busy chat does not receive an immediate second turn')
    assert.deepEqual(await run('queued.map(item=>item.threadId)'),['thread-a'])
    await artifact('pending')
    await run("focusChat('b');switchTo('other');setBusy('a',false);deliverQueued()")
    await until(`sent.length===${sentBeforeEdit+1}`)
    assert.deepEqual(await run('({id:sent.at(-1).id,threadId:sent.at(-1).threadId})'),{id:'a',threadId:'thread-a'},'Queued edits retain the existing chat context after focus changes')
    assert.equal(await run('sent.at(-1).draft.text'),await run('submissions.at(-1).draft.text'))
    assert.match(await run('sent.at(-1).draft.text'),/^Inline edit edit-1\nRename the local count to total\.$/)
    await run("resolveStatuses();switchTo('main')")
    await until('!!deepQuery(\'.source-edit-accept\')')
    assert.equal(await run('sent.length'),sentBeforeEdit+1,'Polling a proposed edit must not duplicate its chat request')
    assert.equal(await run("deepQuery('.source-edit-accept').disabled"),false)
    await until("deepText().includes('const total = 1;')")

    const palette=await run("(()=>{const host=deepQuery('.source-edit-diff').querySelector('diffs-container'),style=getComputedStyle(host),root=host.shadowRoot;return {addition:style.getPropertyValue('--diffs-addition-base').trim(),deletion:style.getPropertyValue('--diffs-deletion-base').trim(),inserted:style.getPropertyValue('--code-block-diff-inserted').trim(),deleted:style.getPropertyValue('--code-block-diff-deleted').trim(),addedBackground:getComputedStyle(root.querySelector('[data-line-type=change-addition]')).backgroundColor,deletedBackground:getComputedStyle(root.querySelector('[data-line-type=change-deletion]')).backgroundColor}})()")
    assert.equal(palette.addition,palette.inserted,'Inline diffs use the active theme addition color')
    assert.equal(palette.deletion,palette.deleted,'Inline diffs use the active theme deletion color')
    assert.notEqual(palette.addition,palette.deletion)
    assert.notEqual(palette.addedBackground,palette.deletedBackground,'Added and removed lines are visibly distinct')

    const beforeProposal=await run('cursor()')
    for(const selector of ['.source-edit-accept','.source-edit-reject','.source-edit-diff']) {
      assert.equal(await run(`(()=>{const event=new KeyboardEvent('keydown',{key:'j',bubbles:true,cancelable:true,composed:true});deepQuery(${JSON.stringify(selector)}).dispatchEvent(event);return event.defaultPrevented})()`),false,'Proposal interactions must not trigger outer Vim actions')
      assert.equal(await run('cursor()'),beforeProposal)
    }
    assert.equal(await run("(()=>{const clipboardData=new DataTransfer(),event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,composed:true,clipboardData});deepQuery('.source-edit-diff').dispatchEvent(event);return event.defaultPrevented})()"),false,'Copying a proposed diff must not yank the outer source selection')

    for(const width of [1100,390]) {
      window.setContentSize(width,760)
      await frames()
      assert.ok(await run('document.documentElement.scrollWidth')<=width,'The proposed diff must fit narrow panes')
      assert.ok(await run("deepQuery('.source-edit-accept').getBoundingClientRect().right")<=width,'Accept remains visible in narrow panes')
      await artifact(`proposal-${width}`)
      await compose('Explain this edit.')
      const bounds=await run("(()=>{const composer=pane().querySelector('.source-review-draft').getBoundingClientRect(),button=pane().querySelector('[aria-label=\"Send comment\"]').getBoundingClientRect();return {left:composer.left,right:composer.right,buttonWidth:button.width,buttonHeight:button.height}})()")
      assert.ok(bounds.left>=0&&bounds.right<=width,JSON.stringify(bounds))
      assert.equal(bounds.buttonWidth,bounds.buttonHeight,'The send control remains circular')
      await artifact(`composer-${width}`)
      await key('Escape')
    }
    window.setContentSize(1100,760)
    await frames()
    const readsBeforeApply=await count('source-viewer.read')
    await run("window.holdApply=true;const accept=deepQuery('.source-edit-accept');accept.click();accept.click()")
    await until("deepQuery('.source-edit-status')?.textContent.includes('Applying')")
    assert.equal(await count('source-edit.apply'),1,'Double acceptance must apply exactly once')
    await run('resolveApplies()')
    await until("!deepQuery('.source-edit-annotation') && deepText().includes('const total = 1;')")
    assert.equal(await count('source-viewer.read'),readsBeforeApply+1,'Accept reloads the source after applying')

    await compose('Rename this value again.','edit')
    await submit()
    await until('!!deepQuery(\'.source-edit-annotation\')')
    await until('!!deepQuery(\'.source-edit-reject\')')
    await click('.source-edit-reject')
    await until('!deepQuery(\'.source-edit-annotation\')')
    assert.equal(await count('source-edit.apply'),1,'Reject must not apply a proposal')
    assert.equal(await count('source-edit.discard'),1)

    await compose('Propose an edit before an external change.','edit')
    await submit()
    await until('!!deepQuery(\'.source-edit-accept\')')
    assert.equal(await run("deepQuery('.source-edit-accept').disabled"),false,'A fresh proposal starts as acceptable')
    await run('bumpSource()')
    await click('[aria-label="Reload source file"]')
    await until("!!deepQuery('.source-edit-annotation') && deepQuery('.source-edit-accept').disabled")
    assert.match(await run("deepQuery('.source-edit-annotation').textContent"),/file has changed/)
    await click('.source-edit-reject')
    await until('!deepQuery(\'.source-edit-annotation\')')

    await run("switchTo('alias')")
    await until("pane().querySelector('.source-viewer-file').title==='/repo/main.ts'")
    await compose('A comment from a symlink-opened file.')
    await submit()
    await until("!pane().querySelector('.source-review-draft') && deepText().includes('A comment from a symlink-opened file.')")
    await compose('Rename the linked file value.','edit')
    await submit()
    await until("!!deepQuery('.source-edit-accept')")
    const aliasReads=await count('source-viewer.read')
    await click('.source-edit-accept')
    await until("!deepQuery('.source-edit-annotation') && deepText().includes('const sum = 1;')")
    assert.equal(await count('source-viewer.read'),aliasReads+1,'Accept reloads symlink-opened files using the canonical document identity')
    await run("switchTo('main')")
    await click('[aria-label="Reload source file"]')
    await until("deepText().includes('const sum = 1;')")

    const sentBeforeFailure=await run('sent.length')
    const discardedBeforeFailure=await count('source-edit.discard')
    await compose('Keep this edit request if chat delivery fails.','edit')
    await run('window.failNextSend=true')
    await submit()
    await until("pane().querySelector('.source-review-problem')?.textContent==='Could not send comment'")
    assert.equal(await run("pane().querySelector('.source-review-draft textarea').value"),'Keep this edit request if chat delivery fails.')
    assert.equal(await count('source-edit.discard'),discardedBeforeFailure+1,'Failed chat delivery discards the prepared edit job')
    assert.equal(await run('sent.length'),sentBeforeFailure)
    assert.equal(await run("!!deepQuery('.source-edit-annotation')"),false,'Failed delivery leaves no pending edit annotation')
    await key('Escape')

    // This delays a middleware callback; the actual active-turn queue is exercised above.
    const sentBeforeCancellation=await run('sent.length')
    await run('window.deferSubmit=true')
    await compose('Cancel before delayed middleware delivery.','edit')
    await submit()
    await until("!!deepQuery('.source-edit-status') && !pane().querySelector('.source-review-draft')")
    assert.equal(await run('deferredSubmits.length'),1)
    await click('.source-edit-reject')
    await until("!deepQuery('.source-edit-annotation')")
    await run('releaseDeferred()')
    await frames()
    assert.equal(await run('sent.length'),sentBeforeCancellation,'A delayed middleware callback must not send an edit after cancellation')

    await run("clearChat('b')")
    await compose('Use this newly linked conversation.','edit')
    await run("selectDestination('b')")
    const sentBeforePromotion=await run('sent.length')
    await submit()
    await until("!!deepQuery('.source-edit-accept')")
    assert.deepEqual(await run('ensured'),[{id:'b',workspace:'/repo'}],'An empty linked chat is promoted once before creating the edit job')
    assert.equal(await run("requests.filter(request=>request.method==='source-edit.start').at(-1).payload.threadId"),'new-thread-b')
    assert.equal(await run('sent.length'),sentBeforePromotion+1)
    assert.deepEqual(await run('({id:sent.at(-1).id,threadId:sent.at(-1).threadId})'),{id:'b',threadId:'new-thread-b'})
    assert.deepEqual(await run("JSON.parse(localStorage.getItem('alto.source-chat.v1:workspace:main'))"),{workspaceId:'workspace',paneId:'chat-b',threadId:'new-thread-b',workspace:'/repo'},'The promoted thread remains bound to this Source pane')
    await click('.source-edit-reject')
    await until("!deepQuery('.source-edit-annotation')")
    await run("switchTo('other');switchTo('main')")

    await compose('Do not reroute me to a replacement conversation.')
    assert.equal(await run("pane().querySelector('[aria-label=\"Destination chat\"]').value"),'chat-b','The promoted destination survives a tab switch')
    await run("replaceChat('b')")
    await until("pane().querySelector('[aria-label=\"Send comment\"]').disabled")
    assert.equal(await run("pane().querySelector('[aria-label=\"Destination chat\"]').selectedOptions[0].textContent"),'Chat unavailable')
    assert.equal(await run("pane().querySelector('.source-review-draft textarea').value"),'Do not reroute me to a replacement conversation.')
    await run('teardown()')
    console.log('Source review browser checks passed')
  } finally {
    window.destroy()
    await new Promise(resolve=>server.close(resolve))
  }
}
check().then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1)})
