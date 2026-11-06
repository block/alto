const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'diff-viewer-performance.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {Context} from 'cordis';
      import {ClientUiRegistry} from './src/client/plugin-runtime';
      import appearance from './program/plugins/interface-appearance.client';
      import explorers from './program/plugins/code-explorer.client';
      import fileTree from './program/plugins/file-tree.client';
      import diffViewer from './program/plugins/diff-viewer.client';
      globalThis.__diffPerf={parseCalls:0,parseMs:0,recordsChanged:0,setItems:0,setOptions:0,highlightCalls:0,highlightMs:0,renders:0};
      const context=new Context(),ui=new ClientUiRegistry(),root=createRoot(document.getElementById('root')),fibers=[];
      let visible=false,revision=1;
      const fileCount=80,lineCount=202;
      const patch=Array.from({length:fileCount},(_,file)=>{
        const name='src/file-'+String(file).padStart(3,'0')+'.ts';
        const lines=Array.from({length:lineCount},(_,line)=>{
          const text='export const value_'+file+'_'+line+' = "'+String(file).padStart(3,'0')+' '+('content ').repeat(9)+'"';
          return line===2||line===200?'-'+text+';\\n+'+text+' + "changed";':' '+text+';';
        }).join('\\n');
        return 'diff --git a/'+name+' b/'+name+'\\n--- a/'+name+'\\n+++ b/'+name+'\\n@@ -1,'+lineCount+' +1,'+lineCount+' @@\\n'+lines+'\\n';
      }).join('');
      let documentValue={id:'perf-document',title:'Large review',workspace:'/repo',patch,createdAt:'2026-11-06T12:00:00Z'};
      window.fixtureSize={files:fileCount,lines:fileCount*lineCount,bytes:new TextEncoder().encode(patch).byteLength};
      window.requests=[];window.sent=[];
      const host={call:async(method,payload)=>{requests.push({method,payload});throw new Error('Unexpected local read '+method)}};
      const session={snapshot:()=>({threadId:'chat-a',turn:{tag:'idle'}}),send:async draft=>sent.push(draft),steer:async()=>{}};
      context.provide('clientUi',ui);context.provide('clientHost',host);
      context.provide('clientWorkspaceLayout',{registerPaneKind:()=>{},paneTargets:()=>[{workspaceId:'workspace-a',paneId:'chat-a',focused:false,session}],focusPane:()=>true});
      localStorage.setItem('alto.diff-review-comments.v1:perf-document',JSON.stringify([{
        id:'saved-note',itemId:'perf-document:0:0',path:'src/file-000.ts',side:'additions',start:3,end:3,body:'Saved review note.',createdAt:'2026-11-06T12:00:00Z',
      }]));
      let Content;
      function render(){flushSync(()=>root.render(<div className="fixture-diff" hidden={!visible}><Content document={documentValue} workspaceId="workspace-a" visible={visible} onRefresh={()=>{}}/></div>))}
      window.setVisible=value=>{visible=value;render()};
      window.refreshMetadata=()=>{documentValue={...documentValue,title:'Updated review title'};render()};
      window.refreshPatch=()=>{documentValue={...documentValue,patch:patch.replaceAll('changed','working-tree-refresh')};render()};
      window.changeDocument=()=>{documentValue={...documentValue,id:'perf-document-'+(++revision),patch:patch.replaceAll('changed','revision-'+revision)};render()};
      window.chooseFile=index=>flushSync(()=>document.querySelector('.file-tree-row[title="src/file-'+String(index).padStart(3,'0')+'.ts"]').click());
      window.selectLine=()=>flushSync(()=>__diffHandle.current.setSelectedLines({id:documentValue.id+':0:0',range:{start:3,end:3,side:'additions'}}));
      window.typeDraft=value=>flushSync(()=>{const input=document.querySelector('[aria-label="Review comment"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))});
      window.codeRoots=()=>[...document.querySelectorAll('.diff-viewer-code *')].flatMap(node=>node.shadowRoot?[node.shadowRoot]:[]);
      window.currentItem=index=>__diffHandle.current.getItem(documentValue.id+':0:'+index);
      window.renderedItems=()=>__diffHandle.current.getInstance().getRenderedItems().map(item=>item.id);
      window.captureFiles=()=>{window.retainedFiles=Array.from({length:fileCount},(_,index)=>currentItem(index))};
      window.changedFiles=()=>retainedFiles.map((item,index)=>({metadata:item.fileDiff!==currentItem(index).fileDiff,version:item.version!==currentItem(index).version}));
      window.metrics=()=>({...__diffPerf,scroll:document.querySelector('.diff-viewer-code')?.scrollTop,rendered:__diffHandle.current?.getInstance()?.getRenderedItems().length});
      window.teardown=async()=>{flushSync(()=>root.unmount());for(const fiber of fibers.reverse())await fiber.dispose()};
      (async()=>{for(const plugin of [appearance,explorers,fileTree,diffViewer])fibers.push(await context.plugin(plugin,{}));Content=ui.component('diff.content');render();window.ready=true})().catch(error=>{window.setupError=String(error);console.error(error)});
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{name:'diff-work-metrics',setup(plugin){
      plugin.onLoad({filter:/(?:diff-viewer\.client\.tsx|utils\/parsePatchFiles\.js|components\/CodeView\.js|renderers\/DiffHunksRenderer\.js)$/},async args=>{
        let contents=await fs.readFile(args.path,'utf8');
        if(args.path.endsWith('diff-viewer.client.tsx'))contents=contents.replace('  const resourceCommit = commitRefFromDiffResource(pane.resource)','  globalThis.__diffPerf.renders++;\n  const resourceCommit = commitRefFromDiffResource(pane.resource)').replace('  const viewer = useRef<CodeViewHandle<ReviewComment>>(null)','  const viewer = useRef<CodeViewHandle<ReviewComment>>(null); globalThis.__diffHandle = viewer');
        if(args.path.endsWith('utils/parsePatchFiles.js'))contents=contents.replace('function parsePatchFiles(data, cacheKeyPrefix, throwOnError = false) {','function parsePatchFiles(data, cacheKeyPrefix, throwOnError = false) { globalThis.__diffPerf.parseCalls++; const perfStart=performance.now();').replace('return patches;','globalThis.__diffPerf.parseMs+=performance.now()-perfStart; return patches;');
        if(args.path.endsWith('components/CodeView.js'))contents=contents.replace('setItems(items) {','setItems(items) { globalThis.__diffPerf.setItems++;').replace('setOptions(options) {','setOptions(options) { globalThis.__diffPerf.setOptions++;').replace('item.item = nextItem;','globalThis.__diffPerf.recordsChanged++; item.item = nextItem;');
        if(args.path.endsWith('renderers/DiffHunksRenderer.js'))contents=contents.replace('renderDiffWithHighlighter(diff, highlighter, forcePlainText = false) {','renderDiffWithHighlighter(diff, highlighter, forcePlainText = false) { globalThis.__diffPerf.highlightCalls++; const perfStart=performance.now();').replace('return {\n\t\t\tresult,\n\t\t\toptions\n\t\t};','globalThis.__diffPerf.highlightMs+=performance.now()-perfStart; return {\n\t\t\tresult,\n\t\t\toptions\n\t\t};');
        return{contents,loader:args.path.endsWith('.tsx')?'tsx':'js'};
      });
    }}],
  })
  const css=(await Promise.all(['src/client/styles.css','src/client/pane-toolbar.css','program/plugins/ui/default.css','program/plugins/theme.css'].map(file=>fs.readFile(file,'utf8')))).join('\n').replace(/@import[^;]+;/g,'')
  const server=http.createServer(async(request,response)=>{
    if(request.url?.startsWith('/fonts/')){try{response.end(await fs.readFile(path.join('public/fonts',path.basename(decodeURIComponent(request.url)))));return}catch{response.statusCode=404;response.end();return}}
    response.end('<!doctype html><html data-alto-theme="light"><style>'+css+'\nhtml,body,#root{height:100%;margin:0;overflow:hidden}.fixture-diff{display:flex;height:100%;min-height:0}.fixture-diff[hidden]{display:none}</style><div id="root"></div></html>')
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const win=new BrowserWindow({show:false,width:1100,height:820,webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,backgroundThrottling:false}})
  const run=async code=>{try{return await win.webContents.executeJavaScript(code)}catch(error){throw new Error('Diff fixture failed: '+code,{cause:error})}}
  const frames=()=>run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const until=async expression=>{for(let index=0;index<150;index++){if(await run(expression))return;if(await run('!!window.setupError'))throw new Error(await run('window.setupError'));await frames()}throw new Error('Timed out: '+expression)}
  const capture=async name=>{if(!process.env.ALTO_DIFF_PERF_ARTIFACT_DIR)return;await fs.mkdir(process.env.ALTO_DIFF_PERF_ARTIFACT_DIR,{recursive:true});await fs.writeFile(path.join(process.env.ALTO_DIFF_PERF_ARTIFACT_DIR,name+'.png'),(await win.webContents.capturePage()).toPNG())}
  const measurements={}
  try {
    await win.loadURL('http://127.0.0.1:'+server.address().port)
    await run(bundle.outputFiles[0].text)
    await until('window.ready===true')
    await frames()
    assert.equal(await run('__diffPerf.parseCalls'),0,'A restored hidden diff does not parse its patch')
    await run('setVisible(true)')
    await until("!!document.querySelector('.diff-review-comment')&&codeRoots().some(root=>root.querySelector('[data-line]'))")
    await frames()
    measurements.size=await run('fixtureSize')
    measurements.loaded=await run('metrics()')
    await run('captureFiles();chooseFile(79)')
    await until("renderedItems().includes('perf-document:0:79')")
    await run('chooseFile(0)')
    await until("renderedItems().includes('perf-document:0:0')")
    await frames()
    measurements.files=await run('metrics()')
    await run('selectLine()')
    await until("!!document.querySelector('[aria-label=\"Review comment\"]')")
    await run("window.retainedDraft=document.querySelector('[aria-label=\"Review comment\"]');typeDraft('Keep this unsaved draft.');refreshMetadata();setVisible(false);setVisible(true)")
    await frames()
    assert.equal(await run("retainedDraft===document.querySelector('[aria-label=\"Review comment\"]')&&retainedDraft.value==='Keep this unsaved draft.'"),true,'Metadata, hide and resume preserve the exact review draft')
    for(let index=0;index<20;index++)await run(`typeDraft('Draft ${index}')`)
    measurements.typing=await run('metrics()')
    await run("typeDraft('A new review note.');document.querySelector('.diff-review-draft-actions .primary').click()")
    await until("document.querySelectorAll('.diff-review-comment').length===2")
    await frames()
    measurements.added=await run('metrics()')
    measurements.changed=await run('changedFiles()')
    await capture('annotation-light')
    await run("document.querySelector('.diff-review-comment button').click()")
    await until("document.querySelectorAll('.diff-review-comment').length===1")
    await frames()
    measurements.removed=await run('metrics()')
    await run('refreshPatch()')
    await frames()
    assert.equal(await run("currentItem(79).fileDiff.additionLines.some(line=>line.includes('working-tree-refresh'))"),true,'A working-tree refresh can change bytes while retaining the document id')
    await run('chooseFile(79)')
    await until("renderedItems().includes('perf-document:0:79')&&codeRoots().some(root=>root.textContent.includes('working-tree-refresh'))")
    await run('chooseFile(0)')
    await until("renderedItems().includes('perf-document:0:0')&&document.querySelectorAll('.diff-review-comment').length===1")
    measurements.refreshed=await run('metrics()')
    assert.equal(await run('requests.length'),0,'Supplied snapshots never read local git or files')
    const layout=await run("(()=>{const pane=document.querySelector('.diff-viewer-pane'),code=document.querySelector('.diff-viewer-code'),style=getComputedStyle(code);return{width:pane.getBoundingClientRect().width,scroll:document.documentElement.scrollWidth,radius:style.borderTopLeftRadius,clip:style.clipPath}})()")
    assert.equal(layout.radius,'12px')
    assert.notEqual(layout.clip,'none')
    assert.ok(layout.width<=1100&&layout.scroll<=1100)
    await run("document.querySelector('.diff-viewer-style button:last-child').click();document.documentElement.dataset.altoTheme='dark'")
    await frames()
    await capture('split-dark')
    win.setContentSize(420,820)
    await run("document.querySelector('[aria-label=\"Hide changed files\"]').click()")
    await frames()
    await capture('narrow-dark')
    await run('changeDocument()')
    await until("!!document.querySelector('.diff-viewer-code')&&!document.querySelector('.diff-review-comment')")
    measurements.revision=await run('metrics()')
    console.log('Diff viewer work metrics: '+JSON.stringify(measurements))
    if(process.env.ALTO_DIFF_PERF_ARTIFACT_DIR)await fs.writeFile(path.join(process.env.ALTO_DIFF_PERF_ARTIFACT_DIR,'work-metrics.json'),JSON.stringify(measurements,null,2))
    if(!process.env.ALTO_DIFF_PERF_BASELINE){
      assert.equal(measurements.loaded.parseCalls,1,'Saved review notes reuse one parsed immutable patch')
      assert.ok(measurements.loaded.highlightCalls>0,'Work metrics cover real syntax highlighting')
      assert.equal(measurements.files.parseCalls,1,'Switching files does not parse again')
      assert.ok(measurements.files.highlightCalls-measurements.loaded.highlightCalls<=6,'A file jump highlights the destinations rather than the intervening review')
      assert.equal(measurements.typing.parseCalls,1,'Typing, metadata, and tab visibility do not parse again')
      assert.equal(measurements.typing.highlightCalls,measurements.files.highlightCalls,'Typing does not redo syntax highlighting')
      assert.equal(measurements.added.parseCalls,1,'Adding a note does not parse the patch again')
      assert.equal(measurements.removed.parseCalls,1,'Removing a note does not parse the patch again')
      assert.equal(measurements.added.recordsChanged-measurements.typing.recordsChanged,1,'Adding a note invalidates only its file')
      assert.equal(measurements.removed.recordsChanged-measurements.added.recordsChanged,1,'Removing a note invalidates only its file')
      assert.equal(measurements.removed.setOptions,measurements.loaded.setOptions,'Annotation changes keep the viewer options stable')
      assert.equal(measurements.changed.filter(file=>file.metadata).length,0,'Annotation edits preserve parsed file metadata')
      assert.equal(measurements.changed.filter(file=>file.version).length,1,'Only the annotated file changes its version')
      assert.equal(measurements.refreshed.parseCalls,2,'Changed patch bytes parse once even when the document id stays the same')
      assert.equal(measurements.revision.parseCalls,3,'A new immutable document parses exactly once')
    }
    await run('teardown()')
    console.log('Diff viewer performance browser checks passed')
  }catch(error){await capture('failure');throw error}
  finally{win.destroy();await new Promise(resolve=>server.close(resolve))}
}
check().then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1)})
