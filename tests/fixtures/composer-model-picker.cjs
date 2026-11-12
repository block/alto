const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'composer-model-picker.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import composerClient,{ComposerSurface} from './program/plugins/composer.client';
      const root=createRoot(document.getElementById('root')),listeners=new Set();
      const efforts=values=>values.map(reasoningEffort=>({reasoningEffort,description:'Use '+reasoningEffort+' reasoning'}));
      const native=[
        {id:'swift-v2',displayName:'Swift',defaultReasoningEffort:'low',supportedReasoningEfforts:efforts(['low','medium'])},
        {id:'balanced',displayName:'Balanced',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:efforts(['none','minimal','low','medium','high','xhigh'])},
        {id:'automatic',displayName:'Automatic'},
        ...Array.from({length:9},(_,index)=>({id:'extra-'+index,displayName:'Additional model '+index+' with a longer descriptive label'})),
      ];
      const claude=[
        {id:'opus',displayName:'Opus',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:efforts(['low','medium','high','max'])},
        {id:'haiku',displayName:'Haiku'},
        {id:'sonnet',displayName:'Sonnet',defaultReasoningEffort:'high',supportedReasoningEfforts:efforts(['low','medium','high'])},
      ];
      const catalogs={codex:native,claude,gemini:[{id:'gemini-auto',displayName:'Agent default',isDefault:true}],
        'cloud-codex':[{id:'remote-native',displayName:'Remote Codex',isDefault:true,defaultReasoningEffort:'medium',supportedReasoningEfforts:efforts(['low','medium','high'])}],
        'cloud-claude':claude,
        'managed-remote':[{id:'managed-reasoner',displayName:'Reasoner',isDefault:true,defaultReasoningEffort:'high',supportedReasoningEfforts:efforts(['low','high'])}]};
      const providers=[{id:'codex',label:'Codex'},{id:'claude',agentId:'claude',label:'Claude'},
        {id:'gemini',agentId:'gemini',label:'Gemini'},
        {id:'cloud-codex',agentId:'codex',label:'Codex',location:{id:'cloud',label:'Cloud'}},
        {id:'cloud-claude',agentId:'claude',label:'Claude',location:{id:'cloud',label:'Cloud'}},
        {id:'managed-remote',agentId:'managed',label:'Managed',location:{id:'managed',label:'Hosted'}}];
      const extraConfig=()=>[{id:'verbosity',name:'Verbosity',currentValue:'quiet',category:'verbosity',options:[{value:'quiet',name:'Quiet'},{value:'full',name:'Full'}]}];
      const managedConfig=()=>[{id:'agent',name:'Managed agent',currentValue:'worker-a',category:'agent',options:[{value:'worker-a',name:'Primary worker'},{value:'worker-b',name:'Backup worker'}]},...extraConfig()];
      providers.find(provider=>provider.id==='managed-remote').configOptions=managedConfig().filter(option=>option.category==='agent');
      let state={revision:1,connected:true,providerId:'codex',providers,models:native,agentConfig:[],
        session:{workspace:'/repo',permissionMode:'full',model:'balanced',effort:'high'},turn:{tag:'idle'},
        harness:{codex:{status:'ready',models:native},extensions:{}},projects:[],skills:[],activities:[],
        canAcceptDirectInput:true,projectScope:'unscoped'};
      let draft={message:'Draft kept while choosing models.',images:[],attachments:[]};
      window.changes=[];window.pendingLoads=[];window.pendingModelRequests=[];window.pendingAgentRequests=[];window.modelRequests=0;window.clickCount=0;window.sent=[];window.activityClicks=0;
      document.addEventListener('click',()=>clickCount++,true);
      const publish=next=>flushSync(()=>{state={...state,...next,revision:state.revision+1};for(const listener of listeners)listener()});
      const selectProvider=(providerId,selection,reset=false)=>{
        const same=providerId===state.providerId&&!reset;
        const models=catalogs[providerId],model=models.find(option=>option.isDefault)??models[0];
        let config=same?state.agentConfig:providerId==='managed-remote'?managedConfig():providerId.includes('claude')?extraConfig():[];
        if(selection){
          const option=config.find(option=>option.id===selection.configId&&option.category==='agent');
          if(!option?.options.some(option=>option.value===selection.value))throw new Error('Agent is unavailable');
          config=config.map(option=>option.id===selection.configId?{...option,currentValue:selection.value}:option);
        }
        publish({providerId,models,agentConfig:config,
          session:same?state.session:{...state.session,model:model?.id,effort:model?.defaultReasoningEffort}});
      };
      let holdModel=false,holdAgent=false;
      const selectModel=id=>{const model=state.models.find(option=>option.id===id)??state.models.find(option=>option.isDefault);
        publish({session:{...state.session,model:id,effort:model?.defaultReasoningEffort}})};
      const session={snapshot:()=>state,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},
        setProvider:(id,selection)=>{changes.push(selection?['provider',id,selection]:['provider',id]);
          if(holdAgent){holdAgent=false;let resolve,reject;const promise=new Promise((accepted,failed)=>{resolve=accepted;reject=failed});
            pendingAgentRequests.push({id,selection,promise,resolve,reject});return promise}
          selectProvider(id,selection)},
        setModel:id=>{changes.push(['model',id]);if(holdModel){holdModel=false;let resolve,reject;
          const promise=new Promise((accepted,failed)=>{resolve=accepted;reject=failed});pendingModelRequests.push({model:id,promise,resolve,reject});return promise}else selectModel(id)},
        setEffort:effort=>{changes.push(['effort',effort]);publish({session:{...state.session,effort}})},
        setAgentConfig:(id,value)=>{changes.push(['config',id,value]);publish({agentConfig:state.agentConfig.map(option=>option.id===id?{...option,currentValue:value}:option)})},
        setPermissionMode:permissionMode=>publish({session:{...state.session,permissionMode}}),
        loadModels:()=>{modelRequests++;return new Promise((resolve,reject)=>pendingLoads.push({resolve,reject}))},
        send:async value=>sent.push(value),interrupt:async()=>{},newThread:()=>{},retargetNewThread:()=>false};
      const preference={autoExpand:false};
      const preferences={subscribe:()=>()=>{},snapshot:()=>preference};
      const ui={canSubmitDuringTurn:()=>true,registerComponent:()=>{},registerSurface:()=>{},registerSettingsPage:()=>{}};
      let composer;
      composerClient({clientSession:session,clientUi:ui,provide:(name,value)=>{if(name==='clientComposer')composer=value}},{});
      const draftStore={read:()=>draft,write:next=>{draft=next}};
      const surface={id:'picker',kind:'composer',capabilities:[]};
      const render=()=>flushSync(()=>root.render(<>
        <div id="activity-overlay" className="turn-progress-surface" hidden>
          <div className="turn-progress-control">
            <div className="turn-progress-pill"><button id="activity-button" className="turn-subagents-trigger"
              onClick={()=>window.activityClicks++}>2 agents</button></div>
          </div>
        </div>
        <ComposerSurface surface={surface} session={session} composer={composer}
          preferences={preferences} ui={ui} autoFocus draftStore={draftStore}/>
      </>));
      window.expandComposer=()=>{originalDraftNode.textContent=Array.from({length:16},(_,index)=>'Expanded draft line '+index+'.').join('\\n');editor().dispatchEvent(new Event('input',{bubbles:true}))};
      window.chooseProvider=id=>selectProvider(id,undefined,true);
      window.holdNextAgent=()=>{holdAgent=true};
      window.ackAgent=()=>{const pending=pendingAgentRequests.shift();selectProvider(pending.id,pending.selection);pending.resolve();return pending.promise};
      window.rejectAgent=error=>{const pending=pendingAgentRequests.shift();pending.reject(new Error(error));return pending.promise.catch(()=>{})};
      window.manyHostedAgents=()=>publish({providers:state.providers.map(provider=>provider.id==='managed-remote'?{...provider,configOptions:managedConfig().filter(option=>option.category==='agent').map(option=>({...option,options:[...option.options,...Array.from({length:18},(_,index)=>({value:'extra-worker-'+index,name:'Additional remote agent '+index}))]}))}:provider)});
      window.hostedUnavailable=()=>publish({providers:state.providers.map(provider=>provider.id==='managed-remote'?{...provider,status:'stopped',error:'Sign in to Hosted in Settings first.'}:provider)});
      window.emptyHostedAgents=()=>publish({providers:state.providers.map(provider=>provider.id==='managed-remote'?{...provider,configOptions:managedConfig().filter(option=>option.category==='agent').map(option=>({...option,options:[]}))}:provider)});
      window.restoreHostedAgents=()=>publish({providers:state.providers.map(provider=>provider.id==='managed-remote'?{...provider,status:'ready',error:undefined,configOptions:managedConfig().filter(option=>option.category==='agent')}:provider)});
      window.holdNextModel=()=>{holdModel=true};
      window.ackModel=()=>{const pending=pendingModelRequests.shift();selectModel(pending.model);pending.resolve();return pending.promise};
      window.rejectModel=error=>{const pending=pendingModelRequests.shift();pending.reject(new Error(error));return pending.promise.catch(()=>{})};
      window.replaceCatalog=()=>publish({models:state.models.map(model=>({...model}))});
      window.patch=change=>publish(change);
      window.setPermissionModesAvailable=(available,providerId=state.providerId)=>publish({providers:state.providers.map(provider=>
        provider.id===providerId?{...provider,capabilities:{...provider.capabilities,permissionModes:available}}:provider)});
      window.emptyCodex=()=>{selectProvider('codex');publish({models:[],harness:{...state.harness,codex:{status:'stopped',models:[]}},
        session:{...state.session,model:undefined,effort:undefined}})};
      window.finishLoad=error=>{const pending=pendingLoads.shift();if(!pending)throw new Error('No pending catalog request');
        if(error)pending.reject(new Error(error));else{if(state.providerId==='codex')publish({models:native,harness:{...state.harness,codex:{status:'ready',models:native}}});pending.resolve()}};
      window.resetChanges=()=>{changes.length=0;clickCount=0};
      window.read=()=>({providerId:state.providerId,model:state.session.model,effort:state.session.effort,agentConfig:state.agentConfig,changes:[...changes],
        draft:draft.message,clicks:clickCount,requests:modelRequests,pending:pendingLoads.length,
        open:!!document.querySelector('.composer-model-picker'),
        models:[...document.querySelectorAll('[role="listbox"][aria-label="Models"] [role="option"]')].map(option=>({name:option.textContent,selected:option.getAttribute('aria-selected')})),
        agents:[...document.querySelectorAll('[data-composer-agents] [role=option]')].map(option=>({name:option.getAttribute('aria-label'),selected:option.getAttribute('aria-selected')})),
        reasoning:[...document.querySelectorAll('[aria-label="Reasoning"] button')].map(button=>({name:button.textContent,selected:button.getAttribute('aria-pressed')})),
        focus:document.activeElement?.getAttribute('aria-label')??document.activeElement?.textContent});
      window.geometry=()=>{
        const popup=document.querySelector('.composer-model-picker'),list=document.querySelector('[data-composer-models]');
        const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
        return {width:innerWidth,height:innerHeight,page:document.documentElement.scrollWidth,popup:box(popup),
          list:{...box(list),scroll:list.scrollHeight,visible:list.clientHeight},
          controls:[...popup.querySelectorAll('button,select')].filter(node=>!node.closest('[data-composer-models],[data-composer-agents]')&&node.getBoundingClientRect().width>0).map(box),
          agents:box(popup.querySelector('[data-composer-agents]')),
          rail:box(popup.querySelector('.composer-picker-agents-rail')),
          nativeAgent:box(popup.querySelector('select[aria-label=Agent]')),
          models:[...list.querySelectorAll('[role=option]')].map(node=>({name:node.textContent,...box(node)})),
          reasoning:[...popup.querySelectorAll('[aria-label=Reasoning] button')].map(box),
          radius:getComputedStyle(popup).borderRadius};
      };
      window.editor=()=>document.querySelector('[data-cordis-composer-editor]');
      window.focusDraft=()=>composer.focus();
      window.selectDraft=(anchor,focus)=>{editor().focus();getSelection().setBaseAndExtent(editor().firstChild,anchor,editor().firstChild,focus)};
      window.draftSelection=()=>{const selection=getSelection();return {focused:document.activeElement===editor(),
        original:selection.anchorNode===originalDraftNode&&selection.focusNode===originalDraftNode,anchor:selection.anchorOffset,focus:selection.focusOffset}};
      window.teardown=()=>flushSync(()=>root.unmount());
      render();
      window.originalEditor=editor();window.originalDraftNode=editor().firstChild;
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all([
    'src/client/styles.css', 'program/plugins/ui/appearance-tokens.css', 'program/plugins/ui/default.css',
    'program/plugins/ui/controls.css', 'program/plugins/ui/focus.css', 'program/plugins/theme.css',
    'program/plugins/turn-progress.css', 'program/plugins/orchestrator-progress.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((_request, response) => response.end('<!doctype html><html data-alto-theme="light"><style>' + css + '\nbody{margin:0;background:var(--canvas)}#root{position:fixed;bottom:24px;left:0;right:0;height:auto;container:conversation-column / inline-size}#outside{position:fixed;left:8px;top:8px}</style><button id="outside">Outside</button><main id="root"></main></html>'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: {
    offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false,
  } })
  const run = async code => {
    try { return await win.webContents.executeJavaScript(code) }
    catch (error) { throw new Error('Browser expression failed: ' + code.slice(0, 300), { cause: error }) }
  }
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const until = async expression => {
    for (let index = 0; index < 100; index++) { if (await run(expression)) return; await frames() }
    throw new Error('Timed out: ' + expression)
  }
  const pointer = async point => {
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    await frames()
  }
  const click = async expression => {
    const point = await run(`(()=>{const node=${expression};if(!node)throw new Error('Missing click target');node.scrollIntoView({block:'nearest'});const r=node.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`)
    await pointer(point)
  }
  const button = (label, scope = '.composer-model-picker') => `([...document.querySelectorAll(${JSON.stringify(scope + ' button')})].find(node=>node.textContent.trim()===${JSON.stringify(label)}||node.firstElementChild?.textContent===${JSON.stringify(label)}))`
  const key = async (keyCode, modifiers = []) => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    if (keyCode === 'Return') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await frames()
  }
  const agent = (name, location) => `([...document.querySelectorAll('[data-composer-agents] [role=option]')].find(node=>node.getAttribute('aria-label')===${JSON.stringify(name + ' · ' + location)}))`
  const selectOption = async (label, name, group) => {
    const selector = JSON.stringify(`select[aria-label="${label}"]`)
    await run(`(()=>{const select=document.querySelector(${selector});
      const option=[...select.options].find(option=>option.textContent.trim()===${JSON.stringify(name)}&&(!${JSON.stringify(group)}||option.parentElement.label===${JSON.stringify(group)}));
      if(!option)throw new Error('Missing native option: '+${JSON.stringify(name)});select.focus();select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));})()`)
    await frames()
  }
  const chooseAgent = async (name, location) => {
    if (await run('document.querySelector("select[aria-label=Agent]").getBoundingClientRect().width>0')) await selectOption('Agent', name, location)
    else await click(agent(name, location))
  }
  const moreControl = `document.querySelector(${JSON.stringify('[aria-label="More options"]')})`
  const showOptions = async () => {
    if (await run(moreControl + '.getAttribute("aria-expanded")!=="true"')) await click(moreControl)
  }
  const open = () => click('document.querySelector(".composer-model-trigger")')
  const outside = () => click('document.getElementById("outside")')
  const retained = async () => {
    assert.equal(await run('editor()===originalEditor&&editor().firstChild===originalDraftNode'), true, 'Choosing controls preserves the native draft DOM')
    assert.equal((await run('read()')).draft, 'Draft kept while choosing models.')
    assert.equal(await run('editor().textContent'), 'Draft kept while choosing models.')
  }
  const capture = async name => {
    const directory = process.env.ALTO_MODEL_PICKER_ARTIFACT_DIR
    if (!directory) return
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, name + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}`)
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await run(bundle.outputFiles[0].text)
    await frames()

    await click('document.querySelector(".composer-permission-trigger")')
    assert.equal(await run('document.querySelectorAll(".composer-permission-picker [role=menuitemradio]").length'), 3,
      'Providers without the optional capability retain Ask, Auto, and Full access')
    await run('setPermissionModesAvailable(false,"claude")')
    assert.equal(await run('!!document.querySelector(".composer-permission-picker")'), true,
      'A different provider capability does not change the active permission menu')
    await run('chooseProvider("claude")')
    await frames()
    assert.deepEqual(await run('(()=>{const button=document.querySelector(".composer-permission-trigger");return {label:button.textContent,title:button.title,disabled:button.disabled,popup:button.getAttribute("aria-haspopup")}})()'),
      { label: 'Managed', title: 'Permissions are managed by the agent provider', disabled: true, popup: null })
    assert.equal(await run('!!document.querySelector(".composer-permission-picker")'), false,
      'Switching to a managed provider closes an already open menu')
    await click('document.querySelector(".composer-permission-trigger")')
    assert.equal(await run('!!document.querySelector(".composer-permission-picker")'), false,
      'Managed permissions cannot open Ask or Full access choices')
    await run('setPermissionModesAvailable(true)')
    await frames()
    assert.equal(await run('!!document.querySelector(".composer-permission-picker")'), false,
      'Restoring permission modes does not reopen a stale menu')
    await click('document.querySelector(".composer-permission-trigger")')
    assert.equal(await run('document.querySelectorAll(".composer-permission-picker [role=menuitemradio]").length'), 2,
      'An explicitly supported non-native provider retains Ask and Full access')
    await run('setPermissionModesAvailable(false)')
    await frames()
    assert.equal(await run('!!document.querySelector(".composer-permission-picker")'), false,
      'A capability withdrawn from the active provider closes the permission menu')
    await run('setPermissionModesAvailable(undefined);chooseProvider("codex")')
    await retained()

    await run('resetChanges()')
    await open()
    const nativeOrder = (await run('read()')).models.map(option => option.name)
    assert.deepEqual(nativeOrder.slice(0, 3), ['Swift', 'Balanced', 'Automatic'], 'The model catalog keeps its familiar order')
    assert.equal(await run('document.activeElement.textContent'), 'Balanced')
    assert.equal(await run('document.activeElement.getAttribute("aria-selected")'), 'true')
    assert.equal(await run('document.querySelector(".composer-model-picker input")'), null, 'The picker opens directly to model choices')
    assert.equal(await run('document.querySelectorAll(".composer-model-picker [role=tab],.composer-picker-header").length'), 0, 'Agent, model, and reasoning choices share one surface without navigation pages')
    assert.deepEqual((await run('read()')).agents.map(option => option.name), ['Codex · Local', 'Claude · Local', 'Gemini · Local', 'Codex · Cloud', 'Claude · Cloud', 'Primary worker · Hosted', 'Backup worker · Hosted'])
    assert.equal(await run('modelRequests'), 0, 'Opening a populated picker does not start or reload a CLI')
    await click(button('Swift', '[data-composer-models]'))
    assert.equal((await run('read()')).open, true)
    assert.deepEqual((await run('read()')).reasoning.map(option => option.name), ['Low', 'Medium'])
    await click(button('Medium', '[aria-label="Reasoning"]'))
    assert.deepEqual((await run('read()')).changes, [['model', 'swift-v2'], ['effort', 'medium']])
    assert.equal((await run('read()')).clicks, 3, 'Opening, choosing a model, and choosing reasoning take three clicks total')
    assert.deepEqual((await run('read()')).models.map(option => option.name), nativeOrder, 'Choosing a model never reorders the list')
    await click(agent('Claude', 'Local'))
    assert.equal((await run('read()')).clicks, 4, 'Changing an agent is one direct click in the open picker')
    assert.equal((await run('read()')).providerId, 'claude')
    assert.equal((await run('read()')).open, true)
    assert.deepEqual((await run('read()')).models.map(option => option.name), ['Opus', 'Haiku', 'Sonnet'])
    assert.deepEqual((await run('read()')).reasoning.map(option => option.name), ['Low', 'Medium', 'High', 'Max'])
    await click(button('Sonnet', '[data-composer-models]'))
    await click(button('Medium', '[aria-label="Reasoning"]'))
    assert.equal((await run('read()')).clicks, 6, 'Agent, model, and reasoning each require one direct click after opening')
    assert.equal((await run('read()')).model, 'sonnet')
    assert.equal((await run('read()')).effort, 'medium')
    assert.equal((await run('read()')).open, true)
    await retained()
    await capture('picker-direct-choices')
    await key('Escape')
    assert.equal((await run('read()')).open, false)
    assert.equal(await run('document.activeElement.classList.contains("composer-model-trigger")'), true)

    await run('chooseProvider("codex");resetChanges()')
    await open()
    await click(button('Swift', '[data-composer-models]'))
    assert.equal((await run('read()')).clicks, 2, 'Changing only the model requires opening plus one choice')
    await outside()
    assert.equal((await run('read()')).open, false)
    assert.equal(await run('document.activeElement.id'), 'outside', 'Outside dismissal keeps the clicked control focused')
    await run('resetChanges()')
    await open()
    await click(button('Medium', '[aria-label="Reasoning"]'))
    assert.equal((await run('read()')).clicks, 2, 'Changing reasoning requires opening plus one choice')
    await run('resetChanges()')
    await click(button('Swift', '[data-composer-models]'))
    assert.deepEqual((await run('read()')).changes, [], 'Clicking the current model preserves reasoning')
    assert.equal((await run('read()')).effort, 'medium')
    await run(button('Balanced', '[data-composer-models]') + '.focus()')
    await run("for(const key of ['Enter','Escape','ArrowDown','ArrowLeft'])document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,isComposing:true,bubbles:true,cancelable:true}))")
    assert.equal((await run('read()')).model, 'swift-v2', 'IME confirmation is not a model selection')
    assert.equal((await run('read()')).open, true, 'IME Escape does not dismiss the picker')
    assert.equal(await run('document.activeElement.textContent'), 'Balanced', 'IME arrows do not move model focus')
    await key('Return')
    assert.equal((await run('read()')).model, 'balanced')
    await key('End')
    assert.equal(await run('document.activeElement.textContent'), 'Additional model 8 with a longer descriptive label')
    await key('Home')
    assert.equal(await run('document.activeElement.textContent'), 'Swift')
    await key('Left')
    assert.equal(await run('document.activeElement.getAttribute("aria-label")'), 'Codex · Local', 'Left reaches the selected agent from the model list')
    await key('End')
    assert.equal(await run('document.activeElement.getAttribute("aria-label")'), 'Backup worker · Hosted')
    await key('Home')
    assert.equal(await run('document.activeElement.getAttribute("aria-label")'), 'Codex · Local')
    await key('Down')
    assert.equal(await run('document.activeElement.getAttribute("aria-label")'), 'Claude · Local')
    assert.equal((await run('read()')).providerId, 'codex', 'Arrow navigation does not change the agent until confirmed')
    await key('Return')
    assert.equal((await run('read()')).providerId, 'claude')
    await run(agent('Claude', 'Local') + '.focus()')
    await key('Right')
    assert.equal(await run('document.activeElement.textContent'), 'Opus', 'Right reaches the selected model from the agent list')
    await run('document.querySelector("[aria-label=Reasoning] button").focus()')
    await key('Right')
    assert.equal(await run('document.activeElement.textContent'), 'Medium')
    await key('Home'); await key('Return')
    assert.equal((await run('read()')).effort, 'low')
    await key('End'); await key('Return')
    assert.equal((await run('read()')).effort, 'max')
    assert.equal((await run('read()')).open, true, 'Keyboard reasoning changes keep the popup open')
    await showOptions()
    await selectOption('Verbosity', 'Full')
    assert.deepEqual((await run('read()')).changes.at(-1), ['config', 'verbosity', 'full'])
    assert.equal((await run('read()')).open, true, 'Optional provider settings stay in the same picker')
    assert.equal(await run('document.querySelectorAll("[data-composer-models] [role=option]").length'), 3, 'Opening options leaves model choices visible')
    await capture('picker-options')

    await click(button('Sonnet', '[data-composer-models]'))
    const heldModelPositions = await run('[...document.querySelectorAll("[data-composer-models] [role=option]")].map(node=>({name:node.textContent,top:node.getBoundingClientRect().top,height:node.getBoundingClientRect().height}))')
    await run('holdNextModel()')
    await click(button('Opus', '[data-composer-models]'))
    assert.deepEqual(await run('[...document.querySelectorAll("[data-composer-models] [role=option]")].map(node=>({name:node.textContent,top:node.getBoundingClientRect().top,height:node.getBoundingClientRect().height}))'), heldModelPositions, 'Pending acknowledgement does not move or reorder model rows')
    assert.equal(await run('[...document.querySelectorAll("[aria-label=Reasoning] button,[data-composer-models] [role=option]")].every(button=>button.disabled)'), true, 'Pending models disable old reasoning and model options')
    await run('replaceCatalog()')
    assert.equal(await run('[...document.querySelectorAll("[aria-label=Reasoning] button,[data-composer-models] [role=option]")].every(button=>button.disabled)'), true, 'Unrelated catalog updates cannot acknowledge a pending model')
    const beforeAck = (await run('read()')).changes.length
    await click(button('Medium', '[aria-label="Reasoning"]'))
    assert.equal((await run('read()')).changes.length, beforeAck)
    assert.equal((await run('read()')).model, 'sonnet')
    await run('ackModel()')
    await until('document.querySelector("[aria-label=Reasoning] button:last-child")?.disabled===false')
    assert.equal((await run('read()')).model, 'opus')
    await click(button('Max', '[aria-label="Reasoning"]'))
    await run('holdNextModel()')
    await click(button('Sonnet', '[data-composer-models]'))
    await run("rejectModel('Model selection was refused')")
    await until('[...document.querySelectorAll(".composer-model-picker [role=alert]")].some(node=>node.textContent.includes("Model selection was refused"))')
    assert.equal((await run('read()')).model, 'opus')
    assert.equal(await run('[...document.querySelectorAll("[aria-label=Reasoning] button,[data-composer-models] [role=option]")].every(button=>!button.disabled)'), true)
    await click(button('Sonnet', '[data-composer-models]'))
    assert.equal((await run('read()')).model, 'sonnet', 'A failed model can be retried')
    assert.equal(await run('!!document.querySelector(".composer-model-picker [role=alert]")'), false)
    await run('holdNextModel()')
    await click(button('Opus', '[data-composer-models]'))
    await key('Escape')
    await run("rejectModel('A dismissed request failed')")
    await open()
    assert.equal(await run('!!document.querySelector(".composer-model-picker [role=alert]")'), false, 'Late failure from a dismissed request is not shown on reopen')
    await run('holdNextModel()')
    await click(button('Opus', '[data-composer-models]'))
    await run('chooseProvider("gemini")')
    await run("rejectModel('The previous provider refused a model')")
    assert.equal((await run('read()')).providerId, 'gemini')
    assert.equal((await run('read()')).open, true)
    assert.deepEqual((await run('read()')).models.map(option => option.name), ['Agent default'])
    assert.deepEqual((await run('read()')).reasoning, [])
    assert.equal(await run('!!document.querySelector(".composer-model-picker [role=alert]")'), false, 'Previous-provider model failures cannot leak into a new provider')

    await run('window.samePicker=document.querySelector(".composer-model-picker")')
    await click('document.querySelector(".composer-location-control > button")')
    assert.equal(await run('document.querySelector(".composer-model-picker")===samePicker'), true, 'The location shortcut uses the already open picker')
    assert.equal(await run('document.activeElement.getAttribute("aria-label")'), 'Gemini · Local')
    assert.equal(await run('!!document.querySelector(".composer-location-control [role=menu]")'), false, 'There is no independent run-location menu')
    await key('Escape')
    assert.equal(await run('document.activeElement===document.querySelector(".composer-location-control > button")'), true, 'Escape restores the shortcut that opened the picker')
    await click('document.querySelector(".composer-location-control > button")')
    await click(agent('Claude', 'Cloud'))
    assert.equal((await run('read()')).providerId, 'cloud-claude', 'Remote agents are directly selectable without a location-navigation step')
    assert.equal((await run('read()')).open, true)
    const unchanged = (await run('read()')).changes.length
    await click(agent('Claude', 'Cloud'))
    assert.equal((await run('read()')).changes.length, unchanged, 'Reselecting a current endpoint does not reconfigure it')
    await click(agent('Backup worker', 'Hosted'))
    assert.equal((await run('read()')).providerId, 'managed-remote')
    assert.deepEqual((await run('read()')).changes.at(-1), ['provider', 'managed-remote', { configId: 'agent', value: 'worker-b' }], 'A provider and named child apply in one action')
    assert.equal((await run('read()')).agentConfig.find(option => option.category === 'agent').currentValue, 'worker-b')
    assert.equal(await run('document.querySelector(".composer-model-trigger").textContent.includes("Backup worker")'), false, 'The closed trigger remains compact with model and reasoning only')
    assert.equal(await run('document.querySelector(".composer-model-trigger").title.includes("Backup worker")&&document.querySelector(".composer-model-trigger").title.includes("Hosted")'), true, 'Full agent and location context remains in the trigger tooltip')
    assert.deepEqual((await run('read()')).agents.filter(option => option.selected === 'true').map(option => option.name), ['Backup worker · Hosted'], 'The bound child wins over the provider default')
    assert.equal(await run('!!'+button('Managed agent')), false, 'Named agents do not need a separate managed-agent control')
    await click(button('Low', '[aria-label="Reasoning"]'))
    await run('holdNextAgent()')
    await click(agent('Primary worker', 'Hosted'))
    assert.equal(await run('[...document.querySelectorAll("[data-composer-agents] [role=option]")].every(node=>node.disabled)'), true)
    assert.equal((await run('read()')).agentConfig.find(option => option.category === 'agent').currentValue, 'worker-b')
    await run("rejectAgent('Agent change was refused')")
    await until('[...document.querySelectorAll(".composer-model-picker [role=alert]")].some(node=>node.textContent.includes("Agent change was refused"))')
    assert.equal((await run('read()')).agentConfig.find(option => option.category === 'agent').currentValue, 'worker-b')
    await click(agent('Primary worker', 'Hosted'))
    assert.equal((await run('read()')).effort, 'low', 'Changing a child agent keeps the chosen reasoning')
    assert.equal((await run('read()')).model, 'managed-reasoner')
    assert.equal((await run('read()')).agentConfig.find(option => option.category === 'agent').currentValue, 'worker-a')
    assert.equal((await run('read()')).open, true)
    await retained()
    await capture('picker-managed')
    await run('holdNextAgent()')
    await click(agent('Backup worker', 'Hosted'))
    await key('Escape')
    await run("rejectAgent('A dismissed agent change failed')")
    await open()
    assert.equal(await run('[...document.querySelectorAll("[data-composer-agents] [role=option]")].every(node=>!node.disabled)'), true)
    assert.equal(await run('!!document.querySelector(".composer-model-picker [role=alert]")'), false, 'Dismissed child requests cannot disable or poison a reopened picker')

    await run('chooseProvider("codex");hostedUnavailable()')
    assert.equal(await run('[...document.querySelectorAll("[data-composer-agents] [role=option]")].filter(node=>node.getAttribute("aria-label").endsWith(" · Hosted")).length'), 0, 'Unavailable providers are explanatory context, not phantom choices')
    assert.equal(await run('[...document.querySelectorAll(".composer-model-picker [role=status]")].some(node=>node.textContent.includes("Sign in to Hosted in Settings first."))'), true)
    assert.equal((await run('read()')).providerId, 'codex')
    await capture('picker-unavailable')
    await run('restoreHostedAgents();emptyHostedAgents()')
    assert.equal(await run('[...document.querySelectorAll("[data-composer-agents] [role=option]")].filter(node=>node.getAttribute("aria-label").endsWith(" · Hosted")).length'), 0)
    assert.equal(await run('[...document.querySelectorAll(".composer-picker-note")].some(node=>node.textContent.includes("No agents available"))'), true)
    await run('restoreHostedAgents()')
    await run('patch({threadId:"saved-chat",activities:[{id:"prompt",kind:"user",content:"Saved prompt"}],turn:{tag:"idle"}})')
    assert.equal(await run('[...document.querySelectorAll("[data-composer-agents] [role=option]")].every(node=>node.disabled)'), true, 'Existing chats cannot retarget their agent')
    assert.equal(await run('document.querySelector("select[aria-label=Agent]")?.disabled??true'), true)
    assert.equal(await run('(()=>{const name=document.querySelector(".composer-picker-agent-select .composer-picker-current-agent");return name?.getBoundingClientRect().width>0&&name.textContent.includes("Codex")&&name.textContent.includes("Local")})()'), true, 'Readonly conversations keep their bound agent and source visible')
    assert.equal(await run('[...document.querySelectorAll("[data-composer-models] [role=option]")].every(node=>!node.disabled)'), true, 'Locked agent identity does not disable model choices')
    assert.equal(await run('document.querySelector(".composer-location-control > button").disabled'), true)
    await key('Escape')
    await run('patch({threadId:undefined,activities:[],turn:{tag:"running"}})')
    await open()
    assert.equal(await run('[...document.querySelectorAll("[data-composer-agents] [role=option]")].every(node=>node.disabled)'), true, 'An active turn cannot switch agents before history arrives')
    await key('Escape')
    await run('patch({threadId:undefined,activities:[],turn:{tag:"idle"}});emptyCodex()')
    await open()
    assert.equal(await run('!!document.activeElement.closest(".composer-model-picker")&&!document.activeElement.disabled'), true, 'An empty catalog focuses an available control')
    assert.equal(await run('modelRequests'), 0)
    await click(button('Load models'))
    assert.equal(await run('modelRequests'), 1)
    await run("finishLoad('Catalog unavailable')")
    await until('[...document.querySelectorAll(".composer-model-picker [role=alert]")].some(node=>node.textContent.includes("Catalog unavailable"))')
    await click(button('Load models'))
    assert.equal(await run('modelRequests'), 2)
    await run('finishLoad()')
    await until('document.querySelector("[data-composer-models] [aria-selected=true]")')
    assert.equal((await run('read()')).models.filter(option => option.selected === 'true')[0].name, 'Balanced')
    await showOptions()
    await click(button('Refresh models'))
    assert.equal(await run('modelRequests'), 3)
    await run('finishLoad()')
    await until('!'+button('Refresh models')+'.disabled')
    await click(button('Reset to default'))
    assert.equal((await run('read()')).model, undefined)
    assert.equal((await run('read()')).effort, undefined)
    assert.equal((await run('read()')).open, true, 'Reset leaves the unified picker open')
    await key('Escape')
    await run('emptyCodex()')
    await open(); await click(button('Load models'))
    await click(agent('Claude', 'Local'))
    await run("finishLoad('Old Codex request failed')")
    assert.equal((await run('read()')).providerId, 'claude')
    assert.equal(await run('!!document.querySelector(".composer-model-picker [role=alert]")'), false)
    await key('Escape')
    await retained()

    await run('chooseProvider("codex")')
    for (const theme of ['light', 'dark']) {
      for (const width of [1000, 420, 320]) {
        win.setContentSize(width, 800)
        await run(`document.documentElement.dataset.altoTheme=${JSON.stringify(theme)}`)
        await frames(); await open()
        const geometry = await run('geometry()')
        assert.ok(geometry.popup.width > 200 && geometry.popup.height > 180, JSON.stringify(geometry))
        assert.ok(geometry.popup.width <= 560, JSON.stringify(geometry))
        assert.ok(geometry.popup.left >= 0 && geometry.popup.right <= width + 1 && geometry.popup.top >= 0 && geometry.popup.bottom <= geometry.height, JSON.stringify(geometry))
        assert.ok(geometry.page <= width + 1, JSON.stringify(geometry))
        assert.ok(geometry.list.scroll > geometry.list.visible && geometry.list.visible > 60, JSON.stringify(geometry))
        assert.ok(geometry.controls.every(control => control.left >= geometry.popup.left && control.right <= geometry.popup.right + 1 && control.top >= geometry.popup.top && control.bottom <= geometry.popup.bottom + 1), JSON.stringify(geometry))
        assert.ok(geometry.models.filter(model => ['Swift', 'Balanced', 'Automatic'].includes(model.name)).every(model => model.height <= 34), JSON.stringify(geometry))
        assert.equal(geometry.reasoning.length, 6)
        assert.ok(geometry.reasoning.every(control => control.height <= 32), JSON.stringify(geometry))
        assert.ok(geometry.reasoning.every((control, index) => geometry.reasoning.slice(index + 1).every(other => control.right <= other.left + 1 || other.right <= control.left + 1 || control.bottom <= other.top + 1 || other.bottom <= control.top + 1)), 'Reasoning controls cannot overlap')
        if (width > 520) {
          assert.ok(geometry.rail.width > 100 && geometry.nativeAgent.width === 0, 'Wide pickers expose agents and models together: ' + JSON.stringify(geometry))
          assert.ok(geometry.agents.right < geometry.list.left + 1, 'Agent and model lists are side by side: ' + JSON.stringify(geometry))
        } else {
          if (width === 320) {
            const compactPositions = await run('[...document.querySelectorAll("[data-composer-models] [role=option]")].map(node=>({name:node.textContent,top:node.getBoundingClientRect().top,height:node.getBoundingClientRect().height}))')
            await run('holdNextModel()')
            await click(button('Swift', '[data-composer-models]'))
            assert.deepEqual(await run('[...document.querySelectorAll("[data-composer-models] [role=option]")].map(node=>({name:node.textContent,top:node.getBoundingClientRect().top,height:node.getBoundingClientRect().height}))'), compactPositions, 'Pending model feedback also keeps compact model rows stationary')
            await run('ackModel()')
            await click(button('Balanced', '[data-composer-models]'))
          }
          assert.equal(geometry.rail.width, 0, 'Compact panes replace the rail with a native agent selector')
          assert.ok(geometry.nativeAgent.width > 100, JSON.stringify(geometry))
          assert.equal((await run('read()')).models.map(option => option.name).join('|'), nativeOrder.join('|'))
          await chooseAgent('Backup worker', 'Hosted')
          assert.equal((await run('read()')).providerId, 'managed-remote')
          assert.equal((await run('read()')).agentConfig.find(option => option.category === 'agent').currentValue, 'worker-b')
          await chooseAgent('Codex', 'Local')
        }
        await capture('picker-' + theme + '-' + width)
        await key('Escape')
        await click('document.querySelector(".composer-location-control > button")')
        if (width > 520) assert.equal(await run('document.activeElement.getAttribute("aria-label")'), 'Codex · Local')
        else assert.equal(await run('document.activeElement===document.querySelector("select[aria-label=Agent]")'), true)
        await key('Escape')
        assert.equal(await run('document.activeElement===document.querySelector(".composer-location-control > button")'), true)
      }
    }
    await run('manyHostedAgents()')
    win.setContentSize(1000, 360)
    await frames(); await open()
    const initialScroll = await run('document.querySelector("[data-composer-models]").scrollTop')
    await run(agent('Codex', 'Local') + '.focus()')
    await key('End')
    const scrolling = await run(`(()=>{const list=document.querySelector('[data-composer-agents]'),active=document.activeElement;
      const r=list.getBoundingClientRect(),a=active.getBoundingClientRect();return {top:r.top,bottom:r.bottom,activeTop:a.top,activeBottom:a.bottom,scroll:list.scrollHeight,visible:list.clientHeight,modelScroll:document.querySelector('[data-composer-models]').scrollTop}})()`)
    assert.ok(scrolling.scroll > scrolling.visible && scrolling.visible > 20, JSON.stringify(scrolling))
    assert.ok(scrolling.activeTop >= scrolling.top && scrolling.activeBottom <= scrolling.bottom + 1, 'Last agent remains reachable on short windows: ' + JSON.stringify(scrolling))
    assert.equal(scrolling.modelScroll, initialScroll, 'Scrolling the agent list does not move the model list')
    await capture('picker-short-wide')
    await key('Escape')
    win.setContentSize(320, 360)
    await frames(); await open()
    const short = await run('geometry()')
    assert.ok(short.popup.top >= 0 && short.popup.bottom <= 360 && short.popup.right <= 321, JSON.stringify(short))
    assert.ok(short.list.visible >= 32, 'A short compact window still exposes a full model row: ' + JSON.stringify(short))
    assert.ok(await run('document.querySelector("select[aria-label=Agent]").options.length') > 20)
    await chooseAgent('Backup worker', 'Hosted')
    assert.equal((await run('read()')).providerId, 'managed-remote')
    assert.equal((await run('read()')).open, true)
    await capture('picker-short-compact')
    await key('Escape')
    await run('restoreHostedAgents();chooseProvider("codex")')
    win.setContentSize(320, 800)
    await frames()
    for (const [anchor, focus, model] of [[7, 7, 'Swift'], [6, 11, 'Balanced'], [11, 6, 'Swift']]) {
      await run(`selectDraft(${anchor},${focus})`)
      assert.deepEqual(await run('draftSelection()'), { focused: true, original: true, anchor, focus })
      await open()
      await click(button(model, '[data-composer-models]'))
      await click(button('Medium', '[aria-label="Reasoning"]'))
      if (anchor === 11 && focus === 6) {
        await run('window.caretPicker=document.querySelector(".composer-model-picker")')
        await click('document.querySelector(".composer-location-control > button")')
        assert.equal(await run('document.querySelector(".composer-model-picker")===caretPicker'), true)
        await chooseAgent('Claude', 'Local')
        await click(button('Sonnet', '[data-composer-models]'))
        await click(button('Medium', '[aria-label="Reasoning"]'))
        await chooseAgent('Codex', 'Local')
        await showOptions(); await click(button('Reset to default'))
      }
      assert.equal((await run('read()')).open, true)
      assert.equal(await run('focusDraft()'), true)
      await frames()
      assert.deepEqual(await run('draftSelection()'), { focused: true, original: true, anchor, focus }, 'Agent, model, and reasoning controls preserve draft caret and selected ranges')
      await retained()
    }
    await run('selectDraft(9,9)')
    await open(); await click(button('Balanced', '[data-composer-models]'))
    assert.equal(await run('focusDraft()'), true)
    await frames()
    assert.equal((await run('read()')).open, false)
    assert.deepEqual(await run('draftSelection()'), { focused: true, original: true, anchor: 9, focus: 9 })

    win.setContentSize(1000, 800)
    await frames()
    await run('selectDraft(5,5)')
    await open()
    const placement = await run(`(()=>{const range=document.createRange();range.setStart(originalDraftNode,17);range.setEnd(originalDraftNode,18);
      const r=range.getBoundingClientRect(),point={x:Math.round(r.left+1),y:Math.round(r.top+r.height/2)};
      if(!editor().contains(document.elementFromPoint(point.x,point.y)))throw new Error('The pointer target is obscured by the picker');return point})()`)
    await pointer(placement)
    assert.equal((await run('read()')).open, false)
    const placed = await run('draftSelection()')
    assert.equal(placed.focused && placed.original, true)
    assert.equal(placed.anchor, placed.focus)
    assert.notEqual(placed.focus, 5)
    await outside(); await run('focusDraft()'); await frames()
    assert.deepEqual(await run('draftSelection()'), placed, 'Native pointer caret placement survives later composer focus')
    await retained()
    await open()
    const overlap = await run(`(()=>{const model=[...document.querySelectorAll('[data-composer-models] [role=option]')].find(node=>node.textContent==='Automatic');
      model.scrollIntoView({block:'nearest'});const r=model.getBoundingClientRect(),point={x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
      const surface=document.getElementById('activity-overlay');surface.hidden=false;
      const control=surface.querySelector('.turn-progress-control'),origin=surface.getBoundingClientRect();
      Object.assign(control.style,{left:(point.x-origin.left)+'px',top:(point.y-origin.top)+'px',bottom:'auto',transition:'none',transform:'translate(-50%,-50%)'});return point})()`)
    await frames()
    assert.equal(await run(`document.elementFromPoint(${overlap.x},${overlap.y})?.closest('[data-composer-models] [role=option]')?.textContent`), 'Automatic')
    await pointer(overlap)
    assert.equal((await run('read()')).model, 'automatic')
    assert.equal(await run('activityClicks'), 0, 'The picker stays above overlapping activity controls')
    await key('Escape')
    assert.equal(await run(`document.elementFromPoint(${overlap.x},${overlap.y})?.closest('#activity-button')?.id`), 'activity-button')
    await pointer(overlap)
    assert.equal(await run('activityClicks'), 1)
    await run('document.getElementById("activity-overlay").hidden=true')
    await retained()
    await open()
    const beforeExpansion = await run('editor().closest(".composer").getBoundingClientRect().height')
    await run('expandComposer()')
    await frames()
    const expanded = await run('geometry()')
    assert.equal((await run('read()')).open, true, 'Expanding the composer preserves the open picker')
    const expandedComposerHeight = await run('editor().closest(".composer").getBoundingClientRect().height')
    assert.ok(expandedComposerHeight > beforeExpansion + 20, 'The fixture exercises an actual composer-height change: ' + JSON.stringify({ beforeExpansion, expandedComposerHeight }))
    assert.ok(expanded.popup.top >= 0 && expanded.popup.bottom <= expanded.height && expanded.popup.left >= 0, 'The picker follows the expanded composer anchor: ' + JSON.stringify(expanded))
    assert.ok(expanded.list.visible >= 32, JSON.stringify(expanded))
    await capture('picker-expanded-composer')
    await key('Escape')
    await run('teardown()')
    console.log('Composer model picker browser checks passed')
  } catch (error) {
    await capture('failure')
    console.error(await run('JSON.stringify(read())'))
    throw error
  } finally {
    win.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
