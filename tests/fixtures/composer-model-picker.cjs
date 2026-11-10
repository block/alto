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
        'cloud-claude':claude};
      const providers=[{id:'codex',label:'Codex'},{id:'claude',agentId:'claude',label:'Claude'},
        {id:'gemini',agentId:'gemini',label:'Gemini'},
        {id:'cloud-codex',agentId:'codex',label:'Codex',location:{id:'cloud',label:'Cloud'}},
        {id:'cloud-claude',agentId:'claude',label:'Claude',location:{id:'cloud',label:'Cloud'}}];
      const extraConfig=()=>[{id:'verbosity',name:'Verbosity',currentValue:'quiet',category:'verbosity',options:[{value:'quiet',name:'Quiet'},{value:'full',name:'Full'}]}];
      let state={revision:1,connected:true,providerId:'codex',providers,models:native,agentConfig:[],
        session:{workspace:'/repo',permissionMode:'full',model:'balanced',effort:'high'},turn:{tag:'idle'},
        harness:{codex:{status:'ready',models:native},extensions:{}},projects:[],skills:[],activities:[],
        canAcceptDirectInput:true,projectScope:'unscoped'};
      let draft={message:'Draft kept while choosing models.',images:[],attachments:[]};
      window.changes=[];window.pendingLoads=[];window.pendingModelRequests=[];window.modelRequests=0;window.clickCount=0;window.sent=[];window.activityClicks=0;
      document.addEventListener('click',()=>clickCount++,true);
      const publish=next=>flushSync(()=>{state={...state,...next,revision:state.revision+1};for(const listener of listeners)listener()});
      const selectProvider=providerId=>{
        const models=catalogs[providerId],model=models.find(option=>option.isDefault)??models[0];
        publish({providerId,models,agentConfig:providerId.includes('claude')?extraConfig():[],
          session:{...state.session,model:model?.id,effort:model?.defaultReasoningEffort}});
      };
      let holdModel=false;
      const selectModel=id=>{const model=state.models.find(option=>option.id===id)??state.models.find(option=>option.isDefault);
        publish({session:{...state.session,model:id,effort:model?.defaultReasoningEffort}})};
      const session={snapshot:()=>state,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},
        setProvider:id=>{changes.push(['provider',id]);selectProvider(id)},
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
      window.chooseProvider=id=>selectProvider(id);
      window.holdNextModel=()=>{holdModel=true};
      window.ackModel=()=>{const pending=pendingModelRequests.shift();selectModel(pending.model);pending.resolve();return pending.promise};
      window.rejectModel=error=>{const pending=pendingModelRequests.shift();pending.reject(new Error(error));return pending.promise.catch(()=>{})};
      window.replaceCatalog=()=>publish({models:state.models.map(model=>({...model}))});
      window.patch=change=>publish(change);
      window.emptyCodex=()=>{selectProvider('codex');publish({models:[],harness:{...state.harness,codex:{status:'stopped',models:[]}},
        session:{...state.session,model:undefined,effort:undefined}})};
      window.finishLoad=error=>{const pending=pendingLoads.shift();if(!pending)throw new Error('No pending catalog request');
        if(error)pending.reject(new Error(error));else{if(state.providerId==='codex')publish({models:native,harness:{...state.harness,codex:{status:'ready',models:native}}});pending.resolve()}};
      window.resetChanges=()=>{changes.length=0;clickCount=0};
      window.read=()=>({providerId:state.providerId,model:state.session.model,effort:state.session.effort,changes:[...changes],
        draft:draft.message,clicks:clickCount,requests:modelRequests,pending:pendingLoads.length,
        open:!!document.querySelector('.composer-model-picker'),
        models:[...document.querySelectorAll('[role="listbox"][aria-label="Models"] [role="option"]')].map(option=>({name:option.textContent,selected:option.getAttribute('aria-selected')})),
        reasoning:[...document.querySelectorAll('[aria-label="Reasoning"] button')].map(button=>({name:button.textContent,selected:button.getAttribute('aria-pressed')})),
        focus:document.activeElement?.getAttribute('aria-label')??document.activeElement?.textContent});
      window.geometry=()=>{
        const popup=document.querySelector('.composer-model-picker'),list=document.querySelector('[data-composer-models]');
        const box=node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
        return {width:innerWidth,height:innerHeight,page:document.documentElement.scrollWidth,popup:box(popup),
          list:{...box(list),scroll:list.scrollHeight,visible:list.clientHeight},
          controls:[...popup.querySelectorAll('button')].filter(node=>!node.closest('[data-composer-models]')).map(box),
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
  const run = code => win.webContents.executeJavaScript(code)
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

    await run('resetChanges()')
    await open()
    assert.equal((await run('read()')).models[0].name, 'Balanced')
    assert.equal(await run('document.activeElement.textContent'), 'Balanced')
    assert.equal(await run('document.activeElement.getAttribute("aria-selected")'), 'true')
    assert.equal(await run('document.querySelector(".composer-model-picker input")'), null, 'The picker opens directly to model choices')
    assert.equal(await run('modelRequests'), 0, 'Opening a populated picker does not start or reload a CLI')
    await click(button('Swift'))
    assert.equal((await run('read()')).open, true)
    assert.deepEqual((await run('read()')).reasoning.map(option => option.name), ['Low', 'Medium'])
    await click(button('Medium', '[aria-label="Reasoning"]'))
    assert.deepEqual((await run('read()')).changes, [['model', 'swift-v2'], ['effort', 'medium']])
    assert.equal((await run('read()')).clicks, 3, 'Model and reasoning require three clicks total')
    assert.equal((await run('read()')).open, true, 'Choosing reasoning keeps the picker open')
    assert.deepEqual((await run('read()')).models.filter(option => option.selected === 'true').map(option => option.name), ['Swift'])
    assert.deepEqual((await run('read()')).reasoning.filter(option => option.selected === 'true').map(option => option.name), ['Medium'])
    await click(button('Balanced'))
    await click(button('High', '[aria-label="Reasoning"]'))
    await click(button('Swift'))
    await click(button('Low', '[aria-label="Reasoning"]'))
    assert.equal((await run('read()')).open, true, 'Models and reasoning can be changed repeatedly in the same popup')
    assert.deepEqual((await run('read()')).models.filter(option => option.selected === 'true').map(option => option.name), ['Swift'])
    assert.deepEqual((await run('read()')).reasoning.filter(option => option.selected === 'true').map(option => option.name), ['Low'])
    await key('Escape')
    assert.equal((await run('read()')).open, false)
    assert.equal(await run('document.activeElement.classList.contains("composer-model-trigger")'), true)
    await retained()

    await run('resetChanges()')
    await open()
    await click(button('Balanced'))
    assert.equal((await run('read()')).clicks, 2, 'Changing only the model requires two clicks')
    assert.deepEqual((await run('read()')).changes, [['model', 'balanced']])
    await outside()
    assert.equal((await run('read()')).open, false)
    assert.equal(await run('document.activeElement.id'), 'outside', 'Outside dismissal keeps the clicked control focused')
    await run('resetChanges()')
    await open()
    await click(button('High', '[aria-label="Reasoning"]'))
    assert.equal((await run('read()')).clicks, 2, 'Changing only reasoning requires two clicks')
    assert.equal((await run('read()')).open, true)
    await run('resetChanges()')
    await click(button('Balanced'))
    assert.deepEqual((await run('read()')).changes, [], 'Clicking the current model does not reset reasoning')
    assert.equal((await run('read()')).effort, 'high')

    await run(button('Swift') + '.focus()')
    await run("for(const key of ['Enter','Escape','ArrowDown'])document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,isComposing:true,bubbles:true,cancelable:true}))")
    assert.equal((await run('read()')).model, 'balanced', 'IME confirmation is not a model selection')
    assert.equal((await run('read()')).open, true, 'IME Escape does not dismiss the picker')
    assert.equal(await run('document.activeElement.textContent'), 'Swift', 'IME arrow keys do not move model focus')
    await key('Return')
    assert.equal((await run('read()')).model, 'swift-v2')
    assert.equal((await run('read()')).open, true)
    await key('Down')
    assert.equal(await run('document.activeElement.textContent'), 'Balanced')
    await key('End')
    assert.equal(await run('document.activeElement.textContent'), 'Additional model 8 with a longer descriptive label')
    await key('Home')
    assert.equal(await run('document.activeElement.textContent'), 'Swift')
    await key('Escape')
    assert.equal((await run('read()')).open, false)
    assert.equal(await run('document.activeElement.classList.contains("composer-model-trigger")'), true)
    await open()
    await run("document.querySelector('[aria-label=\"Reasoning\"] button').focus()")
    await key('Right')
    assert.equal(await run('document.activeElement.textContent'), 'Medium')
    await key('Home')
    assert.equal(await run('document.activeElement.textContent'), 'Low')
    await key('Return')
    assert.equal((await run('read()')).effort, 'low')
    assert.equal((await run('read()')).open, true, 'Keyboard reasoning selection keeps the popup open')
    assert.equal(await run('document.activeElement.getAttribute("aria-pressed")'), 'true')
    await key('Right')
    await key('Return')
    assert.equal((await run('read()')).effort, 'medium')
    assert.equal((await run('read()')).open, true)
    assert.deepEqual((await run('read()')).reasoning.filter(option => option.selected === 'true').map(option => option.name), ['Medium'])

    await click(button('Reset to default'))
    assert.equal((await run('read()')).open, true, 'Resetting defaults keeps the popup open')
    assert.equal((await run('read()')).model, undefined)
    assert.equal((await run('read()')).effort, undefined)
    assert.deepEqual((await run('read()')).models.filter(option => option.selected === 'true').map(option => option.name), ['Balanced'])
    assert.deepEqual((await run('read()')).reasoning.filter(option => option.selected === 'true').map(option => option.name), ['Medium'])

    await click(button('Automatic'))
    assert.deepEqual((await run('read()')).reasoning, [], 'Models without reasoning do not show invented levels')
    await run('window.agentPicker=document.querySelector(".composer-model-picker")')
    await click(button('Agent')); await click(button('Claude'))
    assert.equal((await run('read()')).providerId, 'claude')
    assert.equal((await run('read()')).open, true, 'Changing agents keeps the model picker open')
    assert.equal(await run('document.querySelector(".composer-model-picker")===agentPicker'), true, 'Agent changes retain the same popup')
    assert.deepEqual((await run('read()')).models.map(option => option.name), ['Opus', 'Haiku', 'Sonnet'])
    assert.deepEqual((await run('read()')).reasoning.map(option => option.name), ['Low', 'Medium', 'High', 'Max'])
    assert.equal(await run('document.activeElement.textContent'), 'Opus', 'The new agent opens directly to its selected model')
    await click(button('Haiku'))
    assert.deepEqual((await run('read()')).reasoning, [])
    await click(button('Sonnet'))
    assert.equal((await run('read()')).reasoning.some(option => option.name === 'Max'), false)
    await click(button('Medium', '[aria-label="Reasoning"]'))
    assert.equal((await run('read()')).effort, 'medium')
    assert.equal((await run('read()')).open, true, 'Agent, model, and reasoning can be chosen in one popup')
    await run('holdNextModel()')
    await click(button('Opus'))
    assert.equal(await run('document.querySelector(".composer-model-picker [role=status]").textContent'), 'Changing model…')
    assert.equal(await run('[...document.querySelectorAll("[aria-label=Reasoning] button")].every(button=>button.disabled)'), true)
    assert.equal(await run('[...document.querySelectorAll("[data-composer-models] [role=option]")].every(button=>button.disabled)'), true)
    await run('replaceCatalog()')
    assert.equal(await run('[...document.querySelectorAll("[aria-label=Reasoning] button,[data-composer-models] [role=option]")].every(button=>button.disabled)'), true, 'An unrelated catalog replacement cannot acknowledge the pending model')
    const changesBeforeAck = (await run('read()')).changes.length
    await click(button('Medium', '[aria-label="Reasoning"]'))
    assert.equal((await run('read()')).changes.length, changesBeforeAck, 'Old reasoning cannot apply while the new model is pending')
    assert.equal((await run('read()')).model, 'sonnet')
    await run('ackModel()')
    await until('document.querySelector("[aria-label=Reasoning] button:last-child")?.disabled===false')
    assert.equal((await run('read()')).model, 'opus')
    await click(button('Max', '[aria-label="Reasoning"]'))
    assert.equal((await run('read()')).effort, 'max')
    assert.equal((await run('read()')).open, true)
    await run('holdNextModel()')
    await click(button('Sonnet'))
    await run("rejectModel('Model selection was refused')")
    await until('document.querySelector(".composer-model-picker [role=alert]")?.textContent==="Model selection was refused"')
    assert.equal((await run('read()')).model, 'opus', 'A rejected model change leaves the previous model selected')
    assert.equal(await run('[...document.querySelectorAll("[aria-label=Reasoning] button,[data-composer-models] [role=option]")].every(button=>!button.disabled)'), true, 'A rejected model change re-enables the old choices')
    await click(button('Sonnet'))
    assert.equal((await run('read()')).model, 'sonnet', 'The failed model can be retried')
    assert.equal(await run('!!document.querySelector(".composer-model-picker [role=alert]")'), false)

    await run('holdNextModel()')
    await click(button('Opus'))
    await key('Escape')
    await run("rejectModel('A dismissed request failed')")
    await open()
    assert.equal(await run('!!document.querySelector(".composer-model-picker [role=alert]")'), false, 'A dismissed model request does not leak its late failure on reopen')
    await run('holdNextModel()')
    await click(button('Opus'))
    await click(button('Agent')); await click(button('Gemini'))
    await run("rejectModel('The previous provider refused a model')")
    assert.equal((await run('read()')).providerId, 'gemini')
    assert.equal((await run('read()')).open, true)
    assert.deepEqual((await run('read()')).models.map(option => option.name), ['Agent default'])
    assert.deepEqual((await run('read()')).reasoning, [])
    assert.equal(await run('!!document.querySelector(".composer-model-picker [role=alert]")'), false, 'A previous provider model request cannot publish an error into this picker')
    await key('Escape')
    await run('chooseProvider("claude")')
    await open()
    await click(button('Verbosity')); await click(button('Full'))
    assert.deepEqual((await run('read()')).changes.at(-1), ['config', 'verbosity', 'full'])
    assert.equal(await run('document.activeElement.getAttribute("aria-selected")'), 'true', 'Returning from extra settings focuses the selected model')
    await click(button('Agent'))
    assert.deepEqual(await run('[...document.querySelectorAll(".composer-picker-options [role=menuitemradio]")].map(node=>node.textContent)'), ['Codex', 'Claude', 'Gemini'])
    await click(button('Claude'))
    assert.equal((await run('read()')).open, true, 'Reselecting the current agent returns to model controls without dismissing')
    assert.equal((await run('read()')).providerId, 'claude')
    assert.equal(await run('document.activeElement.textContent'), 'Opus')
    assert.deepEqual((await run('read()')).reasoning.map(option => option.name), ['Low', 'Medium', 'High', 'Max'])
    await click(button('Agent'))
    await click(button('Gemini'))
    assert.equal((await run('read()')).open, true)
    assert.deepEqual((await run('read()')).reasoning, [], 'Automatic agents expose no invented reasoning choices')
    await outside()
    assert.equal((await run('read()')).open, false, 'Outside interaction still dismisses after agent selection')
    await click('document.querySelector(".composer-location-control > button")')
    assert.equal(await run(button('Cloud', '.composer-location-control') + '.disabled'), true, 'A missing remote agent does not switch to a different agent')
    await outside()
    await run('chooseProvider("claude")')
    await click('document.querySelector(".composer-location-control > button")')
    await click(button('Cloud', '.composer-location-control'))
    assert.equal((await run('read()')).providerId, 'cloud-claude')
    await open(); await click(button('Agent'))
    assert.deepEqual(await run('[...document.querySelectorAll(".composer-picker-options [role=menuitemradio]")].map(node=>node.textContent)'), ['Codex', 'Claude'])
    await key('Escape')
    await run('patch({threadId:"saved-chat",activities:[{id:"prompt",kind:"user",content:"Saved prompt"}],turn:{tag:"idle"}})')
    await open()
    assert.equal(await run(button('Agent') + '.disabled'), true, 'A chat with messages cannot switch agents')
    await key('Escape')
    await click('document.querySelector(".composer-location-control > button")')
    assert.equal(await run('[...document.querySelectorAll(".composer-location-control [role=menuitemradio]")].every(node=>node.disabled)'), true)
    await outside()
    await run('patch({threadId:undefined,activities:[],turn:{tag:"running"}})')
    await open()
    assert.equal(await run(button('Agent') + '.disabled'), true, 'An active turn cannot switch agents before any history arrives')
    await key('Escape')
    await run('patch({threadId:undefined,activities:[],turn:{tag:"idle"}});emptyCodex()')
    await open()
    assert.equal(await run('!!document.activeElement.closest(".composer-model-picker")&&!document.activeElement.disabled'), true, 'An empty picker focuses an available action')
    assert.equal(await run('modelRequests'), 0, 'An empty catalog also requires explicit loading')
    await click(button('Load models'))
    assert.equal(await run('modelRequests'), 1)
    assert.equal(await run('document.querySelector("[role=status]").textContent'), 'Loading models…')
    await run("finishLoad('Catalog unavailable')")
    await until('document.querySelector(".composer-model-picker [role=alert]")')
    assert.equal(await run('document.querySelector("[role=alert]").textContent'), 'Catalog unavailable')
    await click(button('Retry'))
    assert.equal(await run('modelRequests'), 2)
    await run('finishLoad()')
    await until('document.activeElement.getAttribute("aria-selected")==="true"')
    assert.equal(await run('document.activeElement.textContent'), 'Balanced', 'Loaded models receive focus without reopening')
    await click('document.querySelector("[aria-label=\\"Refresh models\\"]")')
    assert.equal(await run('modelRequests'), 3, 'Populated catalogs refresh only on explicit request')
    await run('finishLoad()')
    await until('!document.querySelector("[aria-label=\\"Refresh models\\"]").disabled')
    await key('Escape'); await run('emptyCodex()'); await open(); await click(button('Load models'))
    await click(button('Agent')); await click(button('Claude'))
    await run("finishLoad('Old Codex request failed')")
    assert.equal((await run('read()')).open, true)
    assert.equal((await run('read()')).providerId, 'claude')
    assert.equal((await run('read()')).models[0].name, 'Opus')
    assert.equal(await run('!!document.querySelector(".composer-model-picker [role=alert]")'), false, 'A previous provider request cannot leak an error into this provider')
    assert.equal(await run('!!document.querySelector(".composer-model-picker [role=status]")'), false)
    await key('Escape')
    await retained()

    await run('chooseProvider("codex")')
    for (const theme of ['light', 'dark']) {
      for (const width of [1000, 420, 320]) {
        win.setContentSize(width, 800)
        await run(`document.documentElement.dataset.altoTheme=${JSON.stringify(theme)}`)
        await frames(); await open()
        const geometry = await run('geometry()')
        assert.ok(geometry.popup.width > 200 && geometry.popup.height > 200, JSON.stringify(geometry))
        assert.ok(geometry.popup.width <= 322, 'The compact picker is at most 320px wide: ' + JSON.stringify(geometry))
        assert.ok(geometry.popup.left >= 0 && geometry.popup.right <= width + 1 && geometry.popup.top >= 0 && geometry.popup.bottom <= geometry.height, JSON.stringify(geometry))
        assert.ok(geometry.page <= width + 1, JSON.stringify(geometry))
        assert.ok(geometry.list.scroll > geometry.list.visible && geometry.list.visible > 80, JSON.stringify(geometry))
        assert.ok(geometry.controls.every(control => control.left >= geometry.popup.left && control.right <= geometry.popup.right + 1 && control.top >= geometry.popup.top && control.bottom <= geometry.popup.bottom + 1), JSON.stringify(geometry))
        assert.ok(geometry.models.filter(model => ['Swift', 'Balanced', 'Automatic'].includes(model.name)).every(model => model.height <= 34), 'Short model rows use compact spacing: ' + JSON.stringify(geometry))
        assert.equal(geometry.reasoning.length, 6, 'All six supported reasoning levels are rendered')
        assert.ok(geometry.reasoning.every(control => control.height <= 30), 'Reasoning controls use compact spacing: ' + JSON.stringify(geometry))
        assert.ok(geometry.reasoning.every((control, index) => geometry.reasoning.slice(index + 1).every(other => control.right <= other.left + 1 || other.right <= control.left + 1 || control.bottom <= other.top + 1 || other.bottom <= control.top + 1)), 'Wrapped reasoning controls cannot overlap')
        if (width === 320) {
          assert.ok(new Set(geometry.reasoning.map(control => Math.round(control.top))).size >= 2, 'Six reasoning levels wrap within a narrow picker')
          await click(button('XHigh', '[aria-label="Reasoning"]'))
          assert.equal((await run('read()')).effort, 'xhigh', 'A wrapped reasoning level receives native pointer clicks')
          assert.equal((await run('read()')).open, true)
        }
        await capture('model-picker-' + theme + '-' + width)
        await key('Escape')
      }
    }
    await retained()
    for (const [anchor, focus, model] of [[7, 7, 'Swift'], [6, 11, 'Balanced'], [11, 6, 'Swift']]) {
      await run(`selectDraft(${anchor},${focus})`)
      assert.deepEqual(await run('draftSelection()'), { focused: true, original: true, anchor, focus })
      await open()
      await click(button(model))
      await click(button('Medium', '[aria-label="Reasoning"]'))
      assert.equal((await run('read()')).open, true)
      if (anchor === 11 && focus === 6) {
        await click(button('Agent')); await click(button('Claude'))
        await click(button('Sonnet')); await click(button('Medium', '[aria-label="Reasoning"]'))
        assert.equal((await run('read()')).open, true)
        assert.equal((await run('read()')).providerId, 'claude')
        assert.equal((await run('read()')).model, 'sonnet')
        assert.equal((await run('read()')).effort, 'medium')
        await click(button('Agent')); await click(button('Codex'))
        await click(button('Reset to default'))
        assert.equal((await run('read()')).open, true)
      }
      assert.equal(await run('focusDraft()'), true, 'The actual composer service can restore editor focus')
      await frames()
      assert.deepEqual(await run('draftSelection()'), { focused: true, original: true, anchor, focus }, 'Agent, model, and reasoning choices preserve the draft caret and selected range')
      await retained()
    }
    await run('selectDraft(9,9)')
    await open()
    await click(button('Balanced'))
    assert.equal((await run('read()')).open, true)
    assert.equal(await run('focusDraft()'), true)
    await frames()
    assert.equal((await run('read()')).open, false, 'Explicit composer focus closes a model-only selection')
    assert.deepEqual(await run('draftSelection()'), { focused: true, original: true, anchor: 9, focus: 9 })

    win.setContentSize(1000, 800)
    await frames()
    await run('selectDraft(5,5)')
    await open()
    const placement = await run(`(()=>{
      const range=document.createRange();range.setStart(originalDraftNode,17);range.setEnd(originalDraftNode,18);
      const r=range.getBoundingClientRect(),point={x:Math.round(r.left+1),y:Math.round(r.top+r.height/2)};
      if(!editor().contains(document.elementFromPoint(point.x,point.y)))throw new Error('The pointer target is obscured by the picker');
      return point;
    })()`)
    await pointer(placement)
    assert.equal((await run('read()')).open, false, 'Clicking the editor dismisses the picker')
    const placed = await run('draftSelection()')
    assert.equal(placed.focused && placed.original, true)
    assert.equal(placed.anchor, placed.focus)
    assert.notEqual(placed.focus, 5, 'A native pointer click chooses a new caret position')
    await outside()
    assert.equal(await run('focusDraft()'), true)
    await frames()
    assert.deepEqual(await run('draftSelection()'), placed, 'Later composer focus preserves the new pointer placement')
    await retained()

    await open()
    const overlap = await run(`(()=>{
      const model=[...document.querySelectorAll('[data-composer-models] [role=option]')].find(node=>node.textContent==='Automatic');
      model.scrollIntoView({block:'nearest'});
      const r=model.getBoundingClientRect(),point={x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
      const surface=document.getElementById('activity-overlay');surface.hidden=false;
      const control=surface.querySelector('.turn-progress-control'),origin=surface.getBoundingClientRect();
      Object.assign(control.style,{left:(point.x-origin.left)+'px',top:(point.y-origin.top)+'px',bottom:'auto',transition:'none',transform:'translate(-50%,-50%)'});
      return point;
    })()`)
    await frames()
    assert.equal(await run(`(()=>{const r=document.getElementById('activity-button').getBoundingClientRect();return r.left<=${overlap.x}&&r.right>=${overlap.x}&&r.top<=${overlap.y}&&r.bottom>=${overlap.y}})()`), true, 'The real turn-progress styles place an activity control beneath the tested model row')
    assert.equal(await run(`document.elementFromPoint(${overlap.x},${overlap.y})?.closest('[data-composer-models] [role=option]')?.textContent`), 'Automatic', 'An open picker remains above the overlapping activity pill')
    await pointer(overlap)
    assert.equal((await run('read()')).model, 'automatic', 'The overlapping model row still receives native clicks')
    assert.equal(await run('activityClicks'), 0)
    await key('Escape')
    assert.equal(await run(`document.elementFromPoint(${overlap.x},${overlap.y})?.closest('#activity-button')?.id`), 'activity-button', 'Closing the picker exposes the underlying activity control')
    await pointer(overlap)
    assert.equal(await run('activityClicks'), 1, 'The activity control remains clickable after dismissal')
    await run('document.getElementById("activity-overlay").hidden=true')
    await retained()
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
