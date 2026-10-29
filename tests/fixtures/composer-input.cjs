const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'composer-input.tsx', loader: 'tsx', contents: `
      import React,{useSyncExternalStore} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import composerClient,{ComposerSurface} from './program/plugins/composer.client';
      const root=createRoot(document.getElementById('root')),listeners=new Set(),cleanups=[];
      let state={connected:true,harness:{codex:{status:'ready',models:[]},extensions:{}},projects:[],
        session:{workspace:'/repo',permissionMode:'full'},turn:{tag:'running'},
        skills:[{name:'imagegen',description:'Generate an image',path:'/imagegen',scope:'system'}],
        activities:Array.from({length:150},(_,index)=>({id:String(index),text:'A streamed assistant reply. '.repeat(12)})),
        canAcceptDirectInput:true,projectScope:'unscoped'};
      const session={snapshot:()=>state,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)}};
      const ui=new Proxy({canSubmitDuringTurn:()=>true},{get:(target,key)=>target[key]??(()=>{})});
      let composer,version=0,draft;
      composerClient({clientSession:session,clientUi:ui,clientHost:{},effect:fn=>{const dispose=fn();if(dispose)cleanups.push(dispose);return dispose},provide:(name,value)=>{if(name==='clientComposer')composer=value}},{});
      const preference={autoExpand:false},preferences={snapshot:()=>preference,subscribe:()=>()=>{}};
      const surface={id:'typing',kind:'composer',capabilities:['markdown','skills']};
      const draftStore={read:()=>draft,write:next=>{draft=next}};
      function Background(){const current=useSyncExternalStore(session.subscribe,session.snapshot);return <article>{current.activities.map(row=><p key={row.id}>{row.text}</p>)}</article>}
      window.editor=()=>document.querySelector('[data-cordis-composer-editor]');
      window.mount=text=>{
        draft={message:text,images:[],attachments:[]};window.submitted=[];
        flushSync(()=>root.render(<main><Background/><section className="workspace-pane-composer"><ComposerSurface key={++version}
          surface={surface} session={session} composer={composer} ui={ui} preferences={preferences} draftStore={draftStore} autoFocus={true}
          submitDraft={async(draft,mode)=>{submitted.push({draft,mode})}}/></section></main>));
        const range=document.createRange();range.selectNodeContents(editor());range.collapse(false);
        getSelection().removeAllRanges();getSelection().addRange(range);window.originalEditor=editor();window.inputTimes=[];
      };
      window.publish=()=>{state={...state,activities:state.activities.map((row,index)=>index===149?{...row,text:row.text+' streaming'}:row)};flushSync(()=>{for(const listener of listeners)listener()})};
      let began;
      document.addEventListener('beforeinput',()=>{began=performance.now()},true);
      document.addEventListener('input',()=>{if(began!==undefined){inputTimes.push(performance.now()-began);began=undefined}});
      window.frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.result=()=>({times:inputTimes,draft:draft.message,same:editor()===originalEditor,focused:document.activeElement===editor(),
        height:editor().clientHeight,overflow:document.querySelector('.composer').classList.contains('is-overflowing')});
      window.teardown=()=>{root.unmount();for(const cleanup of cleanups.reverse())cleanup()};
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all([
    'src/client/styles.css', 'program/plugins/ui/default.css', 'program/plugins/workspace-layout.css',
    'program/plugins/ui/appearance-tokens.css', 'program/plugins/ui/controls.css', 'program/plugins/ui/focus.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((_request, response) => response.end('<!doctype html><html data-alto-theme="light"><style>' + css + 'main{height:100vh;display:flex;flex-direction:column}article{flex:1;min-height:0;overflow:auto;padding:24px}article p{margin-block:8px}</style><div class="shell-kernel"><div id="root"></div></div>'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const win = new BrowserWindow({ show: false, width: 1000, height: 800,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = code => win.webContents.executeJavaScript(code)
  const frames = () => run('frames()')
  const command = (method, params) => win.webContents.debugger.sendCommand(method, params)
  const insert = text => command('Input.insertText', { text })
  const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, modifiers })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode, modifiers })
  }
  const retained = async (text, context) => {
    const result = await run('result()')
    assert.equal(result.same && result.focused, true, context + ': native editor and focus survive')
    assert.equal(result.draft, text, context + ': draft preserves its exact Markdown source')
    return result
  }
  const metrics = async () => Object.fromEntries((await command('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]))
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    win.webContents.debugger.attach('1.3')
    await command('Performance.enable', { timeDomain: 'threadTicks' })
    const rich = Array.from({ length: 200 }, (_unused, index) => `Line ${index} with **strong text**, *emphasis*, \`some code\`, [a link](https://example.com), and $imagegen.`).join('\n') + '\nPlain tail '
    const plain = Array.from({ length: 200 }, (_unused, index) => `Line ${index} with ordinary prose that extends far enough to wrap over the next line.`).join('\n') + '\nPlain tail '
    const typed = Array.from({ length: 48 }, (_unused, index) => String.fromCharCode(97 + index % 26)).join('')
    const measurements = []
    for (const [name, text, streaming] of [['short', 'A short draft ', false], ['long-plain', plain, false], ['long-rich', rich, false], ['long-rich-streaming', rich, true]]) {
      await run(`mount(${JSON.stringify(text)});frames()`)
      for (let index = 0; index < 8; index++) await insert('w')
      await run('inputTimes=[];frames()')
      const before = await metrics()
      for (const character of typed) {
        if (streaming) await run('publish()')
        await insert(character)
      }
      await frames()
      const after = await metrics(), result = await retained(text + 'w'.repeat(8) + typed, name)
      assert.equal(result.times.length, typed.length, name + ': each character takes the native input path')
      assert.equal(result.height, name === 'short' ? 31 : 180, name + ': autosizing retains its minimum and maximum')
      assert.equal(result.overflow, name !== 'short', name + ': long drafts retain scrolling')
      const times = [...result.times].sort((a, b) => a - b)
      measurements.push({ name, chars: text.length, p50: times[Math.floor(times.length * .5)], p95: times[Math.floor(times.length * .95)],
        scriptMsPerInput: (after.ScriptDuration - before.ScriptDuration) * 1000 / typed.length,
        taskMsPerInput: (after.TaskDuration - before.TaskDuration) * 1000 / typed.length })
    }
    // Timings diagnose real Chromium input work; correctness never depends on a
    // machine-speed threshold or an implementation-specific render counter.
    console.log('Composer input measurements: ' + JSON.stringify(measurements))
    if (process.env.ALTO_COMPOSER_INPUT_METRICS) await fs.writeFile(process.env.ALTO_COMPOSER_INPUT_METRICS, JSON.stringify(measurements, null, 2))

    await run("mount('**bold** and ordinary text');window.formatted=editor().querySelector('strong');window.tail=editor().lastChild;getSelection().setBaseAndExtent(tail,5,tail,13)")
    for (let index = 0; index < 12; index++) await run('publish()')
    assert.equal(await run('getSelection().anchorNode===tail && getSelection().anchorOffset===5 && getSelection().focusOffset===13'), true, 'Streaming preserves an explicit selection')
    await insert('native')
    await retained('**bold** and native text', 'Native replacement')
    assert.equal(await run('formatted===editor().querySelector("strong")'), true, 'Ordinary typing preserves existing rich-text nodes')
    await run("document.execCommand('undo')")
    await retained('**bold** and ordinary text', 'Native undo')
    await run("document.execCommand('redo')")
    await retained('**bold** and native text', 'Native redo')

    await run('(()=>{const range=document.createRange();range.selectNodeContents(editor());range.collapse(false);getSelection().removeAllRanges();getSelection().addRange(range)})()')
    await insert(' $ima')
    await frames()
    assert.equal(await run('!!document.querySelector(".skill-picker [role=option]")'), true, 'The caret still accounts for hidden Markdown delimiters')
    await key('Tab', 'Tab', 9)
    const chosen = await retained('**bold** and native text $imagegen ', 'Skill insertion after formatted content')
    await key('Enter', 'Enter', 13)
    await frames()
    assert.deepEqual(await run('submitted.map(({draft,mode})=>({text:draft.text,skills:draft.skills.map(skill=>skill.name),mode}))'),
      [{ text: chosen.draft, skills: ['imagegen'], mode: 'queue' }], 'Submission preserves source, selected skills, and submit mode')
    assert.equal((await run('result()')).draft, '', 'Successful submission clears the pane draft')

    await run("mount('Input: ')")
    await command('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 })
    await run('publish()')
    await command('Input.imeSetComposition', { text: '日本', selectionStart: 2, selectionEnd: 2 })
    await insert('日本')
    await retained('Input: 日本', 'Native IME composition')
    assert.equal(await run('submitted.length'), 0, 'Composition does not submit a draft')

    win.setContentSize(360, 800)
    await run("mount('First line')")
    await key('Enter', 'Enter', 13, 8)
    await insert('Second line')
    await frames()
    const multiline = await retained('First line\nSecond line', 'Narrow multiline editing')
    assert.ok(multiline.height > 31 && multiline.height <= 180, 'Newlines resize the editor without changing its limits')
    await run('teardown()')
    console.log('Composer input browser checks passed')
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach()
    win.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
