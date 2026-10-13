const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

const source = [
  'alpha beta',
  'second line',
  'third line',
  ...Array.from({length: 75}, (_, index) => `const row${index + 4} = 'Source editing keeps long documents scrollable.';`),
].join('\n')

async function check() {
  await app.whenReady()
  const staged = process.env.SOURCE_EDIT_STAGED
  const plugins = staged ? [{
    name: 'staged-source-edit',
    setup(builder) {
      builder.onLoad({filter: /[/\\]source-[\w.-]+\.(?:ts|tsx|css)$/}, async args => {
        const candidate = path.resolve(staged, path.basename(args.path))
        try {
          return {contents: await fs.readFile(candidate, 'utf8'), loader: args.path.endsWith('.css') ? 'text' : 'tsx', resolveDir: path.resolve('program/plugins')}
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
          return undefined
        }
      })
      builder.onResolve({filter: /^\.\/source-[\w.-]+\.(?:js|css)$/}, async args => {
        for (const extension of args.path.endsWith('.css') ? ['.css'] : ['.tsx', '.ts']) {
          const candidate = path.resolve(staged, path.basename(args.path).replace(/\.(?:js|css)$/, extension))
          try { await fs.access(candidate); return {path: candidate} }
          catch (error) { if (error.code !== 'ENOENT') throw error }
        }
        return undefined
      })
    },
  }] : []
  const bundle = await build({
    stdin: {resolveDir: process.cwd(), sourcefile: 'source-edit.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {EditorView} from '@codemirror/view';
      import sourcePlugin from './program/plugins/source-viewer.client';
      import {sourceViewerResource} from './program/plugins/source-viewer-api';
      const source=${JSON.stringify(source)}, kinds=new Map(), cleanup=[];
      const root=createRoot(document.getElementById('root'));
      const resources={main:'/repo/main.ts',other:'/repo/other.ts'}, generations={};
      let active='main',revision=0;
      window.requests=[];window.copied=[];window.inputEvents=[];window.errors=[];window.holdSave=false;window.pendingSave=null;
      window.addEventListener('error',event=>window.errors.push(event.message));
      window.addEventListener('unhandledrejection',event=>window.errors.push(String(event.reason)));
      document.addEventListener('keydown',event=>inputEvents.push({key:event.key,trusted:event.isTrusted}),true);
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied.push(text)},readText:async()=>window.copied.at(-1)||''}});
      const documentFor=(filePath,contents,version)=>({path:filePath,name:filePath.split('/').at(-1),source:contents,modifiedAt:version,lineCount:contents.split('\\n').length,revision:'revision-'+version});
      const files=new Map([
        ['/repo/main.ts',documentFor('/repo/main.ts',source,++revision)],
        ['/repo/other.ts',documentFor('/repo/other.ts','Other pane contents.\\nAnother line.',++revision)],
        ['/repo/new.ts',documentFor('/repo/new.ts','A different file.\\nAnother line.',++revision)],
        ['/repo/crlf.ts',documentFor('/repo/crlf.ts','alpha\\r\\nbeta\\r\\n',++revision)],
      ]);
      window.disk=filePath=>files.get(filePath);
      window.changeDisk=(filePath,contents)=>files.set(filePath,documentFor(filePath,contents,++revision));
      const host={call:async(method,payload)=>{
        requests.push({method,payload:structuredClone(payload)});
        if(method==='source-viewer.read')return structuredClone(files.get(payload.path));
        if(method!=='source-viewer.save')throw new Error('Unexpected request '+method);
        if(window.holdSave)await new Promise(resolve=>{window.pendingSave=()=>{window.pendingSave=null;resolve()}});
        if(files.get(payload.path).revision!==payload.expectedRevision)throw new Error('This file changed on disk. Your unsaved changes are preserved.');
        const saved=documentFor(payload.path,payload.source,++revision);files.set(payload.path,saved);return structuredClone(saved);
      }};
      const markdown={revision:0,codeBlocks:[],fileLinks:[]},explorers={revision:0};
      const ui={registerStyle:(_owner,_id,css)=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);cleanup.push(()=>style.remove())}};
      const ctx={clientHost:host,clientUi:ui,
        clientMarkdown:{subscribe:()=>()=>{},snapshot:()=>markdown,registerFileLink:()=>{}},
        clientCodeExplorer:{subscribe:()=>()=>{},snapshot:()=>explorers},
        clientWorkspaceLayout:{registerPaneKind:(_owner,kind)=>kinds.set(kind.id,kind.renderer),paneTargets:()=>[]}};
      const dispose=sourcePlugin(ctx);if(dispose)cleanup.push(dispose);
      const render=()=>flushSync(()=>root.render(<>
        {Object.entries(resources).map(([id,filePath])=>{const Pane=kinds.get('source-viewer');return <div key={id} className="test-workspace" data-test-viewer={id} hidden={active!==id}>
          <Pane key={generations[id]??0} workspaceId={id} pane={{type:'pane',id,kind:'source-viewer',workspace:'/repo',resource:sourceViewerResource({path:filePath})}} visible={active===id} focused={active===id}/>
        </div>})}
      </>));
      window.pane=()=>document.querySelector('[data-test-viewer="'+active+'"] .source-viewer-pane');
      window.switchTo=id=>{active=id;render()};
      window.changeResource=filePath=>{resources[active]=filePath;render()};
      window.remountPane=()=>{generations[active]=(generations[active]??0)+1;render()};
      window.closeAndReopenPane=()=>{const filePath=resources[active];delete resources[active];render();active='reopened';resources[active]=filePath;render()};
      window.editor=()=>[...pane().querySelectorAll('.cm-editor')].find(element=>element.getBoundingClientRect().height>0);
      window.editorView=()=>editor()?EditorView.findFromDOM(editor()):null;
      window.buffer=()=>editorView()?.state.sliceDoc();
      window.focusEditor=()=>editorView()?.focus();
      window.elementPoint=selector=>{const element=[...pane().querySelectorAll(selector)].find(element=>element.getBoundingClientRect().height>0);if(!element)throw new Error('Missing visible '+selector);const rect=element.getBoundingClientRect();return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)}};
      window.textPoint=position=>{const rect=editorView().coordsAtPos(position);if(!rect)throw new Error('No editor position '+position);return {x:Math.round(rect.left+1),y:Math.round((rect.top+rect.bottom)/2)}};
      window.teardown=()=>{flushSync(()=>root.unmount());for(const dispose of cleanup.reverse())dispose()};
      render();
    `},
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', plugins,
    loader: {'.css': 'text'}, define: {'process.env.NODE_ENV': '"production"'},
  })
  const css = (await Promise.all([
    'src/client/styles.css', 'src/client/pane-toolbar.css', 'program/plugins/ui/default.css', 'program/plugins/theme.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer(async (request, response) => {
    if (request.url?.startsWith('/fonts/')) {
      try { response.end(await fs.readFile(path.join('public/fonts', path.basename(decodeURIComponent(request.url))))); return }
      catch { response.statusCode = 404; response.end(); return }
    }
    response.end('<!doctype html><style>'+css+'\n#root{height:100vh;display:flex;min-width:0}.test-workspace{display:flex;flex:1;min-height:0;min-width:0;container-type:inline-size;container-name:conversation-column}.test-workspace[hidden]{display:none}</style><div id="root"></div>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const window = new BrowserWindow({show: false, width: 1100, height: 760, webPreferences: {offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false}})
  window.webContents.on('console-message',details=>{if(!details.message.includes('Electron Security Warning'))console.error(details.message)});
  const run = code => window.webContents.executeJavaScript(code)
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const until = async expression => {
    for(let attempt=0;attempt<100;attempt++){if(await run(expression))return;await frames()}
    throw new Error('Timed out: '+expression.slice(0,220))
  }
  const key = async (value, modifiers = []) => {
    if (/^[A-Z]$/.test(value)) modifiers = [...modifiers, 'shift']
    window.webContents.sendInputEvent({type:'keyDown',keyCode:value,modifiers})
    window.webContents.sendInputEvent({type:'keyUp',keyCode:value,modifiers})
    await frames()
  }
  const keys = async values => { for (const value of values) await key(value) }
  const type = async text => { await window.webContents.insertText(text); await frames() }
  const click = async point => {
    window.webContents.sendInputEvent({type:'mouseMove',...point})
    await frames()
    window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point})
    await frames()
    window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point})
    await frames()
  }
  const drag = async (start, end) => {
    window.webContents.sendInputEvent({type:'mouseMove',...start})
    await frames()
    window.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...start})
    await frames()
    for(let step=1;step<=8;step++) {
      window.webContents.sendInputEvent({type:'mouseMove',button:'left',modifiers:['leftButtonDown'],x:Math.round(start.x+(end.x-start.x)*step/8),y:Math.round(start.y+(end.y-start.y)*step/8)})
      await frames()
    }
    window.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...end})
    await frames()
  }
  const clickButton = async label => click(await run(`elementPoint('[aria-label=${JSON.stringify(label)}]')`))
  const enterEditor = async () => {
    if (!await run('!!editor()')) await clickButton('Edit file')
    await until('!!editor()')
    await run('focusEditor()')
    await frames()
  }
  const ex = async command => {
    await key(':')
    await until("!!editor().querySelector('.cm-vim-panel input')")
    await type(command)
    await key('Enter')
    await frames()
  }
  const save = async () => {
    await key('s',['meta'])
    await until("!pane().textContent.includes('Saving')")
    await frames()
  }
  const artifact = async name => {
    if(!process.env.ALTO_SOURCE_EDIT_ARTIFACT_DIR)return
    await fs.mkdir(process.env.ALTO_SOURCE_EDIT_ARTIFACT_DIR,{recursive:true})
    await fs.writeFile(path.join(process.env.ALTO_SOURCE_EDIT_ARTIFACT_DIR,`source-edit-${name}.png`),(await window.webContents.capturePage()).toPNG())
  }
  try {
    await window.loadURL(`http://127.0.0.1:${server.address().port}`)
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    await run(bundle.outputFiles[0].text)
    await until("!!pane().querySelector('.source-viewer-code')")
    await run('pane().focus()')
    await key('i')
    await until('!!editor()')
    await type('draft ')
    await key('Escape')
    assert.equal(await run('buffer()'),'draft '+source,'i switches from review to a writable Vim insert buffer')
    assert.ok(await run("inputEvents.some(event=>event.key==='i'&&event.trusted)"),'Editing uses real browser keyboard events')
    await key('u')
    assert.equal(await run('buffer()'),source,'Vim undo restores the original text')
    await key('r',['control'])
    assert.equal(await run('buffer()'),'draft '+source,'Vim Ctrl+r restores the edit')
    await keys(['g','g','y','y','P'])
    assert.equal(await run('buffer()'),'draft alpha beta\ndraft '+source,'Vim linewise yank and paste work in the editable buffer')
    await key('u')
    assert.equal(await run('buffer()'),'draft '+source)
    await keys(['g','g','0','x'])
    assert.equal(await run('buffer()'),'raft '+source,'Normal-mode deletion edits the document')
    await key('u')
    assert.equal(await run('buffer()'),'draft '+source)
    await keys(['g','g','0','c','w'])
    await type('changed')
    await key('Escape')
    assert.equal(await run('buffer()'),'changed '+source,'The change operator edits source instead of opening a review comment')
    assert.ok(!await run("!!pane().querySelector('.source-review-draft')"))
    await save()
    await until("disk('/repo/main.ts').source==='changed '+"+JSON.stringify(source))
    assert.equal(await run("requests.filter(request=>request.method==='source-viewer.save').at(-1).payload.expectedRevision"),'revision-1','Saving uses the revision that was loaded')
    assert.ok(await run("pane().textContent.includes('Saved')"),'The editor reports a successful save')

    await keys(['g','g','0','i'])
    await type('pending ')
    await key('Escape')
    await run('holdSave=true')
    await key('s',['meta'])
    await until('!!pendingSave')
    const savingText=await run('buffer()')
    await keys(['A'])
    await type(' later')
    await key('Escape')
    const laterText=await run('buffer()')
    assert.notEqual(laterText,savingText)
    await run('holdSave=false;pendingSave()')
    await until("!pane().textContent.includes('Saving')")
    assert.equal(await run("disk('/repo/main.ts').source"),savingText,'The completed save writes the snapshot requested before later typing')
    assert.equal(await run('buffer()'),laterText,'A save response must not overwrite typing made while the request was in flight')
    assert.ok(await run("pane().textContent.includes('Unsaved changes')"),'Typing during an in-flight save remains dirty')
    const savedRevision=await run("disk('/repo/main.ts').revision")
    await save()
    assert.equal(await run("disk('/repo/main.ts').source"),laterText)
    assert.equal(await run("requests.filter(request=>request.method==='source-viewer.save').at(-1).payload.expectedRevision"),savedRevision,'The next save uses the revision returned by the previous one')

    await keys(['g','g','0'])
    await click(await run('textPoint(2)'))
    await key('i')
    await type('mouse ')
    await key('Escape')
    const mouseDraft=await run('buffer()')
    assert.equal(mouseDraft.slice(0,8),'pemouse ','Clicking text positions the insertion cursor accurately')
    await clickButton('Save file')
    await until("disk('/repo/main.ts').source==="+JSON.stringify(mouseDraft))
    await run('focusEditor()')
    await keys(['g','g','0','i'])
    await type('command ')
    await key('Escape')
    const commandDraft=await run('buffer()')
    await ex('w')
    await until("disk('/repo/main.ts').source==="+JSON.stringify(commandDraft))
    await until("!editor().querySelector('.cm-vim-panel input')")

    await keys(['g','g','0','i'])
    await type('retained ')
    await key('Escape')
    const retainedDraft=await run('buffer()')
    assert.ok(await run("!pane().querySelector('[aria-label=\"Reload source file\"]') || pane().querySelector('[aria-label=\"Reload source file\"]').disabled"),'Editing cannot reload over an unsaved draft')
    await clickButton('Discard changes')
    await until("!!pane().querySelector('[role=alertdialog]')")
    assert.equal(await run('buffer()'),retainedDraft,'Opening discard confirmation keeps the current edit visible')
    await key('Escape')
    await until("!pane().querySelector('[role=alertdialog]')")
    assert.equal(await run('buffer()'),retainedDraft,'Canceling discard preserves the dirty draft')
    await clickButton('Review file')
    await until("!!pane().querySelector('.source-viewer-code')")
    assert.ok(!await run('!!editor()'),'Review mode hides the editor')
    assert.ok(await run("pane().querySelector('[aria-label=\"Reload source file\"]').disabled"),'Review cannot reload over its retained unsaved draft')
    await enterEditor()
    assert.equal(await run('buffer()'),retainedDraft,'Reviewing the saved source preserves the unsaved draft')
    await run("switchTo('other')")
    await until("pane().querySelector('.source-viewer-file')?.title==='/repo/other.ts'")
    await enterEditor()
    await key('i')
    await type('other draft ')
    await key('Escape')
    assert.equal(await run('buffer()'),'other draft Other pane contents.\nAnother line.')
    await drag(await run('textPoint(0)'),await run('textPoint(5)'))
    const selected=await run('({from:editorView().state.selection.main.from,to:editorView().state.selection.main.to,text:buffer()})')
    assert.ok(selected.to>selected.from,'Dragging editable source selects text')
    await key('c')
    await type('mouse')
    await key('Escape')
    assert.equal(await run('buffer()'),selected.text.slice(0,selected.from)+'mouse'+selected.text.slice(selected.to),'A mouse selection can be changed with Vim and ordinary text input')

    await run("switchTo('main')")
    await enterEditor()
    assert.equal(await run('buffer()'),retainedDraft,'Hiding and showing a pane preserves its edited buffer')
    await run("changeResource('/repo/new.ts')")
    await until("pane().querySelector('.source-viewer-file')?.title==='/repo/new.ts'")
    await enterEditor()
    assert.equal(await run('buffer()'),'A different file.\nAnother line.')
    await key('i')
    await type('new draft ')
    await key('Escape')
    await clickButton('Review file')
    await until("!editor()")
    await run('pane().focus()')
    await save()
    assert.equal(await run("disk('/repo/new.ts').source"),'new draft A different file.\nAnother line.','Cmd+S can save a retained draft while reviewing the saved file')
    await run("changeResource('/repo/main.ts')")
    await until("pane().querySelector('.source-viewer-file')?.title==='/repo/main.ts'")
    await enterEditor()
    assert.equal(await run('buffer()'),retainedDraft,'Opening another file and returning retains the first file draft')
    await key('u')
    assert.equal(await run('buffer()'),commandDraft,'Per-file editor history survives file navigation')
    await key('r',['control'])
    assert.equal(await run('buffer()'),retainedDraft)

    await run('remountPane()')
    await until('!!editor()')
    assert.equal(await run('buffer()'),retainedDraft,'A remounted pane recovers its dirty draft')

    for(const width of [1100,390]) {
      window.setContentSize(width,760)
      await frames()
      const metrics=await run("(()=>{const paneRect=pane().getBoundingClientRect(),toolbar=pane().querySelector('.source-viewer-toolbar').getBoundingClientRect(),title=pane().querySelector('.source-viewer-file').getBoundingClientRect(),actions=pane().querySelector('.source-viewer-actions').getBoundingClientRect(),save=pane().querySelector('[aria-label=\"Save file\"]').getBoundingClientRect(),editorRect=editor().getBoundingClientRect();return {toolbar:toolbar.height,titleWidth:title.width,actionsRight:actions.right,saveRight:save.right,scroll:document.documentElement.scrollWidth,editorTop:editorRect.top,editorBottom:editorRect.bottom,paneBottom:paneRect.bottom}})()")
      assert.ok(metrics.titleWidth>20 && metrics.actionsRight<=width-160+3 && metrics.saveRight<=width && metrics.scroll<=width && metrics.editorBottom<=metrics.paneBottom+1,JSON.stringify(metrics))
      await artifact(String(width))
    }

    await run("changeResource('/repo/crlf.ts')")
    await until("pane().querySelector('.source-viewer-file')?.title==='/repo/crlf.ts'")
    await enterEditor()
    assert.equal(await run('buffer()'),'alpha\nbeta\n')
    await key('o')
    await type('between')
    await key('Enter')
    await type('next')
    await key('Escape')
    assert.equal(await run('editorView().state.doc.lines'),5,'Opening lines and Enter create real editor lines for CRLF files')
    await ex('wq')
    await until("!editor() && !!pane().querySelector('.source-viewer-code')")
    assert.equal(await run("disk('/repo/crlf.ts').source"),'alpha\r\nbetween\r\nnext\r\nbeta\r\n','Vim editing and save preserve Windows line endings')
    await run("changeResource('/repo/main.ts')")
    await until("pane().querySelector('.source-viewer-file')?.title==='/repo/main.ts'")
    await enterEditor()

    await run('closeAndReopenPane()')
    await until('!!editor()')
    assert.equal(await run('buffer()'),retainedDraft,'Reopening a file in a new pane recovers the closed pane draft')

    await run("changeDisk('/repo/main.ts','A change made outside Alto.')")
    await run('focusEditor()')
    await ex('wq')
    await until("!!pane().querySelector('[role=alert]')")
    assert.ok(await run('!!editor()'),':wq keeps editing when save fails')
    assert.match(await run("pane().querySelector('[role=alert]').textContent"),/changed on disk/)
    assert.equal(await run('buffer()'),retainedDraft,'A revision conflict leaves the complete dirty buffer available')
    assert.equal(await run("disk('/repo/main.ts').source"),'A change made outside Alto.','A conflict never overwrites the newer disk file')
    assert.ok(await run("pane().textContent.includes('Unsaved changes')"))
    await artifact('conflict-390')
    assert.deepEqual(await run('errors'),[],'Editing and review must not report unhandled browser errors')
    await run('teardown()')
    console.log('Source editing browser checks passed')
  } finally {
    window.destroy()
    await new Promise(resolve=>server.close(resolve))
  }
}
check().then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1)})
