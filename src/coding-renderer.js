'use strict';
(()=>{
  const $=id=>document.getElementById(id),api=window.leettrack;
  const core=window.LeetEditor.create($('core-editor'),()=>changed('core'));
  const main=window.LeetEditor.create($('main-editor'),()=>changed('main'));
  let owner=null,loaded=null,mode='leetcode',busy=false,loading=false,loadSequence=0,saveTimer,saveSequence=0,savePromise=Promise.resolve(),restoring=false,compiler=null,pending=null,activeEditor='core',coreVersion=0,mainVersion=0;
  const inputs={leetcode:'',acm:''};let metadata=[];
  const errorText=error=>String(error.message||error).replace(/^Error invoking remote method '[^']+': Error: /,'');
  function message(text){$('coding-progress').textContent=text;}
  function showError(error){$('coding-result').textContent=errorText(error);consoleTab('result');message('操作未完成');}
  function draft(){return loaded?{version:1,slug:loaded.slug,core:core.get(),main:main.get(),mode,input:$('coding-input').value,inputs:{...inputs,[mode]:$('coding-input').value}}:null;}
  async function flush(){
    clearTimeout(saveTimer);const value=draft();if(!value){await savePromise.catch(()=>{});return true;}
    const account=loaded.owner,sequence=++saveSequence;$('coding-save-state').textContent='正在保存…';
    savePromise=api.codingSave(account,value);
    try{await savePromise;if(sequence===saveSequence){$('coding-save-state').textContent='已保存';$('coding-save-state').classList.remove('error');}return true;}
    catch(error){if(sequence===saveSequence){$('coding-save-state').textContent='草稿未保存';$('coding-save-state').classList.add('error');$('coding-save-state').title=errorText(error);message(errorText(error));}return false;}
  }
  function changed(which){
    if(restoring||!loaded)return;
    if(which==='core'){coreVersion++;status('core','未提交');}else{mainVersion++;status('input','待重新检查');status('output','待重新检查');}
    $('coding-save-state').textContent='未保存';clearTimeout(saveTimer);saveTimer=setTimeout(flush,350);
  }
  function status(part,text,passed){const n=$('coding-'+part+'-status');n.textContent=({input:'输入解析',output:'输出格式',core:'核心算法'}[part])+' · '+text;n.className=passed===true?'passed':passed===false?'failed':'';}
  function controls(){
    const ready=!!loaded&&!loading&&!busy;
    $('coding-run').disabled=$('coding-submit').disabled=$('coding-sample').disabled=!ready;
    $('coding-check').disabled=!ready||!compiler?.available||!loaded?.signature.supported;
    if(mode==='acm'&&!compiler?.available)$('coding-run').disabled=$('coding-submit').disabled=true;
    $('coding-picker-open').disabled=busy||loading;
    document.querySelectorAll('[data-mode]').forEach(n=>n.disabled=busy||loading);
    $('coding-stop').hidden=!busy;
    $('coding-run').textContent=pending?.kind==='run'?'继续查询':'运行样例';
    $('coding-submit').textContent=pending?.kind==='submit'?'继续查询':'提交力扣';
  }
  function editorTab(next){
    activeEditor=next;document.querySelectorAll('[data-editor]').forEach(n=>n.classList.toggle('active',n.dataset.editor===next));
    $('core-editor').hidden=next!=='core';$('main-editor').hidden=next!=='main';(next==='core'?core:main).measure();
  }
  function statementTab(which){$('coding-statement').hidden=which!=='statement';$('coding-contract').hidden=which!=='contract';$('coding-statement-tab').classList.toggle('active',which==='statement');$('coding-contract-tab').classList.toggle('active',which==='contract');}
  function consoleTab(which){$('coding-input-panel').hidden=which!=='input';$('coding-result-panel').hidden=which!=='result';$('coding-input-tab').classList.toggle('active',which==='input');$('coding-result-tab').classList.toggle('active',which==='result');}
  function setMode(next,{restore=false}={}){
    if(next==='acm'&&loaded&&!loaded.signature.supported){showError(loaded.signature.reason);return;}
    if(!restore)inputs[mode]=$('coding-input').value;
    mode=next;$('coding-input').value=inputs[mode]||'';
    document.querySelectorAll('[data-mode]').forEach(n=>{const active=n.dataset.mode===mode;n.classList.toggle('active',active);n.setAttribute('aria-pressed',String(active));});
    document.querySelector('[data-editor="main"]').hidden=mode!=='acm';
    $('coding-check').hidden=$('coding-contract-tab').hidden=mode!=='acm';$('coding-check-status').hidden=mode!=='acm';
    $('coding-input-hint').textContent=mode==='acm'?'ACM 模式：第一行 T；按左侧约定读取每组参数。':'LeetCode 模式：每个参数一行，与力扣站内格式一致。';
    if(mode!=='acm'&&activeEditor==='main')editorTab('core');
    if(mode!=='acm')statementTab('statement');
    message(mode==='acm'?'先检查读写，再提交核心算法':'核心算法由力扣评测');controls();if(!restore)changed('input');
  }
  async function open(slug,account=owner){
    if(busy){message('当前程序仍在运行，可先停止。');return false;}
    if(loaded&&loaded.slug===slug&&loaded.owner===account&&!loading){core.measure();main.measure();return true;}
    if(loaded&&!(await flush()))return false;
    const sequence=++loadSequence;loading=true;loaded=null;$('coding-loading').hidden=false;controls();
    $('coding-current-problem').textContent='正在载入…';
    try{
      const response=await api.codingLoad(account,slug);if(sequence!==loadSequence||account!==owner)return false;
      loaded={...response.problem,owner:account};const saved=response.draft;
      restoring=true;core.set(saved?.core??loaded.core);main.set(saved?.main??loaded.main);restoring=false;coreVersion=mainVersion=0;
      inputs.leetcode=saved?.inputs?.leetcode??loaded.examples;inputs.acm=saved?.inputs?.acm??loaded.acmInput;
      if(saved)inputs[saved.mode]=saved.input;
      pending=response.pending?.[0]||null;
      $('coding-current-problem').textContent=loaded.number+' · '+loaded.title;
      $('coding-title').textContent=loaded.title;
      const levels={Easy:'简单',Medium:'中等',Hard:'困难',EASY:'简单',MEDIUM:'中等',HARD:'困难'};
      $('coding-difficulty').textContent=loaded.number+' · '+(levels[loaded.difficulty]||loaded.difficulty);$('coding-difficulty').dataset.difficulty=loaded.difficulty;
      $('coding-statement').innerHTML=window.LeetEditor.sanitize(loaded.content||'<p>题目内容暂未提供，请点击“完整题目”查看。</p>');
      $('coding-contract').textContent=loaded.contract;$('coding-description-note').textContent=response.cached?'网络暂不可用，显示已缓存题目':'题目来自力扣中国站';
      $('coding-source').disabled=false;$('coding-save-state').textContent=saved?'已恢复草稿':'草稿保存在本地';$('coding-save-state').classList.toggle('error',!!response.draftError);
      for(const part of ['input','output','core'])status(part,part==='core'?'未提交':'未检查');
      $('coding-result').textContent='ACM 检查使用预设返回值，只检查读写；核心算法的正确性由力扣判定。';
      editorTab('core');statementTab('statement');consoleTab('input');setMode(saved?.mode==='acm'&&loaded.signature.supported?'acm':'leetcode',{restore:true});
      if(response.draftError)showError(response.draftError);
      return true;
    }catch(error){if(sequence===loadSequence){$('coding-current-problem').textContent='重新选择题目';showError(error);}return false;}
    finally{if(sequence===loadSequence){loading=false;$('coding-loading').hidden=true;controls();core.measure();}}
  }
  function displayCompiler(result){compiler=result;$('coding-compiler-state').textContent=compiler.available?compiler.compiler:compiler.message;$('coding-language').title=$('coding-compiler-state').textContent;controls();}
  async function ensureCompiler(force=false){
    if(compiler&&!force)return;try{displayCompiler(await api.codingCompiler());}catch(error){$('coding-compiler-state').textContent=errorText(error);}
  }
  function ioResult(result,version){
    if(result.stage==='compile'){status('input','未完成');status('output','未完成');return '输入输出编译失败\n'+result.details;}
    const stale=version!==mainVersion;
    status('input',stale?'代码已修改':result.inputPassed?'通过':'未通过',stale?undefined:result.inputPassed);
    status('output',stale?'代码已修改':result.outputPassed?'通过':'未通过',stale?undefined:result.outputPassed);
    let text=(result.passed?'输入解析和输出格式通过':'输入输出检查未通过')+' · '+result.cases+' 组\n使用官方样例参数、多组输入和不同空白字符；函数返回值为测试预设。';
    for(const report of result.reports||[]){if(report.inputError||report.runtimeError||!report.outputPassed){text+='\n\n'+report.name;if(report.inputError)text+='\n'+report.inputError;if(report.runtimeError)text+='\n'+report.runtimeError;if(!report.outputPassed)text+='\n预期打印：\n'+report.expectedOutput+'实际打印：\n'+(report.actualOutput||'（空）');}}
    if(stale)text+='\n\nmain 已修改，请重新检查。';return text;
  }
  function remoteResult(result,version){
    if(result.pending){pending={id:result.id,kind:result.kind};return result.status+'\n'+(result.details||'点击继续查询。');}
    pending=null;const stale=version!==coreVersion;
    if(result.kind==='submit')status('core',(stale?'旧版本 · ':'')+result.status,stale?undefined:result.passed);
    let text=(result.kind==='submit'?'力扣提交':'力扣运行')+' · '+result.status;
    if(result.correct!==null&&result.total!==null)text+='\n通过用例：'+result.correct+' / '+result.total;
    if(result.runtime)text+='\n耗时：'+result.runtime;if(result.memory)text+=' · 内存：'+result.memory;
    const values=x=>Array.isArray(x)?x.join('\n'):String(x||'');
    if(result.details)text+='\n\n'+result.details;if(result.input)text+='\n\n输入：\n'+values(result.input);if(result.actual)text+='\n实际：\n'+values(result.actual);if(result.expected)text+='\n预期：\n'+values(result.expected);if(values(result.stdout))text+='\n打印：\n'+values(result.stdout);
    if(result.kind==='submit')text+='\n\n提交编号：'+result.id;
    if(stale)text+='\n\n核心代码已修改，此结果对应提交时的版本。';return text;
  }
  async function action(kind){
    if(!loaded||busy||loading)return;
    if(kind!=='check'&&!(mode==='acm'&&kind==='run')&&!owner){await api.login();message('登录后，再点击运行或提交。');return;}
    if(!(await flush()))return;
    const snapshot=loaded,coreRev=coreVersion,mainRev=mainVersion;busy=true;controls();consoleTab('result');
    $('coding-result').textContent=kind==='check'?'正在检查输入输出…':'正在处理…';
    try{
      const payload={slug:loaded.slug,core:core.get(),main:main.get(),mode,input:$('coding-input').value};let result;
      if(pending&&pending.kind===(kind==='submit'?'submit':'run')&&kind!=='check')result=await api.codingPoll(owner,pending.id);
      else if(kind==='check')result=await api.codingCheck(owner,loaded.slug,payload.main);
      else result=await (kind==='submit'?api.codingSubmit(owner,payload):api.codingRun(owner,payload));
      if(loaded!==snapshot)return;
      let text;
      if(kind==='check')text=ioResult(result,mainRev);
      else if(result.stage==='compile')text='编译失败\n'+result.details;
      else if(result.stage==='local')text=(result.passed?'本地运行结束':'本地运行未完成')+'\n'+(result.stdout||'（没有输出）')+(result.stderr?'\n'+result.stderr:'')+(result.details?'\n'+result.details:'');
      else{const io=result.io?ioResult(result.io,mainRev)+'\n\n':'';text=io+(result.kind==='blocked'?result.details:remoteResult(result,coreRev));}
      $('coding-result').textContent=text;message(result.pending?'可继续查询评测结果':kind==='check'&&result.passed?'输入输出检查通过':'处理完成');
    }catch(error){if(loaded===snapshot)showError(error);}
    finally{if(loaded===snapshot){busy=false;controls();}}
  }
  function picker(){
    const all=new Map();for(const plan of window.LEETTRACK_CATALOG)for(const q of plan.questions)all.set(q.slug,q);for(const q of metadata)if(q.slug)all.set(q.slug,{...q,id:q.id||q.number});
    const query=$('coding-search').value.trim(),search=query.toLowerCase();let direct=null;
    try{const url=new URL(query);if(url.hostname==='leetcode.cn'&&url.protocol==='https:')direct=url.pathname.match(/^\/problems\/([a-zA-Z0-9_-]+)(?:\/|$)/)?.[1];}catch{if(/^[a-zA-Z0-9_-]*-[a-zA-Z0-9_-]+$/.test(query))direct=query;}
    const rows=[...all.values()].filter(q=>(q.id+' '+q.title+' '+q.slug).toLowerCase().includes(search)).slice(0,40);
    if(direct&&!rows.some(q=>q.slug===direct))rows.unshift({id:'↗',title:'打开 '+direct,slug:direct});
    $('coding-search-results').replaceChildren();
    for(const q of rows){const button=document.createElement('button'),number=document.createElement('span'),title=document.createElement('span');number.textContent=q.id||'—';title.textContent=q.title;button.append(number,title);button.onclick=()=>{$('coding-picker').close();void open(q.slug);};$('coding-search-results').append(button);}
    if(!rows.length){const note=document.createElement('p');note.textContent='没有匹配结果，可粘贴力扣题目链接。';$('coding-search-results').append(note);}
  }
  function updateAccount(account,extra=[]){
    metadata=extra;const next=account||null;if(owner===next)return;
    const previous=loaded;void flush();owner=next;loadSequence++;loaded=null;pending=null;loading=false;busy=false;void api.codingCancel();
    restoring=true;core.set('');main.set('');restoring=false;inputs.leetcode=inputs.acm='';$('coding-loading').hidden=true;$('coding-source').disabled=true;
    $('coding-current-problem').textContent='选择一道题';$('coding-title').textContent='从一道题开始';$('coding-statement').textContent='账号已切换，重新选择题目后载入对应草稿。';controls();
    if(!document.getElementById('coding-page').hidden)void open(previous?.slug||'two-sum',next);
  }
  $('coding-picker-open').onclick=()=>{$('coding-search').value='';picker();$('coding-picker').showModal();$('coding-search').focus();};$('coding-picker-close').onclick=()=>$('coding-picker').close();$('coding-search').oninput=picker;
  $('coding-search').onkeydown=event=>{if(event.key==='Enter')$('coding-search-results').querySelector('button')?.click();};
  $('coding-picker').onclick=event=>{if(event.target===$('coding-picker')){const r=$('coding-picker').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('coding-picker').close();}};
  document.querySelectorAll('[data-mode]').forEach(n=>n.onclick=()=>setMode(n.dataset.mode));document.querySelectorAll('[data-editor]').forEach(n=>n.onclick=()=>editorTab(n.dataset.editor));
  $('coding-statement-tab').onclick=()=>statementTab('statement');$('coding-contract-tab').onclick=()=>statementTab('contract');$('coding-input-tab').onclick=()=>consoleTab('input');$('coding-result-tab').onclick=()=>consoleTab('result');
  $('coding-input').oninput=()=>{inputs[mode]=$('coding-input').value;changed('input');};$('coding-sample').onclick=()=>{if(loaded){inputs[mode]=mode==='acm'?loaded.acmInput:loaded.examples;$('coding-input').value=inputs[mode];changed('input');}};
  $('coding-source').onclick=()=>loaded&&api.openProblem(loaded.slug);
  $('coding-statement').onclick=event=>{const link=event.target.closest('a');if(link){event.preventDefault();if(loaded)void api.openProblem(loaded.slug);}};
  $('coding-check').onclick=()=>action('check');$('coding-run').onclick=()=>action('run');$('coding-submit').onclick=()=>action('submit');$('coding-stop').onclick=()=>{void api.codingCancel();message('正在停止…');};
  $('coding-choose-compiler').onclick=async()=>{const button=$('coding-choose-compiler');button.disabled=true;try{const result=await api.codingChooseCompiler();if(result)displayCompiler(result);}catch(error){$('coding-compiler-state').textContent=errorText(error);}finally{button.disabled=false;}};
  $('coding-compiler-guide').onclick=()=>api.codingCompilerGuide();
  api.onCodingProgress(progress=>{if(loaded&&progress.slug===loaded.slug&&progress.owner===loaded.owner)message(progress.message);});
  document.addEventListener('keydown',event=>{
    if($('coding-page').hidden)return;
    if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void action(event.shiftKey?'submit':'run');}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();void flush();}
  });
  window.LeetCoding={open,flush,updateAccount,ensureCompiler,activate:()=>{void ensureCompiler();if(!loaded&&!loading)void open('two-sum');else{core.measure();main.measure();}},editors:{core,main}};
})();
