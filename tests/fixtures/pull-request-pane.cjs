const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'pull-request-pane-fixture.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {Context} from 'cordis';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {ClientUiRegistry} from './src/client/plugin-runtime';
      import appearancePlugin from './program/plugins/interface-appearance.client';
      import markdownPlugin from './program/plugins/markdown.client';
      import explorerPlugin from './program/plugins/code-explorer.client';
      import fileTreePlugin from './program/plugins/file-tree.client';
      import diffPlugin from './program/plugins/diff-viewer.client';
      import prPlugin from './program/plugins/pull-request-pane.client';
      import dashboardPlugin,{PullRequestRow} from './program/plugins/pull-requests.client';
      import {PR_STATE,PR_REFRESH} from './program/plugins/pull-requests-api';
      const READ='pull-request.read',DIFF='pull-request.diff',base='https://github.com/example/repo/pull/';
      const account={login:'reviewer',url:'https://github.com/reviewer'};
      let visible=false,mounted=true,resource=base+'42',metadataVersion=1,patchVersion=1,baseVersion=1,serial=0,stackMode='none';
      const kinds=new Map(),hostListeners=new Set(),context=new Context(),ui=new ClientUiRegistry();
      const root=createRoot(document.getElementById('pane-mount'));
      const routingRoot=createRoot(document.getElementById('routing-mount'));
      globalThis.__prRenderCounts={parent:0,pane:0,markdown:0,diff:0,chrome:0,list:0};
      let hostState={connected:true,connectionEpoch:1,revision:0,snapshot:{program:{revision:1},extensions:{}}},dashboardFiber,dashboardMounted=false;
      let paneNode={type:'pane',id:'pr-pane',kind:'pull-request',workspace:'/repo',resource};
      window.requests=[];window.pending=[];window.held=new Set([READ,DIFF]);window.failNext=new Map();
      window.openRequests=[];window.externalClicks=[];window.sent=[];window.focused=[];
      window.markdownReactClicks=[];window.dashboardReactClicks=[];window.reactClosed={markdown:0,dashboard:0};
      const nativeNow=Date.now,nativeSetInterval=window.setInterval.bind(window),nativeClearInterval=window.clearInterval.bind(window),pollers=new Map();
      let clockOffset=0;
      Date.now=()=>nativeNow()+clockOffset;
      Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visible?'visible':'hidden'});
      window.setInterval=(callback,delay,...args)=>{const id=nativeSetInterval(callback,delay,...args);if(delay===60000)pollers.set(id,()=>callback(...args));return id};
      window.clearInterval=id=>{pollers.delete(id);nativeClearInterval(id)};
      window.pollPullRequests=()=>{clockOffset+=60001;flushSync(()=>{for(const poll of [...pollers.values()])poll()})};
      const comment=(id,body)=>({id,body,author:account,createdAt:'2026-11-01T12:00:00Z',url:base+'42#'+id});
      const stackEntry=(number,position,state,draft,checks)=>({position,pullRequest:{number,url:base+number,title:'Native stack member '+number+' with a deliberately long title for narrow panes',state,draft,headBranch:'stack/'+number,baseBranch:position===1?'main':'stack/'+(number-1),...(checks?{checks}:{})}});
      const stackFields=()=>stackMode==='none'?{}:stackMode==='unavailable'?{stackUnavailable:true}:{
        stack:{id:'PRS_native',number:7,baseBranch:'main',size:stackMode==='partial'?7:4,entries:[
          stackEntry(44,3,'OPEN',false,'pending'),stackEntry(45,4,'OPEN',true,undefined),
          stackEntry(41,1,'MERGED',false,'passing'),stackEntry(42,2,'OPEN',false,'failing'),
        ]},...(stackMode==='partial'?{moreStackEntries:true}:{}),
      };
      const details=number=>({
        id:'PR_'+number,number,title:'Keep the glass light — PR '+number+' (revision '+metadataVersion+')',url:base+number,
        repository:'example/repo',headRepository:'contributor/repo',branch:'feature/glass-and-a-deliberately-long-branch-name-that-stays-within-the-pane',baseBranch:'main',
        draft:number===45,state:'OPEN',author:account,createdAt:'2026-11-01T12:00:00Z',updatedAt:'2026-11-02T12:00:00Z',
        review:'CHANGES_REQUESTED',checks:'FAILURE',mergeable:'MERGEABLE',mergeState:'BLOCKED',
        unresolvedThreads:1,moreThreads:false,additions:25,deletions:7,changedFiles:1,baseSha:'base-'+baseVersion,
        headSha:String(patchVersion).repeat(40),body:'# Context\\n\\n**Shared Markdown** keeps the glass light and preserves \`refresh()\`.\\n\\n- Review the updated surface.\\n- Keep existing keyboard behavior.',
        checksList:[
          {id:'check-tests',name:'Tests / desktop macOS integration suite',status:'COMPLETED',conclusion:'FAILURE',url:'https://buildkite.com/example/builds/1'},
          {id:'check-lint',name:'Lint',status:'COMPLETED',conclusion:'SUCCESS',url:null},
          {id:'check-build',name:'Build release',status:'IN_PROGRESS',conclusion:null,url:null},
        ],moreChecks:false,comments:[comment('discussion-1','**Discussion note**: retain the \`window\` behavior.')],moreComments:false,
        threads:[{id:'thread-1',path:'src/glass.ts',line:1,isResolved:false,isOutdated:false,url:base+number+'/files#thread-1',moreComments:false,
          comments:[comment('review-1','**Review note**: preserve the \`accent\` setting.')] }],...stackFields(),
      });
      const diff=number=>({
        id:'github-pr:example/repo#'+number+':patch-'+patchVersion+':base-'+baseVersion,title:'example/repo #'+number,workspace:'/repo',createdAt:'2026-11-02T12:00:00Z',
        patch:'diff --git a/src/glass.ts b/src/glass.ts\\n--- a/src/glass.ts\\n+++ b/src/glass.ts\\n@@ -1,2 +1,2 @@\\n-export const opacity = 0.4\\n+export const opacity = 0.'+patchVersion+'\\n export const accent = '+(baseVersion===1?'true':'false')+'\\n',
      });
      const host={subscribe:listener=>{hostListeners.add(listener);return()=>hostListeners.delete(listener)},
        snapshot:()=>hostState,
        call:(method,payload)=>{
          const request={id:++serial,method,payload};window.requests.push(request);
          if(method===PR_REFRESH)return Promise.resolve(null);
          if(method!==READ&&method!==DIFF)return Promise.reject(new Error('Unexpected request '+method));
          const number=Number(payload.resource.match(/\\d+(?:\\/files)?$/)[0].replace('/files',''));
          const value=method===READ?details(number):diff(number);
          const failure=window.failNext.get(method);window.failNext.delete(method);
          if(!window.held.has(method))return failure?Promise.reject(new Error(failure)):Promise.resolve(value);
          return new Promise((resolve,reject)=>window.pending.push({...request,resolve:()=>failure?reject(new Error(failure)):resolve(value),reject}));
        },
      };
      const session={snapshot:()=>({threadId:'origin-thread',session:{workspace:'/repo'},activeProjectId:'project-1',turn:{tag:'idle'}}),
        send:async draft=>window.sent.push(draft),steer:async()=>{throw new Error('Unexpected steer')}};
      const layout={available:()=>true,paneTargets:()=>[{workspaceId:'workspace-1',paneId:'origin-pane',focused:false,session}],
        focusPane:(_workspaceId,paneId)=>{window.focused.push(paneId);return true},
        openPane:request=>{window.openRequests.push(request);return{workspaceId:'workspace-1',paneId:'opened-pr'}},
        registerPaneKind:(owner,kind)=>{
          const dispose=owner.effect(()=>{kinds.set(kind.id,kind);return()=>kinds.delete(kind.id)});
          return{dispose:async()=>dispose()};
        },
      };
      context.provide('clientUi',ui);context.provide('clientHost',host);context.provide('clientWorkspaceLayout',layout);
      const fibers=[];
      async function install(){
        for(const plugin of [appearancePlugin,markdownPlugin,explorerPlugin,fileTreePlugin,diffPlugin,prPlugin]){
          fibers.push(await context.plugin(plugin,{}));
        }
        localStorage.setItem('alto.diff-review-comments.v1:github-pr:example/repo#42:patch-1:base-1',JSON.stringify([{
          id:'saved-note',itemId:'github-pr:example/repo#42:patch-1:base-1:0:0',path:'src/glass.ts',side:'additions',start:1,end:1,
          body:'Saved remote review note.',createdAt:'2026-11-02T12:00:00Z',
        }]));
        const Markdown=ui.component('markdown.content'),row=details(42);
        flushSync(()=>routingRoot.render(<div data-workspace-pane-id="origin-pane">
          <div id="fixture-markdown" onClick={event=>{window.markdownReactClicks.push(event.defaultPrevented);window.reactClosed.markdown++}}>
            <Markdown source="[Read the **pull request**](https://github.com/example/repo/pull/42/files?diff=split#diff-123)" className="activity-markdown"/>
          </div>
          <section id="pull-requests-panel" onClick={event=>{window.dashboardReactClicks.push(event.defaultPrevented);window.reactClosed.dashboard++;ui.overlays.close('pull-requests')}}>
            <PullRequestRow pr={row} items={[row]}/>
          </section>
        </div>));
        render();window.ready=true;
      }
      function HostParent(){
        const state=React.useSyncExternalStore(host.subscribe,host.snapshot,host.snapshot);
        globalThis.__prRenderCounts.parent++;
        const Pane=kinds.get('pull-request')?.renderer;
        const Dashboard=dashboardMounted?ui.rootRenderers().find(root=>root.id==='pull-requests-chrome')?.renderer:undefined;
        return <><section className="fixture-surface workspace-chat-pane workspace-typed-pane is-focused" data-workspace-pane-id="pr-pane" hidden={!visible}>
          <div className="workspace-typed-pane-content">
            {mounted&&Pane&&<Pane workspaceId="workspace-1" pane={paneNode} visible={visible} focused={state.revision%2===0} closePane={()=>{}}/>}
          </div>
        </section>{Dashboard&&<Dashboard/>}</>;
      }
      function render(){flushSync(()=>{
        if(paneNode.resource!==resource)paneNode={...paneNode,...(resource?{resource}:{resource:undefined})};
        root.render(<HostParent/>);
      })}
      window.emitHostChange=extension=>flushSync(()=>{
        hostState={...hostState,revision:hostState.revision+1,snapshot:{...hostState.snapshot,extensions:{...hostState.snapshot.extensions,...extension}}};
        for(const listener of hostListeners)listener();
      });
      window.unrelatedHostChange=()=>window.emitHostChange({fixtureAgentProgress:{sequence:hostState.revision+1,text:'Unrelated ACP progress'}});
      window.dashboardSnapshot=title=>window.emitHostChange({[PR_STATE]:{phase:'ready',fetchedAt:Date.now()+hostState.revision,viewer:'reviewer',total:1,complete:true,error:null,items:[{...details(42),title}]}});
      window.installDashboard=async()=>{flushSync(()=>routingRoot.render(null));dashboardFiber=await context.plugin(dashboardPlugin,{});dashboardMounted=true;render()};
      window.setVisible=value=>{visible=value;render()};
      window.bumpMetadata=()=>metadataVersion++;
      window.bumpPatch=()=>patchVersion++;
      window.bumpBase=()=>baseVersion++;
      window.setStackMode=value=>{stackMode=value};
      window.release=id=>{const index=window.pending.findIndex(request=>request.id===id);if(index<0)throw new Error('No pending request '+id);window.pending.splice(index,1)[0].resolve()};
      window.type=(selector,value)=>flushSync(()=>{
        const field=document.querySelector(selector),prototype=field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype,'value').set.call(field,value);field.dispatchEvent(new Event('input',{bubbles:true}));
      });
      window.choose=value=>{
        if(!document.querySelector('.pull-request-address'))flushSync(()=>document.querySelector('[aria-label="Open another pull request"]').click());
        window.type('.pull-request-address input',value);
        flushSync(()=>document.querySelector('.pull-request-address').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      };
      window.restore=()=>{mounted=false;render();resource=base+'42';mounted=true;render()};
      window.diffRoot=()=>[...document.querySelectorAll('.diff-viewer-code *')].map(node=>node.shadowRoot).find(shadow=>shadow?.querySelector('[data-line]'));
      window.clickLink=(id,options={})=>{
        const anchor=document.getElementById(id);anchor.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0,...options}));
      };
      window.clickStackMember=(number,options={})=>document.querySelector('.pull-request-stack-entry[href="'+base+number+'"]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,button:0,...options}));
      window.showDashboard=()=>ui.overlays.open('pull-requests');
      window.hideDashboard=()=>ui.overlays.close('pull-requests');
      window.dashboardOpen=()=>ui.overlays.snapshot()==='pull-requests';
      document.addEventListener('click',event=>{
        const anchor=event.target instanceof Element?event.target.closest('a[href]'):undefined;
        if(anchor&&!event.defaultPrevented){window.externalClicks.push({id:anchor.id,href:anchor.href});event.preventDefault()}
      });
      window.geometry=()=>{
        const pane=document.querySelector('.pull-request-pane'),toolbar=document.querySelector('.pull-request-toolbar'),summary=document.querySelector('.pull-request-summary-scroll'),diff=document.querySelector('.diff-viewer-code'),changes=document.querySelector('.pull-request-changes'),viewer=changes?.querySelector('.diff-viewer-pane'),description=document.querySelector('.pull-request-description'),discussion=document.querySelector('.pull-request-discussion');
        const visible=node=>node&&node.getBoundingClientRect().width>0;
        const box=node=>{const rect=node.getBoundingClientRect();return{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height}};
        return{viewport:innerWidth,viewportHeight:innerHeight,page:document.documentElement.scrollWidth,container:box(pane.parentElement),pane:{...box(pane),scroll:pane.scrollWidth},toolbar:box(toolbar),
          summary:visible(summary)?{width:summary.clientWidth,height:summary.clientHeight,scroll:summary.scrollWidth,scrollHeight:summary.scrollHeight,inset:parseFloat(getComputedStyle(summary.querySelector('.pull-request-summary')).paddingInlineStart)}:undefined,diff:visible(diff)?box(diff):undefined,
          changes:visible(changes)?box(changes):undefined,viewer:visible(viewer)?box(viewer):undefined,description:visible(description)?box(description):undefined,discussion:visible(discussion)?box(discussion):undefined,
          controls:[...toolbar.querySelectorAll('button,a')].map(box),theme:document.documentElement.dataset.altoTheme};
      };
      window.observe=()=>({text:document.body.innerText,requests:window.requests,pending:window.pending.map(({id,method,payload})=>({id,method,payload})),open:window.openRequests});
      window.disposePr=async()=>{mounted=false;render();await fibers.at(-1).dispose();return{kinds:[...kinds.keys()],style:!!document.querySelector('style[data-cordis-plugin-style="pull-request-pane"]')}};
      window.disposeDiff=async()=>{await fibers.at(-2).dispose();return !!ui.component('diff.content')};
      window.teardown=async()=>{flushSync(()=>{root.unmount();routingRoot.unmount()});await dashboardFiber?.dispose();for(const fiber of fibers.reverse())await fiber.dispose();return{components:['markdown.content','diff.content'].filter(id=>ui.component(id)),styles:document.querySelectorAll('style[data-cordis-plugin-style]').length}};
      install().catch(error=>{window.setupError=String(error);console.error(error)});
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
    // Reproduce the pre-fix layout without editing the source or supplying a
    // feature width from the fixture. The normal run uses production CSS intact.
    plugins: [{name:'pr-render-counts',setup(plugin){
      plugin.onLoad({filter:/(?:pull-request-pane\.client|pull-requests\.client|diff-viewer\.client|markdown-content)\.tsx$/},async args=>{
        let contents=await fs.readFile(args.path,'utf8');
        if(args.path.endsWith('pull-request-pane.client.tsx'))contents=contents.replace('  const initial = rememberedResource(pane.id)', '  globalThis.__prRenderCounts.pane++;\n  const initial = rememberedResource(pane.id)');
        if(args.path.endsWith('markdown-content.tsx'))contents=contents.replace('return function RegisteredMarkdownContent(props) {', "return function RegisteredMarkdownContent(props) { if (props.className.includes('pull-request-markdown')) globalThis.__prRenderCounts.markdown++;");
        if(args.path.endsWith('diff-viewer.client.tsx'))contents=contents.replace('  const resourceCommit = commitRefFromDiffResource(pane.resource)', "  if (presentation === 'content') globalThis.__prRenderCounts.diff++;\n  const resourceCommit = commitRefFromDiffResource(pane.resource)");
        if(args.path.endsWith('pull-requests.client.tsx'))contents=contents.replace('  const mount = useToggleMount(ui)', '  globalThis.__prRenderCounts.chrome++;\n  const mount = useToggleMount(ui)').replace('  const store = useMemo(() => pullRequestViewStore(host)', '  globalThis.__prRenderCounts.list++;\n  const store = useMemo(() => pullRequestViewStore(host)');
        return{contents,loader:'tsx'};
      });
    }},...(process.env.ALTO_PR_PANE_WITHOUT_ROOT_FLEX ? [{ name: 'pr-pane-before-root-flex', setup(plugin) {
      plugin.onLoad({ filter: /pull-request-pane\.css$/ }, async args => ({
        contents: (await fs.readFile(args.path, 'utf8')).replace(/^(\.pull-request-pane \{)\n  flex: 1 1 0;/u, '$1'),
        loader: 'text',
      }))
    } }] : [])],
  })
  const css = (await Promise.all([
    'src/client/styles.css', 'src/client/pane-toolbar.css', 'program/plugins/ui/default.css', 'program/plugins/theme.css', 'program/plugins/workspace-layout.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const links = [
    ['root-link', 'https://github.com/example/repo/pull/42'],
    ['files-link', 'https://github.com/example/repo/pull/42/files'],
    ['files-comment-link', 'https://github.com/example/repo/pull/42/files?diff=split#diff-123'],
    ['commits-link', 'https://github.com/example/repo/pull/42/commits?tab=activity#commit-123'],
    ['comment-link', 'https://github.com/example/repo/pull/42#issuecomment-1'],
    ['query-link', 'https://github.com/example/repo/pull/42?diff=split'],
    ['checks-link', 'https://github.com/example/repo/pull/42/checks'],
    ['external-link', 'https://github.com/example/repo/pull/42', true],
  ].map(([id, href, external]) => `<a id="${id}" href="${href}"${external ? ' data-pull-request-external' : ''}>${id}</a>`).join('')
  const server = http.createServer(async (request, response) => {
    if (request.url?.startsWith('/fonts/')) {
      try { response.end(await fs.readFile(path.join('public/fonts', path.basename(decodeURIComponent(request.url))))); return }
      catch { response.statusCode = 404; response.end(); return }
    }
    response.end('<!doctype html><html data-alto-theme="light"><meta charset="utf-8"><style>' + css + `
      html,body{height:100%;margin:0;overflow:hidden}.fixture-surface[hidden]{display:none}
    </style><div id="pane-mount" class="workspace-layout-root"></div><div id="routing-mount" hidden></div><nav id="fixture-links" hidden data-workspace-pane-id="origin-pane">${links}</nav></html>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const win = new BrowserWindow({ show: false, width: 1000, height: 820, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = async code => {
    try { return await win.webContents.executeJavaScript(code) }
    catch (error) { throw new Error('PR fixture script failed: ' + code, { cause: error }) }
  }
  const frames = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const until = async expression => {
    for (let index = 0; index < 150; index++) {
      if (await run(expression)) return
      if (await run('!!window.setupError')) throw new Error(await run('window.setupError'))
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    throw new Error('Timed out: ' + expression + '\n' + JSON.stringify(await run('observe()')))
  }
  const count = method => run(`requests.filter(request=>request.method===${JSON.stringify(method)}).length`)
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const scrollToChanges = async () => {
    await run("(()=>{const page=document.querySelector('.pull-request-summary-scroll'),changes=document.querySelector('.pull-request-changes');page.scrollTop+=changes.getBoundingClientRect().top-page.getBoundingClientRect().top-8})()")
    await frames()
  }
  const assertContinuousPage = async () => {
    assert.equal(await run("!!document.querySelector('.pull-request-tabs,[role=tablist]')"), false, 'PR details and changes share one page without view tabs')
    assert.equal(await run("(()=>{const page=document.querySelector('.pull-request-summary-scroll'),description=document.querySelector('.pull-request-description'),changes=document.querySelector('.pull-request-changes'),discussion=document.querySelector('.pull-request-discussion');return page.contains(description)&&page.contains(changes)&&page.contains(discussion)&&!!(description.compareDocumentPosition(changes)&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(changes.compareDocumentPosition(discussion)&Node.DOCUMENT_POSITION_FOLLOWING)})()"), true, 'The continuous page orders description, changes, then review discussion')
  }
  const assertFillsContainer = geometry => {
    assert.ok(geometry.container.width > 0 && Math.abs(geometry.pane.width - geometry.container.width) <= 1,
      'PR root must fill the production workspace-typed-pane-content flex row: ' + JSON.stringify(geometry))
  }
  const capture = async name => {
    if (!process.env.ALTO_PR_PANE_ARTIFACT_DIR) return
    await fs.mkdir(process.env.ALTO_PR_PANE_ARTIFACT_DIR, { recursive: true })
    await fs.writeFile(path.join(process.env.ALTO_PR_PANE_ARTIFACT_DIR, name + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  try {
    await win.loadURL('http://127.0.0.1:' + server.address().port)
    await run(bundle.outputFiles[0].text)
    await until('window.ready===true')
    await frames()
    assert.equal(await count('pull-request.read'), 0, 'A restored hidden PR pane should load lazily')
    assert.equal(await count('pull-request.diff'), 0, 'Hidden PR panes must not download a patch')
    await run('setVisible(true)')
    await until("!!document.querySelector('.pull-request-loading')&&pending.some(request=>request.method==='pull-request.read')&&pending.some(request=>request.method==='pull-request.diff')")
    assert.equal(await count('pull-request.read'), 1)
    assert.equal(await count('pull-request.diff'), 1, 'Cold metadata and patch requests start together')
    assertFillsContainer(await run('geometry()'))
    assert.match(await run("document.querySelector('[role=status]').textContent"), /Loading pull request/)
    await run("held.delete('pull-request.read');release(pending.find(request=>request.method==='pull-request.read').id)")
    await until("!!document.querySelector('.pull-request-heading')")
    assert.match(await run("document.querySelector('.pull-request-heading').textContent"), /PR 42/)
    await until("pending.some(request=>request.method==='pull-request.diff')")
    assert.equal(await count('pull-request.diff'), 1, 'Metadata arriving reuses the already running patch request')
    await assertContinuousPage()
    assert.match(await run("document.querySelector('.pull-request-facts').textContent"), /Files changed1/)
    assert.match(await run("document.querySelector('.pull-request-status-list').textContent"), /1 passed · 1 failed · 1 running/)
    assert.equal(await run("document.querySelector('.pull-request-description strong').textContent"), 'Shared Markdown')
    assert.equal(await run("document.querySelector('.pull-request-description code').textContent"), 'refresh()')
    await click('.pull-request-status-detail > summary')
    assert.equal(await run("document.querySelector('.pull-request-status-detail').open"), true)
    assert.equal(await run("document.querySelectorAll('.pull-request-check').length"), 3)
    await click('.pull-request-thread > summary')
    assert.equal(await run("document.querySelector('.pull-request-thread .pull-request-markdown strong').textContent"), 'Review note')
    assert.equal(await run("document.querySelector('[aria-label=\"Pull request discussion\"] strong').textContent"), 'reviewer')
    assert.match(await run("document.querySelector('[aria-label=\"Pull request discussion\"] .pull-request-markdown strong').textContent"), /Discussion note/)

    assert.match(await run("document.querySelector('.pull-request-changes').textContent"), /Loading changes/)
    await run("held.clear();release(pending.find(request=>request.method==='pull-request.diff').id)")
    await until("!!diffRoot()&&!!document.querySelector('.diff-review-comment')")
    assert.equal(await run("diffRoot().querySelector('[data-line][data-line-type=\"change-addition\"]').textContent.includes('0.1')"), true)
    assert.equal(await run("!!document.querySelector('.diff-viewer-commit-picker')"), false)
    assert.equal(await count('diff-viewer.read'), 0)
    assert.equal(await count('diff-viewer.commits'), 0)
    assert.deepEqual(await run("requests.find(request=>request.method==='pull-request.diff').payload"), { resource: 'https://github.com/example/repo/pull/42', workspace: '/repo' })
    assert.equal(await run("document.querySelector('.file-tree').getAttribute('aria-label')"), 'Changed files')
    assert.equal(await run("document.querySelector('.diff-review-comment p').textContent"), 'Saved remote review note.')
    await click('.diff-viewer-footer button')
    await until('sent.length===1')
    assert.match(await run('sent[0].text'), /Saved remote review note/)
    assert.equal(await run("focused.at(-1)"), 'origin-pane')

    await scrollToChanges()
    const point = await run(`(()=>{const node=diffRoot().querySelector('[data-gutter] [data-line-type="change-addition"][data-column-number="1"]');if(!node)throw new Error('No added line gutter');const rect=node.getBoundingClientRect();return{x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)}})()`)
    assert.ok(point.y > 35 && point.y < 820, 'The review gutter is on screen before pointer interaction: ' + JSON.stringify(point))
    win.webContents.sendInputEvent({ type: 'mouseMove', ...point })
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
    await until("!!document.querySelector('[aria-label=\"Review comment\"]')")
    await run("type('[aria-label=\"Review comment\"]','Keep this unsaved review draft.');window.savedDraft=document.querySelector('[aria-label=\"Review comment\"]')")
    await click('[aria-label="Open another pull request"]')
    await run("type('.pull-request-address input','example/repo#partially-typed');window.savedAddress=document.querySelector('.pull-request-address input')")
    await run('bumpMetadata()')
    await run('pollPullRequests()')
    await until("document.querySelector('.pull-request-heading').textContent.includes('revision 2')&&!document.querySelector('[aria-label=\"Refresh diff\"]').disabled")
    assert.equal(await run("savedAddress===document.querySelector('.pull-request-address input')&&savedAddress.value==='example/repo#partially-typed'"), true)
    await frames()
    assert.equal(await count('pull-request.diff'), 2, 'The first unversioned parallel patch is revalidated after its freshness window')
    assert.equal(await run("savedDraft===document.querySelector('[aria-label=\"Review comment\"]')&&savedDraft.value==='Keep this unsaved review draft.'"), true)
    const readsBeforeStablePoll = await count('pull-request.read')
    await run('pollPullRequests()')
    await until(`requests.filter(request=>request.method==='pull-request.read').length>${readsBeforeStablePoll}&&!document.querySelector('[aria-label="Refresh pull request"]').disabled`)
    assert.equal(await count('pull-request.diff'), 2, 'Later unchanged metadata reuses the already revalidated patch')
    await run('setVisible(false);setVisible(true)')
    await until("!document.querySelector('[aria-label=\"Refresh pull request\"]').disabled")
    await frames()
    assert.equal(await count('pull-request.diff'), 2, 'Hiding and showing must reuse an unchanged patch')
    assert.equal(await run("savedDraft===document.querySelector('[aria-label=\"Review comment\"]')&&savedDraft.value==='Keep this unsaved review draft.'"), true)
    const readsBeforeForcedRefresh = await count('pull-request.read')
    await click('[aria-label="Refresh pull request"]')
    await until("!document.querySelector('[aria-label=\"Refresh pull request\"]').disabled&&!document.querySelector('[aria-label=\"Refresh diff\"]').disabled")
    assert.equal(await count('pull-request.read'), readsBeforeForcedRefresh + 1, 'Manual refresh bypasses cached metadata')
    assert.equal(await count('pull-request.diff'), 3, 'Manual refresh reloads the patch even when metadata is unchanged')
    assert.equal(await run("savedDraft===document.querySelector('[aria-label=\"Review comment\"]')&&savedDraft.value==='Keep this unsaved review draft.'"), true, 'Refreshing the same document retains the exact review editor')
    await click('[aria-label="Refresh diff"]')
    await until("requests.filter(request=>request.method==='pull-request.diff').length===4&&!document.querySelector('[aria-label=\"Refresh diff\"]').disabled")
    assert.equal(await count('pull-request.read'), readsBeforeForcedRefresh + 1, 'The diff toolbar refresh does not reload metadata')
    assert.equal(await run("savedDraft===document.querySelector('[aria-label=\"Review comment\"]')&&savedDraft.value==='Keep this unsaved review draft.'"), true, 'Reloading the same immutable document preserves typed comments')
    assert.equal(await run("document.querySelector('.diff-review-comment p').textContent"), 'Saved remote review note.')

    await run("failNext.set('pull-request.read','GitHub is unavailable.')")
    await click('[aria-label="Refresh pull request"]')
    await until("!!document.querySelector('.pull-request-error')")
    assert.match(await run("document.querySelector('.pull-request-error').textContent"), /Showing the last loaded version/)
    assert.match(await run("document.querySelector('.pull-request-heading').textContent"), /revision 2/)
    await click('.pull-request-error button')
    await until("!document.querySelector('.pull-request-error')")
    const diffsBeforeHeadChange = await count('pull-request.diff')
    await run('bumpPatch()')
    await click('[aria-label="Refresh pull request"]')
    await until("!document.querySelector('[aria-label=\"Refresh pull request\"]').disabled")
    await until(`requests.filter(request=>request.method==='pull-request.diff').length>${diffsBeforeHeadChange}&&!document.querySelector('[aria-label="Refresh diff"]').disabled`)
    assert.equal(await run("!!document.querySelector('[aria-label=\"Review comment\"]')"), false, 'A new immutable patch discards the old line selection draft')
    assert.equal(await run("!!document.querySelector('.diff-review-comment')"), false, 'Review notes belong to their immutable patch')
    const diffsBeforeBaseChange = await count('pull-request.diff')
    await run('bumpBase()')
    await click('[aria-label="Refresh pull request"]')
    await until("!document.querySelector('[aria-label=\"Refresh pull request\"]').disabled")
    await until(`requests.filter(request=>request.method==='pull-request.diff').length>${diffsBeforeBaseChange}&&!document.querySelector('[aria-label="Refresh diff"]').disabled`)
    assert.equal(await run("diffRoot().textContent.includes('false')"), true, 'A changed base revision invalidates the diff even when the head stays unchanged')

    const readsBeforeInvalid = await count('pull-request.read')
    const diffsBeforeChoose = await count('pull-request.diff')
    await run("choose('https://not-github.test/example/repo/pull/42')")
    assert.equal(await run("document.querySelector('.pull-request-address input').getAttribute('aria-invalid')"), 'true')
    assert.equal(await count('pull-request.read'), readsBeforeInvalid)
    await run("held.add('pull-request.read');choose('example/repo#43')")
    await until("pending.some(request=>request.method==='pull-request.read'&&request.payload.resource.endsWith('/43'))")
    assert.equal(await count('pull-request.diff'), diffsBeforeChoose + 1)
    assert.equal(await run("requests.filter(request=>request.method==='pull-request.diff').at(-1).payload.resource"), 'https://github.com/example/repo/pull/43', 'The early patch request uses the selected PR identity')
    assert.equal(await run("!!document.querySelector('.diff-viewer-code')"), false, 'A patch finishing before metadata does not show the previous PR code')
    await run("choose('example/repo#44')")
    await until("pending.some(request=>request.method==='pull-request.read'&&request.payload.resource.endsWith('/44'))")
    assert.equal(await count('pull-request.diff'), diffsBeforeChoose + 2)
    await run("release(pending.find(request=>request.method==='pull-request.read'&&request.payload.resource.endsWith('/43')).id)")
    await frames()
    assert.equal(await run("document.querySelector('.pull-request-heading')?.textContent.includes('PR 43')??false"), false, 'A previous URL response must not replace the current PR')
    assert.equal(await count('pull-request.diff'), diffsBeforeChoose + 2, 'Obsolete metadata does not start another patch request')
    await run("held.clear();release(pending.find(request=>request.method==='pull-request.read'&&request.payload.resource.endsWith('/44')).id)")
    await until("document.querySelector('.pull-request-heading')?.textContent.includes('PR 44')&&!!diffRoot()")
    assert.equal(await count('pull-request.diff'), diffsBeforeChoose + 2, 'A diff-first completion is reused when matching metadata arrives')
    assert.equal(await run("localStorage.getItem('alto.pull-request-pane.pr-pane')"), 'https://github.com/example/repo/pull/44')
    const readsBeforeWarmReturn = await count('pull-request.read')
    const diffsBeforeWarmReturn = await count('pull-request.diff')
    await run("held.add('pull-request.read');held.add('pull-request.diff');choose('example/repo#42')")
    await until("document.querySelector('.pull-request-heading')?.textContent.includes('PR 42')&&!!diffRoot()")
    assert.equal(await count('pull-request.read'), readsBeforeWarmReturn, 'Returning to a fresh cached PR shows its summary without a new request')
    assert.equal(await count('pull-request.diff'), diffsBeforeWarmReturn, 'Returning to a fresh cached PR reuses its immutable patch')
    await run("choose('example/repo#44');held.clear()")
    await until("document.querySelector('.pull-request-heading')?.textContent.includes('PR 44')&&!!diffRoot()")
    await run('restore()')
    await until("document.querySelector('.pull-request-heading')?.textContent.includes('PR 44')&&!!diffRoot()")
    assert.equal(await count('pull-request.read'), readsBeforeWarmReturn, 'Unmounting and restoring a pane reuses the fresh shared summary')
    assert.equal(await count('pull-request.diff'), diffsBeforeWarmReturn, 'Unmounting and restoring a pane reuses the shared patch')

    await run("clickLink('root-link');clickLink('files-link');clickLink('files-comment-link');clickLink('commits-link');clickLink('comment-link');clickLink('query-link')")
    assert.equal(await run('openRequests.length'), 6)
    assert.equal(await run("openRequests.every(request=>request.resource==='https://github.com/example/repo/pull/42')"), true, 'Supported GitHub views and fragments share one Alto PR destination')
    assert.equal(await run('externalClicks.length'), 0, 'Internal PR navigation prevents the browser default while still bubbling')
    assert.deepEqual(await run('openRequests[0]'), { direction: 'horizontal', kind: 'pull-request', resource: 'https://github.com/example/repo/pull/42', anchor: { workspaceId: 'workspace-1', paneId: 'origin-pane' }, workspace: '/repo', projectId: 'project-1' })
    await run("clickLink('root-link',{metaKey:true});clickLink('root-link',{ctrlKey:true});clickLink('root-link',{shiftKey:true});clickLink('root-link',{altKey:true});clickLink('checks-link');clickLink('external-link')")
    assert.equal(await run('openRequests.length'), 6, 'Modifiers, unsupported pages, and explicit browser links stay external')
    assert.equal(await run('externalClicks.length'), 6)
    await click('[aria-label="Open on GitHub"]')
    assert.equal(await run('openRequests.length'), 6, 'Explicit Open on GitHub stays external')
    assert.equal(await run('externalClicks.length'), 7)
    await click('.pull-request-heading a')
    assert.equal(await run('openRequests.length'), 6, 'The current PR title does not create a duplicate pane')
    assert.equal(await run('externalClicks.length'), 7, 'The current PR title does not launch a browser')
    await click('#fixture-markdown a span')
    assert.equal(await run('openRequests.length'), 7, 'A real shared Markdown PR link routes through the same interceptor')
    assert.deepEqual(await run('openRequests.at(-1)'), await run('openRequests[0]'))
    assert.deepEqual(await run('markdownReactClicks'), [true], 'Captured navigation still reaches React click handlers')
    assert.equal(await run('reactClosed.markdown'), 1, 'A parent React close handler still runs')
    await run('showDashboard()')
    assert.equal(await run('dashboardOpen()'), true)
    assert.match(await run("document.querySelector('#pull-requests-panel .pr-dashboard-row').getAttribute('aria-label')"), /in Alto/)
    await click('#pull-requests-panel .pr-dashboard-pr-title')
    assert.equal(await run('openRequests.length'), 8, 'The actual dashboard row opens its PR in Alto')
    assert.deepEqual(await run('dashboardReactClicks'), [true], 'Dashboard React handlers receive captured internal navigation')
    assert.equal(await run('reactClosed.dashboard'), 1)
    assert.equal(await run('dashboardOpen()'), false, 'The PR dashboard closes after internal navigation')
    assert.equal(await run('externalClicks.length'), 7)

    assert.equal(await run("!!document.querySelector('.pull-request-stack')"), false, 'A PR without a native stack does not show one')
    const diffsBeforeStackExpiry = await count('pull-request.diff')
    await run("setStackMode('full')")
    await run('pollPullRequests()')
    await until("!!document.querySelector('.pull-request-stack')&&!document.querySelector('[aria-label=\"Refresh diff\"]').disabled")
    assert.equal(await count('pull-request.diff'), diffsBeforeStackExpiry + 1, 'A newly visited PR revalidates its provisional patch after the freshness window')
    const diffCountBeforeStack = await count('pull-request.diff')
    assert.equal(await run("document.querySelector('.pull-request-stack').open"), true, 'Native stacks are expanded initially')
    assert.equal(await run("(()=>{const stack=document.querySelector('.pull-request-stack');return !!(stack.compareDocumentPosition(document.querySelector('.pull-request-status-list'))&Node.DOCUMENT_POSITION_FOLLOWING)&&!!(stack.compareDocumentPosition(document.querySelector('.pull-request-description'))&Node.DOCUMENT_POSITION_FOLLOWING)})()"), true, 'The native stack precedes PR status and description')
    assert.deepEqual(await run("[...document.querySelectorAll('.pull-request-stack-entry')].map(link=>Number(link.href.split('/').at(-1)))"), [41, 42, 44, 45], 'Native stack positions sort from the base branch')
    assert.deepEqual(await run("[...document.querySelectorAll('.pull-request-stack li')].map(item=>item.value)"), [1, 2, 3, 4])
    assert.equal(await run("document.querySelector('.pull-request-stack [aria-current=page]').getAttribute('href')"), 'https://github.com/example/repo/pull/44')
    assert.match(await run("document.querySelector('.pull-request-stack').textContent"), /Stack #7.*4 pull requests.*into main/s)
    assert.match(await run("document.querySelector('.pull-request-stack-entry[href$=\"/41\"]').textContent"), /Merged/)
    assert.match(await run("document.querySelector('.pull-request-stack-entry[href$=\"/45\"]').textContent"), /Draft/)
    assert.deepEqual(await run("[...document.querySelectorAll('.pull-request-stack-entry [role=img]')].map(icon=>icon.getAttribute('aria-label'))"), ['Checks passed', 'Checks failing', 'Checks running'])
    await run('pollPullRequests()')
    await until("!document.querySelector('[aria-label=\"Refresh pull request\"]').disabled&&!document.querySelector('[aria-label=\"Refresh diff\"]').disabled")
    assert.equal(await count('pull-request.diff'), diffCountBeforeStack, 'Stack-only metadata updates reuse a revalidated diff')
    await click('.pull-request-stack > summary')
    assert.equal(await run("document.querySelector('.pull-request-stack').open"), false)
    await click('.pull-request-stack > summary')
    const readsBeforeStackModifier = await count('pull-request.read')
    await run("clickStackMember(45,{metaKey:true})")
    assert.equal(await count('pull-request.read'), readsBeforeStackModifier, 'Command-clicking a stack member keeps the browser default')
    assert.equal(await run('externalClicks.length'), 8)
    assert.equal(await run('openRequests.length'), 8, 'A stack member modifier click does not create an Alto pane')
    assert.match(await run("document.querySelector('.pull-request-heading').textContent"), /PR 44/)
    await run("held.add('pull-request.diff');window.stackPane=document.querySelector('.pull-request-pane');clickStackMember(45)")
    await until("document.querySelector('.pull-request-heading')?.textContent.includes('PR 45')&&pending.some(request=>request.method==='pull-request.diff'&&request.payload.resource.endsWith('/45'))")
    assert.equal(await run("stackPane===document.querySelector('.pull-request-pane')"), true, 'Another stack member opens in the same PR pane')
    assert.equal(await run("document.querySelector('.pull-request-stack [aria-current=page]').getAttribute('href')"), 'https://github.com/example/repo/pull/45')
    assert.equal(await run("!!document.querySelector('.diff-viewer-code')"), false, 'The previous member patch is cleared while loading the selected member')
    assert.equal(await count('pull-request.diff'), diffCountBeforeStack + 1)
    assert.equal(await run("localStorage.getItem('alto.pull-request-pane.pr-pane')"), 'https://github.com/example/repo/pull/45')
    assert.equal(await run('openRequests.length'), 8, 'Selecting a stack member does not create an extra pane')
    assert.equal(await run('externalClicks.length'), 8, 'Selecting a stack member does not navigate the browser')
    await run("held.clear();release(pending.find(request=>request.method==='pull-request.diff'&&request.payload.resource.endsWith('/45')).id)")
    await until('!!diffRoot()')
    await run('restore()')
    await until("document.querySelector('.pull-request-heading')?.textContent.includes('PR 45')&&!!diffRoot()")
    assert.equal(await run("document.querySelector('.pull-request-stack [aria-current=page]').getAttribute('href')"), 'https://github.com/example/repo/pull/45', 'The chosen member survives restoring the original pane resource')
    const diffsBeforeStackStateExpiry = await count('pull-request.diff')
    await run("setStackMode('partial')")
    await run('pollPullRequests()')
    await until("document.querySelector('.pull-request-stack > p')?.textContent.includes('Showing 4 of 7')&&!document.querySelector('[aria-label=\"Refresh diff\"]').disabled")
    assert.equal(await count('pull-request.diff'), diffsBeforeStackStateExpiry + 1, 'The selected member also revalidates its initial provisional bytes after expiry')
    const diffCountBeforeStackStates = await count('pull-request.diff')
    await click('.pull-request-stack > p a')
    assert.equal(await run('externalClicks.length'), 9, 'Partial native stacks disclose the GitHub continuation as an explicit external link')
    assert.equal(await run('openRequests.length'), 8)
    await run("setStackMode('unavailable')")
    await run('pollPullRequests()')
    await until("!document.querySelector('.pull-request-stack')&&document.querySelector('.pull-request-summary').textContent.includes('Stack information is unavailable.')")
    assert.match(await run("document.querySelector('.pull-request-heading').textContent"), /PR 45/)
    assert.equal(await run('!!diffRoot()'), true, 'Unavailable stack metadata does not hide the PR or its changes')
    await run("setStackMode('none')")
    await run('pollPullRequests()')
    await until("!document.querySelector('[aria-label=\"Refresh pull request\"]').disabled&&!document.querySelector('.pull-request-summary').textContent.includes('Stack information is unavailable.')")
    assert.equal(await run("document.querySelector('.pull-request-summary').textContent.includes('Stack information is unavailable.')"), false, 'A later non-stack result removes the stale stack notice')
    assert.equal(await run("!!document.querySelector('.pull-request-stack')"), false)
    assert.equal(await count('pull-request.diff'), diffCountBeforeStackStates, 'Stack availability and completeness updates do not reload unchanged code')
    await run("setStackMode('full')")
    await run('pollPullRequests()')
    await until("!!document.querySelector('.pull-request-stack')")

    for (const theme of ['light', 'dark']) {
      for (const width of [1000, 420, 320]) {
        win.setContentSize(width, 820)
        await run(`document.documentElement.dataset.altoTheme=${JSON.stringify(theme)}`)
        await run("document.querySelector('.pull-request-summary-scroll').scrollTop=0")
        await until('!!diffRoot()')
        await frames()
        await assertContinuousPage()
        const geometry = await run('geometry()')
        assertFillsContainer(geometry)
        assert.ok(geometry.summary.inset >= 18, 'PR content retains a reading inset at every pane width: '+JSON.stringify(geometry))
        assert.ok(geometry.page <= width && geometry.pane.scroll <= width + 1, JSON.stringify(geometry))
        assert.ok(geometry.toolbar.height <= 40 && geometry.controls.every(control => control.left >= -1 && control.right <= width + 1), JSON.stringify(geometry))
        assert.ok(geometry.summary.scroll <= geometry.summary.width + 1, JSON.stringify(geometry))
        assert.ok(geometry.viewer.height >= 0.85 * geometry.viewportHeight && geometry.viewer.height <= 0.95 * geometry.viewportHeight, 'The inline diff uses a near-full viewport height: '+JSON.stringify(geometry))
        assert.ok(geometry.diff.height >= 300 && geometry.summary.scrollHeight > geometry.summary.height, 'The page scrolls around the bounded virtualized diff: '+JSON.stringify(geometry))
        assert.ok(geometry.description.bottom <= geometry.changes.top + 1 && geometry.changes.bottom <= geometry.discussion.top + 1, 'Description, diff, and discussion do not overlap: '+JSON.stringify(geometry))
        await capture(`page-top-${theme}-${width}`)
        await scrollToChanges()
        const changes = await run('geometry()')
        assertFillsContainer(changes)
        assert.ok(changes.page <= width && changes.pane.scroll <= width + 1 && changes.diff.right <= width + 1, JSON.stringify(changes))
        await capture(`inline-changes-${theme}-${width}`)
      }
    }
    await run('installDashboard()')
    await frames()
    const beforeNoise = await run('({...__prRenderCounts})')
    assert.ok(beforeNoise.pane > 0 && beforeNoise.markdown > 0 && beforeNoise.diff > 0 && beforeNoise.chrome > 0 && beforeNoise.list > 0,
      'The render counters cover the actual pane, shared Markdown/diff, and registered dashboard: ' + JSON.stringify(beforeNoise))
    for (let index = 0; index < 20; index++) await run('unrelatedHostChange()')
    await frames()
    const afterClosedNoise = await run('({...__prRenderCounts})')
    await run('showDashboard()')
    await frames()
    const beforeOpenNoise = await run('({...__prRenderCounts})')
    for (let index = 0; index < 20; index++) await run('unrelatedHostChange()')
    await frames()
    const afterOpenNoise = await run('({...__prRenderCounts})')
    const renderMetrics = { beforeNoise, afterClosedNoise, beforeOpenNoise, afterOpenNoise }
    console.log('PR render isolation: ' + JSON.stringify(renderMetrics))
    if (process.env.ALTO_PR_PANE_ARTIFACT_DIR) {
      await fs.writeFile(path.join(process.env.ALTO_PR_PANE_ARTIFACT_DIR, 'render-counts.json'), JSON.stringify(renderMetrics, null, 2))
    }
    for (const [before, after, state] of [[beforeNoise, afterClosedNoise, 'closed'], [beforeOpenNoise, afterOpenNoise, 'open']]) {
      assert.equal(after.parent - before.parent, 20, 'The subscribed host parent really rerenders for every unrelated event')
      for (const key of ['pane', 'markdown', 'diff', 'chrome', 'list']) assert.equal(after[key], before[key],
        `Unrelated host updates must not rerun ${key} with dashboard ${state}: ` + JSON.stringify(renderMetrics))
    }
    await run("dashboardSnapshot('Reactive PR snapshot after render isolation')")
    await until("document.querySelector('#pull-requests-panel .pr-dashboard-pr-title')?.textContent==='Reactive PR snapshot after render isolation'")
    assert.ok(await run('__prRenderCounts.list') > afterOpenNoise.list, 'The memo boundary still permits real PR store updates')
    await run('hideDashboard()')
    assert.equal(await count('diff-viewer.read'), 0, 'PR snapshots must never trigger local working tree reads')
    assert.equal(await count('diff-viewer.commits'), 0, 'PR snapshots must never fetch local commit choices')
    assert.equal(await count('file-tree.list'), 0, 'The changed files tree uses supplied paths')
    const disposed = await run('disposePr()')
    assert.equal(disposed.kinds.includes('pull-request'), false)
    assert.equal(disposed.style, false)
    await run("clickLink('root-link')")
    assert.equal(await run('openRequests.length'), 8, 'Disposal removes global PR link routing')
    assert.equal(await run('disposeDiff()'), false, 'The reusable diff renderer unloads with its owner')
    assert.deepEqual(await run('teardown()'), { components: [], styles: 0 })
    console.log('Pull request pane browser checks passed')
  } catch (error) {
    await capture('failure')
    console.error(await run('JSON.stringify(geometry())'))
    throw error
  } finally {
    win.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}

check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
