const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'viewer-lifetime.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import markdownPlugin from './program/plugins/markdown-viewer.client';
      import sourcePlugin from './program/plugins/source-viewer.client';
      import diffPlugin from './program/plugins/diff-viewer.client';
      import pdfPlugin from './program/plugins/pdf-viewer.client';
      import appearancePlugin from './program/plugins/interface-appearance.client';
      import {sourceViewerResource} from './program/plugins/source-viewer-api';
      const kinds=new Map(),cleanup=[],root=createRoot(document.getElementById('root'));
      const resources={markdown:'/repo/notes.md',source:sourceViewerResource({path:'/repo/main.ts'}),diff:'review:one',pdf:'/repo/report.pdf'};
      const mounted=new Set(Object.keys(resources));
      localStorage.setItem('alto.diff-review-comments.v1:review:one',JSON.stringify([{
        id:'fixture-comment',itemId:'review:one:0:0',path:'main.ts',side:'additions',start:1,end:1,
        body:'Preserved review comment.',createdAt:'2026-10-28T00:00:00Z',
      }]));
      let active='home',version=1;
      window.requests=[];window.held=new Set();window.pending=[];window.native=[];
      const response=(method,payload)=>{
        const filePath=payload.path;
        if(method==='markdown-viewer.read') return {path:filePath,name:filePath.split('/').at(-1),source:'# Notes '+version+'\\n\\n'+Array.from({length:100},(_,i)=>'Paragraph '+i+' keeps the document long enough to scroll.').join('\\n\\n'),modifiedAt:version};
        if(method==='markdown-viewer.write') return {path:filePath,name:filePath.split('/').at(-1),source:payload.source,modifiedAt:++version};
        if(method==='source-viewer.read') return {path:filePath,name:filePath.split('/').at(-1),source:'export const value = '+version+'\\n',modifiedAt:version,lineCount:2,revision:filePath+':'+version};
        if(method==='diff-viewer.read') return {id:payload.resource??payload.commit??'working',title:'Review '+version,workspace:payload.workspace,createdAt:'2026-09-14T12:00:00Z',patch:'diff --git a/main.ts b/main.ts\\n--- a/main.ts\\n+++ b/main.ts\\n@@ -1 +1 @@\\n-old\\n+new'};
        if(method==='diff-viewer.commits') return [];
        if(method==='pdf-viewer.inspect') return {path:filePath,name:filePath.split('/').at(-1),size:100,modifiedAt:version};
        throw new Error('Unexpected request '+method);
      };
      const host={call:(method,payload)=>{
        window.requests.push({method,payload});const value=response(method,payload);
        if(!window.held.has(method))return Promise.resolve(value);
        return new Promise((resolve,reject)=>window.pending.push({method,resolve:()=>resolve(value),reject}));
      }};
      const snapshot={revision:0,codeBlocks:[],fileLinks:[]},explorers={revision:0},layoutSnapshot={revision:0};
      const ui={registerComponent:()=>{},registerRoot:()=>{},overlays:{subscribe:()=>()=>{},nativeViewsOccluded:()=>false,close:()=>{}},
        registerStyle:(_owner,_id,css)=>{const style=document.createElement('style');style.textContent=css;document.head.append(style);cleanup.push(()=>style.remove())}};
      const ctx={clientHost:host,clientUi:ui,clientMarkdown:{subscribe:()=>()=>{},snapshot:()=>snapshot,registerFileLink:()=>{}},
        clientCodeExplorer:{subscribe:()=>()=>{},snapshot:()=>explorers},
        clientWorkspaceLayout:{registerPaneKind:(_owner,kind)=>kinds.set(kind.id,kind.renderer),paneTargets:()=>[],subscribe:()=>()=>{},snapshot:()=>layoutSnapshot},
        clientNativeViews:{available:()=>true,create:async()=>{
          const record={visible:false,destroyed:false,reloads:0};window.native.push(record);
          return {setVisible:value=>{record.visible=value},setBounds:()=>{},focus:()=>{},destroy:async()=>{record.destroyed=true},perform:async action=>{if(action==='reload')record.reloads++}};
        }}};
      for(const plugin of [appearancePlugin,markdownPlugin,sourcePlugin,diffPlugin,pdfPlugin]){const dispose=plugin(ctx);if(dispose)cleanup.push(dispose)}
      const render=()=>flushSync(()=>root.render(<>
        <nav aria-label="Test workspaces">{['home',...Object.keys(resources)].map(id=><button key={id} onClick={()=>window.switchTo(id)}>{id}</button>)}</nav>
        {active==='home'&&<p>Other workspace</p>}
        {[...mounted].map(id=>{const Pane=kinds.get(id+'-viewer');return <div key={id} className="test-workspace" data-test-viewer={id} hidden={active!==id}>
          <Pane workspaceId={id} pane={{type:'pane',id,kind:id+'-viewer',workspace:'/repo',resource:resources[id]}} visible={active===id} focused={active===id}/>
        </div>})}
      </>));
      window.switchTo=id=>{active=id;render()};window.changeResource=(id,resource)=>{resources[id]=resource;render()};
      window.close=id=>{mounted.delete(id);render()};window.open=id=>{mounted.add(id);render()};window.bumpVersion=()=>version++;
      window.resolveRead=method=>{const index=window.pending.findIndex(read=>read.method===method);if(index<0)throw new Error('No pending '+method);window.pending.splice(index,1)[0].resolve()};
      window.rejectRead=method=>{const index=window.pending.findIndex(read=>read.method===method);window.pending.splice(index,1)[0].reject(new Error('Read failed'))};
      window.click=label=>flushSync(()=>document.querySelector('[aria-label="'+label+'"]').click());
      window.teardown=()=>{flushSync(()=>root.unmount());for(const dispose of cleanup.reverse())dispose()};
      render();
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
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
    response.end('<!doctype html><style>'+css+'\n#root{height:100vh;display:flex;flex-direction:column}nav{height:40px;flex:none;display:flex;gap:8px}.test-workspace{display:flex;flex:1;min-height:0;min-width:0}.test-workspace[hidden]{display:none}</style><div id="root"></div>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const window = new BrowserWindow({ show: false, width: 1100, height: 760, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = code => window.webContents.executeJavaScript(code)
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const until = async expression => {
    for(let i=0;i<100;i++){if(await run(expression))return;await frames()}
    throw new Error('Timed out: '+expression)
  }
  const count = method => run(`requests.filter(request=>request.method===${JSON.stringify(method)}).length`)
  try {
    await window.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    await frames()
    assert.equal(await run('requests.length'),0,'Restored hidden viewers should load lazily')
    await run("switchTo('markdown')")
    await until("!!document.querySelector('.markdown-viewer-document')")
    await run("window.editor=document.querySelector('.markdown-viewer-rendered-editor');document.querySelector('.markdown-viewer-scroll').scrollTop=600")
    const scroll = await run("document.querySelector('.markdown-viewer-scroll').scrollTop")
    assert.ok(scroll>0)
    await run("switchTo('home');switchTo('markdown')")
    await frames()
    assert.equal(await count('markdown-viewer.read'),1,'Switching tabs must not reload Markdown')
    assert.equal(await run("editor===document.querySelector('.markdown-viewer-rendered-editor')"),true)
    assert.equal(await run("document.querySelector('.markdown-viewer-scroll').scrollTop"),scroll)

    await run("click('Edit Markdown file');editor.innerHTML='<h1>Unsaved draft</h1>';editor.dispatchEvent(new Event('input',{bubbles:true}));switchTo('home');switchTo('markdown')")
    assert.equal(await run("editor.textContent"),'Unsaved draft')
    assert.equal(await run("!!document.querySelector('[aria-label=\"Finish editing Markdown\"]:not(:disabled)')"),true)
    await run("click('Finish editing Markdown')")
    await until("!!document.querySelector('[aria-label=\"Edit Markdown file\"]')")
    assert.equal(await run("requests.find(request=>request.method==='markdown-viewer.write').payload.source"),'# Unsaved draft\n')
    await run("switchTo('home');switchTo('markdown')")
    await frames()
    assert.equal(await count('markdown-viewer.read'),1)
    await run("bumpVersion();click('Reload Markdown file')")
    await until("document.querySelector('.markdown-viewer-document')?.textContent.includes('Notes 3')")
    assert.equal(await count('markdown-viewer.read'),2)

    for(const [kind,method,selector,reload] of [
      ['source','source-viewer.read','.source-viewer-code','Reload source file'],
      ['diff','diff-viewer.read','.diff-viewer-code','Refresh diff'],
      ['pdf','pdf-viewer.inspect','.pdf-viewer-native-surface','Reload PDF file'],
    ]) {
      await run(`switchTo('${kind}')`)
      await until(`!!document.querySelector('${selector}')`)
      await run(`window.retained=document.querySelector('${selector}');switchTo('home');switchTo('${kind}')`)
      await frames()
      assert.equal(await count(method),1,kind+' should keep its loaded document')
      assert.equal(await run(`retained===document.querySelector('${selector}')`),true,kind+' renderer should stay mounted')
      if(kind==='pdf') {
        assert.equal(await run('native.length'),1)
        assert.equal(await run('native[0].destroyed'),false)
        assert.equal(await run('native[0].visible'),true)
        await run("click('Reload PDF file')")
        assert.equal(await run('native[0].reloads'),1)
      } else {
        await run(`click('${reload}')`)
        await until(`!!document.querySelector('${selector}')`)
        assert.equal(await count(method),2)
      }
    }
    assert.equal(await count('diff-viewer.commits'),2,'Refresh diff should also update the commit choices')

    await run("switchTo('diff')")
    await until("!!document.querySelector('.diff-review-comment')")
    // Pierre slots React annotations from the document DOM, so these must use
    // the app appearance owner rather than the code viewer's shadow CSS.
    const reviewRoles = {
      '--ui-surface': '#eef2f6', '--ui-border': '#203f59', '--ui-text': '#203040',
      '--ui-font': 'monospace', '--ui-size': '14px', '--ui-row-radius': '17px',
      '--ui-danger': '#96283c', '--ui-focus': '#2b4167',
    }
    await run(`for(const [token,value] of Object.entries(${JSON.stringify(reviewRoles)}))document.documentElement.style.setProperty(token,value)`)
    const annotationAppearance = () => run(`(()=>{
      const card=document.querySelector('.diff-review-comment'),button=card.querySelector('button');
      const style=getComputedStyle(card),action=getComputedStyle(button);
      return {document:card.getRootNode()===document,slot:card.parentElement.slot,body:card.querySelector('p').textContent,
        surface:style.backgroundColor,border:style.borderColor,text:style.color,font:style.fontFamily,size:style.fontSize,radius:style.borderRadius,
        danger:button.classList.contains('alto-icon-button')&&button.classList.contains('danger'),
        actionText:action.color,actionFill:action.backgroundColor,outline:action.outlineColor,outlineWidth:action.outlineWidth};
    })()`)
    const annotation = await annotationAppearance()
    assert.deepEqual({ document: annotation.document, slot: annotation.slot, body: annotation.body }, {
      document: true, slot: 'annotation-additions-1', body: 'Preserved review comment.',
    })
    assert.deepEqual([annotation.surface,annotation.border,annotation.text,annotation.font,annotation.size,annotation.radius],
      ['rgb(238, 242, 246)','rgb(32, 63, 89)','rgb(32, 48, 64)','monospace','14px','17px'],
      'Slotted review annotation consumes shared surface, border, text, font, size, and radius roles')
    assert.equal(annotation.danger,true,'Remove action uses the shared destructive icon primitive')
    assert.equal(annotation.actionText,'rgb(150, 40, 60)')
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('DOM.enable')
    await window.webContents.debugger.sendCommand('CSS.enable')
    const documentNode = (await window.webContents.debugger.sendCommand('DOM.getDocument')).root.nodeId
    const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: documentNode, selector: '.diff-review-comment button' })
    const forceAction = states => window.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states })
    await forceAction(['hover'])
    const hovered = await annotationAppearance()
    assert.equal(hovered.actionText,annotation.actionText,'Danger ink persists on hover')
    assert.notEqual(hovered.actionFill,annotation.actionFill,'Shared icon hover is visible')
    await forceAction(['hover','active'])
    const pressed = await annotationAppearance()
    assert.equal(pressed.actionText,annotation.actionText,'Danger ink persists when pressed')
    assert.notEqual(pressed.actionFill,hovered.actionFill,'Shared icon press is distinct from hover')
    await forceAction(['focus-visible'])
    const focused = await annotationAppearance()
    assert.equal(focused.outline,'rgb(43, 65, 103)','Review action consumes the shared focus role')
    assert.equal(focused.outlineWidth,'2px')
    await run("document.querySelector('.diff-review-comment button').disabled=true")
    await forceAction(['hover','active'])
    assert.equal((await annotationAppearance()).actionFill,annotation.actionFill,'Disabled review action ignores hover and press')
    await forceAction([])
    window.webContents.debugger.detach()
    await run("document.querySelector('.diff-review-comment button').disabled=false")
    await run(`for(const token of Object.keys(${JSON.stringify(reviewRoles)}))document.documentElement.style.removeProperty(token)`)

    await run("switchTo('markdown');held.add('markdown-viewer.read');changeResource('markdown','/repo/pending.md');switchTo('home')")
    await until("pending.length===1")
    await run("resolveRead('markdown-viewer.read')")
    await until("document.querySelector('.markdown-viewer-file').title==='/repo/pending.md'")
    const afterPending = await count('markdown-viewer.read')
    await run("switchTo('markdown')")
    await frames()
    assert.equal(await count('markdown-viewer.read'),afterPending,'Returning must reuse a read that finished while hidden')

    await run("changeResource('markdown','/repo/old.md');changeResource('markdown','/repo/new.md');resolveRead('markdown-viewer.read')")
    await frames()
    assert.equal(await run("document.querySelector('.markdown-viewer-document')===null"),true,'An old response must not replace the newer file')
    await run("resolveRead('markdown-viewer.read')")
    await until("document.querySelector('.markdown-viewer-file').title==='/repo/new.md' && !!document.querySelector('.markdown-viewer-document')")
    await run("changeResource('markdown','/repo/failure.md');rejectRead('markdown-viewer.read')")
    await until("!!document.querySelector('.markdown-viewer-error')")
    const failedReads = await count('markdown-viewer.read')
    await run("switchTo('home');switchTo('markdown')")
    assert.equal(await count('markdown-viewer.read'),failedReads)
    await run("held.clear();document.querySelector('.markdown-viewer-error button').click()")
    await until("!!document.querySelector('.markdown-viewer-document')")
    assert.equal(await count('markdown-viewer.read'),failedReads+1)

    for(const theme of ['light','dark']) {
      for(const width of [1100,360]) {
        window.setContentSize(width,760)
        await run(`document.documentElement.dataset.altoTheme='${theme}'`)
        await frames()
        const metrics=await run("(()=>{const toolbar=document.querySelector('.markdown-viewer-toolbar').getBoundingClientRect(),content=document.querySelector('.markdown-viewer-scroll').getBoundingClientRect(),reload=document.querySelector('[aria-label=\"Reload Markdown file\"]').getBoundingClientRect();return {toolbar:toolbar.height,contentTop:content.top,toolbarBottom:toolbar.bottom,reloadRight:reload.right,scroll:document.documentElement.scrollWidth}})()")
        assert.ok(metrics.toolbar<=40 && metrics.contentTop>=metrics.toolbarBottom && metrics.reloadRight<=width && metrics.scroll<=width,JSON.stringify(metrics))
        if(process.env.ALTO_VIEWER_ARTIFACT_DIR) {
          await fs.mkdir(process.env.ALTO_VIEWER_ARTIFACT_DIR,{recursive:true})
          await fs.writeFile(path.join(process.env.ALTO_VIEWER_ARTIFACT_DIR,`markdown-${theme}-${width}.png`),(await window.webContents.capturePage()).toPNG())
        }
      }
    }
    await run("held.add('markdown-viewer.read');changeResource('markdown','/repo/closed.md');close('markdown');resolveRead('markdown-viewer.read')")
    await frames()
    assert.equal(await run("document.querySelector('.markdown-viewer-pane')===null"),true)
    await run("held.clear();open('markdown')")
    await until("!!document.querySelector('.markdown-viewer-document')")
    await run("close('pdf')")
    assert.equal(await run('native[0].destroyed'),true)
    await run('teardown()')
    console.log('Viewer lifetime browser checks passed')
  } finally {
    window.destroy()
    await new Promise(resolve=>server.close(resolve))
  }
}
check().then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1)})
