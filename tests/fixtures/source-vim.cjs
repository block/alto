const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

const source = [
  'alpha beta alpha',
  '  second line',
  '',
  "\tconst café = '🌿';",
  'tail phrase',
  ...Array.from({ length: 135 }, (_, index) => `const row${index + 6} = 'A longer source line for scrolling and reviewing code.';`),
].join('\n')

async function check() {
  await app.whenReady()
  const staged = process.env.SOURCE_VIM_STAGED
  const plugins = staged ? [{
    name: 'staged-source-vim',
    setup(builder) {
      builder.onLoad({ filter: /[/\\]source-[\w.-]+\.(?:ts|tsx|css)$/ }, async args => {
        const candidate = path.resolve(staged, path.basename(args.path))
        try {
          return { contents: await fs.readFile(candidate, 'utf8'), loader: args.path.endsWith('.css') ? 'text' : 'tsx', resolveDir: path.resolve('program/plugins') }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
          return undefined
        }
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
    stdin: { resolveDir: process.cwd(), sourcefile: 'source-vim.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import sourcePlugin from './program/plugins/source-viewer.client';
      import {sourceViewerResource} from './program/plugins/source-viewer-api';
      const source=${JSON.stringify(source)}, kinds=new Map(), cleanup=[];
      const root=createRoot(document.getElementById('root'));
      const resources={main:'/repo/main.ts',other:'/repo/other.ts'};
      let active='main';
      window.requests=[];window.copied=[];window.sourcePointerEvents=[];
      document.addEventListener('pointerup',event=>window.sourcePointerEvents.push({trusted:event.isTrusted}));
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied.push(text)}}});
      const host={call:async(method,payload)=>{
        window.requests.push({method,payload});
        if(method!=='source-viewer.read')throw new Error('Unexpected request '+method);
        const contents=payload.path==='/repo/new.ts'?'A newly opened file.\\nAnother line.':source;
        return {path:payload.path,name:payload.path.split('/').at(-1),source:contents,modifiedAt:1,lineCount:contents.split('\\n').length,revision:payload.path};
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
          <Pane workspaceId={id} pane={{type:'pane',id,kind:'source-viewer',workspace:'/repo',resource:sourceViewerResource({path:filePath})}} visible={active===id} focused={active===id}/>
        </div>})}
      </>));
      window.pane=()=>document.querySelector('[data-test-viewer="'+active+'"] .source-viewer-pane');
      window.switchTo=id=>{active=id;render();pane().focus()};
      window.changeResource=filePath=>{resources[active]=filePath;render()};
      window.key=(key,modifiers={})=>flushSync(()=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...modifiers})));
      window.focusPane=()=>pane().focus();
      window.cursor=()=>pane().querySelector('.source-viewer-file small')?.textContent;
      window.cursorMarker=()=>{for(const element of pane().querySelectorAll('*')){const line=element.shadowRoot?.querySelector('[data-alto-vim-cursor]');if(line)return {line:Number(line.dataset.line),column:line.style.getPropertyValue('--alto-vim-column')}}return null};
      window.deepQuery=selector=>{const direct=pane().querySelector(selector);if(direct)return direct;for(const element of pane().querySelectorAll('*')){const match=element.shadowRoot?.querySelector(selector);if(match)return match}return null};
      window.textPoint=(number,column)=>{const line=deepQuery('[data-line="'+number+'"]'),walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);let remaining=column;for(let text=walker.nextNode();text;text=walker.nextNode()){if(remaining>=text.length){remaining-=text.length;continue}const range=document.createRange();range.setStart(text,remaining);range.setEnd(text,remaining+1);const rect=range.getBoundingClientRect();return {x:Math.round(rect.left+Math.min(2,rect.width/4)),y:Math.round(rect.top+rect.height/2)}}throw new Error('No source text at '+number+':'+column)};
      window.elementPoint=selector=>{const rect=deepQuery(selector).getBoundingClientRect();return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)}};
      window.cursorGeometry=()=>{const line=deepQuery('[data-alto-vim-cursor]');if(!line)return null;const column=Number(cursor().split(',')[1])-1,walker=document.createTreeWalker(line,NodeFilter.SHOW_TEXT);let remaining=column;for(let text=walker.nextNode();text;text=walker.nextNode()){if(remaining>=text.length){remaining-=text.length;continue}const range=document.createRange();range.setStart(text,remaining);range.setEnd(text,remaining+(text.textContent.codePointAt(remaining)>0xffff?2:1));const rect=range.getBoundingClientRect(),bounds=line.getBoundingClientRect();return {expectedX:rect.left-bounds.left,expectedWidth:rect.width,x:parseFloat(line.style.getPropertyValue('--alto-vim-x')),width:parseFloat(line.style.getPropertyValue('--alto-vim-width'))}}return null};
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
    response.end('<!doctype html><style>'+css+'\n#root{height:100vh;display:flex;min-width:0}.test-workspace{display:flex;flex:1;min-height:0;min-width:0}.test-workspace[hidden]{display:none}</style><div id="root"></div>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const window = new BrowserWindow({ show: false, width: 1100, height: 760, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = code => window.webContents.executeJavaScript(code)
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const until = async expression => {
    for(let attempt=0;attempt<100;attempt++){if(await run(expression))return;await frames()}
    throw new Error('Timed out: '+expression)
  }
  const key = async (value, modifiers = {}) => {
    await run(`key(${JSON.stringify(value)},${JSON.stringify(modifiers)})`)
    await frames()
  }
  const keys = async sequence => { for(const value of sequence) await key(value) }
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
  const cursor = async (line, column = 1) => {
    assert.equal(await run('cursor()'),`:${line},${column}`)
    await until(`cursorMarker()?.line===${line}`)
  }
  const command = async (prefix, text, restoreFocus = true) => {
    await key(prefix)
    await until("document.activeElement===pane().querySelector('.source-viewer-command input')")
    await window.webContents.insertText(text)
    window.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'})
    window.webContents.sendInputEvent({type:'char',keyCode:'\r'})
    window.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'})
    await until("!pane().querySelector('.source-viewer-command input')")
    if(restoreFocus)await until('document.activeElement===pane()')
  }
  const artifact = async name => {
    if(!process.env.ALTO_SOURCE_VIM_ARTIFACT_DIR)return
    await fs.mkdir(process.env.ALTO_SOURCE_VIM_ARTIFACT_DIR,{recursive:true})
    await fs.writeFile(path.join(process.env.ALTO_SOURCE_VIM_ARTIFACT_DIR,`source-vim-${name}.png`),(await window.webContents.capturePage()).toPNG())
  }
  try {
    await window.loadURL(`http://127.0.0.1:${server.address().port}`)
    window.webContents.debugger.attach('1.3')
    await window.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    await run(bundle.outputFiles[0].text)
    await until("!!pane().querySelector('.source-viewer-code')")
    await run('focusPane()')
    await cursor(1)
    await keys(['l','3','l','j','k','h'])
    await cursor(1,4)
    await keys(['0','4','j'])
    await cursor(5)
    await keys(['g','g'])
    await cursor(1)
    await keys(['2','0','G'])
    await cursor(20)
    const beforeStep=await run("pane().querySelector('.source-viewer-code').scrollTop")
    await key('j')
    await cursor(21)
    assert.equal(await run("pane().querySelector('.source-viewer-code').scrollTop"),beforeStep,'Ordinary motions within the viewport must not recenter the source')
    await key('G')
    await cursor(source.split('\n').length)

    await keys(['4','G','0'])
    const tabGeometry=await run('cursorGeometry()')
    await key('l')
    await cursor(4,2)
    const afterTabGeometry=await run('cursorGeometry()')
    assert.ok(afterTabGeometry.x-tabGeometry.x>afterTabGeometry.width,'A tab occupies multiple display columns')
    assert.ok(Math.abs(afterTabGeometry.x-afterTabGeometry.expectedX)<1,'The cursor follows the rendered text after a tab')
    const emojiColumn=source.split('\n')[3].indexOf('🌿')
    await keys(['0',...String(emojiColumn),'l'])
    await cursor(4,emojiColumn+1)
    const emojiGeometry=await run('cursorGeometry()')
    assert.ok(Math.abs(emojiGeometry.x-emojiGeometry.expectedX)<1 && Math.abs(emojiGeometry.width-emojiGeometry.expectedWidth)<1,'The block cursor covers the whole emoji glyph')

    await keys(['g','g','v','2','l'])
    assert.equal(await run('pane().dataset.vimMode'),'visual')
    await until("!!deepQuery('[data-alto-vim-selection]')")
    assert.ok(await run("deepQuery('[data-alto-vim-selection]').getBoundingClientRect().width")>0,'Characterwise selection is visibly highlighted')
    await artifact('visual')
    await key('y')
    assert.equal(await run('copied.at(-1)'),'alp','Characterwise visual yank includes the cursor character')
    assert.equal(await run('pane().dataset.vimMode'),'normal')
    await keys(['g','g','V','j'])
    assert.equal(await run('pane().dataset.vimMode'),'visual-line')
    await key('y')
    assert.equal(await run('copied.at(-1)'),'alpha beta alpha\n  second line\n','Linewise visual yank includes complete lines')
    await keys(['g','g','y','w'])
    assert.equal(await run('copied.at(-1)'),'alpha ','The yank operator uses the following word motion')

    await click(await run('textPoint(1,6)'))
    assert.equal(await run('sourcePointerEvents.at(-1)?.trusted'),true,'Source clicks use real browser pointer events')
    await cursor(1,7)
    await until('document.activeElement===pane()')
    await key('l')
    await cursor(1,8)
    await drag(await run('textPoint(1,6)'),await run('textPoint(1,10)'))
    assert.equal(await run('pane().dataset.vimMode'),'visual','Dragging code text enters characterwise visual selection')
    await artifact('mouse-selection')
    assert.equal(await run("(()=>{const clipboardData=new DataTransfer();pane().dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData}));return clipboardData.getData('text/plain')})()"),'beta','Standard copy uses the mouse selection')
    assert.equal(await run('pane().dataset.vimMode'),'visual','Standard copy preserves the selection')
    await key('y')
    assert.equal(await run('copied.at(-1)'),'beta','Mouse-selected text can be yanked without reconstructing the selection with keys')
    await drag(await run('textPoint(1,6)'),await run('textPoint(2,0)'))
    await key('y')
    assert.equal(await run('copied.at(-1)'),'beta alpha\n','Mouse selections ending at the next line preserve the selected newline')

    await drag(await run('textPoint(1,6)'),await run('textPoint(2,8)'))
    await click(await run('elementPoint(\'[aria-label="Comment on selected lines"]\')'))
    await until("document.activeElement===pane().querySelector('.source-review-draft textarea')")
    assert.match(await run("pane().querySelector('.source-review-draft').getAttribute('aria-label')"),/1\D+2/,'The toolbar comments on the lines selected with the mouse')
    await artifact('mouse-comment')
    await key('Escape')
    await until('document.activeElement===pane()')
    await key('Escape')

    await drag(await run('elementPoint(\'[data-column-number="2"]\')'),await run('elementPoint(\'[data-column-number="4"]\')'))
    assert.equal(await run('pane().dataset.vimMode'),'visual-line','Dragging line numbers keeps linewise selection')
    await key('y')
    assert.equal(await run('copied.at(-1)'),source.split('\n').slice(1,4).join('\n')+'\n')

    await click(await run('elementPoint(\'[data-column-number="5"]\')'))
    await cursor(5)
    assert.equal(await run('pane().dataset.vimMode'),'visual-line','A single line-number click is a linewise selection')
    await click(await run("elementPoint('[data-utility-button]')"))
    await until("document.activeElement===pane().querySelector('.source-review-draft textarea')")
    assert.match(await run("pane().querySelector('.source-review-draft').getAttribute('aria-label')"),/Line 5/,'The gutter plus opens a comment for the selected line')
    await key('Escape')
    await until('document.activeElement===pane()')
    await key('Escape')

    await click(await run('elementPoint(\'[aria-label="Wrap long lines"]\')'))
    await until('!!pane().querySelector(\'[aria-label="Stop wrapping long lines"][aria-pressed="true"]\')')
    await click(await run('elementPoint(\'[aria-label="Stop wrapping long lines"]\')'))
    await until('!!pane().querySelector(\'[aria-label="Wrap long lines"][aria-pressed="false"]\')')
    await click(await run('textPoint(1,6)'))
    await cursor(1,7)
    await key('h')
    await cursor(1,6)

    await keys(['5','G','V','2','j','c'])
    await until("document.activeElement===pane().querySelector('.source-review-draft textarea')")
    assert.match(await run("pane().querySelector('.source-review-draft').getAttribute('aria-label')"),/5\D+7/)
    const commentCursor=await run('cursor()')
    await key('j')
    await window.webContents.insertText('j should be ordinary comment text.')
    assert.equal(await run('cursor()'),commentCursor,'Typing in a review comment must not move the Vim cursor')
    assert.equal(await run("pane().querySelector('.source-review-draft textarea').value"),'j should be ordinary comment text.')
    await key('Escape')
    await until("!pane().querySelector('.source-review-draft')")
    await run('focusPane()')

    await key('c')
    await until("document.activeElement===pane().querySelector('.source-review-draft textarea')")
    await window.webContents.insertText('A saved review comment.')
    await key('Enter',{metaKey:true})
    await until("!!deepQuery('[aria-label=\"Remove source comment\"]')")
    const annotationCursor=await run('cursor()')
    assert.equal(await run("(()=>{const event=new KeyboardEvent('keydown',{key:'j',bubbles:true,cancelable:true,composed:true});deepQuery('[aria-label=\"Remove source comment\"]').dispatchEvent(event);return event.defaultPrevented})()"),false,'Annotation buttons keep their keyboard events across the shadow boundary')
    assert.equal(await run('cursor()'),annotationCursor)
    await run("deepQuery('[aria-label=\"Remove source comment\"]').click();focusPane()")

    await keys(['g','g','0'])
    await command('/','alpha')
    await cursor(1,12)
    await key('n')
    await cursor(1,1)
    await key('n')
    await cursor(1,12)
    await command('?','alpha')
    await cursor(1,1)
    await key('n')
    await cursor(1,12)
    await key('N')
    await cursor(1,1)

    await keys(['Escape','g','g'])
    const beforeHalfPage=await run("pane().querySelector('.source-viewer-code').scrollTop")
    await key('d',{ctrlKey:true})
    assert.ok(await run("pane().querySelector('.source-viewer-code').scrollTop")>beforeHalfPage,'Ctrl+d scrolls the viewport from the top of the file')
    await key('f',{ctrlKey:true})
    assert.ok(Number((await run('cursor()')).match(/:(\d+)/)[1])>1,'Ctrl+f moves forward a page instead of awaiting a character find')
    await keys(['7','0','G'])
    const beforeLineScroll=await run("pane().querySelector('.source-viewer-code').scrollTop")
    const lineHeight=await run("parseFloat(getComputedStyle(deepQuery('[data-line]')).lineHeight)")
    await key('3')
    await key('e',{ctrlKey:true})
    assert.ok(Math.abs(await run("pane().querySelector('.source-viewer-code').scrollTop")-beforeLineScroll-lineHeight*3)<=1,'A count with Ctrl+e scrolls the requested number of rows')
    await key('b',{ctrlKey:true})
    assert.ok(Number((await run('cursor()')).match(/:(\d+)/)[1])<70,'Ctrl+b moves backward a page instead of one word')

    await keys(['2','7','G','4','l'])
    await cursor(27,5)
    await run("switchTo('other')")
    await until("!!pane().querySelector('.source-viewer-code')")
    await cursor(1)
    await keys(['1','0','G'])
    await cursor(10)
    await run("switchTo('main')")
    await cursor(27,5)
    assert.equal(await run("requests.filter(request=>request.payload.path==='/repo/main.ts').length"),1,'Revealing a retained pane should not reload or reset its navigation')

    await run("pane().querySelector('[aria-label=\"Vim keyboard shortcuts\"]').click()")
    await until("!!pane().querySelector('[role=dialog][aria-label=\"Vim keyboard shortcuts\"]')")
    assert.match(await run("pane().querySelector('[role=dialog]').textContent"),/Vim navigation/)
    await key('Escape')
    await until("!pane().querySelector('[role=dialog]')")
    await run('focusPane()')
    await command(':','help',false)
    await until("!!pane().querySelector('[role=dialog][aria-label=\"Vim keyboard shortcuts\"]')")
    await key('Escape')
    await until("!pane().querySelector('[role=dialog]')")
    await run('focusPane()')
    await key('Escape')

    for(const width of [1100,390]) {
      window.setContentSize(width,760)
      await frames()
      const metrics=await run("(()=>{const toolbar=pane().querySelector('.source-viewer-toolbar').getBoundingClientRect(),help=pane().querySelector('[aria-label=\"Vim keyboard shortcuts\"]').getBoundingClientRect();return {toolbar:toolbar.height,helpRight:help.right,scroll:document.documentElement.scrollWidth}})()")
      assert.ok(metrics.helpRight<=width && metrics.scroll<=width,JSON.stringify(metrics))
      await artifact(String(width))
      await run("pane().querySelector('[aria-label=\"Vim keyboard shortcuts\"]').click()")
      await until("!!pane().querySelector('[role=dialog]')")
      assert.ok(await run('document.documentElement.scrollWidth')<=width,'Keyboard help must fit narrow panes')
      await artifact(`help-${width}`)
      await key('Escape')
      await until("!pane().querySelector('[role=dialog]')")
    }

    await run('focusPane()')
    await key('Escape')
    await key('V')
    assert.equal(await run('pane().dataset.vimMode'),'visual-line')
    await run("changeResource('/repo/new.ts')")
    await until("pane().querySelector('.source-viewer-file').title==='/repo/new.ts' && !!pane().querySelector('.source-viewer-code')")
    await cursor(1)
    assert.equal(await run('pane().dataset.vimMode'),'normal','Opening another file resets the mode as well as the cursor')
    await run('teardown()')
    console.log('Source Vim browser checks passed')
  } finally {
    window.destroy()
    await new Promise(resolve=>server.close(resolve))
  }
}
check().then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1)})
