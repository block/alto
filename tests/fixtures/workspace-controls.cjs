const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'workspace-controls-check.tsx', loader: 'tsx', contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {MoreHorizontal,Pin,Settings,Trash2} from 'lucide-react';
      import {clientStyles} from './src/client/plugin-api';
      import appearancePlugin from './program/plugins/interface-appearance.client';
      import {Composer} from './program/plugins/ui/composer';
      import {SettingsRow,SettingsSwitch} from './program/plugins/ui/settings';
      let cleanups=[];
      const owner={effect:fn=>{const cleanup=fn();if(cleanup)cleanups.push(cleanup)}};
      window.installAppearance=()=>appearancePlugin({...owner,clientUi:{registerStyle:(owner,id,css)=>owner.effect(()=>{
        const style=document.createElement('style');style.dataset.pluginStyle=id;style.textContent=css;document.head.append(style);return()=>style.remove();
      })}});
      function Preview(){
        const [pinned,pin]=useState(false),[open,expand]=useState(false),[motion,setMotion]=useState(false),[draft,setDraft]=useState('Keep this draft while the controls change.');
        return <main className="workspace-layout-root"><div className="workspace-body"><section className="workspace-chat-pane is-focused">
          <header className={clientStyles.paneHeader+' '+clientStyles.paneToolbar} style={{'--alto-pane-toolbar-end-padding':'var(--space-3)'}}>
            <div className={clientStyles.toolbarTitle}><span>Workspace controls</span></div>
            <div className={clientStyles.toolbarActions}>
              <button id="pin" className={clientStyles.iconButton} aria-label="Pin" aria-pressed={pinned} onClick={()=>pin(!pinned)}><Pin size={16}/></button>
              <button id="menu" className={clientStyles.iconButton} aria-label="More" aria-haspopup="menu" aria-expanded={open} onClick={()=>expand(!open)}><MoreHorizontal size={16}/></button>
              <button id="legacy" className="icon-button" aria-label="Settings"><Settings size={16}/></button>
              <button id="icon-disabled" className={clientStyles.iconButton} aria-label="Unavailable settings" disabled><Settings size={16}/></button>
            </div>
          </header>
          <div className="fixture-content">
            <h2>Actions</h2><p>Shared controls keep their labels, states, and keyboard focus readable.</p>
            <div className="fixture-actions">
              <button id="primary" className={clientStyles.button+' primary'}>Continue</button>
              <button id="legacy-primary" className="button primary">Approve</button>
              <button id="secondary" className={clientStyles.button}>Secondary</button>
              <button id="ghost" className={clientStyles.button+' ghost'}>Cancel</button>
              <button id="danger" className={clientStyles.button+' ghost danger'}><Trash2 size={14}/>Remove</button>
              <button id="disabled" className={clientStyles.button+' primary'} disabled>Unavailable</button>
            </div>
            <div className={clientStyles.toolbar+' fixture-modes'}><div className={clientStyles.toolbarModes}><button id="mode-selected" className="is-active">Source</button><button>Preview</button></div></div>
            <section className="project-settings"><form className="project-settings-form" onSubmit={event=>event.preventDefault()}><h3>Project settings</h3><footer>
              <button id="remove" type="button" className={clientStyles.button+' ghost danger project-settings-remove'}>Remove project</button>
              <button id="save" className={clientStyles.button+' primary project-settings-save'}>Save</button>
              <button id="save-disabled" className={clientStyles.button+' primary project-settings-save'} disabled>Saved</button>
            </footer></form></section>
            <form className="workspace-creator-form" onSubmit={event=>event.preventDefault()}><h3>New workspace</h3><footer><button id="creator-cancel" className={clientStyles.button+' ghost'} type="button">Cancel</button><button id="creator-primary" className={clientStyles.button+' primary'}>Create workspace</button></footer></form>
            <SettingsRow label="Reduce motion" description="Use fewer visual effects." role="switch" checked={motion} onClick={()=>setMotion(!motion)}>
              <SettingsSwitch on={motion}/>
            </SettingsRow>
          </div>
          <div className="workspace-pane-composer"><Composer value={draft} onChange={setDraft} images={[]} attachments={[]} skills={[]} models={[]}
            permissionMode="full" workspaceLabel="/repo" workspaceOptions={[]} capabilities={[]} placeholder="Let's build" focusHeight={156} maxHeight={180} autoFocus={false}
            disabled={false} readOnly={false} sending={false} activeTurn={false}
            onImagesChange={()=>{}} onAttachmentsChange={()=>{}} onAttachFile={async()=>{}}
            onModelChange={()=>{}} onEffortChange={()=>{}} onPermissionModeChange={()=>{}}
            onWorkspaceChange={()=>{}} onSubmit={()=>{}} onInterrupt={()=>{}}/></div>
        </section></div></main>;
      }
      const root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<Preview/>));
      window.click=selector=>flushSync(()=>document.querySelector(selector).click());
      window.teardown=()=>{flushSync(()=>root.unmount());for(const cleanup of cleanups.reverse())cleanup()};
      const box=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
      window.composerMetrics=()=>{
        const composer=document.querySelector('.composer'),editor=document.querySelector('[data-cordis-composer-editor]'),cs=getComputedStyle(composer),es=getComputedStyle(editor);
        return {box:box(composer),radius:cs.borderRadius,padding:cs.padding,editor:{box:box(editor),font:es.fontFamily,size:es.fontSize,weight:es.fontWeight,line:es.lineHeight,tracking:es.letterSpacing,text:editor.textContent},
          controls:[...composer.querySelectorAll('button')].map(el=>({class:el.className,box:box(el)}))};
      };
      window.layout=()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,composer:box(document.querySelector('.composer')),
        controls:[...document.querySelectorAll('.fixture-actions button,.alto-toolbar-actions button,.alto-toolbar-modes button,.project-settings-form button,.workspace-creator-form button,.settings-row')].map(el=>({id:el.id||el.className,...box(el)})),
        composerControls:[...document.querySelectorAll('.composer button')].map(box),context:box(document.querySelector('.composer-context-controls')),model:box(document.querySelector('.composer-model-control')),send:box(document.querySelector('.send-button')),
        row:{radius:getComputedStyle(document.querySelector('.settings-row')).borderRadius,display:getComputedStyle(document.querySelector('.settings-row')).display}});
      window.samples=selectors=>{
        const context=document.createElement('canvas').getContext('2d');
        const rgba=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);const c=[...context.getImageData(0,0,1,1).data];c[3]/=255;return c};
        const over=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3])).concat(1);
        const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
        const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
        return Object.fromEntries(selectors.map(selector=>{
          const element=document.querySelector(selector),style=getComputedStyle(element),chain=[];
          for(let node=element;node;node=node.parentElement)chain.unshift(getComputedStyle(node));
          const background=chain.reduce((bg,s)=>over(rgba(s.backgroundColor),bg),[255,255,255,1]),foreground=rgba(style.color);
          const outlineBackground=(parseFloat(style.outlineOffset)>=0?chain.slice(0,-1):chain).reduce((bg,s)=>over(rgba(s.backgroundColor),bg),[255,255,255,1]);
          foreground[3]*=chain.reduce((alpha,s)=>alpha*Number(s.opacity),1);
          return [selector,{contrast:contrast(over(foreground,background),background),background,color:style.color,fill:style.backgroundColor,border:style.borderColor,
            outline:style.outlineStyle,outlineWidth:parseFloat(style.outlineWidth),outlineContrast:contrast(over(rgba(style.outlineColor),outlineBackground),outlineBackground),
            focused:element.matches(':focus-visible'),hovered:element.matches(':hover'),active:element.matches(':active'),opacity:style.opacity,transform:style.transform,filter:style.filter,box:box(element)}];
        }));
      };
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all(['src/client/styles.css', 'src/client/pane-toolbar.css', 'program/plugins/ui/default.css', 'program/plugins/theme.css', 'program/plugins/workspace-layout.css'].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((_request, response) => response.end('<!doctype html><html data-alto-theme="light" data-alto-theme-plugin="active" data-alto-chrome-theme="alto"><style>' + css + '\n#root{height:100vh}.fixture-content{flex:1;min-height:0;overflow:auto;padding:24px}.fixture-actions{display:flex;flex-wrap:wrap;gap:8px}.fixture-content h2{margin:0 0 8px}.fixture-content p{margin:0 0 24px}.fixture-modes{margin-block:12px}.project-settings-form{margin-block:12px}.fixture-content h3{margin:0 0 12px}.project-settings-form footer,.workspace-creator-form footer{flex-wrap:wrap}</style><div id="root" class="shell-kernel"></div></html>'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const win = new BrowserWindow({ show: false, width: 900, height: 800, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = code => win.webContents.executeJavaScript(code)
  const settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const sample = selectors => run(`samples(${JSON.stringify(selectors)})`)
  // Rebinding the document between force/clear can leave stale CDP states.
  let documentNode
  const nodes = new Map()
  const force = async (selector, states) => {
    if (!documentNode) documentNode = (await win.webContents.debugger.sendCommand('DOM.getDocument')).root.nodeId
    let nodeId = nodes.get(selector)
    if (!nodeId) {
      nodeId = (await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: documentNode, selector })).nodeId
      nodes.set(selector, nodeId)
    }
    assert.ok(nodeId, 'Missing control: ' + selector)
    await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states })
  }
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    await settle()
    const original = await run('composerMetrics()'), originalRow = (await run('layout()')).row
    await run("window.originalEditor=document.querySelector('[data-cordis-composer-editor]');installAppearance()")
    await settle()
    // The typography pass intentionally changes action-label widths, while the
    // editor, outer surface, Send target, and other target heights stay stable.
    const stableComposer = metrics => ({ ...metrics, controls: metrics.controls.map(control => ({ class: control.class, height: control.box.height, send: control.class.includes('send-button') ? control.box : undefined })) })
    assert.deepEqual(stableComposer(await run('composerMetrics()')), stableComposer(original), 'Appearance preserves Composer/editor geometry, typography, Send bounds, and control heights')
    assert.equal(await run("originalEditor===document.querySelector('[data-cordis-composer-editor]')"), true, 'Style installation preserves the draft editor')
    assert.deepEqual((await run('layout()')).row, originalRow, 'Structured SettingsRow retains its own shape')
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('DOM.enable')
    await win.webContents.debugger.sendCommand('CSS.enable')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
    const primary = ['#primary', '#legacy-primary', '#save', '#creator-primary', '.send-button']
    for (const theme of ['light', 'dark']) {
      await run(`document.documentElement.dataset.altoTheme=${JSON.stringify(theme)}`)
      for (const accent of ['#7c3aed', '#16a34a', '#ea580c', '#fff8d6', '#ffffff', '#000000']) {
        await run(`document.documentElement.style.setProperty('--alto-theme-accent',${JSON.stringify(accent)})`)
        for (const state of [[], ['hover'], ['hover', 'active']]) {
          for (const selector of primary) await force(selector, state)
          const measured = await sample([...primary, '.send-button svg', '#secondary', '#danger', '#remove', '#creator-cancel'])
          for (const [selector, control] of Object.entries(measured)) {
            const minimum = selector.includes('send-button') ? 3 : 4.5
            assert.ok(control.contrast >= minimum, JSON.stringify({ theme, accent, state, selector, ...control }))
          }
        }
        for (const selector of primary) await force(selector, [])
      }
      await run("document.documentElement.style.setProperty('--alto-theme-accent','#7c3aed')")
      for (const selector of ['#disabled', '#icon-disabled', '#save-disabled']) {
        const before = (await sample([selector]))[selector]
        await force(selector, ['hover', 'active'])
        const after = (await sample([selector]))[selector]
        for (const property of ['color', 'fill', 'border', 'transform', 'filter']) assert.equal(after[property], before[property], theme + ': disabled hover preserves ' + selector + ' ' + property)
        assert.ok(Number(after.opacity) < 1, theme + ': disabled control stays dim')
        await force(selector, [])
      }
      for (const selector of ['#pin', '#menu']) {
        const rest = (await sample([selector]))[selector]
        await run(`click(${JSON.stringify(selector)})`)
        const selected = (await sample([selector]))[selector]
        assert.notEqual(selected.fill, rest.fill, theme + ': persistent icon state is visible without hover')
        await force(selector, ['hover', 'active'])
        assert.notEqual((await sample([selector]))[selector].fill, selected.fill, theme + ': selected/open icon still gives pressed feedback')
        await force(selector, [])
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, x: 1, y: 400 })
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 400 })
        await settle()
        const released = (await sample([selector]))[selector]
        assert.equal(released.fill, selected.fill, theme + ': persistent icon state stays visible ' + JSON.stringify({ selector, released }))
        await run(`click(${JSON.stringify(selector)})`)
      }
      const selectedMode = (await sample(['#mode-selected']))['#mode-selected']
      await force('#mode-selected', ['hover'])
      assert.equal((await sample(['#mode-selected']))['#mode-selected'].fill, selectedMode.fill, theme + ': selected mode retains its fill on hover')
      await force('#mode-selected', ['hover', 'active'])
      assert.notEqual((await sample(['#mode-selected']))['#mode-selected'].fill, selectedMode.fill, theme + ': selected mode still gives pressed feedback')
      await force('#mode-selected', [])
      for (const selector of ['#primary', '#secondary', '#danger', '#save', '#creator-primary', '#creator-cancel', '#pin', '#legacy', '.send-button']) {
        await force(selector, ['focus', 'focus-visible'])
        await run(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`)
        const control = (await sample([selector]))[selector]
        assert.ok(control.focused && control.outline !== 'none' && control.outlineWidth >= 2 && control.outlineContrast >= 3, theme + ': visible keyboard focus ' + JSON.stringify({ selector, ...control }))
        await run('document.activeElement.blur()')
        await force(selector, [])
      }
      for (const width of [900, 360]) {
        win.setContentSize(width, 800)
        await settle()
        const layout = await run('layout()')
        assert.ok(layout.scroll <= width, JSON.stringify({ theme, width, layout }))
        for (const control of [...layout.controls, layout.composer]) assert.ok(control.x >= 0 && control.right <= width, JSON.stringify({ theme, width, control }))
        for (const control of layout.composerControls) assert.ok(control.x >= layout.composer.x && control.right <= layout.composer.right && control.y >= layout.composer.y && control.bottom <= layout.composer.bottom, JSON.stringify({ theme, width, control, composer: layout.composer }))
        assert.ok(layout.model.right <= layout.send.x, theme + ': model control stays clear of Send')
        if (layout.context.y < layout.model.bottom && layout.model.y < layout.context.bottom) assert.ok(layout.context.right <= layout.model.x, theme + ': context and model controls stay separate')
        await force('#primary', ['hover', 'active'])
        const pressed = await run('layout()')
        assert.deepEqual(pressed.controls.filter(control => control.id !== 'primary'), layout.controls.filter(control => control.id !== 'primary'), theme + ': pressing a control does not move its neighbors')
        await force('#primary', [])
        if (process.env.ALTO_WORKSPACE_CONTROLS_ARTIFACT_DIR) {
          await fs.mkdir(process.env.ALTO_WORKSPACE_CONTROLS_ARTIFACT_DIR, { recursive: true })
          await fs.writeFile(path.join(process.env.ALTO_WORKSPACE_CONTROLS_ARTIFACT_DIR, `controls-${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG())
        }
      }
    }
    await run('teardown()')
    console.log('Workspace controls browser checks passed')
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach()
    win.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
