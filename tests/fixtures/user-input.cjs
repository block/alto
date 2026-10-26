const { app, BrowserWindow } = require('./background-electron.cjs')
const { build } = require('esbuild')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

async function check() {
  await app.whenReady()
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: 'question-picker.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {ApprovalRequest} from './program/plugins/ui/inspectors';
      import {ActivityTimeline,activityFrom} from './program/plugins/ui/activity';
      import {ComposerSurface,ComposerPreferenceController,QuestionReplyButton} from './program/plugins/composer.client';
      import {ComposerActions} from './program/plugins/composer-actions';
      import {ComposerReplies} from './program/plugins/composer-replies';
      import {QuestionComposerContext} from './program/plugins/ui/question-composer';
      const root=createRoot(document.getElementById('root'));
      const sample={id:42,method:'item/tool/requestUserInput',receivedAt:'2026-09-09T00:00:00Z',params:{
        threadId:'chat-one',turnId:'turn-one',itemId:'item-one',isBlocking:true,
        questions:[{id:'scope',header:'Scope',question:'Where should I apply this change?',isOther:true,options:[
          {label:'This workspace (Recommended)',description:'Update the current project and leave other workspaces unchanged.'},
          {label:'All workspaces',description:'Apply the same change across every project.'}
        ]}]
      }};
      window.calls=[];
      window.request=structuredClone(sample);
      let extra;
      window.replyMode='success';
      const resolve=async(id,result)=>{
        window.calls.push({id,result});
        if(window.replyMode==='error')throw new Error('Temporary transport failure');
        if(window.replyMode==='deferred')await new Promise(r=>window.finishReply=r);
      };
      window.render=()=>flushSync(()=>root.render(<>
        <ApprovalRequest request={window.request} resolve={resolve}/>
        {extra && <ApprovalRequest request={extra} resolve={resolve}/>}</>));
      window.reset=(params={})=>{
        window.request={...structuredClone(sample),id:window.request.id+1,params:{...structuredClone(sample.params),...params}};
        extra=undefined;window.calls=[];window.replyMode='success';window.render();
      };
      window.addSecond=()=>{extra={...structuredClone(sample),id:91,params:{...structuredClone(sample.params),threadId:'chat-two'}};window.render()};
      window.click=selector=>flushSync(()=>document.querySelector(selector).click());
      window.type=(selector,value)=>flushSync(()=>{
        const input=document.querySelector(selector);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
        input.dispatchEvent(new Event('input',{bubbles:true}));
      });
      window.submit=()=>flushSync(()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      window.teardown=()=>flushSync(()=>root.unmount());
      const asyncListeners=new Set();
      let asyncState={threadId:'chat-one',activities:[],turn:{tag:'running'},connected:true,canAcceptDirectInput:true};
      const asyncSession={snapshot:()=>asyncState,subscribe:fn=>{asyncListeners.add(fn);return()=>asyncListeners.delete(fn)},
        steer:async draft=>{window.calls.push({kind:'steer',draft});if(window.replyMode==='error')throw new Error('Failed')},
        send:async draft=>{window.calls.push({kind:'send',draft})}};
      window.showAsync=(withOptions=false)=>{
        window.calls=[];window.replyMode='success';
        const item=activityFrom({method:'item/completed',params:{threadId:'chat-one',turnId:'turn-async',item:{
          id:withOptions?'options-question':'text-question',type:'agentMessage',phase:'final_answer',delivery:'async',
          text:'What should I check next?',questions:[{title:'What should I check next?',options:withOptions?['Composer','Sidebar']:null}]
        }}});
        flushSync(()=>root.render(<ActivityTimeline items={[item]} active={asyncState.turn.tag!=='idle'} session={asyncSession}/>));
      };
      window.finishAsyncTurn=()=>flushSync(()=>{asyncState={...asyncState,turn:{tag:'idle'}};for(const fn of asyncListeners)fn()});
      let composerRoot;
      const replies=new ComposerReplies();
      const composer={actions:new ComposerActions(),replies,focus:()=>{document.querySelector('[data-cordis-composer-editor]').focus();return true},attach:async()=>{}};
      const ReplyButton=props=><QuestionReplyButton {...props} composer={composer}/>;
      const questionUi={component:()=>ReplyButton};
      const preferences=new ComposerPreferenceController(false,{getItem:()=>null,setItem:()=>{}});
      window.showComposerQuestion=()=>{
        asyncState={...asyncState,turn:{tag:'running'},projects:[],skills:[],session:{workspace:'/tmp',permissionMode:'full'},harness:{codex:{status:'ready',models:[]}}};
        window.calls=[];window.replyMode='success';
        const item=activityFrom({method:'item/completed',params:{threadId:'chat-one',turnId:'composer-turn',item:{
          id:'composer-question',type:'agentMessage',phase:'final_answer',delivery:'async',text:'What should I check next?',
          questions:[{title:'What should I check next?',options:['Composer','Sidebar']}]
        }}});
        const items=[item];
        composerRoot??=createRoot(document.getElementById('composer-root'));
        flushSync(()=>{
          root.render(<QuestionComposerContext.Provider value={{ui:questionUi,session:asyncSession}}><ActivityTimeline items={items} active session={asyncSession}/></QuestionComposerContext.Provider>);
          composerRoot.render(<ComposerSurface surface={{id:'demo',kind:'composer',capabilities:[]}} session={asyncSession} composer={composer} preferences={preferences}
            draftStore={{read:()=>({message:'Existing draft',images:[],attachments:[]}),write:()=>{}}}
            submitDraft={async draft=>window.calls.push({kind:'queue',draft})}/>);
        });
      };
      window.typeComposer=text=>flushSync(()=>{
        const editor=document.querySelector('[data-cordis-composer-editor]');
        editor.textContent=text;editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
      });
      window.showAnsweredHistory=()=>{
        localStorage.removeItem('alto.answered-agent-questions');
        const question={id:'agent:chat-one:old-turn:item-1415',kind:'agent',title:'Codex',content:'How does this question picker feel?',timestamp:'',
          delivery:'async',questions:[{title:'How does this question picker feel?',options:['Looks good','Too large','Needs clearer contrast']}]};
        const reply={id:'user:next-turn:item-1',kind:'user',title:'You',content:'How does this question picker feel?\\nToo large',timestamp:''};
        flushSync(()=>root.render(<ActivityTimeline items={[question,reply]} session={asyncSession}/>));
      };
      window.showNativeComposerQuestion=()=>{
        window.calls=[];
        const request={id:'native-composer',method:'item/tool/requestUserInput',receivedAt:'',params:{threadId:'chat-one',questions:[{id:'answer',question:'Which file?',options:null}]}};
        flushSync(()=>root.render(<QuestionComposerContext.Provider value={{ui:questionUi,session:asyncSession}}><ApprovalRequest request={request} resolve={resolve}/></QuestionComposerContext.Provider>));
      };
      let chronologicalItems;
      let chronologicalActive=true;
      const renderChronological=()=>flushSync(()=>root.render(<ActivityTimeline items={chronologicalItems} active={chronologicalActive} session={asyncSession}/>));
      window.showChronologicalQuestion=(withTrace=false)=>{
        localStorage.removeItem('alto.answered-agent-questions');
        asyncState={...asyncState,turn:{tag:'running'}};
        chronologicalActive=true;
        chronologicalItems=[
          {id:'chronological-start',kind:'user',title:'You',content:'Adjust the panel',timestamp:''},
          {id:'chronological-before',kind:'agent',title:'Codex',content:'Progress before the question',phase:'commentary',timestamp:''},
          ...(withTrace?[
            {id:'chronological-reasoning',kind:'reasoning',title:'Thinking',content:'Check the panel layout',status:'completed',timestamp:''},
            {id:'chronological-tool',kind:'tool',title:'Read panel.tsx',content:'Panel source',status:'completed',timestamp:''},
          ]:[]),
          {id:'chronological-question',kind:'agent',title:'Codex',content:'Which panel?',timestamp:'',delivery:'async',questions:[{title:'Which panel?',options:['Composer','Sidebar']}]},
        ];
        renderChronological();
      };
      window.appendQuestionProgress=()=>{
        chronologicalItems=[...chronologicalItems,{id:'chronological-after',kind:'agent',title:'Codex',content:'Progress after the question',timestamp:''}];
        renderChronological();
      };
      window.foldQuestionProgress=()=>{
        chronologicalActive=false;
        chronologicalItems=[...chronologicalItems,
          {id:'chronological-final',kind:'agent',title:'Codex',content:'Finished adjusting the panel',phase:'final_answer',durationMs:1000,timestamp:''},
          {id:'chronological-next',kind:'user',title:'You',content:'Next task',timestamp:''},
        ];
        renderChronological();
      };
      window.sendChronologicalMessage=text=>{
        chronologicalActive=false;
        asyncState={...asyncState,turn:{tag:'idle'}};
        chronologicalItems=[...chronologicalItems,{id:'chronological-next',kind:'user',title:'You',content:text,timestamp:''}];
        renderChronological();
      };
      window.remountChronological=()=>{
        flushSync(()=>root.render(null));
        renderChronological();
      };
      document.getElementById('draft').focus();window.render();
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const css = (await Promise.all([
    'src/client/styles.css', 'program/plugins/ui/default.css', 'program/plugins/theme.css', 'program/plugins/ui/user-input.css',
  ].map(file => fs.readFile(file, 'utf8')))).join('\n').replace(/@import[^;]+;/g, '')
  const server = http.createServer((request, response) => {
    if (request.url === '/fonts/Inter[opsz,wght].ttf') {
      void fs.readFile('public/fonts/Inter[opsz,wght].ttf').then(bytes => response.end(bytes)).catch(() => { response.statusCode = 404; response.end() })
      return
    }
    response.end('<!doctype html><style>' + css + '</style><body style="background:var(--canvas);overflow:auto"><main style="max-width:768px;margin:auto;padding:18px"><p>Before I update the project, one choice:</p><div id="root"></div><div id="composer-root"></div><div contenteditable="plaintext-only" id="draft" aria-label="Composer draft">Keep this draft untouched</div></main></body>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const window = new BrowserWindow({ show: false, width: 1000, height: 760, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
  const run = code => window.webContents.executeJavaScript(code)
  const settle = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
  const captureAsync = async label => {
    for (const theme of ['light', 'dark']) {
      for (const width of [1000, 360]) {
        window.setContentSize(width, 760)
        await run(`document.documentElement.dataset.altoTheme='${theme}'`)
        await settle()
        const metrics = await run(`(()=>{const p=document.querySelector('.input-request')??document.querySelector('.activity-markdown'),r=p.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scroll:p.scrollWidth,client:p.clientWidth}})()`)
        assert.ok(metrics.left >= 0 && metrics.right <= metrics.width)
        assert.ok(metrics.scroll <= metrics.client)
        if (label === 'composer-reply') {
          const bounds = await run(`(()=>{const label=document.querySelector('.composer-question-reply').getBoundingClientRect(),composer=document.querySelector('.composer').getBoundingClientRect();return {bottom:label.bottom,top:composer.top,left:label.left,right:label.right,width:innerWidth}})()`)
          assert.ok(bounds.bottom <= bounds.top - 4, 'Reply label must stay above the composer: ' + JSON.stringify(bounds))
          assert.ok(bounds.left >= 0 && bounds.right <= bounds.width)
        }
        if (label === 'async-options') {
          const row = await run("document.querySelector('.input-question-option').getBoundingClientRect().height")
          assert.ok(row >= 32 && row <= 36, 'Simple choices should remain compact: ' + row)
        }
        if (process.env.ALTO_QUESTION_ARTIFACT_DIR) {
          await fs.mkdir(process.env.ALTO_QUESTION_ARTIFACT_DIR, { recursive: true })
          await fs.writeFile(path.join(process.env.ALTO_QUESTION_ARTIFACT_DIR, `${label}-${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
        }
      }
    }
  }
  try {
    await window.loadURL(`http://127.0.0.1:${server.address().port}`)
    await run(bundle.outputFiles[0].text)
    assert.equal(await run('document.activeElement.id'), 'draft')
    assert.equal(await run('document.querySelector("button[type=submit]").disabled'), true)
    assert.equal(await run('document.querySelectorAll("input:checked").length'), 0)
    await run('click(".input-question-option")')
    assert.equal(await run('calls.length'), 0, 'Selecting is not permission to send yet')
    assert.equal(await run('document.querySelector("button[type=submit]").disabled'), false)
    await run('document.getElementById("draft").focus();window.request=structuredClone(window.request);render()')
    assert.equal(await run('document.querySelector("input:checked").value'), 'This workspace (Recommended)')
    assert.equal(await run('document.activeElement.id'), 'draft', 'Snapshot refresh must not grab focus')

    // Native radio groups support arrow keys without document-wide shortcuts.
    await run('document.querySelector("input[type=radio]").focus()')
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' })
    await settle()
    assert.equal(await run('document.querySelector("input:checked").value'), 'All workspaces')
    await run("replyMode='deferred';submit();submit()")
    assert.equal(await run('calls.length'), 1)
    assert.deepEqual(await run('calls[0]'), { id: 42, result: { answers: { scope: { answers: ['All workspaces'] } } } })
    assert.equal(await run('document.querySelector("button[type=submit]").disabled'), true)
    await run('finishReply()')
    await settle()
    assert.equal(await run('document.querySelector("button[type=submit]").textContent'), 'Sent')
    await run('submit()')
    assert.equal(await run('calls.length'), 1)

    // A failed transport keeps the answer editable and allows an explicit retry.
    await run('reset();click(".input-question-option:last-child")')
    assert.equal(await run('document.querySelector("button[type=submit]").disabled'), true)
    await run('type(".input-question-custom input", "Only the toolbar");replyMode="error";submit()')
    await settle()
    assert.ok(await run('!!document.querySelector("[role=alert]")'))
    assert.equal(await run('document.querySelector(".input-question-custom input").value'), 'Only the toolbar')
    assert.equal(await run('document.querySelector("button[type=submit]").disabled'), false)
    await run('replyMode="success";submit()')
    await settle()
    assert.deepEqual(await run('calls[1].result'), { answers: { scope: { answers: ['Only the toolbar'] } } })

    // Multi-question requests require every answer. Secret input stays masked.
    await run(`reset({isBlocking:false,questions:[
      {id:'name',header:'Project',question:'Project name?',options:null},
      {id:'secret',header:'Credentials',question:'Access token?',isSecret:true,options:[]}
    ]})`)
    assert.equal(await run('document.querySelector("button[type=submit]").textContent'), 'Send answers')
    await run('type("input[type=text]", "Project name")')
    assert.equal(await run('document.querySelector("button[type=submit]").disabled'), true)
    await run('type("input[type=password]", "test-only-secret");submit()')
    await settle()
    assert.deepEqual(await run('calls[0].result'), { answers: { name: { answers: ['Project name'] }, secret: { answers: ['test-only-secret'] } } })

    // Two chats can ask the same question ID without sharing choices or replies.
    await run('reset();addSecond();click("form:nth-child(2) .input-question-option")')
    assert.equal(await run('document.querySelector("form:first-child button").disabled'), true)
    await run('click("form:nth-child(2) button[type=submit]")')
    await settle()
    assert.equal(await run('calls[0].id'), 91)

    await run('reset();click(".input-question-option")')
    for (const theme of ['light', 'dark']) {
      for (const width of [1000, 360]) {
        window.setContentSize(width, 760)
        await run(`document.documentElement.dataset.altoTheme='${theme}'`)
        await settle()
        const metrics = await run(`(()=>{const card=document.querySelector('form'),r=card.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth,cardScroll:card.scrollWidth,cardWidth:card.clientWidth,choiceCount:card.querySelectorAll('input[type=radio]').length,font:getComputedStyle(card).fontSize}})()`)
        assert.ok(metrics.left >= 0 && metrics.right <= metrics.width, JSON.stringify(metrics))
        assert.ok(metrics.scroll <= metrics.width)
        assert.ok(metrics.cardScroll <= metrics.cardWidth)
        assert.equal(metrics.choiceCount, 3)
        assert.equal(metrics.font, '14px')
        if (process.env.ALTO_QUESTION_ARTIFACT_DIR) {
          await fs.mkdir(process.env.ALTO_QUESTION_ARTIFACT_DIR, { recursive: true })
          await fs.writeFile(path.join(process.env.ALTO_QUESTION_ARTIFACT_DIR, `${theme}-${width}.png`), (await window.webContents.capturePage()).toPNG())
        }
      }
    }
    await run('replyMode="deferred";submit();reset();finishReply()')
    await settle()
    // Astra's actual async delivery bypasses server requests altogether.
    await run('document.getElementById("draft").focus();showAsync()')
    assert.equal(await run('document.activeElement.id'), 'draft')
    assert.equal(await run('document.querySelectorAll("input[type=radio]").length'), 0)
    assert.equal(await run('document.querySelector(".input-request")'), null)
    assert.equal(await run('document.querySelector(".activity-markdown").textContent'), 'What should I check next?')
    await captureAsync('async-text')
    await run('finishAsyncTurn();reset();showAsync()')
    assert.equal(await run('document.querySelector("form")'), null, 'Open-ended questions must remain normal text after remounting')
    await run('showAsync(true)')
    await captureAsync('async-options')
    await run('finishAsyncTurn()')
    assert.equal(await run('document.querySelectorAll("input[type=radio]").length'), 3)
    assert.equal(await run('document.querySelector(".input-request-heading").textContent'), 'A question for you')
    await run('click(".input-question-option");submit()')
    await settle()
    assert.equal(await run('calls.at(-1).kind'), 'send')
    await run('showAnsweredHistory()')
    assert.equal(await run('document.querySelector("form")'), null)
    assert.equal(await run('document.querySelector(".input-question-answer").textContent'), 'Too large', 'Saved replies must survive cleared browser storage')
    await captureAsync('answered-history')

    // A normal follow-up can arrive before a turn with a picker has a final answer.
    await run('reset();showChronologicalQuestion(true);click(".input-question-option")')
    await run('window.questionRow=document.querySelector("[data-activity-id=chronological-question]");sendChronologicalMessage("Keep the current panel")')
    assert.equal(await run('document.querySelector("[data-activity-id=chronological-before]")?.textContent.includes("Progress before the question")'), true, 'Sending a normal message must keep the previous response visible while a question is open')
    assert.equal(await run('document.querySelector("[data-activity-id=chronological-reasoning]")'), null, 'Previous reasoning can still fold into Details')
    assert.equal(await run('document.querySelector("[data-activity-id=chronological-tool]")'), null, 'Previous tool activity can still fold into Details')
    assert.equal(await run('questionRow===document.querySelector("[data-activity-id=chronological-question]")'), true, 'Sending a message must not remount the open question picker')
    assert.equal(await run('document.querySelector("input[type=radio]").checked'), true, 'Sending a message must preserve the selected answer')
    assert.equal(await run('!!(document.querySelector("[data-activity-id=chronological-before]").compareDocumentPosition(questionRow)&Node.DOCUMENT_POSITION_FOLLOWING)'), true, 'The response remains before its question')
    assert.equal(await run('document.querySelector("[data-activity-id=chronological-next]").textContent.includes("Keep the current panel")'), true)
    await run('remountChronological()')
    assert.equal(await run('!!document.querySelector("[data-activity-id=chronological-before]")'), true, 'Reloading older question history must also keep the response visible')
    assert.equal(await run('document.querySelector("[data-activity-id=chronological-tool]")'), null)
    await run('reset()')

    await run('showChronologicalQuestion();click(".input-question-option")')
    await run('window.questionRow=document.querySelector("[data-activity-id=chronological-question]");appendQuestionProgress()')
    assert.equal(await run('questionRow===document.querySelector("[data-activity-id=chronological-question]")'), true)
    assert.equal(await run('document.querySelector("input[type=radio]").checked'), true, 'New progress must preserve the selected answer')
    await run('submit()')
    await settle()
    assert.equal(await run('document.querySelector(".input-question-answer").textContent'), 'Composer')
    assert.equal(await run('!!(questionRow.compareDocumentPosition(document.querySelector("[data-activity-id=chronological-after]"))&Node.DOCUMENT_POSITION_FOLLOWING)'), true, 'Later progress must stay below the answered question')
    await captureAsync('answered-in-order')
    await run('foldQuestionProgress()')
    assert.equal(await run('document.querySelector("[data-activity-id=chronological-after]")'), null)
    assert.equal(await run('questionRow===document.querySelector("[data-activity-id=chronological-question]")'), true, 'Folding work must preserve the question card')
    await run('click(".activity-turn-summary")')
    assert.equal(await run('!!(questionRow.compareDocumentPosition(document.querySelector("[data-activity-id=chronological-after]"))&Node.DOCUMENT_POSITION_FOLLOWING)'), true)
    assert.equal(await run('document.querySelector(".input-question-answer").textContent'), 'Composer')

    // The custom choice on a picker still uses the real composer.
    await run('showComposerQuestion();click(".input-question-option:last-child")')
    assert.equal(await run('document.querySelector(".input-question-custom input")'), null)
    await run('click(".input-question-composer button")')
    assert.equal(await run('document.activeElement.hasAttribute("data-cordis-composer-editor")'), true)
    assert.equal(await run('document.querySelector("[data-cordis-composer-editor]").textContent'), 'Existing draft')
    assert.ok(await run('!!document.querySelector(".composer-question-reply")'))
    assert.equal(await run('document.querySelector(".send-button").title'), 'Send answer')
    await captureAsync('composer-reply')
    await run('typeComposer("The caret disappears");replyMode="error";click(".send-button")')
    await settle()
    assert.equal(await run('document.querySelector("[data-cordis-composer-editor]").textContent'), 'The caret disappears')
    assert.ok(await run('!!document.querySelector(".composer-question-reply [role=alert]")'))
    await run('replyMode="success";click(".send-button")')
    await settle()
    assert.equal(await run('calls.at(-1).kind'), 'steer', 'Question replies bypass the normal queue')
    assert.equal(await run('calls.at(-1).draft.text'), 'What should I check next?\nThe caret disappears')
    assert.equal(await run('document.querySelector(".input-question-answer").textContent'), 'The caret disappears')
    assert.equal(await run('document.querySelector(".composer-question-reply")'), null)
    await run('showNativeComposerQuestion();click(".input-question-composer button");typeComposer("app.ts")')
    await run('click(".composer-question-reply button")')
    assert.equal(await run('document.querySelector("[data-cordis-composer-editor]").textContent'), 'app.ts', 'Canceling a reply must not clear the draft')
    await run('click(".input-question-composer button");click(".send-button")')
    await settle()
    assert.deepEqual(await run('calls'), [{ id: 'native-composer', result: { answers: { answer: { answers: ['app.ts'] } } } }], 'Native questions must resolve their request, not create a new chat message')
    await run('teardown()')
    assert.equal(await run('document.getElementById("draft").textContent'), 'Keep this draft untouched')
    console.log('Agent question picker checks passed')
  } finally {
    window.destroy()
    await new Promise(resolve => server.close(resolve))
  }
}
check().then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
