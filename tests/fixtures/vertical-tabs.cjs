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
      import {SquareTerminal} from 'lucide-react';
      import plugin from './program/plugins/workspace-layout.client';
      import groupsPlugin from './program/plugins/workspace-tab-groups.client';
      import verticalTabsPlugin from './program/plugins/vertical-tabs.client';
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
      const Tool=()=><button type="button" className="alto-button test-tool"><svg width="14" height="14"/><span>Subagents</span></button>;
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
      const groups=fiber(groupsPlugin),vertical=fiber(ctx=>{verticalTabsPlugin(ctx);
        verticalHotkeysPlugin({...ctx,clientVerticalTabs:registry.verticalTabs,clientHotkeys:{registerAction:(owner,action)=>hotkeys.registerAction(owner,action)}})});
      window.enableGroups=groups.enable;window.disableGroups=groups.disable;
      window.enableVertical=vertical.enable;window.disableVertical=vertical.disable;
      groups.enable();
      window.mounts=0;
      const Pane=({pane})=>{useEffect(()=>{window.mounts++},[]);const body=<main className="test-pane"><p>Conversation in {pane.id}</p><textarea id={'draft-'+pane.id} defaultValue={'Draft for '+pane.id}/></main>;
        // Terminal-like panes draw their own top bar with the shared pane header, as the real terminal does.
        return pane.kind==='terminal'?<div className="alto-pane test-terminal"><div className="alto-pane-header workspace-local-tabbar">Terminal</div>{body}</div>:body};
      registry.registerPaneKind({effect:fn=>fn()},{id:'test',label:'Test pane',renderer:Pane});
      registry.registerPaneKind({effect:fn=>fn()},{id:'terminal',label:'Terminal',icon:SquareTerminal,renderer:Pane});
      window.boot=()=>{root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<Surface surface={{id:'workspace-layout',kind:'workspace-layout'}}/>))};
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
      window.teardown=()=>{hotkeys.dispose();flushSync(()=>root.unmount())};
      window.boot();
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all(['src/client/styles.css', 'program/plugins/ui/default.css', 'program/plugins/theme.css'].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((request, response) => {
    response.end('<!doctype html><style>' + css + '\n#root{height:100vh}.test-pane{padding:24px;width:100%}.test-pane textarea{width:100%;min-height:100px}.test-terminal{flex:1 1 0}</style><div id="root"></div>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const window = new BrowserWindow({ show: false, width: 1200, height: 760, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = code => window.webContents.executeJavaScript(code)
  const settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const finishMotion = async () => {
    await run("document.querySelectorAll('.vertical-tab-rail, .workspace-tabs').forEach(el=>el.getAnimations({subtree:true}).forEach(animation=>animation.finish()))")
    await settle()
  }
  const capture = async name => {
    if (!process.env.ALTO_VERTICAL_TABS_ARTIFACT_DIR) return
    await fs.mkdir(process.env.ALTO_VERTICAL_TABS_ARTIFACT_DIR, { recursive: true })
    await fs.writeFile(path.join(process.env.ALTO_VERTICAL_TABS_ARTIFACT_DIR, name + '.png'), (await window.webContents.capturePage()).toPNG())
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
      assert.deepEqual([measured.edgeTop, measured.edgeBorderTop, measured.edgeRadius, measured.edgeLeft], ['39px', '1px', '18px', '1px'], label + ': curved sheet edge')
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
    await capture('vertical-group-light')
    await run("click('[data-workspace-group]')")
    await finishMotion()
    state = await run('inspect()')
    assert.deepEqual(state.tabs.filter(tab => tab.id === 'a' || tab.id === 'b').map(tab => tab.height), [0, 0], 'Collapsed groups fold their rows away')
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

    for (const theme of ['light', 'dark']) {
      await run(`document.documentElement.dataset.altoTheme='${theme}';document.documentElement.dataset.desktopPlatform='darwin'`)
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
        await capture(`vertical-${theme}-${width}`)
      }
    }
    window.setContentSize(1200, 760)
    await settle()

    await run('disableVertical()')
    await settle()
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
    assert.equal(state.mounts, mounted)
    assert.equal(await run("originalDraft===document.getElementById('draft-pane-a') && originalDraft.value==='Keep this draft'"), true)

    await run('disableGroups();enableVertical()')
    await finishMotion()
    state = await run('inspect()')
    assert.equal(state.railStrip, 'vertical', 'The default strip also renders vertically')
    await run("drop('[data-workspace-tab=e]','[data-workspace-tab=a]',0.1)")
    assert.equal((await run('inspect()')).saved.views[0].id, 'e')
    assert.equal((await run('inspect()')).mounts, mounted)
    await run('teardown()')
    console.log('Vertical tab browser checks passed')
  } finally {
    window.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
