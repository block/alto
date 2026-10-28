const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'vertical-tabs-check.tsx', loader: 'tsx', contents: `
      import React,{useEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {CheckSquare,Network,SquareTerminal,X} from 'lucide-react';
      import {Composer} from './program/plugins/ui/composer';
      import plugin from './program/plugins/workspace-layout.client';
      import groupsPlugin from './program/plugins/workspace-tab-groups.client';
      import verticalTabsPlugin from './program/plugins/vertical-tabs.client';
      import workspaceMaterialPlugin from './program/plugins/workspace-material.client';
      import workspaceTabsAppearancePlugin from './program/plugins/workspace-tabs-appearance.client';
      import interfaceAppearancePlugin from './program/plugins/interface-appearance.client';
      import verticalHotkeysPlugin from './program/plugins/hotkeys-vertical-tabs.client';
      import {HotkeysService} from './program/plugins/hotkeys.client';
      import {parseWorkspaceLayout} from './program/plugins/workspace-layout-state';
      let saved={version:2,activeViewId:'a',views:['Alto','Incident review with a long name','Design','Review','Shell'].map((name,i)=>{
        const id=String.fromCharCode(97+i);return {id,name,workspace:'/repo',focusedPaneId:'pane-'+id,root:{type:'pane',id:'pane-'+id,workspace:'/repo',kind:id==='e'?'terminal':'test'}};
      })};
      localStorage.setItem('codex-cordis.workspace-layout',JSON.stringify(saved));
      localStorage.removeItem('codex-cordis.vertical-tabs');
      const state={connected:true,session:{workspace:'/repo',permissionMode:'full'},projects:[],threads:[],skills:[],turn:{tag:'idle'},activities:[],history:{tag:'ready',entries:[]},harness:{codex:{status:'ready',models:[]},ui:{surfaces:[],contributions:[{id:'test-tool',slot:'header-right'}],regions:[]}}};
      const host={subscribe:()=>()=>{},snapshot:()=>({connectionEpoch:1}),call:async(method,payload)=>{
        if(method.endsWith('.read'))return structuredClone(saved);
        if(method.endsWith('.write')){saved=parseWorkspaceLayout(payload);return null;}
      }};
      let Surface,registry,root;
      const session={snapshot:()=>state,subscribe:()=>()=>{}};
      const Placeholder=()=>null;
      const Tool=()=><><button type="button" className="alto-icon-button icon-button shell-control agents-toggle test-tool" aria-label="Agents"><Network size={15}/><span className="agents-toggle-count">2</span></button>
        <button type="button" className="alto-button todo-header-button" aria-label="Tasks" title="Tasks"><CheckSquare size={16}/><span>Tasks</span></button></>;
      const ui={subscribe:()=>()=>{},snapshot:()=>0,component:()=>Placeholder,renderer:()=>undefined,contributionRenderer:()=>Tool,
        overlays:{open:()=>{},close:()=>{}},
        registerSurface:(_owner,_id,component)=>{Surface=component},
        registerStyle:(owner,id,css)=>{owner.effect(()=>{const el=document.createElement('style');el.dataset.pluginStyle=id;el.textContent=css;document.head.append(el);return ()=>el.remove()})}};
      const ctx={provide:(name,value)=>{if(name==='clientVerticalTabs')registry.verticalTabs=value;else registry=value},clientUi:ui,clientHost:host,clientSession:session,
        clientSessionRouter:{setActive:()=>{},clearActive:()=>{}},clientSessionFactory:{create:()=>{throw new Error('Unexpected chat creation')}}};
      plugin({...ctx,effect:fn=>fn()});
      const fiber=install=>{let effects=[];return {
        enable:()=>flushSync(()=>install({...ctx,clientWorkspaceLayout:registry,effect:fn=>{const cleanup=fn();effects.push(cleanup);return cleanup}})),
        disable:()=>flushSync(()=>{for(const cleanup of effects.reverse())cleanup();effects=[]}),
      }};
      const hotkeys=new HotkeysService(ui,{leader:'Alt'});
      const controls=fiber(interfaceAppearancePlugin),appearance=fiber(workspaceTabsAppearancePlugin),material=fiber(workspaceMaterialPlugin),groups=fiber(groupsPlugin),vertical=fiber(ctx=>{verticalTabsPlugin(ctx);
        verticalHotkeysPlugin({...ctx,clientVerticalTabs:registry.verticalTabs,clientHotkeys:{registerAction:(owner,action)=>hotkeys.registerAction(owner,action)}})});
      window.enableGroups=groups.enable;window.disableGroups=groups.disable;
      window.enableVertical=vertical.enable;window.disableVertical=vertical.disable;
      window.enableMaterial=material.enable;window.disableMaterial=material.disable;
      window.enableAppearance=appearance.enable;window.disableAppearance=appearance.disable;
      controls.enable();appearance.enable();
      material.enable();
      groups.enable();
      window.mounts=0;
      const Pane=({pane})=>{useEffect(()=>{window.mounts++},[]);const body=<div className="test-pane"><p>Conversation in {pane.id}</p><textarea id={'draft-'+pane.id} defaultValue={'Draft for '+pane.id}/></div>;
        // Terminal-like panes draw their own top bar with the shared pane header, as the real terminal does.
        return pane.kind==='terminal'?<div className="alto-pane ghostty-workspace-pane test-terminal"><div className="alto-pane-header workspace-local-tabbar"><div className="pane-tabs"><div className="pane-tab active"><button type="button" className="pane-tab-select"><span>Terminal</span></button><button type="button" className="pane-tab-close fixture-local-close" aria-label="Close terminal tab"><X size={12}/></button></div></div><button type="button" className="icon-button fixture-legacy-header" aria-label="Terminal options"><Network size={14}/></button></div>{body}</div>:body};
      registry.registerPaneKind({effect:fn=>fn()},{id:'test',label:'Test pane',renderer:Pane});
      registry.registerPaneKind({effect:fn=>fn()},{id:'terminal',label:'Terminal',icon:SquareTerminal,renderer:Pane});
      window.boot=()=>{root=createRoot(document.getElementById('workspace-mount'));flushSync(()=>root.render(<Surface surface={{id:'workspace-layout',kind:'workspace-layout'}}/>))};
      window.reload=()=>{flushSync(()=>root.unmount());window.boot()};
      const rect=selector=>{const el=document.querySelector(selector);if(!el)return undefined;const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
      window.inspect=()=>({saved:structuredClone(saved),mounts:window.mounts,
        headerStrip:!!document.querySelector('.workspace-tabbar .workspace-tabs'),
        railStrip:document.querySelector('.vertical-tab-rail .workspace-tabs')?.getAttribute('aria-orientation'),
        rail:rect('.vertical-tab-rail'),tool:rect('.test-tool'),footer:rect('.vertical-tab-rail-footer'),
        toolHost:document.querySelector('.test-tool')?.closest('.vertical-tab-rail-footer, .workspace-tabbar')?.className,
        toolsAttribute:document.documentElement.getAttribute('data-workspace-tools'),
        railEnd:document.documentElement.style.getPropertyValue('--workspace-tools-rail-end'),
        toggleInFooter:!!document.querySelector('.vertical-tab-rail-footer .vertical-tab-rail-toggle'),views:rect('.workspace-views'),bar:rect('.workspace-tabbar'),
        collapsed:document.querySelector('.vertical-tab-rail')?.classList.contains('is-collapsed'),
        toggle:!!document.querySelector('.vertical-tab-rail-toggle'),
        tabs:[...document.querySelectorAll('[data-workspace-tab]')].map(el=>{const r=el.getBoundingClientRect(),title=el.querySelector('.workspace-tab-title');
          return {id:el.dataset.workspaceTab,top:r.top,left:r.left,width:r.width,height:r.height,icon:!!el.querySelector('.workspace-tab-icon svg'),
            iconClass:el.querySelector('.workspace-tab-icon svg')?.getAttribute('class'),titleVisible:!!title&&title.getBoundingClientRect().width>0}}),
        activePanel:document.querySelector('.workspace-view:not([hidden]) textarea')?.id,
        stored:JSON.parse(localStorage.getItem('codex-cordis.vertical-tabs')??'null'),
        scroll:document.documentElement.scrollWidth});
      window.tabGeometry=()=>{
        const box=element=>{if(!element)return undefined;const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,center:r.top+r.height/2}};
        const strip=document.querySelector('.workspace-tabs'),rail=document.querySelector('.vertical-tab-rail');
        return {orientation:strip.getAttribute('aria-orientation'),collapsed:!!rail?.classList.contains('is-collapsed'),gap:parseFloat(getComputedStyle(strip).gap),
          rows:[...strip.querySelectorAll('.workspace-tab')].map(row=>({id:row.dataset.workspaceTab,box:box(row),title:box(row.querySelector('.workspace-tab-title,:scope>span:first-child')),icon:box(row.querySelector('.workspace-tab-icon')),
            close:box(row.querySelector('.workspace-tab-close')),status:box(row.querySelector('.workspace-tab-thread-status')),count:box(row.querySelector('.workspace-tab-group-count')),toggle:box(row.querySelector('.workspace-tab-group-toggle'))})),
          history:[...document.querySelectorAll('.workspace-history-controls>button')].map(box),tools:[...document.querySelectorAll('.workspace-tabbar-tools button')].map(box),add:box(document.querySelector('.workspace-tab-add'))};
      };
      window.click=selector=>flushSync(()=>document.querySelector(selector).click());
      window.context=selector=>flushSync(()=>{const el=document.querySelector(selector),b=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:b.left+8,clientY:b.bottom}))});
      window.clickText=text=>flushSync(()=>{const el=[...document.querySelectorAll('.workspace-tab-group-menu button')].find(el=>el.textContent.trim()===text);if(!el)throw new Error('Missing button '+text);el.click()});
      window.key=key=>flushSync(()=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})));
      let transfer,dragged;
      const dragEvent=(kind,target,fraction)=>{const to=document.querySelector(target),b=to.getBoundingClientRect();to.dispatchEvent(new DragEvent(kind,{dataTransfer:transfer,bubbles:true,cancelable:true,clientX:b.left+b.width/2,clientY:b.top+b.height*fraction}))};
      window.drop=(source,target,fraction)=>{
        flushSync(()=>{dragged=document.querySelector(source);transfer=new DataTransfer();dragged.dispatchEvent(new DragEvent('dragstart',{dataTransfer:transfer,bubbles:true,cancelable:true}))});
        flushSync(()=>dragEvent('dragover',target,fraction));
        flushSync(()=>dragEvent('drop',target,fraction));
        flushSync(()=>dragged.dispatchEvent(new DragEvent('dragend',{dataTransfer:transfer,bubbles:true,cancelable:true})));
      };
      window.resize=(dx)=>{const handle=document.querySelector('.vertical-tab-rail-resize'),b=handle.getBoundingClientRect(),x=b.left+b.width/2,y=b.top+40;
        flushSync(()=>handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerId:1,clientX:x,clientY:y})));
        flushSync(()=>handle.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientX:x+dx,clientY:y})));
        flushSync(()=>handle.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientX:x+dx,clientY:y})));
      };
      window.split=(direction,kind)=>flushSync(()=>registry.splitFocused(direction,kind));
      window.closePane=()=>flushSync(()=>registry.closeFocusedPane());
      window.bars=()=>{const view=document.querySelector('.workspace-view:not([hidden])');return [...view.querySelectorAll('.workspace-chat-pane')].map(pane=>{const bar=pane.querySelector('.alto-pane-header')??pane.querySelector(':scope > .workspace-pane-header'),r=bar.getBoundingClientRect(),style=getComputedStyle(bar);
        return {kind:pane.className,top:r.top,bottom:r.bottom,left:Math.round(r.left),color:style.backgroundColor,border:style.borderBottomColor,borderWidth:style.borderBottomWidth,height:style.height,minHeight:style.minHeight}})};
      window.commandB=(shift=false)=>flushSync(()=>document.body.dispatchEvent(new KeyboardEvent('keydown',{key:shift?'B':'b',code:'KeyB',metaKey:true,shiftKey:shift,bubbles:true,cancelable:true})));
      // Reuse the mounted workspace and its real Composer, with representative
      // transcript markup. The original typed renderer and draft remain mounted.
      let preview;
      window.mountPreview=()=>{
        const pane=document.querySelector('.workspace-view:not([hidden]) .workspace-chat-pane'),content=pane.querySelector('.workspace-typed-pane-content'),title=pane.querySelector('.workspace-pane-title');
        const mount=document.createElement('div'),heading=document.createElement('div');mount.style.display='contents';heading.className='workspace-pane-title-control';
        heading.innerHTML='<button type="button" class="workspace-pane-title"><span class="workspace-pane-title-text">A quieter workspace</span></button>';
        preview={pane,content,title,heading,mount,classes:pane.className,root:createRoot(mount)};
        content.style.display='none';title.replaceWith(heading);pane.classList.remove('workspace-typed-pane');pane.classList.add('is-focused');pane.append(mount);
        flushSync(()=>preview.root.render(<>
          <div className="workspace-pane-conversation"><div className="conversation-stage"><div className="conversation-feed"><div className="conversation-feed-content">
            <article className="activity-card activity-user"><div className="activity-content activity-markdown"><p>Bring the tabs, conversation, and composer into the same visual family.</p></div></article>
            <article className="activity-card activity-agent"><div className="activity-content activity-markdown"><p>The navigation now shares its type and surface palette with the conversation. The title follows the reading column, while the tools keep a compact, consistent shape.</p><p>Both tab orientations preserve the same selection, hover, and keyboard focus states.</p></div></article>
          </div></div></div></div>
          <div className="workspace-pane-composer"><Composer value="Keep the conversation easy to read." images={[]} attachments={[]} skills={[]} models={[]}
            permissionMode="full" workspaceLabel="/repo" workspaceOptions={[]} capabilities={[]} placeholder="Let's build" focusHeight={156} maxHeight={180} autoFocus={false}
            disabled={false} readOnly={false} sending={false} activeTurn={false}
            onChange={value=>window.previewDraft=value} onImagesChange={()=>{}} onAttachmentsChange={()=>{}} onAttachFile={async()=>{}}
            onModelChange={()=>{}} onEffortChange={()=>{}} onPermissionModeChange={()=>{}}
            onWorkspaceChange={()=>{}} onSubmit={()=>{}} onInterrupt={()=>{}}/></div>
        </>));
      };
      window.unmountPreview=()=>{flushSync(()=>preview.root.unmount());preview.mount.remove();preview.heading.replaceWith(preview.title);preview.content.style.removeProperty('display');preview.pane.className=preview.classes;preview=undefined};
      window.teardown=()=>{hotkeys.dispose();flushSync(()=>root.unmount());controls.disable()};
      window.boot();
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all(['src/client/styles.css', 'program/plugins/ui/default.css', 'program/plugins/theme.css', 'program/plugins/todo.css', 'program/plugins/orchestrator.css', 'program/plugins/pane-tabs.css'].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((request, response) => {
    response.end('<!doctype html><style>' + css + '\n#root{height:100vh}#workspace-mount{display:flex;min-width:0;min-height:0;flex:1 1 0}.test-pane{padding:24px;width:100%}.test-pane textarea{width:100%;min-height:100px}.test-terminal{flex:1 1 0}</style><div id="root"><div class="shell-kernel"><div data-shell-node="workspace" class="shell-box shell-direction-row shell-grow shell-surface-canvas"><main data-shell-node="workspace-layout-main" class="shell-box shell-direction-column shell-grow shell-surface-canvas"><div id="workspace-mount"></div></main></div></div></div>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const window = new BrowserWindow({ show: false, width: 1200, height: 760, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = code => window.webContents.executeJavaScript(code)
  const settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const finishMotion = async () => {
    await run("document.querySelectorAll('.vertical-tab-rail, .workspace-tabs, .pane-tabs').forEach(el=>el.getAnimations({subtree:true}).forEach(animation=>animation.finish()))")
    await settle()
  }
  const capture = async name => {
    if (!process.env.ALTO_VERTICAL_TABS_ARTIFACT_DIR) return
    await fs.mkdir(process.env.ALTO_VERTICAL_TABS_ARTIFACT_DIR, { recursive: true })
    await fs.writeFile(path.join(process.env.ALTO_VERTICAL_TABS_ARTIFACT_DIR, name + '.png'), (await window.webContents.capturePage()).toPNG())
  }
  const assertTabGeometry = async label => {
    const measured = await run('tabGeometry()')
    for (const row of measured.rows.filter(row => row.box.width > 1 && row.box.height > 1)) {
      assert.equal(row.box.height, 32, label + ': tab rows share the compact row height')
      if (measured.collapsed) continue
      for (const action of [row.close, row.status, row.toggle].filter(Boolean)) {
        assert.deepEqual([action.width, action.height, action.center], [24, 24, row.box.center], label + ': action slots remain centered and fixed')
      }
      const firstAction = row.status?.left ?? (row.count?.width ? row.count.left : undefined) ?? row.close?.left ?? row.toggle?.left
      if (row.title && firstAction !== undefined) assert.ok(row.title.right <= firstAction + .01, label + ': title stays clear of its action slots ' + JSON.stringify(row))
    }
    for (const control of measured.history) assert.deepEqual([control.width, control.height], [24, 24], label + ': history uses the icon slot size')
    for (const control of measured.tools) assert.equal(control.height, 32, label + ': footer/top tools share one target height')
    assert.equal(measured.gap, 4, label + ': both orientations share the tab gap')
    if (process.env.ALTO_TAB_GEOMETRY_REPORT) console.log(label + ': ' + JSON.stringify(measured))
    return measured
  }
  const assertStableTabStatus = async label => {
    const before = await assertTabGeometry(label)
    await run("window.geometryStatus=document.createElement('span');geometryStatus.className='workspace-tab-thread-status';geometryStatus.textContent='●';document.querySelector('[data-workspace-tab=a]').append(geometryStatus)")
    const after = await assertTabGeometry(label + ' with status')
    const original = before.rows.find(row => row.id === 'a'), changed = after.rows.find(row => row.id === 'a')
    assert.deepEqual(changed.title, original.title, label + ': a status update does not move or shrink the tab title')
    assert.deepEqual(changed.close, original.close, label + ': a status update does not move the close action')
    await run('geometryStatus.remove()')
  }
  const material = () => run(`(() => {
    // Canvas normalizes both rgb() and color(srgb ...) computed colors.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const sample = element => {
      if (!element) return undefined;
      const style = getComputedStyle(element);
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = style.backgroundColor;
      context.fillRect(0, 0, 1, 1);
      const rgba = [...context.getImageData(0, 0, 1, 1).data];
      return { color: style.backgroundColor, rgba, alpha: rgba[3] / 255, image: style.backgroundImage, mask: style.maskComposite };
    };
    const selectors = ['html', 'body', '#root', '.shell-kernel', '[data-shell-node="workspace"]', '[data-shell-node="workspace-layout-main"]'];
    const view = document.querySelector('.workspace-view:not([hidden])');
    return {
      ancestors: Object.fromEntries(selectors.map(selector => [selector, sample(document.querySelector(selector))])),
      root: sample(document.querySelector('.workspace-layout-root')),
      rail: sample(document.querySelector('.vertical-tab-rail')),
      bar: sample(document.querySelector('.workspace-tabbar')),
      sheet: sample(view),
      panes: [...view.querySelectorAll('.workspace-chat-pane, .alto-pane')].map(sample),
      cornerOverlay: getComputedStyle(view, '::after').content,
    };
  })()`)
  const assertOpaqueContent = (measured, label) => {
    assert.equal(measured.sheet.alpha, 1, label + ': content sheet stays opaque');
    assert.ok(measured.panes.length > 0, label + ': pane backgrounds are present');
    for (const pane of measured.panes) assert.equal(pane.alpha, 1, label + ': content panes stay opaque');
  }
  const assertNativeMaterial = (measured, label) => {
    for (const [selector, surface] of Object.entries(measured.ancestors)) {
      assert.equal(surface.alpha, 0, label + ': transparent ' + selector + ' ' + JSON.stringify(surface));
      assert.equal(surface.image, 'none', label + ': no opaque background image on ' + selector);
    }
    assert.ok(measured.root.alpha > 0 && measured.root.alpha < 1, label + ': one translucent chrome layer');
    assert.equal((measured.rail ?? measured.bar).alpha, 0, label + ': chrome reveals the shared material');
    if (measured.rail) {
      assert.equal(measured.sheet.alpha, 0, label + ': clear title band');
      assert.match(measured.sheet.image, /linear-gradient/, label + ': content fill starts below the title band');
      assert.match(measured.sheet.mask, /exclude/, label + ': real rounded sheet cutout');
      assert.equal(measured.cornerOverlay, 'none', label + ': no corner painted over opaque content');
      for (const pane of measured.panes) {
        assert.equal(pane.alpha, 0, label + ': clear pane title band');
        assert.match(pane.image, /linear-gradient/, label + ': pane body retains its own fill');
      }
    } else assertOpaqueContent(measured, label);
  }
  const assertOpaqueChrome = (measured, label) => {
    for (const selector of ['html', '[data-shell-node="workspace-layout-main"]']) {
      const surface = measured.ancestors[selector];
      // Dark main paints an opaque gradient instead of a background color.
      assert.ok(surface.alpha === 1 || surface.image !== 'none', label + ': shell background restored on ' + selector);
    }
    assert.equal(measured.root.alpha, 1, label + ': opaque workspace chrome');
    if (measured.rail) assert.equal(measured.rail.alpha, 1, label + ': opaque rail');
    else assert.ok(measured.bar.alpha > 0, label + ': horizontal chrome restored');
    assertOpaqueContent(measured, label);
  }
  const assertMaterialPixels = async label => {
    const points = await run(`(() => {
      const view = document.querySelector('.workspace-view:not([hidden])'), bounds = view.getBoundingClientRect();
      const band = parseFloat(getComputedStyle(view.querySelector('.workspace-pane-header')).minHeight);
      const radius = parseFloat(getComputedStyle(view).getPropertyValue('--workspace-sheet-radius'));
      const rail = document.querySelector('.vertical-tab-rail').getBoundingClientRect();
      const context = document.createElement('canvas').getContext('2d');
      const expected = (element, paneColor = true) => {
        const style = getComputedStyle(element);
        context.fillStyle = (paneColor && style.getPropertyValue('--workspace-pane-background')) || style.getPropertyValue('--canvas');
        context.fillRect(0, 0, 1, 1);
        const [r,g,b,a] = context.getImageData(0, 0, 1, 1).data;
        return [b,g,r,a];
      };
      return { gutter: [2, 2], rail: [rail.left + 2, 2], corner: [bounds.left + 1, bounds.top + band + 1], panes: [...view.querySelectorAll('.workspace-chat-pane')].flatMap(pane => {
        const rect = pane.getBoundingClientRect();
        if (!rect.width || !rect.height) return [];
        const owner = pane.querySelector('.alto-pane') ?? pane;
        return [{ header: [rect.left + 2, rect.top + 2], top: rect.top, body: [rect.left + 3, rect.top + band + radius + 4], expected: expected(owner), headerCanvas: expected(pane, false) }];
      }) };
    })()`)
    const shot = await window.webContents.capturePage(), size = shot.getSize(), bitmap = shot.toBitmap()
    const pixel = ([x, y]) => [...bitmap.subarray((Math.floor(y) * size.width + Math.floor(x)) * 4, (Math.floor(y) * size.width + Math.floor(x)) * 4 + 4)]
    const chrome = pixel(points.rail)
    assert.deepEqual(pixel(points.gutter), chrome, label + ': gutters expose the shared material')
    // The sheet casts a faint black shadow onto the material at its corner.
    // It must still expose the glass rather than an opaque corner fill.
    const corner = pixel(points.corner)
    assert.equal(corner[3], chrome[3], label + ': rounded corner keeps the material alpha')
    for (let channel = 0; channel < 3; channel++) {
      assert.ok(corner[channel] <= chrome[channel] && corner[channel] >= chrome[channel] * .88,
        label + ': rounded corner exposes the material beneath a faint shadow ' + JSON.stringify({ corner, chrome }))
    }
    for (const pane of points.panes) {
      assert.deepEqual(pixel(pane.header), pane.top === 0 ? chrome : pane.headerCanvas, label + ': title band and lower split header colors')
      assert.deepEqual(pixel(pane.body), pane.expected, label + ': opaque content body ' + JSON.stringify(pane))
    }
  }
  const readTabsContrast = (theme, orientation) => {
    // Place representative desktop colors beneath the entire painted DOM
    // chain, including the root tint. Native material can vary beyond these inputs.
    const backdrop = theme === 'light' ? [184, 184, 189, 1] : [69, 71, 76, 1]
    return run(`(() => {
      const host=document.querySelector(${JSON.stringify(orientation === 'vertical' ? '.vertical-tab-rail' : '.workspace-tabbar')}),ctx=document.createElement('canvas').getContext('2d');
      const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);const c=[...ctx.getImageData(0,0,1,1).data];c[3]/=255;return c};
      const over=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3])).concat(1);
      const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
      const inspect=selector=>{
        const element=typeof selector==='string'?host.querySelector(selector):selector;if(!element)return undefined;
        const style=getComputedStyle(element),chain=[];
        for(let node=element;node;node=node.parentElement)chain.unshift(getComputedStyle(node));
        const background=chain.reduce((bg,s)=>over(rgba(s.backgroundColor),bg),${JSON.stringify(backdrop)});
        const opacity=chain.reduce((a,s)=>a*Number(s.opacity),1),foreground=rgba(style.color);foreground[3]*=opacity;
        const r=element.getBoundingClientRect();
        return {ratio:contrast(over(foreground,background),background),background,color:rgba(style.color),opacity,weight:Number(style.fontWeight),outline:parseFloat(style.outlineWidth),outlineColor:rgba(style.outlineColor),outlineRatio:contrast(over(rgba(style.outlineColor),background),background),focus:element.matches(':focus-visible'),transition:style.transitionProperty,rect:{x:r.x,y:r.y,width:r.width,height:r.height}};
      };
      const probe=document.createElement('i');document.querySelector('.workspace-layout-root').append(probe);
      const body=Object.fromEntries(['text','text-strong','muted'].map(name=>{probe.style.color='var(--'+name+')';return [name,rgba(getComputedStyle(probe).color)]}));probe.remove();
      const headers=[...document.querySelectorAll('.workspace-view:not([hidden]) :is(.workspace-pane-header,.alto-pane-header)')].map(header=>{
        const title=header.querySelector('.workspace-pane-title-text,.workspace-typed-pane-title strong,.pane-tab-select span');
        return {chrome:${JSON.stringify(orientation === 'vertical')}&&!header.closest('.workspace-split-vertical:not(.is-fullscreen-second) > .workspace-split-second'),
          title:inspect(title),action:inspect(header.querySelector('.workspace-pane-actions button svg')),legacy:inspect(header.querySelector('.fixture-legacy-header')),close:inspect(header.querySelector('.fixture-local-close')),
          expectedTitle:body[title?.matches('strong,.pane-tab-select span')?'text-strong':'text'],expectedAction:body.muted,expectedLegacy:body.text};
      });
      return {normal:inspect('.workspace-tab:not(.is-active):not(.workspace-tab-group-label) .workspace-tab-title'),selected:inspect('.workspace-tab.is-active .workspace-tab-title'),row:inspect('.workspace-tab:not(.is-active):not(.workspace-tab-group-label)'),activeRow:inspect('.workspace-tab.is-active'),group:inspect('.workspace-tab-group-label > span:first-child'),groupRow:inspect('.workspace-tab-group-label'),icon:inspect(${JSON.stringify(orientation === 'vertical' ? '.workspace-tab-icon svg' : '.workspace-tab-add svg')}),tool:inspect('.test-tool'),disabled:inspect('.workspace-history-controls > button:disabled'),status:inspect('.contrast-status'),green:rgba(getComputedStyle(host).getPropertyValue('--green')),headers};
    })()`)
  }
  const assertReadableTabs = (measured, label) => {
    for (const name of ['normal', 'selected', 'group', 'tool']) assert.ok(measured[name].ratio >= 4.5, label + ': readable ' + name + ' ' + measured[name].ratio)
    assert.ok(measured.icon.ratio >= 3, label + ': readable navigation icon')
    for (const header of measured.headers) {
      for (const [name, minimum] of [['title', 4.5], ['action', 3], ['legacy', 3], ['close', 3]]) {
        const sample = header[name]
        if (!sample) continue
        const expected = header.chrome ? measured.normal.color : header[name === 'title' ? 'expectedTitle' : name === 'legacy' ? 'expectedLegacy' : 'expectedAction']
        assert.deepEqual(sample.color, expected, label + ': ' + name + ' follows its chrome or content ink')
        if (header.chrome && sample.rect.height) assert.ok(sample.ratio >= minimum, label + ': readable header ' + name + ' ' + sample.ratio)
      }
    }
  }
  const assertHeaderControls = async theme => {
    const read = async () => {
      const measured = await readTabsContrast(theme, 'vertical')
      return { ink: measured.normal.color, header: measured.headers.find(header => header.legacy) }
    }
    for (const [name, className] of [['legacy', 'fixture-legacy-header'], ['close', 'fixture-local-close']]) {
      const { header } = await read(), rect = header[name].rect
      await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
      await settle()
      const hovered = await read()
      assert.deepEqual(hovered.header[name].color, hovered.ink, name + ': legacy header hover keeps readable chrome ink')
      await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
      await run(`document.querySelector('.workspace-view:not([hidden]) .${className}').focus({preventScroll:true})`)
      const focused = await read()
      assert.deepEqual(focused.header[name].color, focused.ink, name + ': legacy header focus keeps chrome ink')
      assert.ok(focused.header[name].focus && focused.header[name].outline >= 2 && focused.header[name].outlineRatio >= 3, name + ': header keyboard focus contrasts against its fill')
      await run('document.activeElement.blur()')
    }
    await window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1100, y: 700 })
  }
  const assertTabsContrast = async (theme, orientation, suffix = '') => {
    const prefix = 'contrast-' + theme + '-' + orientation + suffix
    const read = () => readTabsContrast(theme, orientation)
    const mouse = (type, rect, extra = {}) => window.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type, x: rect.x + Math.min(24, rect.width / 2), y: rect.y + rect.height / 2, ...extra,
    })
    await run("window.contrastStatus=document.createElement('i');contrastStatus.className='workspace-tab-thread-status contrast-status';contrastStatus.style.color='var(--green)';contrastStatus.textContent='●';document.querySelector('.workspace-tab:not(.is-active):not(.workspace-tab-group-label)').append(contrastStatus)")
    window.setBackgroundColor(theme === 'light' ? '#aaabb1' : '#22242a')
    await mouse('mouseMoved', { x: 1100, y: 700, width: 0, height: 0 })
    await settle()
    const normal = await read()
    assertReadableTabs(normal, theme)
    assert.ok(normal.disabled.opacity < .5, theme + ': disabled navigation remains dim')
    assert.ok(normal.selected.weight > normal.normal.weight, theme + ': selection has stronger text')
    assert.deepEqual(normal.status.color, normal.green, theme + ': semantic status color is preserved')
    assert.doesNotMatch(normal.row.transition, /(^|,\s*)(all|color|background[^,]*|border-color)(,|$)/, 'Hover paint changes immediately')
    await capture(prefix + '-rest')
    await mouse('mouseMoved', normal.row.rect)
    await settle()
    const hovered = await read()
    assert.notDeepEqual(hovered.row.background, normal.row.background, theme + ': hover is visible')
    assert.notDeepEqual(hovered.row.background, hovered.activeRow.background, theme + ': hover differs from selection')
    assert.ok(hovered.normal.ratio >= 4.5, theme + ': readable hovered title')
    const colors = { ink: normal.normal.color, secondary: normal.tool.color, groupInk: normal.group.color, normal: normal.row.background, group: normal.groupRow.background, selected: normal.activeRow.background, hover: hovered.row.background, pressed: {} }
    await capture(prefix + '-hover')
    for (const target of ['row', 'activeRow']) {
      await mouse('mouseMoved', normal[target].rect)
      const before = await read()
      await mouse('mousePressed', normal[target].rect, { button: 'left', buttons: 1, clickCount: 1 })
      const pressed = await read()
      assert.notDeepEqual(pressed[target].background, before[target].background, theme + ': pressed ' + target + ' differs from hover')
      colors.pressed[target] = pressed[target].background
      await mouse('mouseReleased', { x: 1100, y: 700, width: 0, height: 0 }, { button: 'left', buttons: 0, clickCount: 1 })
    }
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await window.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
    await run("document.querySelector('.workspace-tab.is-active').focus({preventScroll:true})")
    const focused = await read()
    assert.ok(focused.activeRow.focus && focused.activeRow.outline >= 2, theme + ': keyboard focus has a visible outline')
    assert.ok(focused.activeRow.outlineRatio >= 3, theme + ': focus outline contrasts against its fill')
    assert.deepEqual(focused.row.rect, normal.row.rect, theme + ': states preserve row geometry')
    colors.focus = focused.activeRow.background
    colors.outline = focused.activeRow.outlineColor
    await capture(prefix + '-focus')
    await run("window.contrastGroup=document.querySelector('.workspace-tab-group-label');contrastGroup.classList.add('is-active');contrastGroup.focus({preventScroll:true})")
    const selectedGroup = await read()
    await run("contrastGroup.dataset.tabDrop='inside'")
    const drop = await read()
    assert.notDeepEqual(drop.groupRow.background, selectedGroup.groupRow.background, theme + ': drop feedback takes priority over selected focus')
    assert.notDeepEqual(drop.groupRow.background, normal.groupRow.background, theme + ': drop feedback differs from an ordinary group heading')
    colors.drop = drop.groupRow.background
    await capture(prefix + '-group-drop')
    await run("document.activeElement.blur();contrastStatus.remove();contrastGroup.classList.remove('is-active');delete contrastGroup.dataset.tabDrop")
    return colors
  }
  const assertCoherence = async label => {
    const measured = await run(`(() => {
      const pane=document.querySelector('.workspace-view:not([hidden]) .workspace-chat-pane:not(.workspace-typed-pane)'),style=getComputedStyle(pane),ctx=document.createElement('canvas').getContext('2d');
      const box=element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,height:r.height}};
      const color=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data]};
      const role=name=>{const probe=document.createElement('i');probe.style.backgroundColor='var('+name+')';pane.append(probe);const result=color(getComputedStyle(probe).backgroundColor);probe.remove();return result};
      const composer=pane.querySelector('.composer'),bubble=pane.querySelector('.activity-user'),tasks=document.querySelector('.todo-header-button'),agents=document.querySelector('.agents-toggle-count');
      const tab=document.querySelector('.workspace-tab:not(.workspace-tab-group-label)'),group=document.querySelector('.workspace-tab-group-label'),feed=pane.querySelector('.conversation-feed-content'),view=pane.closest('.workspace-view');
      const controls=[tab,group,tasks,document.querySelector('.test-tool'),document.querySelector('.workspace-tab-add'),document.querySelector('.workspace-history-controls > button')];
      return {pane:box(pane),title:box(pane.querySelector('.workspace-pane-title-text')),feed:box(feed),composer:box(composer),tasks:box(tasks),
        width:parseFloat(style.getPropertyValue('--workspace-column-width')),gutter:parseFloat(style.getPropertyValue('--workspace-column-gutter')),
        fonts:[tab,pane.querySelector('.workspace-pane-title'),pane.querySelector('.activity-agent .activity-content'),pane.querySelector('[data-cordis-composer-editor]')].map(el=>getComputedStyle(el).fontFamily),
        fills:{bubble:color(getComputedStyle(bubble).backgroundColor),composer:color(getComputedStyle(composer).backgroundColor),sheet:role('--workspace-surface-sheet'),recessed:role('--workspace-surface-recessed'),raised:role('--workspace-surface-raised')},chrome:role('--workspace-surface-chrome'),
        radii:[composer,bubble,...controls].map(el=>getComputedStyle(el).borderRadius),radius:style.getPropertyValue('--workspace-radius').trim(),composerRadius:style.getPropertyValue('--radius-composer').trim(),originalRadius:getComputedStyle(document.documentElement).getPropertyValue('--radius-composer').trim(),
        roundSupported:CSS.supports('corner-shape','round'),corners:[composer,bubble,...controls].map(el=>getComputedStyle(el).getPropertyValue('corner-shape')),
        controls:controls.map(box),groupFrame:parseFloat(getComputedStyle(group,'::before').borderTopLeftRadius),groupInset:parseFloat(getComputedStyle(group).getPropertyValue('--workspace-tab-group-inset')),
        sheetRadius:getComputedStyle(view).getPropertyValue('--workspace-sheet-radius').trim(),sheetEdgeRadius:getComputedStyle(view,'::before').borderTopLeftRadius,vertical:!!document.querySelector('.vertical-tab-rail'),
        tasksNamed:tasks.getAttribute('aria-label'),tasksLabel:getComputedStyle(tasks.querySelector('span')).display,agentsVisible:agents.getBoundingClientRect().width>0,
        collapsed:!!document.querySelector('.vertical-tab-rail.is-collapsed'),scroll:document.documentElement.scrollWidth,viewport:innerWidth};
    })()`)
    const near = (actual, expected, description) => assert.ok(Math.abs(actual - expected) <= 1, label + ': ' + description + ' ' + JSON.stringify(measured))
    const column = Math.min(measured.width, measured.pane.width - 2 * measured.gutter)
    near(measured.composer.width, column, 'composer fits the pane reading column')
    near(measured.feed.width, column, 'transcript uses the same reading column')
    near(measured.title.left, measured.composer.left, 'pane title aligns with the reading column')
    near(measured.feed.left, measured.composer.left, 'transcript and composer align')
    assert.ok(measured.fonts.every(font => font === measured.fonts[0]), label + ': navigation, title, transcript, and real editor share one font family ' + JSON.stringify(measured.fonts))
    assert.deepEqual(measured.fills.bubble, measured.fills.recessed, label + ': message uses the recessed surface')
    assert.deepEqual(measured.fills.composer, measured.fills.raised, label + ': real composer uses the raised surface')
    assert.notDeepEqual(measured.fills.bubble, measured.fills.composer, label + ': message and composer retain distinct surface roles')
    assert.equal(measured.originalRadius, '48px', label + ': original composer radius is preserved')
    assert.equal(measured.composerRadius, measured.originalRadius, label + ': appearance keeps the composer radius')
    assert.equal(measured.radius, measured.originalRadius, label + ': shared rounding derives from the composer')
    assert.ok(measured.radii.every(radius => radius === measured.radius), label + ': composer, messages, tabs, group labels, and toolbar controls share the original rounding ' + JSON.stringify(measured.radii))
    if (measured.roundSupported) assert.ok(measured.corners.every(shape => shape === 'round'), label + ': shared surfaces use round corners')
    for (const control of measured.controls) assert.ok(parseFloat(measured.radius) >= Math.min(control.width, control.height) / 2, label + ': short controls clamp into circles or pills')
    assert.equal(measured.groupFrame, parseFloat(measured.radius) + measured.groupInset, label + ': group outline follows the same rounding and inset')
    assert.equal(measured.sheetRadius, measured.radius, label + ': sheet follows the composer rounding')
    if (measured.vertical) assert.equal(measured.sheetEdgeRadius, measured.radius, label + ': sheet edge uses the shared radius')
    assert.deepEqual([measured.tasks.width, measured.tasks.height, measured.tasksNamed, measured.tasksLabel], [32, 32, 'Tasks', 'none'], label + ': Tasks is a named 32px icon control')
    if (!measured.collapsed) assert.equal(measured.agentsVisible, true, label + ': the Agents count stays visible')
    assert.ok(measured.scroll <= measured.viewport, label + ': content stays inside the viewport')
    return measured
  }
  try {
    await window.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    await settle()
    let state = await run('inspect()')
    assert.equal(state.mounts, 5)
    assert.equal(state.headerStrip, true, 'Tabs start in the top bar')
    assert.equal(state.railStrip, undefined)
    assert.match(state.toolHost, /workspace-tabbar/, 'Tools start in the top bar')
    assert.equal(state.toolsAttribute, null)
    await assertTabGeometry('Initial horizontal geometry')

    await run("document.getElementById('draft-pane-a').value='Keep this draft';window.originalDraft=document.getElementById('draft-pane-a');enableVertical()")
    await finishMotion()
    state = await run('inspect()')
    assert.equal(state.headerStrip, false, 'The top tabs are removed while the rail is active')
    assert.equal(state.railStrip, 'vertical')
    assert.equal(state.mounts, 5, 'Moving tabs to the side does not remount panes')
    assert.equal(await run("originalDraft===document.getElementById('draft-pane-a') && originalDraft.value==='Keep this draft'"), true)
    assert.equal(state.rail.width, 232)
    assert.ok(state.views.left >= state.rail.right - 1, JSON.stringify(state))
    assert.equal(state.bar, undefined, 'The rail replaces the top bar')
    assert.equal(state.rail.top, 0)
    assert.equal(state.rail.height, 760)
    assert.equal(state.toolHost, 'vertical-tab-rail-footer', 'Top bar tools move into the rail')
    assert.ok(state.tool.top >= state.footer.top && state.tool.left >= state.rail.left && state.tool.right <= state.rail.right, JSON.stringify(state))
    assert.equal(state.toggleInFooter, true)
    assert.equal(state.toolsAttribute, 'rail')
    assert.equal(state.railEnd, '232px')
    await assertStableTabStatus('Expanded vertical geometry')
    // Every pane kind's top bar joins one title band: same height and color as
    // the rail's top row, with the sheet edge curving beneath it.
    const band = selector => run(`(()=>{const view=document.querySelector('.workspace-view:not([hidden])'),bar=view.querySelector('${selector}'),style=getComputedStyle(bar),r=bar.getBoundingClientRect(),edge=getComputedStyle(view,'::before'),rail=document.querySelector('.vertical-tab-rail');
      return {barTop:r.top,barBottom:r.bottom,barWidth:Math.round(r.width),viewWidth:Math.round(view.getBoundingClientRect().width),barColor:style.backgroundColor,barBorder:style.borderBottomColor,railColor:getComputedStyle(rail).backgroundColor,railHeader:document.querySelector('.vertical-tab-rail-header').getBoundingClientRect().height,
        sheetColor:getComputedStyle(view).backgroundColor,edgeTop:edge.top,edgeBorderTop:edge.borderTopWidth,edgeRadius:edge.borderTopLeftRadius,edgeLeft:edge.borderLeftWidth}})()`)
    const assertBand = (measured, label) => {
      assert.equal(measured.barTop, 0, label)
      assert.equal(measured.barBottom, measured.railHeader, label + ': aligned with the rail top row')
      assert.equal(measured.barBottom, 40, label)
      assert.equal(measured.barColor, measured.railColor, label + ': chrome color')
      assert.notEqual(measured.sheetColor, measured.railColor, label + ': lighter sheet')
      // The edge sits in the band's last row, above any native surface in the content box.
      assert.deepEqual([measured.edgeTop, measured.edgeBorderTop, measured.edgeRadius, measured.edgeLeft], ['39px', '1px', '48px', '1px'], label + ': curved sheet edge')
    }
    const headerless = await band('.workspace-typed-pane > .workspace-pane-header')
    assertBand(headerless, 'Pane kinds without a top bar')
    assert.equal(headerless.barWidth, headerless.viewWidth, 'Their pane controls widen into a full band')
    await run("window.chatLike=document.querySelector('.workspace-view:not([hidden]) > .workspace-typed-pane');chatLike.classList.remove('workspace-typed-pane')")
    assertBand(await band('.workspace-chat-pane > .workspace-pane-header'), 'Chat titles')
    await run("chatLike.classList.add('workspace-typed-pane')")
    await run("click('[data-workspace-tab=e]')")
    await settle()
    const terminal = await band('.alto-pane-header')
    assertBand(terminal, 'Terminal-style top bars')
    assert.equal(terminal.barBorder, 'rgba(0, 0, 0, 0)', 'The sheet edge replaces the top bar border')
    await capture('vertical-terminal-band-light')
    for (let index = 1; index < state.tabs.length; index += 1) {
      assert.ok(state.tabs[index].top >= state.tabs[index - 1].top + state.tabs[index - 1].height, 'Tabs stack vertically')
      assert.equal(state.tabs[index].left, state.tabs[0].left)
    }
    assert.ok(state.tabs.every(tab => tab.icon && tab.titleVisible && tab.height === 32), JSON.stringify(state.tabs))
    assert.match(state.tabs[4].iconClass, /square-terminal/, 'Tabs show their focused pane kind')
    assert.ok(state.scroll <= 1200)
    await capture('vertical-expanded-light')

    await run("click('[data-workspace-tab=c]')")
    assert.equal((await run('inspect()')).activePanel, 'draft-pane-c')
    await run("drop('[data-workspace-tab=e]','[data-workspace-tab=b]',0.1)")
    assert.deepEqual((await run('inspect()')).saved.views.map(view => view.id), ['a','e','b','c','d'], 'Dragging uses the vertical midpoint')
    await run("drop('[data-workspace-tab=e]','[data-workspace-tab=d]',0.9)")
    assert.deepEqual((await run('inspect()')).saved.views.map(view => view.id), ['a','b','c','d','e'])

    await run("context('[data-workspace-tab=a]');clickText('Add to new group');key('Escape')")
    await run("context('[data-workspace-tab=b]');clickText('Group')")
    await finishMotion()
    const groupLabel = await run("(()=>{const r=document.querySelector('[data-workspace-group]').getBoundingClientRect(),a=document.querySelector('[data-workspace-tab=a]').getBoundingClientRect();return {labelBottom:r.bottom,memberTop:a.top,labelWidth:r.width}})()")
    assert.ok(groupLabel.memberTop >= groupLabel.labelBottom, JSON.stringify(groupLabel))
    // Each member's slice of the group line reaches across the gap to the next.
    const groupLine = await run(`(()=>{const slice=id=>{const tab=document.querySelector('[data-workspace-tab='+id+']'),r=tab.getBoundingClientRect(),style=getComputedStyle(tab),line=getComputedStyle(tab,'::before');
      return {top:r.top+parseFloat(style.borderTopWidth)+parseFloat(line.top),bottom:r.bottom-parseFloat(style.borderBottomWidth)-parseFloat(line.bottom)}};return {a:slice('a'),b:slice('b')}})()`)
    assert.ok(groupLine.a.bottom >= groupLine.b.top, 'Group line is continuous: ' + JSON.stringify(groupLine))
    // The line sits under the label's first letter, and member content starts a step past it.
    const groupColumn = await run(`(()=>{const label=document.querySelector('[data-workspace-group] > span:first-child').getBoundingClientRect(),tab=document.querySelector('[data-workspace-tab=a]'),r=tab.getBoundingClientRect(),line=getComputedStyle(tab,'::before'),
      left=r.left+parseFloat(getComputedStyle(tab).borderLeftWidth)+parseFloat(line.left);return {labelText:label.left,line:left,lineEnd:left+parseFloat(line.width),content:tab.firstElementChild.getBoundingClientRect().left}})()`)
    assert.equal(groupColumn.line, groupColumn.labelText, 'Group line aligns with the label text: ' + JSON.stringify(groupColumn))
    assert.equal(groupColumn.content - groupColumn.lineEnd, 8, 'Member content starts a step past the line: ' + JSON.stringify(groupColumn))
    await assertTabGeometry('Expanded group geometry')
    await capture('vertical-group-light')
    await run("click('[data-workspace-group]')")
    await finishMotion()
    state = await run('inspect()')
    assert.deepEqual(state.tabs.filter(tab => tab.id === 'a' || tab.id === 'b').map(tab => tab.height), [0, 0], 'Collapsed groups fold their rows away')
    await assertTabGeometry('Collapsed group geometry')
    assert.equal(state.mounts, 5)
    await run("click('[data-workspace-group]')")
    await finishMotion()

    await run("resize(80)")
    await finishMotion()
    state = await run('inspect()')
    assert.equal(state.rail.width, 312)
    assert.equal(state.stored.width, 312)
    await run("document.querySelector('.vertical-tab-rail-resize').focus();key('Home')")
    await finishMotion()
    assert.equal((await run('inspect()')).rail.width, 168)
    await run("document.querySelector('.vertical-tab-rail-resize').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
    await finishMotion()
    assert.equal((await run('inspect()')).rail.width, 232)

    await run("click('.vertical-tab-rail-toggle')")
    await finishMotion()
    state = await run('inspect()')
    assert.equal(state.collapsed, true)
    assert.equal(state.rail.width, 48)
    assert.equal(state.stored.collapsed, true)
    assert.ok(state.tabs.every(tab => tab.icon && !tab.titleVisible), JSON.stringify(state.tabs))
    await capture('vertical-collapsed-light')
    await run("document.querySelector('[data-workspace-tab=c]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
    await finishMotion()
    assert.equal((await run('inspect()')).rail.width, 232, 'Renaming temporarily widens a collapsed rail')
    await run("key('Escape')")
    await finishMotion()
    assert.equal((await run('inspect()')).rail.width, 48)
    assert.equal((await run('inspect()')).railEnd, '48px', 'Flyouts follow the collapsed rail edge')

    await run('commandB()')
    await finishMotion()
    state = await run('inspect()')
    assert.equal(state.collapsed, false, 'Command-B expands the rail')
    assert.equal(state.rail.width, 232)
    await run('commandB()')
    await finishMotion()
    state = await run('inspect()')
    assert.equal(state.collapsed, true, 'Command-B collapses the rail')
    assert.equal(state.stored.collapsed, true)

    await run('commandB(true)')
    await finishMotion()
    state = await run('inspect()')
    assert.equal(state.railStrip, undefined, 'Command-Shift-B switches to top tabs')
    assert.equal(state.headerStrip, true)
    assert.equal(state.bar.height, 52)
    await assertStableTabStatus('Restored horizontal geometry')
    const expandedMembers = await run("[...document.querySelectorAll('.workspace-tab-group-member')].map(row=>row.getBoundingClientRect().width)")
    await run("click('[data-workspace-group]');document.querySelector('.workspace-tabs').getAnimations({subtree:true}).forEach(animation=>{animation.pause();animation.currentTime=100})")
    const foldingMembers = await run("[...document.querySelectorAll('.workspace-tab-group-member')].map(row=>({width:row.getBoundingClientRect().width,height:row.getBoundingClientRect().height,inert:row.inert}))")
    assert.ok(foldingMembers.every((row,index)=>row.width>0&&row.width<expandedMembers[index]&&row.height===32&&row.inert), 'Horizontal members retain their folding motion and leave keyboard navigation immediately: ' + JSON.stringify(foldingMembers))
    await finishMotion()
    assert.ok(await run("[...document.querySelectorAll('.workspace-tab-group-member')].every(row=>row.getBoundingClientRect().width===0)"), 'Horizontal groups still fold completely')
    await assertTabGeometry('Folded horizontal geometry')
    await run("click('[data-workspace-group]')")
    await finishMotion()
    assert.match(state.toolHost, /workspace-tabbar/)
    assert.equal(state.toolsAttribute, null)
    assert.equal(state.stored.orientation, 'horizontal')
    const horizontalChrome = await run("(()=>{const bar=getComputedStyle(document.querySelector('.workspace-tabbar')).backgroundColor,view=getComputedStyle(document.querySelector('.workspace-view:not([hidden])')).backgroundColor;return {bar,view}})()")
    assert.equal(horizontalChrome.bar, terminal.railColor, 'Top tabs use the same chrome color as the rail')
    assert.notEqual(horizontalChrome.bar, horizontalChrome.view, 'The top bar is darker than the sheet')
    await capture('horizontal-chrome-light')
    assert.equal(await run("originalDraft===document.getElementById('draft-pane-a') && originalDraft.value==='Keep this draft'"), true, 'Switching orientation keeps panes mounted')
    await run('commandB()')
    assert.equal((await run('inspect()')).stored.collapsed, true, 'Command-B is inactive with top tabs')
    await run('commandB(true)')
    await finishMotion()
    state = await run('inspect()')
    assert.equal(state.railStrip, 'vertical', 'Command-Shift-B switches back to the side rail')
    assert.equal(state.collapsed, true, 'The rail keeps its collapsed state across switches')
    assert.equal(state.stored.orientation, 'vertical')

    await run("split('horizontal','terminal')")
    await settle()
    const splitBars = await run('bars()')
    assert.equal(splitBars.length, 2)
    for (const bar of splitBars) {
      assert.deepEqual([bar.top, bar.bottom, bar.border], [0, 40, 'rgba(0, 0, 0, 0)'], 'Side-by-side title bars share the band: ' + JSON.stringify(splitBars))
      assert.equal(bar.color, splitBars[0].color)
    }
    assert.equal(splitBars[0].color, (await run("getComputedStyle(document.querySelector('.vertical-tab-rail')).backgroundColor")), 'Split title bars use the rail chrome')
    await capture('vertical-split-light')
    await run('reload()')
    await finishMotion()
    state = await run('inspect()')
    assert.equal(state.collapsed, true, 'The collapsed preference survives reloads')
    // Reloading the test root remounts every pane once; later checks count from here.
    const mounted = state.mounts
    await run("window.originalDraft=document.getElementById('draft-pane-a');originalDraft.value='Keep this draft'")
    await run("click('.vertical-tab-rail-toggle')")
    await finishMotion()

    window.webContents.debugger.attach('1.3')
    const transparencyPreference = value => window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-transparency', value }],
    })
    const assertAccentChrome = async theme => {
      const accents = [['violet', '#7c3aed'], ['blue', '#2563eb'], ['warm', '#ea580c'], ['green', '#16a34a'], ['black', '#000000'], ['white', '#ffffff']]
      const nativeColors = new Set(), opaqueColors = new Set()
      let content
      for (const [name, accent] of accents) {
        await run(`document.documentElement.style.setProperty('--alto-theme-accent',${JSON.stringify(accent)})`)
        await settle()
        const appearance = await assertCoherence(theme + ': ' + name + ' accent')
        if (content) assert.deepEqual(appearance.fills, content, theme + ': changing the accent preserves sheet, message, and composer fills')
        else content = appearance.fills
        let nativeColor, stateColors
        for (const orientation of ['vertical', 'horizontal']) {
          const label = theme + ': ' + name + ' ' + orientation
          const glass = await material()
          assertNativeMaterial(glass, label)
          assert.ok(Math.abs(glass.root.alpha - .2) < .01, label + ': glass keeps 80% native material visible')
          assert.equal(glass.root.image, 'none', label + ': accent wash adds no gradient')
          if (nativeColor) assert.deepEqual(glass.root.rgba, nativeColor, label + ': both orientations share one tinted material')
          else nativeColor = glass.root.rgba
          nativeColors.add(JSON.stringify(glass.root.rgba))
          const states = await assertTabsContrast(theme, orientation, '-' + name)
          if (stateColors) assert.deepEqual(states, stateColors, label + ': accent shares all states in both orientations')
          stateColors = states
          await settle()
          await capture(`accent-${theme}-${orientation}-${name}`)
          await transparencyPreference('reduce')
          const reduced = await material()
          assertOpaqueChrome(reduced, label + ': reduced transparency')
          assert.deepEqual(reduced.root.rgba, appearance.chrome, label + ': opaque chrome uses the shared accent surface, including the dark alias')
          opaqueColors.add(JSON.stringify(reduced.root.rgba))
          await transparencyPreference('no-preference')
          await run("document.documentElement.dataset.desktopPlatform='linux'")
          const nonmac = await material()
          assertOpaqueChrome(nonmac, label + ': nonmac fallback')
          assert.deepEqual(nonmac.root.rgba, reduced.root.rgba, label + ': nonmac and reduced-transparency chrome agree')
          await run("document.documentElement.dataset.desktopPlatform='darwin';commandB(true)")
          await finishMotion()
        }
      }
      assert.equal(nativeColors.size, accents.length, theme + ': every accent recolors the glass')
      assert.equal(opaqueColors.size, accents.length, theme + ': every accent recolors opaque chrome')
      await run("document.documentElement.style.removeProperty('--alto-theme-accent')")
      await settle()
    }
    await transparencyPreference('no-preference')
    const appearanceByTheme = new Map()
    for (const theme of ['light', 'dark']) {
      await run(`Object.assign(document.documentElement.dataset,{altoTheme:'${theme}',desktopPlatform:'darwin',altoThemePlugin:'active',altoChromeTheme:'alto'})`)
      for (const width of [1200, 600]) {
        window.setContentSize(width, 760)
        await settle()
        await finishMotion()
        state = await run('inspect()')
        assert.ok(state.scroll <= width, JSON.stringify({ width, scroll: state.scroll }))
        assert.equal(state.bar, undefined)
        assert.equal(state.toolHost, 'vertical-tab-rail-footer')
        if (width === 600) {
          assert.equal(state.collapsed, true, 'Narrow workspaces show an icon-only rail')
          assert.equal(state.toggle, false)
          assert.equal(state.rail.width, 76, 'The macOS icon rail clears the window buttons')
          assert.ok(state.tool.left >= state.rail.left && state.tool.right <= state.rail.right, JSON.stringify(state.tool))
          assert.ok(state.views.width >= 520, JSON.stringify(state.views))
        } else {
          assert.equal(state.collapsed, false)
          // Back and forward sit clear of the window buttons, centered on their row.
          const arrows = await run("[...document.querySelectorAll('.vertical-tab-rail-header .workspace-history-controls > button')].map(button=>{const r=button.getBoundingClientRect();return {left:r.left,center:r.top+r.height/2}})")
          assert.equal(arrows[0].left, 96, theme + ': back clears the window buttons ' + JSON.stringify(arrows))
          assert.deepEqual(arrows.map(arrow => arrow.center), [21, 21], theme + ': arrows align with the window buttons')
          assert.equal((await run("document.querySelector('.vertical-tab-rail-header').getBoundingClientRect().height")), 40, 'The rail header keeps the band height')
        }
        assertNativeMaterial(await material(), theme + ' at ' + width + 'px');
        let verticalColors
        if (width === 1200) {
          verticalColors = await assertTabsContrast(theme, 'vertical')
          await assertMaterialPixels(theme + ': side-by-side panes')
        }
        await run('commandB(true)')
        await finishMotion()
        assertNativeMaterial(await material(), theme + ': horizontal tabs share the material')
        const horizontalState = await run('inspect()')
        assert.ok(horizontalState.scroll <= width, theme + ': horizontal tabs stay within ' + width + 'px')
        assert.ok(horizontalState.tool.right <= width, theme + ': horizontal tools stay visible')
        if (width === 1200) {
          const horizontalColors = await assertTabsContrast(theme, 'horizontal')
          assert.deepEqual(horizontalColors, verticalColors, theme + ': both orientations share all tab colors and state fills')
          appearanceByTheme.set(theme, horizontalColors)
          await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'no-preference' }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
          assert.equal(await run("getComputedStyle(document.querySelector('.workspace-tab-group-label')).transitionProperty"), 'none', 'Reduced motion disables horizontal group label transitions')
          await transparencyPreference('no-preference')
        }
        await capture(`horizontal-${theme}-${width}`)
        await run('commandB(true)')
        await finishMotion()
        assertNativeMaterial(await material(), theme + ': switching back to vertical')
        await capture(`vertical-${theme}-${width}`)
      }
      await transparencyPreference('reduce')
      await settle()
      assert.equal(await run("matchMedia('(prefers-reduced-transparency: reduce)').matches"), true)
      assertOpaqueChrome(await material(), theme + ': reduced transparency')
      await transparencyPreference('no-preference')
      await settle()
      assertNativeMaterial(await material(), theme + ': restored transparency preference')
      await run("document.documentElement.dataset.desktopPlatform='linux'")
      assertOpaqueChrome(await material(), theme + ': nonmac fallback')
      await run("document.documentElement.dataset.desktopPlatform='darwin'")
    }
    window.setContentSize(1200, 760)
    await settle()
    await finishMotion()

    // Preview actual editing UI without replacing or remounting any pane renderer.
    for (const theme of ['light', 'dark']) {
      window.setBackgroundColor(theme === 'light' ? '#aaabb1' : '#22242a')
      await run(`document.documentElement.dataset.altoTheme='${theme}';click('[data-workspace-tab=a]');mountPreview()`)
      await assertAccentChrome(theme)
      for (const width of [1200, 600]) {
        window.setContentSize(width, 760)
        await settle()
        await finishMotion()
        for (const orientation of ['vertical', 'horizontal']) {
          const label = `coherence-${theme}-${orientation}-${width}`
          await capture(label)
          await assertCoherence(label)
          assertReadableTabs(await readTabsContrast(theme, orientation), label)
          if (theme === 'light' && width === 1200 && orientation === 'vertical') {
            await run("window.coherenceEditor=document.querySelector('[data-cordis-composer-editor]');coherenceEditor.focus();document.execCommand('insertText',false,' A retained draft.');window.editorSelection={node:getSelection().anchorNode,offset:getSelection().anchorOffset,text:coherenceEditor.textContent};disableAppearance();enableAppearance()")
            await settle()
            assert.equal(await run("coherenceEditor===document.querySelector('[data-cordis-composer-editor]') && document.activeElement===coherenceEditor && getSelection().anchorNode===editorSelection.node && getSelection().anchorOffset===editorSelection.offset && coherenceEditor.textContent===editorSelection.text"), true, 'Style changes retain the real editor, focus, draft, and caret')
            await run('coherenceEditor.blur()')
          }
          await run('commandB(true)')
          await finishMotion()
        }
      }
      await run('unmountPreview()')
      window.setContentSize(1200, 760)
      await run("click('[data-workspace-tab=c]');mountPreview()")
      await settle()
      await finishMotion()
      await capture(`coherence-${theme}-vertical-split`)
      await assertCoherence(theme + ': chat beside a typed terminal pane')
      await run('unmountPreview()')
      assert.equal((await run('inspect()')).mounts, mounted, 'Content previews and appearance changes preserve pane mounts')
      assert.equal(await run("originalDraft===document.getElementById('draft-pane-a') && originalDraft.value==='Keep this draft'"), true, 'The original pane draft remains mounted behind the preview')
    }

    // The same sheet must work when either a headerless or terminal-style
    // pane leads it, including a lower split promoted to full screen.
    for (const tab of ['e', 'a']) {
      await run(`click('[data-workspace-tab=${tab}]')`)
      await settle()
      assertNativeMaterial(await material(), tab + ': full-size pane')
      await assertMaterialPixels(tab + ': full-size pane')
      if (tab === 'e') await assertHeaderControls('dark')
    }
    await run("click('[data-workspace-tab=c]');window.materialSplit=document.querySelector('.workspace-view:not([hidden]) > .workspace-split');materialSplit.classList.replace('workspace-split-horizontal','workspace-split-vertical')")
    await settle()
    await finishMotion()
    await assertMaterialPixels('Vertical split keeps its lower header opaque')
    assertReadableTabs(await readTabsContrast('dark', 'vertical'), 'Lower split keeps its content ink')
    await run("materialSplit.classList.add('is-fullscreen-second')")
    await settle()
    await finishMotion()
    await capture('vertical-native-fullscreen-second')
    await assertMaterialPixels('A full-screen lower pane joins the title band')
    assertReadableTabs(await readTabsContrast('dark', 'vertical'), 'Promoted lower header joins the chrome ink')
    await run("materialSplit.classList.remove('is-fullscreen-second');materialSplit.classList.replace('workspace-split-vertical','workspace-split-horizontal')")
    await settle()
    await run("document.documentElement.dataset.sidebarMode='pinned'")
    await finishMotion()
    await assertMaterialPixels('Pinned sidebar gutter')
    await run("delete document.documentElement.dataset.sidebarMode")
    await finishMotion()

    await run('disableVertical()')
    await settle()
    await finishMotion()
    state = await run('inspect()')
    assert.equal(state.headerStrip, true, 'Disabling the fiber restores the top tabs')
    assert.equal(state.railStrip, undefined)
    assert.equal(state.bar.height, 52, 'Disabling the fiber restores the top bar')
    assert.match(state.toolHost, /workspace-tabbar/, 'Tools return to the top bar')
    assert.equal(state.toolsAttribute, null)
    assert.equal(state.railEnd, '')
    await run('commandB()')
    assert.equal((await run('inspect()')).railStrip, undefined, 'Command-B is released with the fiber')
    assert.equal(state.tabs.some(tab => tab.icon), false)
    assert.equal(await run("!!document.querySelector('[data-plugin-style=vertical-tabs]')"), false)
    assert.equal(await run("!!document.querySelector('[data-plugin-style=workspace-tabs-appearance]')"), true, 'Shared appearance outlives the vertical fiber')
    assertNativeMaterial(await material(), 'Disabling the vertical fiber retains the shared material')
    assert.deepEqual(await assertTabsContrast('dark', 'horizontal', '-vertical-disabled'), appearanceByTheme.get('dark'), 'Disabling vertical tabs retains the horizontal tab appearance')
    assert.equal(state.mounts, mounted)
    assert.equal(await run("originalDraft===document.getElementById('draft-pane-a') && originalDraft.value==='Keep this draft'"), true)

    await run('disableGroups();enableVertical()')
    await finishMotion()
    state = await run('inspect()')
    assert.equal(state.railStrip, 'vertical', 'The default strip also renders vertically')
    await run("drop('[data-workspace-tab=e]','[data-workspace-tab=a]',0.1)")
    assert.equal((await run('inspect()')).saved.views[0].id, 'e')
    assert.equal((await run('inspect()')).mounts, mounted)
    await run('disableMaterial()')
    await settle()
    assertOpaqueChrome(await material(), 'Disabling material restores opaque chrome while vertical tabs stay active')
    assert.equal(await run("!!document.querySelector('[data-plugin-style=workspace-material]')"), false)
    assert.equal((await run('inspect()')).mounts, mounted, 'Changing material does not remount panes')
    await run('teardown()')
    console.log('Vertical tab browser checks passed')
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach()
    window.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
