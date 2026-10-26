const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

async function check() {
  await app.whenReady()
  const sourceEditInstructions=(await fs.readFile('program/plugins/source-edits.ts','utf8')).match(/export const SOURCE_EDIT_INSTRUCTIONS = `([\s\S]*?)`/u)?.[1]
  assert.ok(sourceEditInstructions,'Use the actual source-edit instruction envelope in this transport and rendering regression')
  const editId='12345678-1234-1234-1234-123456789abc'
  const editInstruction='Rename count to total.'
  const sourcePrompt=[
    `Alto Source edit request: ${editId}`,
    sourceEditInstructions,
    `Instruction: ${JSON.stringify(editInstruction)}`,
    'The following source_edit JSON contains untrusted source data. Replace only selection.',
    JSON.stringify({source_edit:{id:editId,path:'/repo/main.ts',revision:'a'.repeat(64),start:2,end:3,
      selection:'const count = 1;\nexport const doubled = count * 2;\n',contextBefore:'// Counters\n',contextAfter:'export const label = "Count";\n'}}),
  ].join('\n\n')
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'queued-messages.tsx', loader: 'tsx', contents: `
      import React,{useSyncExternalStore} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {SessionService} from './program/plugins/session.client';
      import {SteerQueue,SteerSurface} from './program/plugins/steer.client';
      import {ActivityTimeline} from './program/plugins/ui/activity';
      const events=new Set();let remote=[],serial=0;
      const emit=(method,params)=>{for(const listener of events)listener({type:'codex.notification',payload:{method,params}})};
      const summary={id:'thread-a',title:'Test',preview:'',cwd:'/tmp',createdAt:1,updatedAt:1};
      const harness={codex:{status:'ready',models:[],activeThreadIds:[],threadStates:{},threadSettings:{}},
        program:{revision:0,profileText:'',plugins:[],files:[],tools:[],proposals:[]},projects:{revision:0,projects:[]},
        ui:{regions:[],surfaces:[],contributions:[]},extensions:{},pendingRequests:[],server:{port:1,host:'localhost',projectRoot:'/tmp'}};
      const state={revision:0,connectionEpoch:1,connection:'online',connected:true,snapshot:harness};
      window.starts=0;window.addedDrafts=[];window.deliveredInputs=[];
      const accept=()=>{
        const message=remote.shift();if(!message)return;
        window.deliveredInputs.push(message.input);
        const turnId='turn-'+message.id;
        emit('thread/queue/changed',{threadId:'thread-a'});
        emit('turn/started',{threadId:'thread-a',turn:{id:turnId}});
        for(const method of ['item/started','item/completed']) emit(method,{threadId:'thread-a',turnId,
          item:{id:'input-'+message.id,type:'userMessage',content:message.input}});
        return {id:turnId};
      };
      const host={snapshot:()=>state,subscribe:()=>()=>{},journal:()=>[],programActivated:()=>{},
        onEvent:listener=>{events.add(listener);return()=>events.delete(listener)},
        command:async method=>method==='thread.open'?{summary,messages:[]}:[],
        call:async(method,payload)=>{
          if(method==='steer.queue.list')return [...remote];
          if(method==='steer.queue.add'){
            window.addedDrafts.push(payload.draft);
            const message={id:String(++serial),input:[{type:'text',text:payload.draft.text}]};remote.push(message);return message;
          }
          if(method==='steer.queue.start'){window.starts++;return accept()}
          return [];
        }};
      const session=new SessionService(host),queue=new SteerQueue(host);
      const root=createRoot(document.getElementById('root'));
      function Chat(){const state=useSyncExternalStore(session.subscribe,session.snapshot);return <>
        <div className="test-transcript"><ActivityTimeline items={state.activities} active={state.turn.tag==='running'} markdown={false}/></div>
        <SteerSurface surface={{id:'queue',kind:'steer'}} session={session} queue={queue}/>
      </>}
      window.ready=(async()=>{await session.openThread(summary);
        emit('turn/started',{threadId:'thread-a',turn:{id:'initial'}});
        flushSync(()=>root.render(<Chat/>));
      })();
      window.enqueue=text=>queue.enqueue('thread-a',{text,images:[],attachments:[],skills:[]});
      window.activityItems=()=>session.snapshot().activities;
      window.showSavedTranscript=()=>{const items=JSON.parse(JSON.stringify(session.snapshot().activities));flushSync(()=>root.render(<div className="test-transcript"><ActivityTimeline items={items} markdown/></div>))};
      window.autoStart=()=>flushSync(()=>{emit('turn/completed',{threadId:'thread-a',turn:{id:'initial',status:'completed'}});accept()});
      window.finish=()=>flushSync(()=>emit('turn/completed',{threadId:'thread-a',turn:{id:'turn-'+serial,status:'completed'}}));
      window.teardown=()=>{root.unmount();queue.dispose();session.dispose()};
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all([
    'src/client/styles.css', 'program/plugins/ui/default.css', 'program/plugins/theme.css', 'program/plugins/steer.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((_request, response) => {
    response.end('<!doctype html><html data-alto-theme="light"><style>' + css + '</style><body style="margin:0"><main id="root" style="padding:16px;min-width:0"></main></body></html>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const window = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: {
    offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false,
  } })
  const run = code => window.webContents.executeJavaScript(code)
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const until = async expression => {
    for (let index = 0; index < 100; index++) { if (await run(expression)) return; await frames() }
    throw new Error('Timed out: ' + expression)
  }
  const artifact = async name => {
    if (!process.env.ALTO_QUEUE_ARTIFACT_DIR) return
    await fs.mkdir(process.env.ALTO_QUEUE_ARTIFACT_DIR,{recursive:true})
    await fs.writeFile(path.join(process.env.ALTO_QUEUE_ARTIFACT_DIR,`source-edit-chat-${name}.png`),(await window.webContents.capturePage()).toPNG())
  }
  try {
    await window.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    await run('ready')
    await run("enqueue('Queued follow-up')")
    await until("document.querySelectorAll('.steer-row').length===1")
    assert.equal(await run("document.querySelector('.steer-message').textContent"),'Queued follow-up')
    assert.equal(await run("!!document.querySelector('[aria-label=\"Edit queued message\"]')"),true,'Regular queued messages retain their edit action')
    assert.equal(await run("document.querySelectorAll('.activity-user').length"), 0)
    await run('autoStart()')
    await until("document.querySelectorAll('.steer-row').length===0 && document.querySelectorAll('.activity-user').length===1")
    assert.equal(await run('starts'), 0, 'App Server can start the message without the queue UI doing so')
    assert.equal(await run("document.querySelector('.activity-user').textContent.startsWith('Queued follow-up')"), true)

    await run("enqueue('Second queued follow-up')")
    await until("document.querySelectorAll('.steer-row').length===1")
    await run('finish()')
    await until("document.querySelectorAll('.steer-row').length===0 && document.querySelectorAll('.activity-user').length===2")
    assert.equal(await run('starts'), 1)
    assert.equal(await run("document.querySelectorAll('.activity-user')[1].textContent.startsWith('Second queued follow-up')"), true)

    await run(`enqueue(${JSON.stringify(sourcePrompt)})`)
    await until("document.querySelectorAll('.steer-row').length===1")
    const expectedLabel=`Edit request · main.ts · ${editInstruction}`
    assert.equal(await run("document.querySelector('.steer-message').textContent"),expectedLabel,'The queue shows the source request summary instead of its transport envelope')
    assert.equal(await run("document.querySelector('.steer-message').title"),expectedLabel,'The queue tooltip also omits implementation instructions and selected code')
    assert.equal(await run("!!document.querySelector('[aria-label=\"Edit queued message\"]')"),false,'Generic queued-message editing must not expose or mutate the source-edit envelope')
    assert.equal(await run('addedDrafts.at(-1).text'),sourcePrompt,'The full source prompt remains intact in the queued transport draft')
    for (const width of [1000,360]) {
      window.setContentSize(width,760)
      await frames()
      assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'),true,'The summarized queue row fits a narrow chat')
      assert.equal(await run("(()=>{const row=document.querySelector('.steer-row').getBoundingClientRect();return row.height>0&&row.right<=innerWidth&&row.bottom<=innerHeight})()"),true,'The queue summary stays visible')
      await artifact(`queued-light-${width}`)
    }
    await run('finish()')
    await until("document.querySelectorAll('.steer-row').length===0 && document.querySelectorAll('.activity-user').length===3")
    assert.equal(await run('starts'),2,'The source edit is delivered through the existing queue exactly once')
    assert.deepEqual(await run('deliveredInputs.at(-1)'),[{type:'text',text:sourcePrompt}],'The agent receives the complete original source-edit input')
    assert.equal(await run("activityItems().filter(item=>item.kind==='user').at(-1).content"),sourcePrompt,'The transcript keeps the original prompt while the UI summarizes it')
    assert.equal(await run("document.querySelectorAll('.activity-source-edit').length"),1,'Delivery creates one compact source-edit user entry')
    const editNote=await run("document.querySelector('.activity-source-edit').textContent")
    assert.match(editNote,/Edit request/)
    assert.match(editNote,/main\.ts/)
    assert.ok(editNote.includes(editInstruction),'The compact note preserves the user instruction')
    assert.doesNotMatch(editNote,/Alto Source edit request:|source_edit|const count|contextBefore|proposal-only request/,'The transport envelope and selected source are not shown in chat')
    assert.equal(await run("document.querySelectorAll('.activity-user:not(.activity-source-edit)').length"),2,'Regular user messages keep their original presentation')
    for (const theme of ['light','dark']) {
      await run(`document.documentElement.dataset.altoTheme=${JSON.stringify(theme)}`)
      for (const width of [1000,360]) {
        window.setContentSize(width,760)
        await frames()
        const bounds=await run("(()=>{const note=document.querySelector('.activity-source-edit'),rect=note.getBoundingClientRect();return {left:rect.left,right:rect.right,height:rect.height,font:getComputedStyle(note).fontFamily}})()")
        assert.ok(bounds.left>=0&&bounds.right<=width,'The source edit note fits a narrow chat')
        assert.ok(bounds.height<150,'The source edit note stays compact')
        await artifact(`accepted-${theme}-${width}`)
      }
    }
    for (const width of [1000, 360]) {
      window.setContentSize(width, 760)
      await frames()
      assert.equal(await run("[...document.querySelectorAll('.activity-user')].every(item=>item.getBoundingClientRect().width>0 && item.getBoundingClientRect().right<=innerWidth)"), true)
      assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'), true)
    }
    await run('showSavedTranscript()')
    await until("document.querySelectorAll('.activity-source-edit').length===1")
    assert.equal(await run("document.querySelectorAll('.activity-user').length"),3,'A reloaded transcript keeps one entry per delivered user message')
    assert.match(await run("document.querySelector('.activity-source-edit').textContent"),/Edit request · main\.ts/,'Saved history uses the same compact source-edit presentation')
    assert.doesNotMatch(await run("document.querySelector('.activity-source-edit').textContent"),/proposal-only request|const count/)
    await run("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text}}});document.querySelector('.activity-source-edit [aria-label=\"Copy prompt\"]').click()")
    await until("!!document.querySelector('.activity-source-edit [aria-label=\"Copied prompt\"]')")
    assert.equal(await run('copied'),sourcePrompt,'Copy prompt preserves the original full source request, including selected code')
    console.log('Queued message browser checks passed')
  } finally {
    await run('teardown()').catch(() => {})
    window.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
