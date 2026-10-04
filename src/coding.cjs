'use strict';
const A=require('./coding-adapter.cjs');
const J=require('./coding-java.cjs');
const {languageOf,languages}=require('./coding-languages.cjs');
const problemKey=(owner,slug,language='cpp')=>(owner||'@local')+':'+slug+':'+languageOf(language);
const {validSlug}=require('./coding-store.cjs');
const QUESTION_QUERY='query LeetTrackCodingQuestion($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId questionFrontendId title titleSlug translatedTitle content translatedContent difficulty isPaidOnly sampleTestCase exampleTestcases metaData codeSnippets { langSlug code } } }';
const errorText=error=>String(error.message||error).replace(/^Error invoking remote method '[^']+': Error: /,'');
function startError(start,kind){
  const message=[start?.error,start?.message,start?.msg,start?.detail].filter(x=>typeof x==='string').join(' · ').slice(0,1000);
  return new Error(`力扣未返回${kind==='run'?'运行':'提交'}编号。${message||'接口字段：'+Object.keys(start||{}).join(', ')}${kind==='run'?'；编号值：'+(JSON.stringify(start?.interpret_id)??'缺失').slice(0,300):''}`);
}
function normalizeProblem(q,language='cpp'){
  languageOf(language);
  if(!q||!validSlug(q.titleSlug)||!/^\d+$/.test(String(q.questionId))||!Array.isArray(q.codeSnippets))throw new Error('题目接口格式发生变化，未载入代码。');
  const core=q.codeSnippets.find(x=>x.langSlug===language)?.code;
  if(typeof core!=='string')throw new Error('这道题没有 '+languages[language].label+' 模板。');
  const sig=A.signature(q.metaData);const input=String(q.exampleTestcases||q.sampleTestCase||'');
  let samples=[],reason=null;
  if(sig.supported)try{samples=A.examples(input,sig);}catch(error){reason=errorText(error);}
  const effective=reason?{supported:false,reason}:sig;
  return {language,slug:q.titleSlug,questionId:String(q.questionId),number:String(q.questionFrontendId||q.questionId),title:q.translatedTitle||q.title,difficulty:q.difficulty,content:q.translatedContent||q.content||'',paidOnly:!!q.isPaidOnly,core,signature:effective,examples:input,main:(language==='java'?J:A).mainTemplate(effective),acmInput:effective.supported?A.stdinFor(samples,effective):'',contract:A.contract(effective),fetchedAt:new Date().toISOString()};
}
function normalizedVerdict(body,kind,id){
  const verdicts={10:'Accepted',11:'Wrong Answer',12:'Memory Limit Exceeded',13:'Output Limit Exceeded',14:'Time Limit Exceeded',15:'Runtime Error',20:'Compile Error'};
  const passed=Number(body.status_code)===10&&(kind==='submit'||body.correct_answer===true||(typeof body.compare_result==='string'&&/^1+$/.test(body.compare_result)));
  return {kind,id,pending:false,passed,status:kind==='run'&&Number(body.status_code)===10&&!passed?'Wrong Answer':body.status_msg||verdicts[body.status_code]||'评测完成',correct:body.total_correct??null,total:body.total_testcases??null,runtime:body.status_runtime||null,memory:body.status_memory||null,details:body.full_compile_error||body.compile_error||body.full_runtime_error||'',input:body.last_testcase||body.input_data||'',actual:body.code_answer||body.code_output||'',expected:body.expected_code_answer||body.expected_output||'',stdout:body.std_output||body.std_output_list||''};
}
class CodingService{
  constructor({store,runner,request,identity,getAccount,onProgress=()=>{},onSubmitted=()=>{},delay=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>Date.now()}){
    Object.assign(this,{store,runner,request,identity,getAccount,onProgress,onSubmitted,delay,now});this.problems=new Map();this.pending=new Map();this.active=null;
  }
  assertOwner(owner){if((owner||null)!==(this.getAccount()||null))throw new Error('账号已切换，请重新打开编程页。');}
  async load(owner,slug,language='cpp'){
    languageOf(language);
    this.assertOwner(owner);if(!validSlug(slug))throw new Error('请选择有效题目。');
    let problem,cached=false;
    try{
      const data=await this.request('/graphql/',{method:'POST',body:JSON.stringify({query:QUESTION_QUERY,variables:{titleSlug:slug}})});
      if(data.errors)throw new Error('题目接口暂不可用，请稍后重试。');
      if(data.data?.question?.isPaidOnly&&!data.data.question.content&&!data.data.question.translatedContent)throw new Error('这道题需要力扣会员权限。');
      problem=normalizeProblem(data.data?.question,language);if(problem.slug!==slug)throw new Error('题目响应与所选题目不一致，未载入代码。');await this.store.cacheProblem(owner,problem).catch(()=>{});
    }catch(error){problem=await this.store.cachedProblem(owner,slug,language);if(!problem)throw error;cached=true;}
    this.assertOwner(owner);this.problems.set(problemKey(owner,slug,language),problem);
    let draft=null,draftError=null;try{draft=await this.store.draft(owner,slug,language);}catch(error){draftError=errorText(error);}
    this.assertOwner(owner);return {problem,draft,draftError,cached,pending:[...this.pending].filter(([,p])=>p.owner===owner&&p.slug===slug&&(p.language||'cpp')===language).map(([id,p])=>({id,kind:p.kind,language}))};
  }
  async save(owner,draft){if(!this.problems.has(problemKey(owner,draft?.slug,draft?.language)))throw new Error('请先载入对应账号的题目。');return this.store.save(owner,draft);}
  problem(owner,slug,language='cpp'){this.assertOwner(owner);const problem=this.problems.get(problemKey(owner,slug,language));if(!problem)throw new Error('请先载入题目。');return problem;}
  async task(owner,slug,fn){
    if(this.active)throw new Error('已有程序在运行，请等待或停止。');
    const controller=new AbortController();this.active={owner,slug,controller};
    const progress=(stage,message)=>this.onProgress({owner,slug,stage,message});
    try{return await fn(controller.signal,progress);}finally{this.active=null;}
  }
  cancel(){this.active?.controller.abort();return !!this.active;}
  dispose(){this.cancel();}
  async check(owner,slug,main,language='cpp'){const problem=this.problem(owner,slug,language);return this.task(owner,slug,async(signal,progress)=>{progress('io','正在检查输入解析与输出格式…');return this.runner.check(problem,main,{signal});});}
  async run(owner,payload){
    if(!['leetcode','acm'].includes(payload?.mode))throw new Error('编程模式无效。');
    const language=languageOf(payload.language),problem=this.problem(owner,payload.slug,language);this.validateCode(payload.core);
    if(payload.mode==='acm')return this.task(owner,payload.slug,async(signal,progress)=>{progress('local','正在本地编译运行…');return this.runner.run(payload.core,payload.main,payload.input,{signal,language});});
    return this.task(owner,payload.slug,async(signal,progress)=>{
      await this.authenticate(owner);progress('remote','正在力扣运行样例…');
      if(typeof payload.input!=='string'||!payload.input.trim()||payload.input.length>100000)throw new Error('请填写有效的力扣测试输入。');
      const start=await this.request(`/problems/${problem.slug}/interpret_solution/`,{method:'POST',body:JSON.stringify({lang:language,question_id:problem.questionId,typed_code:payload.core,data_input:payload.input})});
      const id=String(start.interpret_id||'');if(!/^[\w.-]{1,160}$/.test(id)||['.','..'].includes(id))throw startError(start,'run');
      this.pending.set(id,{owner,slug:problem.slug,language,kind:'run'});return this.poll(owner,id,{signal,progress});
    });
  }
  validateCode(code){if(typeof code!=='string'||!code.trim()||code.length>200000)throw new Error('请填写核心代码，最多 200 KB。');}
  async authenticate(owner){
    this.assertOwner(owner);if(!owner)throw new Error('先连接力扣账号，再运行或提交。');
    const current=await this.identity();if(current!==owner)throw new Error('力扣账号已变更，请先同步再提交。');this.assertOwner(owner);
  }
  async submit(owner,payload){
    if(!['leetcode','acm'].includes(payload?.mode))throw new Error('编程模式无效。');
    const language=languageOf(payload.language),problem=this.problem(owner,payload.slug,language);this.validateCode(payload.core);
    return this.task(owner,payload.slug,async(signal,progress)=>{
      let io=null;
      if(payload.mode==='acm'){
        progress('io','提交前检查输入输出…');io=await this.runner.check(problem,payload.main,{signal});
        if(!io.passed)return {kind:'blocked',io,details:'输入输出检查未通过，修正后再提交。'};
      }
      if(signal.aborted)throw new Error('操作已取消。');await this.authenticate(owner);
      progress('remote','正在提交核心算法到力扣…');
      if(signal.aborted)throw new Error('操作已取消。');this.assertOwner(owner);
      let start;try{start=await this.request(`/problems/${problem.slug}/submit/`,{method:'POST',body:JSON.stringify({lang:language,question_id:problem.questionId,questionSlug:problem.slug,typed_code:payload.core})});}
      catch(error){throw new Error(errorText(error)+'\n未确认提交编号，请先在力扣查看是否收到提交，再重试。');}
      const id=String(start.submission_id||'');if(!/^\d+$/.test(id))throw new Error(startError(start,'submit').message+'\n请先在站内检查是否已收到，避免重复提交。');
      this.pending.set(id,{owner,slug:problem.slug,language,kind:'submit'});
      const result=await this.poll(owner,id,{signal,progress});if(!result.pending)void this.onSubmitted(owner);
      return {...result,io};
    });
  }
  async poll(owner,id,{signal,progress=()=>{}}={}){
    const pending=this.pending.get(id);if(!pending||pending.owner!==owner)throw new Error('没有待查询的评测结果。');
    const started=this.now();let lastError=null;
    for(let i=0;i<40&&this.now()-started<60000;i++){
      if(signal?.aborted)return {...pending,id,pending:true,status:'已停止等待，可继续查询'};
      this.assertOwner(owner);
      try{
        const data=await this.request(`/submissions/detail/${id}/check/`,{method:'GET'});
        if(data.state==='SUCCESS'||data.finished===true){this.pending.delete(id);return normalizedVerdict(data,pending.kind,id);}
        if(!['PENDING','STARTED'].includes(data.state))throw new Error('评测接口格式发生变化。');
        progress('remote','力扣正在评测…');
      }catch(error){lastError=errorText(error);break;}
      await this.delay(1500);
    }
    return {...pending,id,pending:true,status:'评测结果待查询',details:lastError||'力扣仍在处理，点击继续查询；不会重复提交代码。'};
  }
  async resume(owner,id){
    return this.task(owner,this.pending.get(id)?.slug,async(signal,progress)=>{
      await this.authenticate(owner);const result=await this.poll(owner,id,{signal,progress});if(result.kind==='submit'&&!result.pending)void this.onSubmitted(owner);return result;
    });
  }
}
module.exports={CodingService,normalizeProblem,normalizedVerdict,QUESTION_QUERY};
