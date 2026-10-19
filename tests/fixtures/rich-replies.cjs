const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')
const Module = require('node:module')
const { randomUUID } = require('node:crypto')

async function check() {
  await app.whenReady()
  const documentBundle = await build({
    entryPoints: ['program/plugins/rich-replies-document.ts'], bundle: true, write: false,
    platform: 'node', format: 'cjs',
  })
  const documentModule = new Module(path.resolve('tests/fixtures/rich-replies-document.cjs'))
  documentModule._compile(documentBundle.outputFiles[0].text, path.resolve('tests/fixtures/rich-replies-document.cjs'))
  const { buildRichReplyDocument, RICH_REPLY_CONTENT_SECURITY_POLICY } = documentModule.exports
  assert.equal(typeof buildRichReplyDocument, 'function')
  assert.equal(typeof RICH_REPLY_CONTENT_SECURITY_POLICY, 'string', 'Use the production reply document CSP')
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'rich-replies-fixture.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {Context} from 'cordis';
      import {MarkdownRendererRegistry} from './program/plugins/markdown.client';
      import {createMarkdownContentRenderer} from './program/plugins/markdown-content';
      import richReplies from './program/plugins/rich-replies.client';
      const ctx=new Context(),markdown=new MarkdownRendererRegistry();
      ctx.provide('clientMarkdown',markdown);
      ctx.provide('clientUi',{registerStyle:(owner,id,css)=>owner.effect(()=>{
        const style=document.createElement('style');style.dataset.fixturePluginStyle=id;
        style.textContent=css;document.head.append(style);return()=>style.remove();
      })});
      window.hostCalls=[];
      ctx.provide('clientHost',{call:async(name,payload)=>{
        window.hostCalls.push({name,payload});
        if(name!=='rich-replies.render')throw Error('Unknown host method '+name);
        if(window.rejectRender)throw Error('The rich reply server is unavailable.');
        const result=await fetch('/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        if(!result.ok)throw Error('Could not prepare rich reply');return result.json();
      }});
      const Content=createMarkdownContentRenderer(markdown),root=createRoot(document.getElementById('message'));
      let fiber,source='';
      const render=()=>flushSync(()=>root.render(<Content source={source} className="activity-content activity-markdown" label="Agent reply"/>));
      window.renderMarkdown=value=>{source=value;render()};
      window.renderRich=value=>{const fence=String.fromCharCode(96).repeat(4);window.renderMarkdown(fence+'alto-html\\n'+value+'\\n'+fence)};
      window.registered=()=>markdown.snapshot().codeBlocks.map(({id,languages})=>({id,languages}));
      window.unload=async()=>{await fiber.dispose()};
      window.reload=async()=>{fiber=await ctx.plugin(richReplies,{})};
      window.click=label=>flushSync(()=>{
        const button=document.querySelector('button[aria-label="'+label+'"]');
        if(!button)throw Error('Missing button '+label);button.click();
      });
      window.hostMarker='untouched';window.hostTool=()=>{window.hostMarker='host tool called'};
      window.reload().then(()=>{window.ready=true});
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all([
    'src/client/styles.css', 'src/client/pane-toolbar.css', 'program/plugins/ui/default.css',
    'program/plugins/theme.css', 'program/plugins/markdown.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const headers = JSON.parse(process.env.ALTO_TEST_WEB_SECURITY_HEADERS || 'null')
  assert.ok(headers?.['Content-Security-Policy'], 'The parent must use the real application security headers')
  const received = [], documents = new Map()
  const replyServer = http.createServer((request, response) => {
    if (request.url.startsWith('/probe')) {
      received.push(request.url);response.end('Unexpected rich-reply network request');return
    }
    const document = documents.get(request.url)
    response.setHeader('Content-Security-Policy', RICH_REPLY_CONTENT_SECURITY_POLICY + '; sandbox allow-scripts')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.statusCode = document ? 200 : 404
    response.end(document || 'Unknown reply')
  })
  await new Promise(resolve => replyServer.listen(0, '127.0.0.1', resolve))
  const replyOrigin = `http://127.0.0.1:${replyServer.address().port}`
  const server = http.createServer(async (request, response) => {
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value)
    if (request.url === '/fixture.js') {
      response.setHeader('Content-Type', 'text/javascript');response.end(bundle.outputFiles[0].text);return
    }
    if (request.url === '/render') {
      let body = '';for await (const chunk of request) body += chunk
      const { html } = JSON.parse(body), token = randomUUID()
      const prepared = buildRichReplyDocument(html, token), route = '/reply/' + token
      documents.set(route, prepared.document)
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ url: replyOrigin + route, token, title: prepared.title }))
      return
    }
    if (request.url.startsWith('/probe')) {
      received.push(request.url);response.end('Unexpected rich-reply network request');return
    }
    if (request.url.startsWith('/fonts/')) {
      try { response.end(await fs.readFile(path.join('public/fonts', path.basename(decodeURIComponent(request.url))))) }
      catch { response.statusCode = 404; response.end() }
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><html data-alto-theme="light"><meta charset="utf-8"><style>' + css + `
      html,body{margin:0;height:100%;overflow:hidden}
      body{display:flex;flex-direction:column;padding:16px;background:var(--canvas);color:var(--text)}
      body>header{height:40px;flex:none;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)}
      main{flex:1;min-height:0;min-width:0;overflow:auto}
      #message{max-width:720px;min-width:0;margin:0 auto;padding:16px 0}
      footer{flex:none;padding-top:12px}textarea{display:block;height:76px;width:100%;resize:none;padding:12px;border:1px solid var(--border);border-radius:10px;background:var(--panel);color:inherit}
    </style><body><header><strong>Alto</strong><button>Chat controls</button></header><main><article id="message"></article></main><footer><textarea aria-label="Follow up">A draft stays below the reply</textarea></footer><script src="/fixture.js" defer></script></body></html>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  const win = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: {
    offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false,
  } })
  const attempted = []
  // Cancel unexpected probes as well as recording them, so regressions cannot leak data.
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.includes('/probe')) { attempted.push(details.url);callback({ cancel: true }) }
    else callback({})
  })
  const run = code => win.webContents.executeJavaScript(code).catch(error=>{console.error('Parent script failed:',code);throw error})
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const until = async expression => {
    for (let i = 0; i < 150; i++) {
      if (await run(expression)) return
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw Error('Timed out: ' + expression)
  }
  const frame = 'document.querySelector(".rich-reply-frame")'
  const child = async () => {
    const url = await run(`${frame}?.src`)
    return win.webContents.mainFrame.frames.find(candidate => candidate.url === url)
  }
  const inReply = async code => {
    const target = await child();assert.ok(target, 'The rich reply has a separate browser frame')
    return target.executeJavaScript(code).catch(error=>{console.error('Reply script failed:',code);throw error})
  }
  const show = async html => {
    const previous = await run(`${frame}?.src`)
    await run(`renderRich(${JSON.stringify(html)})`)
    await until(`!!${frame}?.src && ${frame}.src!==${JSON.stringify(previous || '')}`)
    for (let i = 0; i < 150; i++) {
      const target = await child()
      if (target && await target.executeJavaScript('document.readyState==="complete"')) { await frames();return }
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw Error('Timed out waiting for the reply document')
  }
  const replyLayout = () => inReply(`(()=>{
    const root=document.scrollingElement;
    const scrollers=[...document.querySelectorAll('body *')].filter(element=>{
      const style=getComputedStyle(element);
      return ['auto','scroll'].includes(style.overflowY)&&element.scrollHeight>element.clientHeight+1;
    }).map(element=>element.id||element.tagName);
    return {height:innerHeight,documentHeight:root.scrollHeight,bodyHeight:document.body.scrollHeight,
      lastBottom:document.querySelector('#last-marker')?.getBoundingClientRect().bottom,scrollers};
  })()`)
  const fullyExpanded = async () => {
    let layout
    for (let i=0;i<150;i++) {
      layout=await replyLayout()
      if (layout.documentHeight<=layout.height+1&&Math.abs(layout.height-Math.max(80,layout.bodyHeight))<=1&&layout.lastBottom<=layout.height+1&&!layout.scrollers.length) break
      await frames()
    }
    assert.ok(layout.documentHeight<=layout.height+1, 'The reply document has no vertical scroll range: '+JSON.stringify(layout))
    assert.ok(layout.bodyHeight<=layout.height+1, 'The full body fits in its iframe: '+JSON.stringify(layout))
    assert.ok(Math.abs(layout.height-Math.max(80,layout.bodyHeight))<=1, 'The iframe follows the natural content height: '+JSON.stringify(layout))
    assert.ok(layout.lastBottom<=layout.height+1, 'The final paragraph is inside the full-height iframe: '+JSON.stringify(layout))
    assert.deepEqual(layout.scrollers, [], 'Answer content has no nested vertical scrollers')
    assert.equal(await inReply('document.scrollingElement.scrollTop=100;document.scrollingElement.scrollTop'), 0, 'The document cannot scroll separately from the conversation')
    return layout.height
  }
  const screenshot = async name => {
    if (!process.env.ALTO_RICH_REPLY_ARTIFACT_DIR) return
    // Offscreen child-frame painting follows layout asynchronously.
    await new Promise(resolve => setTimeout(resolve, 100))
    await fs.mkdir(process.env.ALTO_RICH_REPLY_ARTIFACT_DIR, { recursive: true })
    await fs.writeFile(path.join(process.env.ALTO_RICH_REPLY_ARTIFACT_DIR, name + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  const sample = `<title>Release choices</title>
    <style>
      h2{font-size:25px;line-height:1.2;letter-spacing:-.025em;margin:0 0 12px}
      p{margin:8px 0;max-width:62ch}.intro{font-size:16px;line-height:1.5}
      .choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:12px 28px;margin:20px 0 12px}
      .choice h3{font-size:14px;margin:0 0 6px}.choice p{color:var(--alto-muted);margin:0}
      #local-action{padding:0;border:0;background:none;color:var(--alto-accent);text-decoration:underline;text-underline-offset:3px}
      #step-explanation{min-height:2em}summary{cursor:pointer;color:var(--alto-muted)}
      svg{display:block;width:100%;max-width:360px;height:32px;margin:12px 0}text{fill:var(--alto-muted);font-size:11px}
    </style>
    <section aria-label="Release comparison"><h2>Stage the release, then expand</h2><p class="intro">Start with a small group so measured behavior can guide the next step. Both approaches preserve the existing records.</p>
      <div class="choices"><div class="choice"><h3>Staged</h3><p>Observe a small group first. Expand after the checks pass.</p></div><div class="choice"><h3>Immediate</h3><p>Enable the change for everyone when a gradual release adds little information.</p></div></div>
      <svg role="img" aria-label="Staged rollout" viewBox="0 0 360 32"><path d="M5 8H355" stroke="var(--alto-border)"/><circle cx="5" cy="8" r="3" fill="var(--alto-accent)"/><circle cx="180" cy="8" r="3" fill="var(--alto-muted)"/><circle cx="355" cy="8" r="3" fill="var(--alto-muted)"/><text x="0" y="29">Observe</text><text x="160" y="29">Review</text><text x="318" y="29">Expand</text></svg>
      <button id="local-action">Review the next step (<output>0</output>/3)</button><p id="step-explanation" aria-live="polite">Choose the control to walk through the rollout.</p>
      <details><summary>What should the checks cover?</summary>${Array.from({ length: 8 }, (_, i) => `<p>Check ${i + 1}: review the measured behavior before expanding.</p>`).join('')}</details>
    </section>
    <script>document.querySelector('#local-action').addEventListener('click',()=>{const output=document.querySelector('output');output.value=Number(output.value)%3+1;document.querySelector('#step-explanation').textContent=['Observe errors and latency in the small group.','Review the measurements against the existing behavior.','Expand the release when the checks pass.'][Number(output.value)-1]})</script>`
  try {
    await win.loadURL(origin)
    await until('window.ready===true')
    assert.deepEqual(await run('registered()'), [{ id: 'rich-replies.html', languages: ['alto-html'] }])
    assert.ok(await run('document.querySelectorAll("style[data-fixture-plugin-style]").length > 0'))

    await run("window.resizeOrigins=[];addEventListener('message',event=>{if(event.data?.type==='alto.rich-reply.resize')resizeOrigins.push({origin:event.origin,sameSource:event.source===document.querySelector('.rich-reply-frame')?.contentWindow})})")
    await show(sample)
    assert.ok(await run("resizeOrigins.length>0&&resizeOrigins.every(event=>event.origin==='null'&&event.sameSource)"), 'Resize reports come from the isolated iframe with an opaque origin')
    assert.equal(await run(`${frame}.title`), 'Release choices')
    assert.equal(await run(`${frame}.getAttribute('sandbox')`), 'allow-scripts', 'The iframe grants scripts without same-origin, form, popup, or navigation capabilities')
    assert.equal(await run(`${frame}.contentDocument`), null, 'The application cannot read the isolated document')
    assert.equal(await inReply('document.querySelector("h2").textContent'), 'Stage the release, then expand')
    assert.equal(await inReply('document.querySelector("section").getAttribute("aria-label")'), 'Release comparison')
    assert.equal(await inReply('document.querySelectorAll(".choice").length'), 2)
    assert.equal(await inReply('document.querySelector("svg").getAttribute("aria-label")'), 'Staged rollout')
    await inReply('document.querySelector("#local-action").click()')
    assert.equal(await inReply('document.querySelector("output").value'), '1', 'Inline JavaScript supports local reply interactions')
    assert.equal(await inReply('document.querySelector("#step-explanation").textContent'), 'Observe errors and latency in the small group.')
    const closedHeight = await run(`${frame}.getBoundingClientRect().height`)
    await inReply('document.querySelector("summary").click()')
    await until(`${frame}.getBoundingClientRect().height > ${closedHeight + 30}`)
    assert.equal(await inReply('document.querySelector("details").open'), true)
    assert.ok(await inReply('document.documentElement.scrollHeight<=innerHeight+1'), 'Expanded details remain fully visible in the reply')
    await inReply('document.querySelector("summary").click()')
    await until(`${frame}.getBoundingClientRect().height <= ${closedHeight + 2}`)

    const presentation = await run(`(()=>{const root=document.querySelector('.rich-reply'),style=getComputedStyle(root),bounds=root.getBoundingClientRect(),content=${frame}.getBoundingClientRect(),button=root.querySelector('button[aria-label="Show HTML source"]');return{tag:root.tagName,role:root.getAttribute('role'),label:root.getAttribute('aria-label'),border:[style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth],background:style.backgroundColor,padding:[style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft],header:!!root.querySelector(':scope > header,:scope > figcaption'),leftInset:content.left-bounds.left,topInset:content.top-bounds.top,buttonBelow:button.getBoundingClientRect().top>=content.bottom,tabIndex:button.tabIndex,opacity:getComputedStyle(button).opacity}})()`)
    assert.equal(presentation.tag, 'DIV')
    assert.equal(presentation.role, 'group')
    assert.equal(presentation.label, 'Release choices')
    assert.deepEqual(presentation.border, ['0px','0px','0px','0px'])
    assert.equal(presentation.background, 'rgba(0, 0, 0, 0)')
    assert.deepEqual(presentation.padding, ['0px','0px','0px','0px'])
    assert.equal(presentation.header, false, 'Rich replies have no separate header')
    assert.equal(presentation.leftInset, 0)
    assert.equal(presentation.topInset, 0)
    assert.equal(presentation.buttonBelow, true, 'The source control follows the answer and cannot cover it')
    assert.equal(presentation.tabIndex, 0, 'The source control remains in the keyboard focus order')
    if (await run("matchMedia('(hover: hover)').matches")) assert.equal(presentation.opacity, '0', 'Desktop replies hide the source control until interaction')
    const bodyPresentation = await inReply("(()=>{const style=getComputedStyle(document.body);return{background:style.backgroundColor,padding:[style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft]}})()")
    assert.equal(bodyPresentation.background, 'rgba(0, 0, 0, 0)')
    assert.deepEqual(bodyPresentation.padding, ['0px','0px','0px','0px'])
    await run(`document.querySelector('.rich-reply button[aria-label="Show HTML source"]').focus({preventScroll:true})`)
    await until(`getComputedStyle(document.querySelector('.rich-reply button[aria-label="Show HTML source"]')).opacity==="1"`)
    assert.equal(await run('document.activeElement.getAttribute("aria-label")'), 'Show HTML source')
    await run('document.activeElement.blur()')
    await screenshot('normal')
    win.setContentSize(360, 760)
    await until('innerWidth===360');await frames()
    const layout = await run(`(()=>{const rich=document.querySelector('.rich-reply').getBoundingClientRect(),footer=document.querySelector('footer').getBoundingClientRect(),main=document.querySelector('main').getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth,richLeft:rich.left,richRight:rich.right,width:innerWidth,mainBottom:main.bottom,footerTop:footer.top,footerBottom:footer.bottom,headerHeight:document.querySelector('body>header').getBoundingClientRect().height}})()`)
    assert.equal(layout.overflow, false, JSON.stringify(layout))
    assert.equal(await inReply('document.documentElement.scrollWidth>document.documentElement.clientWidth'), false)
    assert.ok(layout.richLeft >= 0 && layout.richRight <= layout.width, JSON.stringify(layout))
    assert.ok(layout.mainBottom <= layout.footerTop && layout.footerBottom <= 760, JSON.stringify(layout))
    assert.equal(layout.headerHeight, 40)
    await screenshot('narrow')
    await run("document.documentElement.dataset.altoTheme='dark'");await frames();await screenshot('dark')
    const vars = await inReply("(()=>{const style=getComputedStyle(document.body);return ['--alto-bg','--alto-fg','--alto-muted','--alto-border','--alto-accent','--alto-font'].map(name=>style.getPropertyValue(name).trim())})()")
    assert.ok(vars.every(Boolean), 'Rich HTML receives the application theme variables')

    const token = await run("document.querySelector('.rich-reply-frame').src.split('/').at(-1)")
    const priorHeight = await run(`${frame}.getBoundingClientRect().height`)
    await inReply("parent.postMessage({type:'alto.rich-reply.resize',token:'incorrect',height:81},'*')")
    await frames()
    assert.equal(await run(`${frame}.getBoundingClientRect().height`), priorHeight, 'A wrong token cannot resize the reply')
    await run(`postMessage({type:'alto.rich-reply.resize',token:${JSON.stringify(token)},height:81},'*')`)
    await frames()
    assert.equal(await run(`${frame}.getBoundingClientRect().height`), priorHeight, 'A different message source cannot resize the reply')
    await inReply(`parent.postMessage({type:'alto.rich-reply.resize',token:${JSON.stringify(token)},height:2400},'*')`)
    await until(`${frame}.getBoundingClientRect().height===2400`)
    await inReply(`parent.postMessage({type:'alto.rich-reply.resize',token:${JSON.stringify(token)},height:1e9},'*')`)
    await until(`${frame}.getBoundingClientRect().height===1000000`)
    await inReply(`parent.postMessage({type:'alto.rich-reply.resize',token:${JSON.stringify(token)},height:1},'*')`)
    await until(`${frame}.getBoundingClientRect().height===80`)

    await run('window.previewFrame=document.querySelector(".rich-reply-frame");click("Show HTML source")')
    await frames()
    assert.equal(await run('document.querySelector(".rich-reply-frame")===window.previewFrame'), true)
    await run('click("Show rich reply")')
    await frames()
    assert.equal(await inReply('document.querySelector("output").value'), '1', 'Source inspection preserves local reply state')

    const longSource = '<p>' + 'A'.repeat(5000) + '</p>'
    await show(longSource);await run('click("Show HTML source")');await frames()
    assert.ok((await run('document.querySelector(".rich-reply pre").textContent')).includes(longSource))
    assert.equal(await run('document.documentElement.scrollWidth>innerWidth'), false)
    assert.ok(await run('document.querySelector("textarea").getBoundingClientRect().bottom<=innerHeight'))
    await run('click("Show rich reply")');await until(`!!${frame}`)

    const longReply = `<title>Full answer</title><h2>A complete explanation</h2>
      <section id="answer-sequence"><table><thead><tr><th scope="col" style="white-space:nowrap">Point</th><th scope="col">Explanation</th></tr></thead><tbody>
        ${Array.from({length:20},(_,i)=>`<tr><th scope="row">${i+1}</th><td>This explanation remains in the conversation flow, so the reader can follow every sentence without switching to another scroll area.</td></tr>`).join('')}
      </tbody></table><p id="sequence-last">The complete table ends here.</p></section>
      <p id="after-sequence">The next paragraph follows all of that content.</p>
      <details id="long-details"><summary>Show the supporting explanation</summary>
        ${Array.from({length:10},(_,i)=>`<p>Supporting point ${i+1}: expanding this explanation should extend the answer naturally and keep all of its text readable.</p>`).join('')}
      </details>
      <button id="add-content" onclick="document.querySelector('#dynamic-content').innerHTML=Array.from({length:12},(_,i)=>'<p>Additional point '+(i+1)+': this content appeared after the reply was rendered and belongs in the same conversation flow.</p>').join('')">Add an explanation</button>
      <div id="dynamic-content"></div><p id="last-marker">End of the full answer.</p>`
    for (const width of [1000,360]) {
      win.setContentSize(width,760)
      await until(`innerWidth===${width}`)
      await run("document.documentElement.dataset.altoTheme='light';document.querySelector('main').scrollTop=0")
      if (width===1000) await show(longReply)
      else await frames()
      const initialHeight=await fullyExpanded()
      assert.ok(initialHeight>640, 'A long answer grows past the former preview limit')
      assert.ok(await inReply('document.querySelector("#after-sequence").getBoundingClientRect().top>=document.querySelector("#sequence-last").getBoundingClientRect().bottom'), 'The complete table cannot overlap the following paragraph')
      assert.ok(await run('document.querySelector("main").scrollHeight>document.querySelector("main").clientHeight'), 'The conversation owns scrolling for long answers')
      await screenshot(`long-${width}-top`)

      await inReply('document.querySelector("#long-details summary").click()')
      await until(`${frame}.getBoundingClientRect().height>${initialHeight+100}`)
      const detailsHeight=await fullyExpanded()
      await inReply('document.querySelector("#add-content").click()')
      await until(`${frame}.getBoundingClientRect().height>${detailsHeight+100}`)
      const dynamicHeight=await fullyExpanded()
      assert.equal(await inReply('document.querySelectorAll("#dynamic-content p").length'),12)

      await run('document.querySelector("main").scrollTop=document.querySelector("main").scrollHeight')
      await frames()
      const marker=await inReply('(()=>{const rect=document.querySelector("#last-marker").getBoundingClientRect();return{top:rect.top,bottom:rect.bottom}})()')
      const outer=await run(`(()=>{const main=document.querySelector('main').getBoundingClientRect(),reply=${frame}.getBoundingClientRect(),composer=document.querySelector('footer').getBoundingClientRect();return{mainTop:main.top,mainBottom:main.bottom,replyTop:reply.top,composerTop:composer.top,horizontalOverflow:document.documentElement.scrollWidth>innerWidth}})()`)
      assert.ok(outer.replyTop+marker.top>=outer.mainTop&&outer.replyTop+marker.bottom<=outer.mainBottom+1, 'Scrolling the conversation reveals the final paragraph')
      assert.ok(outer.mainBottom<=outer.composerTop, 'The expanded reply cannot cover the composer')
      assert.equal(outer.horizontalOverflow,false)
      await screenshot(`long-${width}-bottom`)

      await inReply('document.querySelector("#long-details summary").click()')
      await until(`${frame}.getBoundingClientRect().height<${dynamicHeight-100}`)
      const collapsedHeight=await fullyExpanded()
      await inReply('document.querySelector("#dynamic-content").replaceChildren()')
      await until(`${frame}.getBoundingClientRect().height<${collapsedHeight-100}`)
      const finalHeight=await fullyExpanded()
      assert.ok(Math.abs(finalHeight-initialHeight)<=2, 'Collapsing details and removing dynamic content restores the natural answer height')
    }

    await show('<section style="min-height:100vh">A viewport-sized authored widget.</section><footer style="height:40px">A following footer.</footer>')
    for (let i=0;i<6;i++) await frames()
    const viewportHeight=await run(`${frame}.getBoundingClientRect().height`)
    assert.ok(viewportHeight<2000, 'Viewport-relative content cannot cause runaway iframe growth')
    for (let i=0;i<6;i++) await frames()
    assert.equal(await run(`${frame}.getBoundingClientRect().height`),viewportHeight, 'Viewport-dependent sizing settles instead of feeding back into itself')

    await show('<section><h2>Recovered markup</h2><p>Browsers recover an unclosed section')
    assert.equal(await inReply('document.querySelector("h2").textContent'), 'Recovered markup')
    assert.equal(await run('!!document.querySelector("[role=alert]")'), false)

    await run('renderMarkdown("```html\\n<h2>Source example</h2>\\n```")')
    assert.equal(await run(`!!${frame}`), false)
    assert.equal(await run('document.querySelector("pre code.language-html").textContent'), '<h2>Source example</h2>')
    assert.equal(await run('!!document.querySelector("h2")'), false)

    const attack = `<title>Untrusted content</title><p>Isolated local script</p>
      <style>@import url('${replyOrigin}/probe-import');p{background-image:url('${replyOrigin}/probe-style')}@font-face{font-family:probe;src:url('${replyOrigin}/probe-font')}</style>
      <script src="${replyOrigin}/probe-script-src"></script><link rel="stylesheet" href="${replyOrigin}/probe-link">
      <img src="${replyOrigin}/probe-image"><iframe src="${replyOrigin}/probe-frame"></iframe><object data="${replyOrigin}/probe-object"></object>
      <form action="${replyOrigin}/probe-form"><input type="submit" value="Submit"></form>
      <a id="top-link" href="${replyOrigin}/probe-top" target="_top">Top navigation</a>
      <script>
        window.probes={};
        try{parent.document.body;probes.parent='readable'}catch{probes.parent='blocked'}
        try{parent.hostTool();probes.host='called'}catch{probes.host='blocked'}
        try{localStorage.setItem('secret','value');probes.storage='writable'}catch{probes.storage='blocked'}
        try{document.cookie='secret=value';probes.cookie='writable'}catch{probes.cookie='blocked'}
        fetch('${replyOrigin}/probe-fetch').then(()=>probes.fetch='allowed',()=>probes.fetch='blocked');
        try{const socket=new WebSocket('${replyOrigin.replace('http:', 'ws:')}/probe-websocket');socket.onerror=()=>probes.socket='blocked';socket.onopen=()=>probes.socket='allowed'}catch{probes.socket='blocked'}
        parent.postMessage({type:'alto.rich-reply.resize',token:'wrong-token',height:1e9},'*');
        parent.postMessage({type:'rich-replies.render',html:'forged'},'*');
        parent.postMessage({method:'hostTool'},'*');
        window.popup=window.open('${replyOrigin}/probe-popup');
      </script>`
    const callsBeforeAttack = await run('hostCalls.length')
    await show(attack)
    await inReply('new Promise(resolve=>{const poll=()=>probes.fetch&&probes.socket?resolve():setTimeout(poll,10);poll()})')
    assert.deepEqual(await inReply('probes'), { parent: 'blocked', host: 'blocked', storage: 'blocked', cookie: 'blocked', fetch: 'blocked', socket: 'blocked' })
    assert.equal(await inReply('window.popup===null'), true, 'Replies cannot open auxiliary windows')
    await inReply('document.querySelector("form").requestSubmit();document.querySelector("#top-link").click()')
    await frames()
    assert.equal(await run('window.hostMarker'), 'untouched', 'Reply JavaScript cannot call host functions')
    assert.equal(await run('hostCalls.length'), callsBeforeAttack + 1, 'Forged messages do not dispatch host methods')
    assert.equal(win.webContents.getURL(), origin + '/', 'Reply JavaScript cannot navigate the top-level chat')
    const attackHeight=await run(`${frame}.getBoundingClientRect().height`)
    await inReply("parent.postMessage({type:'alto.rich-reply.resize',token:'wrong-token',height:1e9},'*')")
    await frames()
    assert.equal(await run(`${frame}.getBoundingClientRect().height`),attackHeight, 'Forged resize messages cannot expand the chat')
    assert.deepEqual(attempted, [], 'Reply CSP and sandbox prevent outbound resource requests')
    assert.deepEqual(received, [], 'No rich-reply resource reaches the network')

    await run(`renderRich(${JSON.stringify('<p>' + 'x'.repeat(60_001) + '</p>')})`)
    await until('!!document.querySelector(".rich-reply [role=alert]")')
    assert.match(await run('document.querySelector("[role=alert]").textContent'), /large|limit|60[,.]?000|long/i)
    assert.equal(await run(`!!${frame}`), false)
    assert.ok(await run('document.querySelector(".rich-reply pre").textContent.length > 60_000'), 'An invalid rich reply retains readable source')
    await run('window.rejectRender=true;renderRich("<p>Recoverable server error</p>")')
    await until('document.querySelector("[role=alert]")?.textContent.includes("unavailable")')
    assert.equal(await run('document.querySelector(".rich-reply pre").textContent'), '<p>Recoverable server error</p>')
    await run('window.rejectRender=false')

    await show(sample);await run('unload()');await until(`!${frame}`)
    assert.deepEqual(await run('registered()'), [])
    assert.equal(await run('document.querySelectorAll("style[data-fixture-plugin-style]").length'), 0, 'Unloading owns both the renderer and its styles')
    assert.ok((await run('document.querySelector("pre code.language-alto-html").textContent')).includes('Stage the release, then expand'))
    await run('reload()');await until(`!!${frame}`)
    assert.equal(await run('registered().length'), 1)
    assert.equal(await run('document.querySelector("textarea").value'), 'A draft stays below the reply')
    console.log('Rich reply browser checks passed')
  } finally {
    win.webContents.session.webRequest.onBeforeRequest(null)
    win.destroy()
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => replyServer.close(resolve))])
  }
}
check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
