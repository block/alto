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
      import {createPortal,flushSync} from 'react-dom';
      import {themeStyle} from './src/client/shell';
      import appearancePlugin from './program/plugins/interface-appearance.client';
      import workspaceAppearancePlugin from './program/plugins/workspace-tabs-appearance.client';
      import surfacesPlugin from './program/plugins/ui-surfaces.client';
      import themePlugin,{ThemeController} from './program/plugins/theme.client';
      import {DEFAULT_THEME,THEME_STORAGE_KEY} from './program/plugins/theme-api';
      import {useThemeAppearance} from './program/plugins/theme-runtime';
      import searchPlugin from './program/plugins/search.client';
      import {WorkspaceTabActionMenu} from './program/plugins/workspace-tab-menu.client';
      import {NewWorkspaceDialog} from './program/plugins/ui/project-settings';
      import {Composer} from './program/plugins/ui/composer';
      import {uiStyles} from './program/plugins/ui/appearance';

      // Production shells have an inline default accent; Settings must beat it.
      for(const [name,value] of Object.entries(themeStyle({accent:DEFAULT_THEME.accent})))document.getElementById('root').style.setProperty(name,value);

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
      function Creator(){const active=useSyncExternalStore(overlays.subscribe,overlays.snapshot);return active==='creator'?<NewWorkspaceDialog disabled={false} onClose={()=>overlays.close('creator')} onCreate={async()=>{}}/>:null}
      function AccentProbe(){const theme=useThemeAppearance();return createPortal(<div id="accent-body-portal" hidden data-theme={theme.mode+'|'+theme.accent}>
        <span className="activity-markdown"><a href="#accent">A themed link</a></span><button className={uiStyles.button+' primary'}>A themed action</button><input type="checkbox" defaultChecked aria-label="Native accent sample"/>
      </div>,document.body)}
      function App(){useSyncExternalStore(ui.subscribe,ui.snapshot);const Settings=surfaces.get('default-settings'),Search=roots.get('default-search');return <><div data-shell-node="workspace" className="fixture-workspace"><main className="workspace-layout-root">
        <div className="fixture-content"><button id="menu-trigger" className={uiStyles.button} onClick={()=>overlays.open('menu')}>Tab options</button></div><Draft/>
        </main></div><Settings surface={{id:'settings',kind:'settings'}}/><Search/><Menu/><Creator/><AccentProbe/></>}
      const root=createRoot(document.getElementById('root'));
      flushSync(()=>root.render(<App/>));
      window.frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      window.openSettings=()=>flushSync(()=>overlays.open('settings'));
      window.openCreator=()=>flushSync(()=>overlays.open('creator'));
      window.setWorkspaceInset=value=>{document.querySelector('.fixture-workspace').style.paddingLeft=value+'px'};
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
      window.rememberAccentCaret=()=>flushSync(()=>{const editor=document.querySelector('[data-cordis-composer-editor]');editor.focus();const text=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT).nextNode(),range=document.createRange();range.setStart(text,3);range.setEnd(text,8);getSelection().removeAllRanges();getSelection().addRange(range);window.accentCaret={text,start:3,end:8}});
      window.accentValues=()=>{
        const canvas=document.createElement('canvas'),context=canvas.getContext('2d');canvas.width=canvas.height=1;
        const rgba=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);const value=[...context.getImageData(0,0,1,1).data];value[3]/=255;return value};
        const composer=document.querySelector('.composer'),probe=document.createElement('span');probe.hidden=true;composer.append(probe);
        const token=(element,name)=>{element.append(probe);probe.style.color='var('+name+')';return rgba(getComputedStyle(probe).color)};
        const result={inline:document.getElementById('root').style.getPropertyValue('--accent'),published:document.documentElement.style.getPropertyValue('--alto-theme-accent'),
          shell:token(document.getElementById('root'),'--accent'),body:token(document.getElementById('accent-body-portal'),'--accent'),
          material:token(document.querySelector('.workspace-layout-root'),'--workspace-material-tint'),chrome:token(document.querySelector('.workspace-layout-root'),'--workspace-chrome'),
          focus:token(composer,'--composer-focus-outline'),runtime:document.getElementById('accent-body-portal').dataset.theme,
          native:[...document.querySelectorAll('#accent-body-portal input,select[aria-label="Chrome palette"],input[aria-label="Custom accent color"]')].map(element=>getComputedStyle(element).accentColor==='auto'?'auto':rgba(getComputedStyle(element).accentColor)),
          selection:rgba(getComputedStyle(document.querySelector('#accent-body-portal a'),'::selection').backgroundColor),
          stored:JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)),restored:new ThemeController().snapshot(),
          caret:getSelection().anchorNode===accentCaret.text&&getSelection().focusNode===accentCaret.text&&getSelection().anchorOffset===accentCaret.start&&getSelection().focusOffset===accentCaret.end,
          focusApplied:getComputedStyle(composer).boxShadow.includes(getComputedStyle(probe).color)};
        probe.remove();return result;
      };
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
            contrast:contrast(over(foreground,background),background),borderWidth:parseFloat(style.borderTopWidth),borderContrast:contrast(over(rgba(style.borderTopColor),outside),outside),outlineWidth:parseFloat(style.outlineWidth),outlineStyle:style.outlineStyle,outlineContrast:contrast(over(rgba(style.outlineColor),outside),outside),
            x:box.x,right:box.right,width:box.width,backgroundImage:style.backgroundImage}]}));
      };
      window.bounds=selector=>{const box=document.querySelector(selector).getBoundingClientRect(),workspace=document.querySelector('.fixture-workspace>main').getBoundingClientRect();return{left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,workspaceLeft:workspace.left,workspaceRight:workspace.right,workspaceWidth:workspace.width}};
      window.geometry=selector=>{const element=document.querySelector(selector),style=getComputedStyle(element);return{padding:[style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft],gap:style.columnGap,minHeight:style.minHeight,height:element.getBoundingClientRect().height,direction:style.flexDirection}};
      window.settingsRowBounds=()=>[...document.querySelectorAll('.settings-row')].map(row=>{const copy=row.querySelector('.settings-row-copy'),control=row.querySelector('.settings-row-control'),style=getComputedStyle(row);return{label:copy.querySelector('strong').textContent,row:row.getBoundingClientRect().toJSON(),inset:[parseFloat(style.paddingLeft),parseFloat(style.paddingRight)],copy:copy.getBoundingClientRect().toJSON(),control:control.getBoundingClientRect().toJSON(),fields:[...control.querySelectorAll('select,textarea,input:not([type=color]),.theme-mode-picker,.theme-palette-control,.theme-accent-control,.theme-accent-presets,.theme-color-picker')].map(field=>({name:field.className||field.tagName,box:field.getBoundingClientRect().toJSON()})),direction:style.flexDirection,interactive:row.classList.contains('is-interactive'),copyWidth:copy.clientWidth,copyScroll:copy.scrollWidth}});
      window.reach=(selector,scroll=true)=>{const element=document.querySelector(selector);if(scroll){element.scrollIntoView({block:'end',inline:'nearest'});for(let parent=element.parentElement;parent;parent=parent.parentElement)if(/auto|scroll/.test(getComputedStyle(parent).overflowY))parent.scrollTop=parent.scrollHeight;}const box=element.getBoundingClientRect(),clips=[];
        for(let parent=element.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if(/auto|scroll|hidden|clip/.test(style.overflowY)){const clip=parent.getBoundingClientRect();clips.push({top:clip.top,bottom:clip.bottom,scroll:parent.scrollTop,max:parent.scrollHeight-parent.clientHeight})}}
        return{top:box.top,bottom:box.bottom,height:innerHeight,clips};};
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
  const geometrySentinel = {
    '--ui-panel-inset': '16px', '--ui-dialog-inset': '28px', '--ui-row-min-height': '38px',
    '--ui-row-block-padding': '9px', '--ui-row-inline-padding': '20px', '--ui-row-gap': '11px',
    '--ui-choice-row-min-height': '60px', '--ui-field-min-height': '40px', '--ui-field-inline-padding': '18px',
    '--ui-control-gap': '10px', '--ui-control-inline-padding': '22px', '--ui-icon-slot': '26px',
  }
  const setGeometrySentinels = enabled => run(`for(const [token,value] of Object.entries(${JSON.stringify(geometrySentinel)})){${enabled ? 'document.documentElement.style.setProperty(token,value)' : 'document.documentElement.style.removeProperty(token)'}}`)
  const assertGeometry = async (selector, expected) => {
    const actual = await run(`geometry(${JSON.stringify(selector)})`)
    for (const [property, value] of Object.entries(expected)) assert.deepEqual(actual[property], value, `${selector} ${property} follows shared geometry`)
  }
  const settleGeometry = async () => {
    await settle()
    await run('Promise.all(document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation=>animation.finished.catch(()=>{})))')
    await settle()
  }
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
  const assertDialogFits = async selector => {
    const bounds = await run(`bounds(${JSON.stringify(selector)})`)
    assert.ok(bounds.left >= bounds.workspaceLeft - 1 && bounds.right <= bounds.workspaceRight + 1 && bounds.top >= -1 && bounds.bottom <= bounds.height + 1 && bounds.scroll <= bounds.width + 1,
      selector + ' stays inside the available workspace and viewport: ' + JSON.stringify(bounds))
  }
  const assertFieldsFit = async (panelSelector, fieldSelector) => {
    const fields = await run(`(()=>{const panel=document.querySelector(${JSON.stringify(panelSelector)}).getBoundingClientRect();return[...document.querySelectorAll(${JSON.stringify(fieldSelector)})].map(field=>({field:field.getBoundingClientRect().toJSON(),panel:panel.toJSON()}))})()`)
    assert.ok(fields.length, fieldSelector + ' renders actual fields')
    for (const { field, panel } of fields) assert.ok(field.width > 0 && field.left >= panel.left && field.right <= panel.right + 1, fieldSelector + ' fits its enclosing dialog: ' + JSON.stringify({ field, panel }))
  }
  const assertSettingsClearance = async stacked => {
    const container = await run(`(()=>{const element=document.querySelector('.program-modal-content'),style=getComputedStyle(element);return{name:style.containerName,type:style.containerType,width:element.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)}})()`)
    for (const row of await run('settingsRowBounds()')) {
      assert.ok(row.copyScroll <= row.copyWidth + 1, 'Settings supporting copy fits: ' + JSON.stringify(row))
      assert.ok(row.copy.right <= row.control.left + 1 || row.copy.bottom <= row.control.top + 1, 'Settings copy and control do not overlap: ' + JSON.stringify(row))
      assert.ok(row.control.left >= row.row.left + row.inset[0] - 1 && row.control.right <= row.row.right - row.inset[1] + 1, 'Settings control stays inside the row insets: ' + JSON.stringify(row))
      for (const field of row.fields) assert.ok(field.box.left >= row.control.left - 1 && field.box.right <= row.control.right + 1, 'Settings palette/field stays inside its control: ' + JSON.stringify({ label: row.label, control: row.control, field }))
      if (stacked && !row.interactive) assert.equal(row.direction, 'column', row.label + ' stacks at the actual content width: ' + JSON.stringify(container))
    }
  }
  const assertReachable = async selector => {
    await run(`reach(${JSON.stringify(selector)})`)
    await settle()
    const reached = await run(`reach(${JSON.stringify(selector)},false)`)
    assert.ok(reached.top >= -1 && reached.bottom <= reached.height + 1 && reached.clips.every(clip => reached.top >= clip.top - 1 && reached.bottom <= clip.bottom + 1),
      selector + ' is reachable by scrolling: ' + JSON.stringify(reached))
    return reached
  }
  const artifact = async name => {
    if (!process.env.ALTO_INTERFACE_APPEARANCE_ARTIFACT_DIR) return
    await fs.mkdir(process.env.ALTO_INTERFACE_APPEARANCE_ARTIFACT_DIR, { recursive: true })
    await fs.writeFile(path.join(process.env.ALTO_INTERFACE_APPEARANCE_ARTIFACT_DIR, name + '.png'), (await win.webContents.capturePage()).toPNG())
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

    // Exercise the actual Settings event/controller/storage path before the
    // broader style-role tests override tokens or write theme attributes.
    await run(`openSettings();nav('Appearance');input('.program-modal-search input','appearance');remember('.program-modal-search input','accentSettings');rememberAccentCaret()`)
    await settleGeometry()
    const accentSelectors = ['.composer', '[data-cordis-composer-editor]', '.send-button']
    const accentGeometry = measured => Object.fromEntries(accentSelectors.map(selector => [selector, Object.fromEntries(['width', 'radius', 'font', 'size'].map(property => [property, measured[selector][property]]))]))
    const originalAccentGeometry = accentGeometry(await sample(accentSelectors))
    for (const mode of ['light', 'dark']) {
      await run(`click('.theme-mode-picker button:nth-child(${mode === 'light' ? 2 : 3})')`)
      for (const [label, accent, channel, chrome] of [['Green', '#16a34a', 1, 'alto'], ['Orange', '#ea580c', 0, 'ink']]) {
        await run(`click('button[aria-label="${label} accent"]');(()=>{const select=document.querySelector('select[aria-label="Chrome palette"]');select.value=${JSON.stringify(chrome)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`)
        await settleGeometry()
        const values = await run('accentValues()')
        const expected = accent.slice(1).match(/../g).map(value => parseInt(value, 16)).concat(1)
        const context = mode + ' actual ' + label + ' Settings click: '
        assert.equal(values.inline, '#7c3aed', 'The real shell retains its inline default during user overrides')
        assert.equal(values.published, accent, context + 'publishes the requested accent')
        assert.equal(values.runtime, mode + '|' + accent, context + 'updates subscribed renderer appearance')
        assert.deepEqual(values.shell, expected, context + 'beats the inline shell default')
        assert.deepEqual(values.body, expected, context + 'reaches the body-mounted portal')
        assert.equal(await run(`document.querySelector('#accent-body-portal').parentElement===document.body`), true)
        const measured = await sample([...accentSelectors, '#accent-body-portal a', '#accent-body-portal button'])
        assert.ok(measured['#accent-body-portal a'].contrast >= 4.5, context + 'Markdown links retain readable contrast: ' + JSON.stringify(measured['#accent-body-portal a']))
        for (const [name, color] of Object.entries({ link: measured['#accent-body-portal a'].color, material: values.material, chrome: values.chrome, focus: values.focus, selection: values.selection, send: measured['.send-button'].color })) {
          assert.ok(color[channel] > Math.max(...color.slice(0, 3).filter((_value, index) => index !== channel)), context + name + ' follows the selected hue: ' + JSON.stringify(color))
        }
        assert.ok(values.focusApplied, context + 'the real focused Composer paints its themed outline')
        assert.ok(measured['.send-button'].fill[3] > 0 && measured['.send-button'].fill[3] < .5, context + 'Send retains its soft translucent treatment')
        assert.ok(measured['.send-button'].contrast >= 3, context + 'Send glyph remains legible: ' + JSON.stringify(measured['.send-button']))
        for (const color of values.native) assert.deepEqual(color, measured['#accent-body-portal button'].fill, context + 'native controls inherit the action accent')
        assert.ok(values.native.length >= 3, 'Native checkbox and actual Settings palette controls are sampled')
        assert.ok(values.selection[3] > 0 && values.selection[3] < 1, context + 'text selection keeps a translucent accent')
        for (const saved of [values.stored, values.restored]) assert.deepEqual([saved.mode, saved.accent, saved.chrome], [mode, accent, chrome], context + 'persists and restores the preference')
        assert.ok(values.caret && await run(`preserved('.program-modal-search input','accentSettings')&&preserved('[data-cordis-composer-editor]','originalEditor')`), context + 'preserves Settings query/caret and Composer draft/editor/caret')
        assert.deepEqual(accentGeometry(measured), originalAccentGeometry, context + 'changes no editor or Send shape/type/width')
      }
      await artifact('settings-accent-' + mode)
      await run(`key('.program-modal-search input','Escape');openSettings();nav('Appearance')`)
      await settle()
      assert.equal(await run(`document.querySelector('button[aria-label="Orange accent"]').getAttribute('aria-checked')`), 'true', mode + ' reopening Settings retains the selected accent')
      assert.equal(await run(`document.querySelector('input[aria-label="Custom accent color"]').value`), '#ea580c')
      await run(`input('.program-modal-search input','appearance');remember('.program-modal-search input','accentSettings');rememberAccentCaret()`)
      await settleGeometry()
    }
    await run(`click('.theme-settings-card .settings-row:last-child');key('.program-modal-search input','Escape')`)
    console.log('Real Settings accent propagation, persistence, and Composer retention checks passed')

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
          if(selector==='.project-settings-form input'){
            assert.ok(measured.borderWidth===1 && measured.borderContrast>=3 && measured.outlineStyle==='none' && measured.shadow==='none', JSON.stringify({ mode, accent, selector, ...measured }))
          }else{
            assert.ok(measured.outlineStyle !== 'none' && measured.outlineWidth >= 2 && measured.outlineContrast >= 3, JSON.stringify({ mode, accent, selector, ...measured }))
          }
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
        await assertSettingsClearance(width <= 480)
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

    // Distinct sentinels expose feature overrides that would otherwise look
    // correct only while the shared defaults happen to have the same values.
    win.setContentSize(1100, 800)
    await setGeometrySentinels(true)
    await assertGeometry('#menu-trigger', { gap: '10px', padding: ['9px', '22px', '9px', '22px'] })
    await run(`click('#menu-trigger')`)
    await settleGeometry()
    await assertGeometry('.workspace-tab-action-menu', { padding: ['16px', '16px', '16px', '16px'] })
    await assertGeometry('.workspace-tab-action-menu button', { minHeight: '38px', gap: '11px', padding: ['9px', '20px', '9px', '20px'] })
    await run('disableAppearance();installAppearance()')
    await assertGeometry('.workspace-tab-action-menu button', { minHeight: '38px', padding: ['9px', '20px', '9px', '20px'] })
    await run(`key('.workspace-tab-action-menu button','Escape');openSettings()`)
    await settleGeometry()
    await assertGeometry('.program-modal-backdrop', { padding: ['28px', '28px', '28px', '28px'] })
    await assertGeometry('.program-modal-content', { padding: ['28px', '28px', '28px', '28px'] })
    await assertGeometry('.settings-row', { minHeight: '60px', padding: ['11px', '20px', '11px', '20px'] })
    await run(`nav('Workspaces');click('button[aria-label="Add workspace"]')`)
    await settleGeometry()
    await assertGeometry('.project-settings-form', { padding: ['16px', '16px', '16px', '16px'], gap: '16px' })
    await assertGeometry('.project-settings-form input', { minHeight: '40px', height: 40, padding: ['9px', '18px', '9px', '18px'] })
    await run(`key('.program-modal-search input','Escape');cmdK()`)
    await settleGeometry()
    await assertGeometry('.search-results', { padding: ['16px', '16px', '16px', '16px'] })
    await assertGeometry('.search-result', { minHeight: '60px', gap: '11px', padding: ['9px', '20px', '9px', '20px'] })
    await setGeometrySentinels(false)
    await assertGeometry('.search-result', { minHeight: '52px' })
    assert.equal((await sample(['.search-palette-input']))['.search-palette-input'].outlineStyle, 'none', 'Geometry reapplication does not add a purple Cmd+K field outline')
    await run(`key('.search-palette input','Escape')`)

    // Simulate a sidebar/split pane while retaining the wide browser viewport.
    await run(`setWorkspaceInset(440);openSettings();nav('Appearance')`)
    await settleGeometry()
    assert.equal((await run(`bounds('.program-modal')`)).workspaceWidth, 660)
    await assertDialogFits('.program-modal')
    await assertFieldsFit('.program-modal', '.program-modal-search,.settings-row select,.theme-mode-picker')
    await assertSettingsClearance(true)
    await artifact('settings-constrained-660')
    await run(`nav('Workspaces');click('button[aria-label="Add workspace"]')`)
    await settleGeometry()
    await assertFieldsFit('.program-modal', '.project-settings-form input,.project-settings-form textarea')
    await assertReachable('.project-settings-save')
    await run(`key('.program-modal-search input','Escape');cmdK()`)
    await settleGeometry()
    await assertDialogFits('.search-palette')
    await assertFieldsFit('.search-palette', '.search-palette-input')
    await assertReachable('.search-result:last-child')
    await artifact('search-constrained-660')
    await run(`key('.search-palette input','Escape');setWorkspaceInset(0)`)

    for (const [width, height] of [[900, 480], [390, 480]]) {
      win.setContentSize(width, height)
      await run(`openSettings();nav('Appearance')`)
      await settleGeometry()
      await assertDialogFits('.program-modal')
      await assertFieldsFit('.program-modal', '.program-modal-search,.settings-row select,.theme-mode-picker')
      await assertSettingsClearance(width < 480)
      await assertReachable('.theme-settings-card .settings-row:last-child')
      await artifact(`settings-short-${width}x${height}`)
      await run(`nav('Workspaces');click('button[aria-label="Add workspace"]')`)
      await settleGeometry()
      await assertFieldsFit('.program-modal', '.project-settings-form input,.project-settings-form textarea')
      const save = await assertReachable('.project-settings-save')
      assert.ok(save.clips.some(clip => clip.max > 0 && clip.scroll > 0), 'The short Settings form can scroll to its Save action')
      await run(`key('.program-modal-search input','Escape');cmdK()`)
      await settleGeometry()
      await assertDialogFits('.search-palette')
      await assertReachable('.search-result:last-child')
      assert.equal((await sample(['.search-palette-input']))['.search-palette-input'].outlineStyle, 'none')
      await artifact(`search-short-${width}x${height}`)
      await run(`key('.search-palette input','Escape')`)
    }
    for (const [width, height] of [[900, 480], [390, 320]]) {
      win.setContentSize(width, height)
      await run('openCreator()')
      await settleGeometry()
      await assertDialogFits('.workspace-creator')
      await assertFieldsFit('.workspace-creator', '.workspace-creator-form input,.workspace-creator-form textarea')
      const create = await assertReachable('.workspace-creator-form button[type="submit"]')
      if (height < 400) assert.ok(create.clips.some(clip => clip.max > 0 && clip.scroll > 0), 'The short creator scrolls its form while retaining its header')
      await artifact(`creator-short-${width}x${height}`)
      await run(`click('.workspace-creator>header>button')`)
    }
    win.setContentSize(1100, 800)
    await settle()
    await run(`click('.composer-permission-trigger')`)
    await settleGeometry()
    await assertGeometry('.composer-permission-picker', { padding: ['12px', '12px', '12px', '12px'] })
    const permissionRows = await run(`(()=>{window.originalPermissionPicker=document.querySelector('.composer-permission-picker');return[...originalPermissionPicker.querySelectorAll('button:has(.permission-option-copy small)')].map(row=>({height:getComputedStyle(row).minHeight,columns:getComputedStyle(row).gridTemplateColumns.split(' ')}))})()`)
    assert.ok(permissionRows.length >= 2, 'The real Composer permission menu contains description choices')
    for (const row of permissionRows) {
      assert.equal(row.height, '52px', 'Permission descriptions retain two-line choice density')
      assert.equal(row.columns[0], '24px', 'Permission icon column shares the icon slot')
      assert.equal(row.columns.at(-1), '24px', 'Permission check column shares the icon slot')
    }
    await run('disableAppearance();installAppearance()')
    assert.ok(await run(`originalPermissionPicker===document.querySelector('.composer-permission-picker')&&preserved('[data-cordis-composer-editor]','originalEditor')`), 'Geometry replacement preserves the open permission picker and Composer draft nodes')
    await assertGeometry('.composer-permission-picker>button', { minHeight: '52px', padding: ['6px', '12px', '6px', '12px'] })
    await run(`key('.composer-permission-trigger','Escape')`)
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
