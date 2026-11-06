const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'conversation-rendering.tsx', loader: 'tsx', contents: `
      import React,{Profiler} from 'react';
      import {createRoot,flushSync} from 'react-dom/profiling';
      import Prism from 'prismjs';
      import remarkMath from 'remark-math';
      import uiSurfacesClient from './program/plugins/ui-surfaces.client';
      import {ActivityCard} from './program/plugins/ui/activity';
      import {DefaultCodeBlock} from './program/plugins/code-blocks.client';
      import {MarkdownMathProvider} from './program/plugins/ui/markdown';

      const root=createRoot(document.getElementById('root')),listeners=new Set();
      const stats={commits:0,renderMs:0,highlights:0,highlightMs:0,parses:0,surfaces:0};
      const history=Array.from({length:60},(_,index)=>[
        {id:'prompt:'+index,turnId:'turn:'+index,kind:'user',title:'You',content:'Review change '+index,timestamp:''},
        {id:'reply:'+index,turnId:'turn:'+index,kind:'agent',title:'Assistant',phase:'final_answer',durationMs:1000,
          content:('Reviewed **change '+index+'** with $x_1$.\\n\\n').repeat(8),timestamp:''},
      ]).flat();
      let state={revision:0,connected:true,threadId:'chat',activities:history,turn:{tag:'idle'},
        session:{workspace:'/repo',permissionMode:'full'},projects:[],skills:[],hasEarlierActivities:false,loadingEarlierActivities:false,
        harness:{codex:{status:'ready',models:[],threadStates:{}},program:{proposals:[]},pendingRequests:[],extensions:{}}};
      window.responses=[];
      const session={snapshot:()=>state,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},loadEarlierActivities:async()=>{},
        resolveRequest:async(id,result)=>{responses.push({id,result})},resolveProposal:async(id,decision)=>{responses.push({id,decision})}};
      const components=new Map(),cleanups=[];
      const ui={subscribe:()=>()=>{},snapshot:()=>0,component:id=>{if(id==='chat.file-review-action')stats.surfaces++;return components.get(id)},
        overlays:{toggle:()=>{},open:()=>{}},registerStyle:()=>{},registerSurface:()=>{},registerContributionRenderer:()=>{},
        registerComponent:(_owner,id,renderer)=>components.set(id,renderer)};
      const config={showCopyButton:true};
      const CodeBlock=props=><DefaultCodeBlock {...props} config={config}/>;
      const math={id:'fixture',remarkPlugins:[remarkMath],preprocess:source=>{stats.parses++;return source},component:({formula})=><span data-formula={formula}>{formula}</span>};
      const markdownState={codeBlocks:[{id:'code',component:CodeBlock}],fileLinks:[],math};
      const markdown={subscribe:()=>()=>{},snapshot:()=>markdownState};
      uiSurfacesClient({clientSession:session,clientUi:ui,clientMarkdown:markdown,clientHost:{command:()=>{}},clientProgram:{},
        effect:effect=>{const cleanup=effect();if(typeof cleanup==='function')cleanups.push(cleanup)}});
      const Conversation=components.get('chat.conversation');
      let mode='conversation',visible=true,unscoped=true;
      let surfaceMarkdown=true,parentVersion=0;
      let message={id:'stream',kind:'agent',title:'Assistant',status:'streaming',timestamp:'',content:''};
      const profile=(_id,_phase,duration)=>{stats.commits++;stats.renderMs+=duration};
      const render=()=>flushSync(()=>root.render(<Profiler id="conversation" onRender={profile}>
        {mode==='conversation'?<Conversation surface={{id:'conversation-'+parentVersion,kind:'conversation',markdown:surfaceMarkdown}} session={session} visible={visible} showUnscopedRequests={unscoped}/>
          :<MarkdownMathProvider renderer={math} fileLinks={markdownState.fileLinks}><ActivityCard item={message} codeBlock={CodeBlock}/></MarkdownMathProvider>}
      </Profiler>));
      const publish=next=>flushSync(()=>{state=next;for(const listener of listeners)listener()});
      window.resetStats=()=>{for(const name of Object.keys(stats))stats[name]=0};
      window.stats=()=>({...stats});
      window.unrelated=count=>{const began=performance.now();for(let index=0;index<count;index++)publish({...state,revision:state.revision+1,
        session:{...state.session,model:'model-'+index},projects:[{id:'project-'+index}],
        harness:{...state.harness,extensions:{monitor:{revision:index}}}});return performance.now()-began};
      window.parentUpdates=count=>{const began=performance.now();for(let index=0;index<count;index++){parentVersion++;render()}return performance.now()-began};
      window.setMarkdown=next=>{surfaceMarkdown=next;render()};
      window.connection=message=>publish({...state,connectionError:message});
      window.historyState=(hasEarlier,loading)=>publish({...state,hasEarlierActivities:hasEarlier,loadingEarlierActivities:loading});
      window.requests=requests=>publish({...state,harness:{...state.harness,pendingRequests:requests}});
      window.proposals=proposals=>publish({...state,harness:{...state.harness,program:{...state.harness.program,proposals}}});
      window.setUnscoped=next=>{unscoped=next;render()};
      window.waiting=flags=>publish({...state,turn:{tag:'running'},harness:{...state.harness,codex:{...state.harness.codex,
        threadStates:{chat:{status:{type:'active',activeFlags:flags}}}}}});
      window.starting=location=>publish({...state,remoteLocation:location,remoteStarting:!!location});
      window.reply=text=>publish({...state,activities:state.activities.map(item=>item.id==='reply:59'?{...item,content:text}:item)});
      window.setVisible=next=>{visible=next;render()};
      window.startStream=content=>{mode='stream';message={...message,content};render()};
      window.appendStream=text=>{message={...message,content:message.content+text};render()};
      window.replaceStream=(from,to)=>{message={...message,content:message.content.replace(from,to)};render()};
      window.finishStream=()=>{message={...message,status:'completed'};render()};
      window.streamSource=()=>message.content;
      window.clipboard=[];
      Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{clipboard.push(text)}}});
      Prism.hooks.add('before-tokenize',env=>{if(env.code.includes('fixedMarker')){stats.highlights++;env.profileStart=performance.now()}});
      Prism.hooks.add('after-tokenize',env=>{if(env.profileStart!==undefined)stats.highlightMs+=performance.now()-env.profileStart});
      window.teardown=()=>{flushSync(()=>root.unmount());for(const cleanup of cleanups)cleanup()};
      render();
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all([
    'src/client/styles.css', 'program/plugins/ui/appearance-tokens.css', 'program/plugins/ui/default.css',
    'program/plugins/code-blocks.css', 'program/plugins/markdown.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((_request, response) => response.end('<!doctype html><style>' + css + '#root{display:flex;height:700px;flex-direction:column}.conversation-stage{flex:1;min-height:0}</style><main id="root"></main>'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const win = new BrowserWindow({ show: false, width: 1000, height: 780, webPreferences: {
    offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false,
  } })
  const run = code => win.webContents.executeJavaScript(code)
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const until = async expression => {
    for (let index = 0; index < 200; index++) { if (await run(expression)) return; await frames() }
    throw new Error('Timed out: ' + expression)
  }
  const measurements = {}
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    await frames()
    assert.equal(await run('document.querySelectorAll(".activity-turn").length'), 24)
    await run('resetStats()')
    measurements.backgroundMs = await run('unrelated(300)')
    measurements.background = await run('stats()')
    await run('resetStats()')
    measurements.parentMs = await run('parentUpdates(300)')
    measurements.parent = await run('stats()')

    await run("connection('Connection interrupted')")
    assert.equal(await run('document.querySelector(".connection-banner").textContent'), 'Connection interrupted')
    await run("historyState(true,true)")
    assert.equal(await run('document.querySelector(".activity-history-window").disabled'), true)
    await run("historyState(true,false)")
    assert.equal(await run('document.querySelector(".activity-history-window").disabled'), false)
    await run("reply('Updated **answer** with $x_2$ and [details](https://example.test/details).')")
    await until('document.querySelector("[data-activity-id=\\"reply:59\\"] [data-formula=\\"x_2\\"]")')
    assert.equal(await run('document.querySelector("[data-activity-id=\\"reply:59\\"] strong").textContent'), 'answer')
    await run('setMarkdown(false)')
    assert.equal(await run('!!document.querySelector("[data-activity-id=\\"reply:59\\"] strong")'), false)
    await run('setMarkdown(true)')
    assert.equal(await run('document.querySelector("[data-activity-id=\\"reply:59\\"] strong").textContent'), 'answer')
    await run("setVisible(false);reply('Content received while hidden')")
    assert.equal(await run('document.body.textContent.includes("Content received while hidden")'), false)
    await run('setVisible(true)')
    await until('document.body.textContent.includes("Content received while hidden")')
    await frames()
    await run('resetStats();requests([{id:1,method:"item/commandExecution/requestApproval",params:{threadId:"other",command:"echo other"}}])')
    assert.equal((await run('stats()')).commits, 0, 'Requests for another chat do not redraw this conversation')
    await run('requests([{id:2,method:"item/commandExecution/requestApproval",params:{threadId:"chat",command:"echo current"}}])')
    assert.equal(await run('document.querySelector(".approval-card h3").textContent'), 'Run this command?')
    await run('document.querySelector(".approval-card .primary").click()')
    await until('responses.length===1')
    assert.deepEqual(await run('responses[0]'), { id: 2, result: { decision: 'accept' } })
    await run('requests([{id:3,method:"item/commandExecution/requestApproval",params:{command:"echo global"}}])')
    assert.equal(await run('document.querySelectorAll(".approval-card").length'), 1)
    await run('setUnscoped(false)')
    assert.equal(await run('document.querySelectorAll(".approval-card").length'), 0)
    await run('setUnscoped(true);proposals([{id:"proposal",summary:"A pending update",files:[]}])')
    assert.equal(await run('document.querySelectorAll(".approval-card").length'), 2)
    await run('setUnscoped(false)')
    assert.equal(await run('document.querySelectorAll(".approval-card").length'), 0)
    await run('waiting(["waitingOnApproval"])')
    assert.equal(await run('document.querySelector(".activity-turn-latest .activity-turn-label").textContent'), 'Waiting for approval')
    await run('waiting(["waitingOnUserInput"])')
    assert.equal(await run('document.querySelector(".activity-turn-latest .activity-turn-label").textContent'), 'Waiting for your reply')
    await run('starting("Blox")')
    assert.equal(await run('document.querySelector(".activity-turn-latest [role=status] .activity-working-shimmer").firstChild.textContent'), 'Starting Blox…')
    await run('starting("Cloud")')
    assert.equal(await run('document.querySelector(".activity-turn-latest [role=status] .activity-working-shimmer").firstChild.textContent'), 'Starting Cloud…')

    // The list must stay one Markdown block while its continuation grows.
    // A finished fence within it should not repeat syntax tokenization.
    const code = 'const fixedMarker = 1;\n' + Array.from({ length: 120 }, (_, index) => `const value${index} = fixedMarker + ${index};`).join('\n')
    const source = '1. Read [the guide](https://example.test/guide) with $x_1$.\n\n   ```typescript\n' + code.split('\n').map(line => '   ' + line).join('\n') + '\n   ```\n\n   Follow this continuation'
    await run(`startStream(${JSON.stringify(source)})`)
    await until('document.querySelector(".activity-streaming-markdown").textContent.includes("Follow this continuation")')
    assert.equal(await run('document.querySelectorAll(".activity-streaming-markdown > div").length'), 1)
    await run('resetStats()')
    for (let index = 0; index < 20; index++) {
      await run(`appendStream(${JSON.stringify(' and continuation-' + index)})`)
      await until(`document.querySelector('.activity-streaming-markdown').textContent.includes(${JSON.stringify('continuation-' + index)})`)
    }
    measurements.stream = await run('stats()')
    assert.equal(await run('document.querySelectorAll(".activity-streaming-markdown ol").length'), 1)
    assert.equal(await run('document.querySelectorAll(".cordis-code-block").length'), 1)
    await run("replaceStream('fixedMarker = 1','fixedMarker = 2')")
    await until('document.querySelector(".cordis-code-block code").textContent.includes("fixedMarker = 2")')
    assert.equal((await run('stats()')).highlights, measurements.stream.highlights + 1, 'Changed code is re-highlighted')
    assert.ok(await run('document.querySelectorAll(".cordis-code-block .token").length') > 0)
    await run('finishStream()')
    await until('!!document.querySelector("[aria-label=\\"Copy reply\\"]")')
    await run('document.querySelector("[aria-label=\\"Copy code\\"]").click()')
    await until('clipboard.length===1')
    assert.equal(await run('clipboard[0]'), code.replace('fixedMarker = 1', 'fixedMarker = 2'))
    await run('document.querySelector("[aria-label=\\"Copy reply\\"]").click()')
    await until('clipboard.length===2')
    assert.equal(await run('clipboard[1]===streamSource()'), true)
    console.log('Conversation rendering measurements: ' + JSON.stringify(measurements))
    if (process.env.ALTO_CONVERSATION_RENDER_METRICS) await fs.writeFile(process.env.ALTO_CONVERSATION_RENDER_METRICS, JSON.stringify(measurements, null, 2))
    assert.equal(measurements.background.commits, 0, 'Unrelated host updates do not render the conversation')
    assert.equal(measurements.parent.surfaces, 0, 'Unrelated parent updates do not redraw the registered conversation')
    assert.equal(measurements.stream.highlights, 0, 'Unchanged completed code does not repeat tokenization during list streaming')
    await run('teardown()')
    console.log('Conversation rendering browser checks passed')
  } finally {
    win.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
