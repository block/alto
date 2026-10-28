const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'interface-appearance-check.tsx', loader: 'tsx', contents: `
      import React,{useState,useSyncExternalStore} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import appearancePlugin from './program/plugins/interface-appearance.client';
      import workspaceAppearancePlugin from './program/plugins/workspace-tabs-appearance.client';
      import surfacesPlugin from './program/plugins/ui-surfaces.client';
      import themePlugin from './program/plugins/theme.client';
      import searchPlugin from './program/plugins/search.client';
      import {WorkspaceTabActionMenu} from './program/plugins/workspace-tab-menu.client';
      import {Composer} from './program/plugins/ui/composer';
      import {uiStyles} from './program/plugins/ui/appearance';

      const owner=()=>{let cleanups=[];return {
        effect(fn){const cleanup=fn();if(typeof cleanup==='function')cleanups.push(cleanup);return cleanup},
        dispose(){const pending=cleanups;cleanups=[];for(const cleanup of pending.reverse())cleanup()}
      }};
      const featureOwner=owner(),workspaceOwner=owner(),styles=new Map(),surfaces=new Map(),roots=new Map(),pages=[];
      const uiListeners=new Set();let uiRevision=0;
      const changed=()=>{uiRevision++;for(const listener of uiListeners)listener()};
      const sessionListeners=new Set(),overlayListeners=new Set();let overlay;
      const overlays={subscribe:fn=>{overlayListeners.add(fn);return()=>overlayListeners.delete(fn)},snapshot:()=>overlay,
        open:id=>{overlay=id;for(const fn of overlayListeners)fn()},
        close:id=>{if(overlay===id){overlay=undefined;for(const fn of overlayListeners)fn()}},
        toggle:id=>overlay===id?overlays.close(id):overlays.open(id)};
      const threads=Array.from({length:20},(_,index)=>({id:'thread-'+index,title:'Conversation '+String(index).padStart(2,'0'),preview:'A saved reply',cwd:'/repo',createdAt:1,updatedAt:100-index}));
      let state={connected:true,threadId:'thread-0',session:{workspace:'/repo',permissionMode:'full'},projects:[],threads:[],skills:[],
        turn:{tag:'idle'},activities:[],history:{tag:'ready',entries:[]},
        harness:{extensions:{},server:{projectRoot:'/repo'},codex:{status:'ready',models:[]},program:{plugins:[],tools:[]},ui:{surfaces:[],contributions:[],regions:[]}}};
      const session={snapshot:()=>state,subscribe:fn=>{sessionListeners.add(fn);return()=>sessionListeners.delete(fn)},
        setPermissionMode:permissionMode=>{state={...state,session:{...state.session,permissionMode}};for(const fn of sessionListeners)fn()},
        selectProject:()=>{},saveProject:async()=>{},removeProject:async()=>{}};
      const selectedThreads=[];
      const layout={snapshot:()=>0,subscribe:()=>()=>{},tabs:()=>threads.map((thread,index)=>({id:'tab-'+index,title:thread.title,active:index===0,threadIds:[thread.id],threads:[thread]})),
        paneTargets:()=>[],focusThread:id=>{selectedThreads.push(id);return true},newTab:()=>{throw Error('Search should reuse its existing conversation')}};
      const host={snapshot:()=>({connectionEpoch:1}),subscribe:()=>()=>{},command:async()=>{},call:async(method,payload)=>method==='search.preview'?{preview:'Saved reply for '+payload.threadId}:undefined};
      const browserProgram={diagnostics:[]};
      const ui={subscribe:listener=>{uiListeners.add(listener);return()=>uiListeners.delete(listener)},snapshot:()=>uiRevision,overlays,settingsPages:()=>pages,
        registerStyle:(scope,id,css)=>scope.effect(()=>{if(styles.has(id))throw Error('Duplicate style '+id);const style=document.createElement('style');style.dataset.pluginStyle=id;style.textContent=css;styles.set(id,style);document.head.append(style);changed();return()=>{styles.delete(id);style.remove();changed()}}),
        registerSurface:(scope,id,component)=>scope.effect(()=>{surfaces.set(id,component);changed();return()=>{surfaces.delete(id);changed()}}),
        registerRoot:(scope,id,component)=>scope.effect(()=>{roots.set(id,component);changed();return()=>{roots.delete(id);changed()}}),
        registerSettingsPage:(scope,page)=>scope.effect(()=>{pages.push(page);changed();return()=>{pages.splice(pages.indexOf(page),1);changed()}}),
        registerComponent:()=>{},registerContributionRenderer:()=>{}};
      const services={clientUi:ui,clientSession:session,clientHost:host,clientMarkdown:{},clientWorkspaceLayout:layout,
        clientProgram:{subscribe:()=>()=>{},snapshot:()=>browserProgram},get:()=>undefined,on:()=>()=>{}};
      const apply=(plugin,scope,config)=>{const dispose=plugin(Object.assign(scope,services),config);if(typeof dispose==='function')scope.effect(()=>dispose)};
      let appearanceOwner;
      window.installAppearance=()=>flushSync(()=>{if(appearanceOwner)throw Error('Appearance already installed');appearanceOwner=owner();apply(appearancePlugin,appearanceOwner)});
      window.disableAppearance=()=>flushSync(()=>{appearanceOwner?.dispose();appearanceOwner=undefined});
      // Install global roles first, as a feature's later style registration must
      // not silently bypass them. Reinstallation below covers the reverse order.
      installAppearance();apply(surfacesPlugin,featureOwner);apply(themePlugin,featureOwner,{defaultMode:'light'});apply(searchPlugin,featureOwner);apply(workspaceAppearancePlugin,workspaceOwner);
      const menuRoot={current:document.getElementById('menu-host')};
      const closeMenu=()=>overlays.close('menu');
      function Menu(){const active=useSyncExternalStore(overlays.subscribe,overlays.snapshot);return active==='menu'?<WorkspaceTabActionMenu
        view={{id:'tab-0',name:'Conversation 00',workspace:'/repo',root:{type:'pane',id:'pane-0',workspace:'/repo'}}}
        x={36} y={76} trigger={document.getElementById('menu-trigger')} rootRef={menuRoot} close={closeMenu}
        actions={[{id:'rename',label:'Rename tab',available:()=>true,run:()=>{}},{id:'close',label:'Close tab',available:()=>true,run:()=>{}}]}/>:null}
      function Draft(){const [draft,setDraft]=useState('Keep this conversation draft.');return <Composer value={draft} onChange={setDraft} images={[]} attachments={[]} skills={[]} models={[]}
        permissionMode="full" workspaceLabel="/repo" workspaceOptions={[]} capabilities={[]} placeholder="Message" focusHeight={156} maxHeight={180} autoFocus={false}
        disabled={false} readOnly={false} sending={false} activeTurn={false} onImagesChange={()=>{}} onAttachmentsChange={()=>{}} onAttachFile={async()=>{}}
        onModelChange={()=>{}} onEffortChange={()=>{}} onPermissionModeChange={()=>{}} onWorkspaceChange={()=>{}} onSubmit={()=>{}} onInterrupt={()=>{}}/>}
      function App(){useSyncExternalStore(ui.subscribe,ui.snapshot);const Settings=surfaces.get('default-settings'),Search=roots.get('default-search');return <><div data-shell-node="workspace" className="fixture-workspace"><main className="workspace-layout-root">
        <div className="fixture-content"><button id="menu-trigger" className={uiStyles.button} onClick={()=>overlays.open('menu')}>Tab options</button></div><Draft/>
        </main></div><Settings surface={{id:'settings',kind:'settings'}}/><Search/><Menu/></>}
      const root=createRoot(document.getElementById('root'));
      flushSync(()=>root.render(<App/>));
      window.frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.openSettings=()=>flushSync(()=>overlays.open('settings'));
      window.cmdK=()=>flushSync(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',metaKey:true,bubbles:true,cancelable:true})));
      window.key=(selector,key)=>flushSync(()=>document.querySelector(selector).dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})));
      window.click=selector=>flushSync(()=>document.querySelector(selector).click());
      window.input=(selector,value)=>flushSync(()=>{const element=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}))});
      window.nav=label=>flushSync(()=>[...document.querySelectorAll('.program-modal-nav-item')].find(element=>element.textContent===label).click());
      window.setTheme=(mode,accent)=>{document.documentElement.dataset.altoTheme=mode;document.documentElement.style.setProperty('--alto-theme-accent',accent)};
      window.disableWorkspaceAppearance=()=>flushSync(()=>workspaceOwner.dispose());
      window.styleIds=()=>[...styles.keys()];
      window.searchState=()=>({query:document.querySelector('.search-palette input')?.value,selected:[...document.querySelectorAll('.search-result')].findIndex(element=>element.getAttribute('aria-selected')==='true'),overlay,selectedThreads});
      window.remember=(selector,name)=>{const element=document.querySelector(selector);element.focus();element.setSelectionRange?.(3,8);window[name]={element,value:element.value,text:element.textContent,start:element.selectionStart,end:element.selectionEnd};return true};
      window.preserved=(selector,name)=>{const saved=window[name],element=document.querySelector(selector);return saved.element===element&&element.isConnected&&element.value===saved.value&&element.textContent===saved.text&&element.selectionStart===saved.start&&element.selectionEnd===saved.end};
      window.samples=selectors=>{
        const canvas=document.createElement('canvas'),context=canvas.getContext('2d');canvas.width=canvas.height=1;
        const rgba=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);const value=[...context.getImageData(0,0,1,1).data];value[3]/=255;return value};
        const over=(a,b)=>a.slice(0,3).map((value,index)=>value*a[3]+b[index]*(1-a[3])).concat(1);
        const luminance=color=>color.slice(0,3).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
        const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
        return Object.fromEntries(selectors.map(selector=>{const element=document.querySelector(selector);if(!element)throw Error('Missing '+selector);const style=getComputedStyle(element),chain=[];
          for(let node=element;node;node=node.parentElement)chain.unshift(getComputedStyle(node));
          const background=chain.reduce((result,current)=>over(rgba(current.backgroundColor),result),[255,255,255,1]);
          const foreground=rgba(style.color);foreground[3]*=chain.reduce((result,current)=>result*Number(current.opacity),1);
          const outside=(parseFloat(style.outlineOffset)>=0?chain.slice(0,-1):chain).reduce((result,current)=>over(rgba(current.backgroundColor),result),[255,255,255,1]);
          const box=element.getBoundingClientRect();return[selector,{color:rgba(style.color),fill:rgba(style.backgroundColor),border:rgba(style.borderTopColor),outline:rgba(style.outlineColor),
            radius:style.borderTopLeftRadius,shadow:style.boxShadow,font:style.fontFamily,size:style.fontSize,weight:style.fontWeight,opacity:style.opacity,
            contrast:contrast(over(foreground,background),background),outlineWidth:parseFloat(style.outlineWidth),outlineStyle:style.outlineStyle,outlineContrast:contrast(over(rgba(style.outlineColor),outside),outside),
            x:box.x,right:box.right,width:box.width,backgroundImage:style.backgroundImage}]}));
      };
      window.bounds=selector=>{const box=document.querySelector(selector).getBoundingClientRect();return{left:box.left,right:box.right,width:innerWidth,scroll:document.documentElement.scrollWidth}};
      window.searchClearance=()=>{const panel=document.querySelector('.search-palette').getBoundingClientRect(),field=document.querySelector('.search-palette-input').getBoundingClientRect();return{left:field.left-panel.left,right:panel.right-field.right,top:field.top-panel.top}};
      window.settingsCopyBounds=()=>[...document.querySelectorAll('.theme-settings-card .settings-row')].map(row=>{const copy=row.querySelector('.settings-row-copy');return{label:copy.querySelector('strong').textContent,width:copy.clientWidth,scroll:copy.scrollWidth}});
      window.teardown=()=>{flushSync(()=>root.unmount());disableAppearance();workspaceOwner.dispose();featureOwner.dispose()};
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all(['src/client/styles.css', 'src/client/pane-toolbar.css', 'program/plugins/workspace-layout.css'].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((_request, response) => response.end('<!doctype html><style>' + css + '\n#root{height:100vh}.fixture-workspace{display:flex;flex:1;width:100%;height:100%;min-width:0}.fixture-workspace>main{display:flex;flex-direction:column;width:100%;padding:20px;gap:20px}.fixture-content{flex:1;min-height:0}#menu-host{position:fixed;inset:0;pointer-events:none}#menu-host>*{pointer-events:auto}</style><div id="root" class="shell-kernel"></div><div id="menu-host"></div>'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const win = new BrowserWindow({ show: false, width: 1100, height: 800, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = code => win.webContents.executeJavaScript(code)
  const settle = () => run('frame()')
  const sample = selectors => run(`samples(${JSON.stringify(selectors)})`)
  let documentNode
  const force = async (selector, states) => {
    if (!documentNode) documentNode = (await win.webContents.debugger.sendCommand('DOM.getDocument')).root.nodeId
    const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: documentNode, selector })
    assert.ok(nodeId, 'Missing control: ' + selector)
    await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states })
  }
  const sentinel = {
    '--ui-surface': '#eef2f6', '--ui-surface-inset': '#dde7ec', '--ui-border': '#203f59',
    '--ui-text': '#203040', '--ui-text-strong': '#102030', '--ui-text-secondary': '#405060',
    '--ui-control-fill': '#e1e8f1',
    '--ui-hover': '#d1dbe8', '--ui-pressed': '#c4d2e4', '--ui-selected': '#bdcde2',
    '--ui-field-fill': '#e6ebf2', '--ui-field-border': '#4f6580', '--ui-focus': '#8a276c',
    '--ui-action': '#364e78', '--ui-on-action': '#ffffff', '--ui-action-hover': '#2b4167', '--ui-action-pressed': '#1e304d',
    '--ui-panel-radius': '17px', '--ui-dialog-radius': '23px', '--ui-row-radius': '7px', '--ui-field-radius': '11px',
    '--ui-control-radius': '19px', '--ui-font': 'monospace', '--ui-size': '14px', '--ui-weight': '600',
    '--ui-panel-shadow': 'rgb(10, 20, 30) 0px 4px 9px 0px', '--ui-dialog-shadow': 'rgb(30, 20, 10) 0px 7px 11px 0px',
  }
  const setSentinels = enabled => run(`for(const [token,value] of Object.entries(${JSON.stringify(sentinel)})){${enabled ? 'document.documentElement.style.setProperty(token,value)' : 'document.documentElement.style.removeProperty(token)'}}`)
  const expectedColor = token => sentinel[token].slice(1).match(/../g).map(value => parseInt(value, 16)).concat(1)
  const assertRole = async (selector, property, token) => {
    const measured = (await sample([selector]))[selector][property]
    assert.deepEqual(measured, token.startsWith('--ui-') && sentinel[token].startsWith('#') ? expectedColor(token) : sentinel[token], `${selector} ${property} consumes ${token}`)
  }
  const assertPortal = selector => run(`!document.querySelector(${JSON.stringify(selector)}).closest('.workspace-layout-root')`)
  const assertFits = async selector => {
    const bounds = await run(`bounds(${JSON.stringify(selector)})`)
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.scroll <= bounds.width, selector + ': ' + JSON.stringify(bounds))
  }
  const contrast = async (selectors, minimum, context) => {
    await run('Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation=>animation.finished.catch(()=>{})))')
    for (const [selector, measured] of Object.entries(await sample(selectors))) {
      assert.equal(measured.backgroundImage, 'none', context + ': flat roles make the contrast sample complete')
      assert.ok(measured.contrast >= minimum, JSON.stringify({ context, selector, minimum, ...measured }))
    }
  }
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    await settle()
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('DOM.enable')
    await win.webContents.debugger.sendCommand('CSS.enable')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    await run(`remember('[data-cordis-composer-editor]','originalEditor')`)
    await setSentinels(true)
    for (const [property, token] of [['color', '--ui-text'], ['fill', '--ui-control-fill'], ['radius', '--ui-control-radius'], ['font', '--ui-font'], ['size', '--ui-size'], ['weight', '--ui-weight']]) await assertRole('#menu-trigger', property, token)
    for (const [states, token] of [[['hover'], '--ui-hover'], [['hover', 'active'], '--ui-pressed']]) {
      await force('#menu-trigger', states)
      await assertRole('#menu-trigger', 'fill', token)
    }
    await force('#menu-trigger', ['focus', 'focus-visible'])
    await assertRole('#menu-trigger', 'outline', '--ui-focus')
    await force('#menu-trigger', [])

    await run('cmdK()')
    await settle()
    assert.ok(await assertPortal('.search-palette'), 'Cmd+K is a real portal outside workspace appearance scope')
    for (const [property, token] of [['fill', '--ui-surface'], ['border', '--ui-border'], ['radius', '--ui-dialog-radius'], ['shadow', '--ui-dialog-shadow'], ['font', '--ui-font']]) await assertRole('.search-palette', property, token)
    for (const [property, token] of [['fill', '--ui-field-fill'], ['border', '--ui-field-border'], ['radius', '--ui-field-radius']]) await assertRole('.search-palette-input', property, token)
    await assertRole('.search-palette input', 'color', '--ui-text')
    await assertRole('.search-result strong', 'color', '--ui-text-strong')
    await assertRole('.search-result strong', 'size', '--ui-size')
    await assertRole('.search-result strong', 'weight', '--ui-weight')
    await assertRole('.search-result-copy>span', 'color', '--ui-text-secondary')
    await assertRole('.search-result.active', 'fill', '--ui-selected')
    for (const [states, token] of [[['hover'], '--ui-hover'], [['hover', 'active'], '--ui-pressed']]) {
      await force('.search-result:nth-child(2)', states)
      await assertRole('.search-result:nth-child(2)', 'fill', token)
    }
    await force('.search-result:nth-child(2)', [])
    assert.equal(await run(`document.activeElement===document.querySelector('.search-palette input')`), true, 'Cmd+K focuses its input for immediate typing')
    assert.equal((await sample(['.search-palette-input']))['.search-palette-input'].outlineStyle, 'none', 'The focused Search input keeps its neutral field border')
    await run(`input('.search-palette input','Conversation');key('.search-palette input','ArrowDown');remember('.search-palette input','originalSearch')`)
    const searchBefore = await run('searchState()')
    await run('disableWorkspaceAppearance()')
    await assertRole('.search-palette', 'fill', '--ui-surface')
    for (let cycle = 0; cycle < 2; cycle++) {
      await run('disableAppearance()')
      assert.equal((await run('styleIds()')).filter(id => id.startsWith('interface-')).length, 0, 'Disposal removes only the owner styles')
      assert.ok(await run(`preserved('.search-palette input','originalSearch') && preserved('[data-cordis-composer-editor]','originalEditor')`), 'Disposal preserves query, caret, and Composer draft nodes')
      await run('installAppearance()')
      await assertRole('.search-palette', 'fill', '--ui-surface')
      assert.ok(await run(`preserved('.search-palette input','originalSearch') && preserved('[data-cordis-composer-editor]','originalEditor')`), 'Reapplication preserves query, caret, and Composer draft nodes')
      assert.deepEqual(await run('searchState()'), searchBefore, 'Reapplication does not reset keyboard selection')
    }
    for (let i = 0; i < 14; i++) await run(`key('.search-palette input','ArrowDown')`)
    assert.ok(await run(`(()=>{const list=document.querySelector('.search-results'),row=list.querySelector('[aria-selected="true"]'),a=list.getBoundingClientRect(),b=row.getBoundingClientRect();return list.scrollTop>0&&b.top>=a.top&&b.bottom<=a.bottom})()`), 'Keyboard navigation scrolls the selected result into view')
    await run(`key('.search-palette input','Escape')`)
    assert.equal(await run('searchState().overlay'), undefined)

    await run('openSettings()')
    await settle()
    assert.ok(await assertPortal('.program-modal'), 'Settings is a real portal outside workspace appearance scope')
    for (const [property, token] of [['fill', '--ui-surface'], ['border', '--ui-border'], ['radius', '--ui-dialog-radius'], ['shadow', '--ui-dialog-shadow'], ['font', '--ui-font']]) await assertRole('.program-modal', property, token)
    await assertRole('.program-modal-sidebar', 'fill', '--ui-surface-inset')
    await assertRole('.program-modal-search', 'fill', '--ui-field-fill')
    await assertRole('.program-modal-search input', 'color', '--ui-text')
    await assertRole('.program-modal-nav-item.active', 'fill', '--ui-selected')
    await assertRole('.settings-row-copy strong', 'color', '--ui-text-strong')
    await assertRole('.settings-row-copy small', 'color', '--ui-text-secondary')
    await force('.settings-row.is-interactive:first-child', ['hover'])
    await assertRole('.settings-row.is-interactive:first-child', 'fill', '--ui-hover')
    await force('.settings-row.is-interactive:first-child', ['hover', 'active'])
    await assertRole('.settings-row.is-interactive:first-child', 'fill', '--ui-pressed')
    await force('.settings-row.is-interactive:first-child', [])
    await run(`click('.settings-row[role="radio"]')`)
    assert.equal(await run(`document.querySelector('.settings-row[role="radio"]').getAttribute('aria-checked')`), 'true', 'Permission rows remain interactive')
    await assertRole('.settings-row[role="radio"]', 'fill', '--ui-selected')
    await force('.settings-row[role="radio"]', ['hover'])
    await assertRole('.settings-row[role="radio"]', 'fill', '--ui-selected')
    await force('.settings-row[role="radio"]', ['hover', 'active'])
    await assertRole('.settings-row[role="radio"]', 'fill', '--ui-pressed')
    await force('.settings-row[role="radio"]', [])
    await run(`input('.program-modal-search input','workspaces');remember('.program-modal-search input','originalSettings');disableAppearance();installAppearance()`)
    assert.ok(await run(`preserved('.program-modal-search input','originalSettings')`), 'Open Settings retains query, caret, and node across appearance replacement')
    await run(`input('.program-modal-search input','');nav('Workspaces');click('button[aria-label="Add workspace"]')`)
    await assertRole('.project-settings-form input', 'fill', '--ui-field-fill')
    await assertRole('.project-settings-form input', 'border', '--ui-focus')
    await run('document.activeElement.blur()')
    await assertRole('.project-settings-form input', 'border', '--ui-field-border')
    await assertRole('.project-settings-save', 'color', '--ui-on-action')
    for (const [states, token] of [[[], '--ui-action'], [['hover'], '--ui-action-hover'], [['hover', 'active'], '--ui-action-pressed']]) {
      await force('.project-settings-save', states)
      await assertRole('.project-settings-save', 'fill', token)
    }
    await force('.project-settings-save', [])
    await run(`input('.project-settings-form input','/keep/my/new-workspace');remember('.project-settings-form input','originalProject');disableAppearance();installAppearance()`)
    assert.ok(await run(`preserved('.project-settings-form input','originalProject')`), 'An unsaved workspace draft survives appearance replacement')

    await setSentinels(false)
    for (const mode of ['light', 'dark']) {
      for (const accent of ['#7c3aed', '#16a34a', '#fff8d6']) {
        await run(`setTheme(${JSON.stringify(mode)},${JSON.stringify(accent)})`)
        for (const state of [[], ['hover'], ['hover', 'active']]) {
          await force('.project-settings-save', state)
          await contrast(['.project-settings-save', '.project-settings-form input', '.program-modal-nav-item.active'], 4.5, mode + ' Settings ' + accent + ' ' + state.join('/'))
        }
        await force('.project-settings-save', [])
        for (const selector of ['.project-settings-save', '.project-settings-form input', '.program-modal-nav-item.active']) {
          await force(selector, ['focus', 'focus-visible'])
          await run(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`)
          const measured = (await sample([selector]))[selector]
          assert.ok(measured.outlineStyle !== 'none' && measured.outlineWidth >= 2 && measured.outlineContrast >= 3, JSON.stringify({ mode, accent, selector, ...measured }))
          await run('document.activeElement.blur()')
          await force(selector, [])
        }
      }
      await run(`nav('Appearance')`)
      await contrast(['.settings-row-copy strong', '.settings-row-copy small', 'select[aria-label="Chrome palette"]', '.theme-mode-picker button.active'], 4.5, mode + ' real Appearance settings')
      for (const width of [1100, 390]) {
        win.setContentSize(width, 800)
        await settle()
        await assertFits('.program-modal')
        if (width <= 480) {
          for (const copy of await run('settingsCopyBounds()')) assert.ok(copy.scroll <= copy.width + 1, mode + ': supporting Settings copy stays clear of its control ' + JSON.stringify(copy))
        }
        if (process.env.ALTO_INTERFACE_APPEARANCE_ARTIFACT_DIR) {
          await fs.mkdir(process.env.ALTO_INTERFACE_APPEARANCE_ARTIFACT_DIR, { recursive: true })
          await fs.writeFile(path.join(process.env.ALTO_INTERFACE_APPEARANCE_ARTIFACT_DIR, `settings-${mode}-${width}.png`), (await win.webContents.capturePage()).toPNG())
        }
      }
      win.setContentSize(1100, 800)
      await run(`nav('Workspaces');click('button[aria-label="Add workspace"]')`)
    }
    await run(`key('.program-modal-search input','Escape')`)
    assert.equal(await run('searchState().overlay'), undefined, 'Settings Escape remains functional')

    await setSentinels(true)
    await run(`click('#menu-trigger')`)
    await settle()
    assert.ok(await assertPortal('.workspace-tab-action-menu'), 'The common menu is also outside workspace appearance scope')
    for (const [property, token] of [['fill', '--ui-surface'], ['border', '--ui-border'], ['radius', '--ui-panel-radius'], ['shadow', '--ui-panel-shadow']]) await assertRole('.workspace-tab-action-menu', property, token)
    await assertRole('.workspace-tab-action-menu button', 'color', '--ui-text')
    await assertRole('.workspace-tab-action-menu button', 'radius', '--ui-row-radius')
    for (const [states, token] of [[['hover'], '--ui-hover'], [['hover', 'active'], '--ui-pressed']]) {
      await force('.workspace-tab-action-menu button', states)
      await assertRole('.workspace-tab-action-menu button', 'fill', token)
    }
    await force('.workspace-tab-action-menu button', [])
    await run(`key('.workspace-tab-action-menu button','ArrowDown')`)
    assert.equal(await run('document.activeElement.textContent'), 'Close tab', 'Common menu keyboard navigation remains functional')
    await run(`key('.workspace-tab-action-menu button','Escape')`)
    assert.equal(await run('document.activeElement.id'), 'menu-trigger', 'Common menu Escape returns focus to its trigger')
    await setSentinels(false)

    for (const mode of ['light', 'dark']) {
      await run(`setTheme(${JSON.stringify(mode)},'#fff8d6');cmdK()`)
      await settle()
      for (const states of [[], ['hover'], ['hover', 'active']]) {
        await force('.search-result.active', states)
        await contrast(['.search-result strong', '.search-result-copy>span', '.search-palette input'], 4.5, mode + ' search with pale accent ' + states.join('/'))
        await contrast(['.search-result-check'], 3, mode + ' current conversation indicator with pale accent ' + states.join('/'))
      }
      await force('.search-result.active', [])
      await force('.search-result.active', ['focus', 'focus-visible'])
      await run(`document.querySelector('.search-result.active').focus({preventScroll:true})`)
      const row = (await sample(['.search-result.active']))['.search-result.active']
      assert.ok(row.outlineStyle !== 'none' && row.outlineWidth >= 2 && row.outlineContrast >= 3, JSON.stringify({ mode, row }))
      await force('.search-result.active', [])
      await run(`document.querySelector('.search-palette input').focus({preventScroll:true})`)
      assert.equal((await sample(['.search-palette-input']))['.search-palette-input'].outlineStyle, 'none', 'Search does not draw an accent outline around the typing field')
      for (const width of [1100, 390]) {
        win.setContentSize(width, 800)
        await settle()
        await assertFits('.search-palette')
        const clearance = await run('searchClearance()')
        assert.ok(Object.values(clearance).every(value => value >= 4), mode + ': Search field stays clear of the dialog clip ' + JSON.stringify(clearance))
        if (process.env.ALTO_INTERFACE_APPEARANCE_ARTIFACT_DIR) {
          await fs.writeFile(path.join(process.env.ALTO_INTERFACE_APPEARANCE_ARTIFACT_DIR, `search-${mode}-${width}.png`), (await win.webContents.capturePage()).toPNG())
        }
      }
      await run(`key('.search-palette input','Escape')`)
    }
    assert.ok(await run(`preserved('[data-cordis-composer-editor]','originalEditor')`), 'Every appearance/state update preserves the original Composer draft node')
    await run('teardown()')
    assert.deepEqual(await run('styleIds()'), [], 'All fixture-owned styles clean up')
    console.log('Interface appearance browser checks passed')
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach()
    win.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}

check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
