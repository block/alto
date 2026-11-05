const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'group-status-check.tsx', loader: 'tsx', contents: `
      import React,{useEffect} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import layoutPlugin from './program/plugins/workspace-layout.client';
      import groupsPlugin from './program/plugins/workspace-tab-groups.client';
      import verticalPlugin from './program/plugins/vertical-tabs.client';
      import statusPlugin from './program/plugins/workspace-thread-status.client';
      import materialPlugin from './program/plugins/workspace-material.client';
      import appearancePlugin from './program/plugins/workspace-tabs-appearance.client';
      import controlsPlugin from './program/plugins/interface-appearance.client';
      import {parseWorkspaceLayout} from './program/plugins/workspace-layout-state';
      const thread=id=>({id,title:id,preview:'',cwd:'/repo',createdAt:1,updatedAt:1});
      const pane=(id,threadId)=>({type:'pane',id,kind:'test',workspace:'/repo',thread:thread(threadId)});
      const split=(id,first,second)=>({type:'split',id,direction:'horizontal',ratio:0.5,first,second});
      let saved={version:2,activeViewId:'outside',groups:[{id:'release',name:'Release work awaiting review',color:'purple',collapsed:true}],views:[
        {id:'a',groupId:'release',name:'First unread chat',workspace:'/repo',focusedPaneId:'pane-a1',root:split('split-a',pane('pane-a1','unread-a'),pane('pane-a2','unread-a'))},
        {id:'b',groupId:'release',name:'Second unread chat',workspace:'/repo',focusedPaneId:'pane-b',root:pane('pane-b','unread-b')},
        {id:'c',groupId:'release',name:'Working chat',workspace:'/repo',focusedPaneId:'pane-c1',root:split('split-c',pane('pane-c1','working'),pane('pane-c2','unread-a'))},
        {id:'outside',name:'Current chat',workspace:'/repo',focusedPaneId:'pane-outside',root:pane('pane-outside','outside')},
      ]};
      localStorage.setItem('codex-cordis.workspace-layout',JSON.stringify(saved));
      localStorage.setItem('codex-cordis.vertical-tabs',JSON.stringify({orientation:'horizontal',width:232,collapsed:false}));
      const state={connected:true,session:{workspace:'/repo',permissionMode:'full'},projects:[],threads:[],skills:[],turn:{tag:'idle'},activities:[],history:{tag:'ready',entries:[]},harness:{codex:{status:'ready',models:[]},ui:{surfaces:[],contributions:[],regions:[]}}};
      const host={subscribe:()=>()=>{},snapshot:()=>({connectionEpoch:1}),call:async(method,payload)=>{
        if(method.endsWith('.read'))return structuredClone(saved);
        if(method.endsWith('.write')){saved=parseWorkspaceLayout(payload);return null;}
      }};
      let Surface,registry,vertical,root;
      const statusListeners=new Set();
      let status={revision:0,running:[],finished:[]};
      const statusStore={snapshot:()=>status,subscribe:listener=>{statusListeners.add(listener);return()=>statusListeners.delete(listener)}};
      window.setStatus=(running,finished)=>flushSync(()=>{status={revision:status.revision+1,running,finished};for(const listener of statusListeners)listener()});
      const Placeholder=()=>null;
      const ui={subscribe:()=>()=>{},snapshot:()=>0,component:()=>Placeholder,renderer:()=>undefined,contributionRenderer:()=>undefined,
        overlays:{open:()=>{},close:()=>{}},registerSurface:(_owner,_id,component)=>{Surface=component},
        registerStyle:(owner,id,css)=>owner.effect(()=>{const element=document.createElement('style');element.dataset.pluginStyle=id;element.textContent=css;document.head.append(element);return()=>element.remove()})};
      const ctx={provide:(name,value)=>{if(name==='clientVerticalTabs')vertical=value;else registry=value},clientUi:ui,clientHost:host,
        clientSession:{snapshot:()=>state,subscribe:()=>()=>{}},clientThreadStatus:statusStore,
        clientSessionRouter:{setActive:()=>{},clearActive:()=>{}},clientSessionFactory:{create:()=>{throw new Error('Unexpected chat creation')}}};
      const fiber=install=>{let effects=[];return {
        enable:()=>flushSync(()=>install({...ctx,clientWorkspaceLayout:registry,effect:fn=>{const cleanup=fn();effects.push(cleanup);return cleanup}})),
        disable:()=>flushSync(()=>{for(const cleanup of effects.reverse())cleanup();effects=[]}),
      }};
      layoutPlugin({...ctx,effect:fn=>fn()});
      const controls=fiber(controlsPlugin),appearance=fiber(appearancePlugin),material=fiber(materialPlugin),groups=fiber(groupsPlugin),rail=fiber(verticalPlugin),badges=fiber(statusPlugin);
      controls.enable();groups.enable();appearance.enable();material.enable();rail.enable();badges.enable();
      window.disableStatus=badges.disable;window.enableStatus=badges.enable;
      window.orient=(orientation,width=232)=>flushSync(()=>{vertical.setWidth(width);vertical.setOrientation(orientation)});
      window.toggleGroup=()=>flushSync(()=>document.querySelector('[data-workspace-group=release]').click());
      window.renameGroup=name=>{
        flushSync(()=>{const group=document.querySelector('[data-workspace-group=release]'),bounds=group.getBoundingClientRect();group.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:bounds.left+8,clientY:bounds.bottom}))});
        flushSync(()=>{const input=document.querySelector('.workspace-tab-group-name input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,name);input.dispatchEvent(new Event('input',{bubbles:true}))});
        flushSync(()=>document.querySelector('.workspace-tab-group-name input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})));
        originalDraft.focus();
      };
      window.mounts=0;
      const Pane=({pane})=>{useEffect(()=>{window.mounts++},[]);return <main className="test-pane"><p>Conversation in {pane.id}</p><textarea id={'draft-'+pane.id} defaultValue={'Draft for '+pane.id}/></main>};
      registry.registerPaneKind({effect:fn=>fn()},{id:'test',label:'Test chat',renderer:Pane});
      root=createRoot(document.getElementById('workspace-mount'));
      flushSync(()=>root.render(<Surface surface={{id:'workspace-layout',kind:'workspace-layout'}}/>));
      window.originalDraft=document.getElementById('draft-pane-outside');originalDraft.value='Keep my unfinished message';originalDraft.focus();
      window.inspect=()=>{
        const group=document.querySelector('[data-workspace-group=release]'),summary=group.querySelector('.workspace-tab-group-status'),count=group.querySelector('.workspace-tab-group-count');
        const visible=element=>!!element&&getComputedStyle(element).display!=='none'&&element.getBoundingClientRect().width>0;
        return {expanded:group.getAttribute('aria-expanded'),statuses:[...group.querySelectorAll('.workspace-tab-group-status [data-thread-status]')].map(element=>element.dataset.threadStatus),
          counts:[...group.querySelectorAll('.workspace-tab-group-status-count')].map(element=>element.textContent),
          labels:[...group.querySelectorAll('[aria-label]')].map(element=>element.getAttribute('aria-label')),
          titles:[...group.querySelectorAll('[title]')].map(element=>element.title),fallback:count?.textContent,fallbackVisible:visible(count),summaryVisible:visible(summary),
          tabStatuses:[...document.querySelectorAll('[data-workspace-tab] [data-thread-status]')].map(element=>element.dataset.threadStatus),
          mounts:window.mounts,listeners:statusListeners.size,draft:originalDraft===document.getElementById('draft-pane-outside')&&originalDraft.value==='Keep my unfinished message',focused:document.activeElement===originalDraft,saved:structuredClone(saved)};
      };
      window.geometry=()=>{
        const box=element=>{const r=element.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
        const group=document.querySelector('[data-workspace-group=release]'),strip=document.querySelector('.workspace-tabs'),rail=document.querySelector('.vertical-tab-rail'),summary=group.querySelector('.workspace-tab-group-status'),bar=document.querySelector('.workspace-tabbar'),title=group.firstElementChild;
        const parts=[...group.querySelectorAll('.workspace-tab-group-status-count,.workspace-tab-group-toggle')].filter(element=>element.getBoundingClientRect().width>0);
        const bounds=box(group),center=document.elementFromPoint((bounds.left+bounds.right)/2,(bounds.top+bounds.bottom)/2);
        const other=document.querySelector('[data-workspace-tab=outside]');
        return {orientation:strip.getAttribute('aria-orientation'),compact:!!rail?.classList.contains('is-collapsed'),group:bounds,title:box(title),summary:summary?box(summary):undefined,parts:parts.map(box),
          toggle:box(group.querySelector('.workspace-tab-group-toggle')),other:box(other),close:box(other.querySelector('.workspace-tab-close')),trailingPadding:getComputedStyle(group).paddingRight,
          views:box(document.querySelector('.workspace-views')),bar:bar?box(bar):undefined,rail:rail?box(rail):undefined,hit:center?.closest('[data-workspace-group]')===group,scroll:document.documentElement.scrollWidth,width:innerWidth};
      };
      window.teardown=()=>{badges.disable();flushSync(()=>root.unmount());rail.disable();groups.disable();material.disable();appearance.disable();controls.disable();return statusListeners.size};
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all([
    'src/client/styles.css', 'program/plugins/ui/default.css', 'program/plugins/theme.css', 'program/plugins/thread-status.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((request, response) => {
    if (request.url.startsWith('/fonts/')) {
      void fs.readFile(path.join('public', decodeURIComponent(request.url))).then(bytes => response.end(bytes)).catch(() => response.end())
      return
    }
    response.end('<!doctype html><style>' + css + '\n#root{height:100vh}#workspace-mount{display:flex;min-width:0;min-height:0;flex:1 1 0}.test-pane{padding:24px;width:100%}.test-pane textarea{width:100%;min-height:100px}</style><div id="root"><div class="shell-kernel"><div data-shell-node="workspace" class="shell-box shell-direction-row shell-grow shell-surface-canvas"><main data-shell-node="workspace-layout-main" class="shell-box shell-direction-column shell-grow shell-surface-canvas"><div id="workspace-mount"></div></main></div></div></div>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const window = new BrowserWindow({ show: false, width: 1200, height: 760, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  window.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message) })
  const run = code => window.webContents.executeJavaScript(code)
  const settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const finishMotion = async () => {
    await run("document.querySelectorAll('.vertical-tab-rail,.workspace-tabs').forEach(element=>element.getAnimations({subtree:true}).forEach(animation=>{if(Number.isFinite(animation.effect.getComputedTiming().endTime))animation.finish();else{animation.pause();animation.currentTime=0}}))")
    await settle()
  }
  const mixed = () => run("setStatus(['working','outside'],['unread-a','unread-b','working','outside','not-open'])")
  const capture = async name => {
    if (!process.env.ALTO_TAB_GROUP_STATUS_ARTIFACT_DIR) return
    await fs.mkdir(process.env.ALTO_TAB_GROUP_STATUS_ARTIFACT_DIR, { recursive: true })
    await fs.writeFile(path.join(process.env.ALTO_TAB_GROUP_STATUS_ARTIFACT_DIR,name+'.png'),(await window.webContents.capturePage()).toPNG())
  }
  const assertChevronColumn = (fallback, current, label) => {
    if (current.compact) return
    const inset = current.group.right - current.toggle.right
    assert.equal(inset, fallback.group.right - fallback.toggle.right, label + ': status does not move the group chevron inward ' + JSON.stringify({ fallback, current }))
    assert.equal(inset, current.other.right - current.close.right, label + ': group chevron and regular-tab close share their trailing column ' + JSON.stringify(current))
  }
  const assertMixed = async label => {
    const result = await run('inspect()')
    assert.deepEqual(result.statuses.sort(), ['finished', 'running'], label + ': both kinds of hidden activity are visible')
    assert.deepEqual(result.counts.sort(), ['1', '2'], label + ': duplicate panes and unrelated chats do not inflate counts')
    for (const text of ['1 working chat', '2 unread chats']) {
      assert.ok(result.labels.includes(text), label + ': accessible ' + text)
      assert.ok(result.titles.includes(text), label + ': tooltip ' + text)
    }
    assert.equal(result.fallbackVisible, false, label + ': activity replaces the total-tab fallback')
    assert.equal(result.draft, true, label + ': original draft node and value survive')
    assert.equal(result.mounts, 6, label + ': all original panes stay mounted')
  }
  try {
    await window.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    await settle()
    await mixed()
    await assertMixed('Collapsed group')
    window.webContents.debugger.attach('1.3')
    const { root: documentNode } = await window.webContents.debugger.sendCommand('DOM.getDocument')
    const { nodeId: groupNodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '[data-workspace-group=release]' })
    const { nodes: accessibleNodes } = await window.webContents.debugger.sendCommand('Accessibility.getPartialAXTree', { nodeId: groupNodeId, fetchRelatives: false })
    const groupNode = accessibleNodes.find(node => node.role?.value === 'button')
    assert.equal(groupNode?.description?.value?.replace(/\s+/g, ' ').trim(), '1 working chat 2 unread chats', 'The group exposes meaningful status descriptions to assistive technology')
    window.webContents.debugger.detach()
    const originalLayout = (await run('inspect()')).saved
    await run('toggleGroup()')
    await finishMotion()
    let result = await run('inspect()')
    assert.equal(result.expanded, 'true')
    assert.deepEqual(result.statuses, [], 'Expanded groups leave indicators on their member chats')
    assert.equal(result.tabStatuses.filter(status => status === 'finished').length, 2)
    assert.equal(result.tabStatuses.filter(status => status === 'running').length, 2)
    await run('toggleGroup()')
    await finishMotion()
    await assertMixed('Collapsed again')

    await run("setStatus(['outside'],['unread-a','unread-b','working','outside'])")
    result = await run('inspect()')
    assert.deepEqual(result.statuses, ['finished'])
    assert.deepEqual(result.counts, ['3'], 'Finishing the hidden working chat updates its group without reopening it')
    await run("setStatus(['outside'],['unread-b','working','outside'])")
    assert.deepEqual((await run('inspect()')).counts, ['2'], 'Acknowledging a hidden chat updates its unread count')
    await run("setStatus(['outside'],['outside','not-open'])")
    result = await run('inspect()')
    assert.deepEqual(result.statuses, [])
    assert.equal(result.fallback, '3')
    assert.equal(result.fallbackVisible, true, 'The total-tab count returns when the group has no pending status')

    await mixed()
    await run('disableStatus()')
    result = await run('inspect()')
    assert.deepEqual(result.statuses, [])
    assert.deepEqual(result.tabStatuses, [])
    assert.equal(result.listeners, 0, 'Unloading the addon releases every status subscription')
    assert.equal(result.fallbackVisible, true)
    await run('enableStatus()')
    await assertMixed('Reloaded status addon')
    assert.deepEqual((await run('inspect()')).saved, originalLayout, 'Status updates do not modify layout, active tab, or group state')

    await run("renameGroup('Buzz');setStatus(['outside'],['outside'])")
    await finishMotion()
    const fallbackChevron = await run('geometry()')
    await run("setStatus(['outside'],['unread-a','outside'])")
    await finishMotion()
    const unreadChevron = await run('geometry()')
    await capture('buzz-single-unread-arrow')
    assertChevronColumn(fallbackChevron, unreadChevron, 'Buzz with one unread chat')
    await run("renameGroup('Release work awaiting review')")
    await mixed()

    for (const theme of ['light', 'dark']) for (const orientation of ['horizontal', 'vertical']) for (const width of [1200, 900, 600]) {
      window.setContentSize(width, 760)
      await run(`document.documentElement.dataset.altoTheme='${theme}';document.documentElement.dataset.desktopPlatform='darwin';orient('${orientation}',${width === 1200 ? 232 : 168})`)
      await finishMotion()
      for (const name of ['Buzz', 'Release work awaiting review']) {
        const nameKey = name === 'Buzz' ? 'buzz' : 'long-name'
        await run(`renameGroup(${JSON.stringify(name)});setStatus(['outside'],['outside'])`)
        await finishMotion()
        const fallback = await run('geometry()')
        assertChevronColumn(fallback, fallback, theme + ' ' + orientation + ' ' + width + 'px ' + name + ' without status')
        for (const status of ['single-unread', 'mixed']) {
          if (status === 'mixed') await mixed()
          else await run("setStatus(['outside'],['unread-a','outside'])")
          await finishMotion()
          const label = theme + ' ' + orientation + ' ' + width + 'px ' + name + ' ' + status
          if (status === 'mixed') await assertMixed(label)
          else {
            const result = await run('inspect()')
            assert.deepEqual(result.statuses, ['finished'], label + ': only the unread icon appears')
            assert.deepEqual(result.counts, ['1'], label + ': the count is one unread chat')
            assert.ok(result.labels.includes('1 unread chat'), label + ': the singular unread label is accessible')
          }
          const geometry = await run('geometry()')
          assertChevronColumn(fallback, geometry, label)
          assert.equal(geometry.orientation, orientation)
          assert.ok(geometry.scroll <= geometry.width, label + ': no page overflow ' + JSON.stringify(geometry))
          assert.ok(geometry.group.left >= 0 && geometry.group.right <= width, label + ': group stays on screen ' + JSON.stringify(geometry))
          assert.equal(geometry.hit, true, label + ': the group remains clickable')
          for (const part of geometry.parts) assert.ok(part.left >= geometry.group.left && part.right <= geometry.group.right, label + ': status and toggle stay within the group ' + JSON.stringify(geometry))
          if (orientation === 'horizontal') {
            assert.equal(geometry.bar.height, 52, label + ': header height stays fixed')
            assert.ok(geometry.group.bottom <= geometry.views.top, label + ': group does not cover the conversation')
          } else {
            assert.ok(geometry.group.right <= geometry.views.left, label + ': rail does not cover the conversation')
          }
          assert.equal((await run('inspect()')).summaryVisible, true, label + ': status summary is visible')
          if (!geometry.compact) assert.ok(geometry.title.right <= geometry.summary.left, label + ': group name clears the status summary ' + JSON.stringify(geometry))
          await capture(`${theme}-${orientation}-${width}-${nameKey}-${status}`)
        }
      }
    }
    assert.equal((await run('inspect()')).focused, true, 'Presentation and status changes preserve the focused draft')
    assert.equal(await run('teardown()'), 0)
    console.log('Workspace tab group status browser checks passed')
  } finally {
    window.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
