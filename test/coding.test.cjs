'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const A=require('../src/coding-adapter.cjs');
const {CodingRunner}=require('../src/coding-runner.cjs');
const {CodingStore}=require('../src/coding-store.cjs');
const {CodingService,normalizeProblem}=require('../src/coding.cjs');
const meta={name:'twoSum',params:[{name:'nums',type:'integer[]'},{name:'target',type:'integer'}],return:{type:'integer[]'}};
const raw={questionId:'1',questionFrontendId:'1',titleSlug:'two-sum',translatedTitle:'两数之和',difficulty:'Easy',content:'<p>Two sum</p>',metaData:JSON.stringify(meta),exampleTestcases:'[2,7,11,15]\n9\n[3,2,4]\n6\n[3,3]\n6',codeSnippets:[{langSlug:'cpp',code:'class Solution { public: vector<int> twoSum(vector<int>& nums, int target) { return {}; } };'}]};
const problem=normalizeProblem(raw);
async function folder(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'leettrack-coding-'));t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});return dir;}
function fakeService(store,overrides={}){
  let account='alice';const calls=[];
  const service=new CodingService({store,runner:{check:async()=>({passed:true,stage:'io',inputPassed:true,outputPassed:true}),run:async()=>({passed:true,stage:'local'})},getAccount:()=>account,identity:async()=>account,delay:async()=>{},request:async(route,opts)=>{calls.push({route,opts});if(route==='/graphql/')return {data:{question:raw}};if(route.endsWith('/submit/'))return {submission_id:123};if(route.endsWith('/interpret_solution/'))return {interpret_id:'run-456'};return {state:'SUCCESS',status_code:10,status_msg:'Accepted',correct_answer:true,total_correct:3,total_testcases:3};},...overrides});
  return {service,calls,setAccount:value=>{account=value;}};
}
test('metadata supports ordinary functions, lists and void output, and preserves LC-only questions',()=>{
  assert.equal(A.signature(meta).supported,true);assert.equal(A.typeOf('list<list<String>>').cpp,'vector<vector<string>>');
  assert.equal(A.signature({...meta,params:[{name:'root',type:'TreeNode'}]}).supported,false);
  assert.equal(A.signature({...meta,systemdesign:true}).supported,false);
  assert.equal(A.signature({...meta,params:[{name:'x);system("bad")',type:'int'}]}).supported,false);
  assert.equal(A.signature({...meta,return:{type:'void'},output:{paramindex:0}}).supported,true);
  assert.equal(A.signature({...meta,return:{type:'void'}}).supported,false);
  assert.equal(normalizeProblem({...raw,metaData:'invalid'}).core,raw.codeSnippets[0].code);
});
test('stdin conversion preserves quoted whitespace, empty strings, array lengths and Beijing-independent samples',()=>{
  const sig=A.signature({name:'solve',params:[{name:'words',type:'string[]'},{name:'s',type:'string'}],return:{type:'int'}});
  assert.equal(A.stdinFor([[['a b','c"d',''], ' leading ']],sig),'1\n3\n"a b" "c\\"d" ""\n" leading "\n');
  assert.equal(A.stdinFor([[['a b'],'']],sig,{loose:true}).includes('"a b"'),true);
  assert.throws(()=>A.examples('not json',sig));assert.throws(()=>A.examples('[1,2]\n9\n10',problem.signature));
});
test('output checker enforces row boundaries, extra output, strings and configurable floating tolerance',()=>{
  const integers=A.typeOf('integer[]');assert.equal(A.equalOutput('0 1  \r\n','0 1\n',integers),true);
  assert.equal(A.equalOutput('0\n1\n','0 1\n',integers),false);assert.equal(A.equalOutput('answer: 0 1','0 1',integers),false);
  assert.equal(A.equalOutput('1.2500000001\n','1.25\n',A.typeOf('double')),true);
  assert.equal(A.equalOutput('NaN','1.25',A.typeOf('double')),false);assert.equal(A.equalOutput('1.3','1.25',A.typeOf('double')),false);
});
test('C++ mock checks the actual main before any algorithm is written',async t=>{
  const dir=await folder(t),runner=new CodingRunner(dir);const checked=await runner.check(problem,problem.main);
  assert.equal(checked.passed,true,JSON.stringify(checked));assert.equal(checked.cases,7);assert.equal(checked.reports.length,2);assert.deepEqual(await fs.readdir(dir),[]);
});
test('C++ input check catches wrong arguments, incomplete T loops and never calling the core',async t=>{
  const runner=new CodingRunner(await folder(t));
  const badArgs=await runner.check(problem,problem.main.replace('Solution().twoSum(nums, target)','Solution().twoSum(nums, target + 1)'));
  assert.equal(badArgs.inputPassed,false);assert.equal(badArgs.outputPassed,true);assert.match(badArgs.reports[0].inputError,/target/);
  const badCount=await runner.check(problem,problem.main.replace('while (T--)','if (T--)'));
  assert.equal(badCount.inputPassed,false);assert.match(badCount.reports[0].inputError,/调用/);
  const missing=await runner.check(problem,'int main() { cout << "0 1\\n"; }');assert.equal(missing.inputPassed,false);
});
test('C++ output check distinguishes valid parsed input from wrong print separators',async t=>{
  const runner=new CodingRunner(await folder(t));
  const result=await runner.check(problem,problem.main.replace('printAnswer(answer);','for (int x : answer) cout << x << "\\n";'));
  assert.equal(result.inputPassed,true);assert.equal(result.outputPassed,false);assert.equal(result.passed,false);
});
test('C++ adapters handle bool vectors, quoted string matrices and character inputs',async t=>{
  const runner=new CodingRunner(await folder(t));
  for(const [params,result,example] of [
    [[{name:'flags',type:'boolean[]'}],'boolean[]','[true,false,true]'],
    [[{name:'words',type:'string[][]'},{name:'c',type:'character'}],'string[][]','[["a b","c\\\"d"],["中文",""]]\n"x"']
  ]){
    const p=normalizeProblem({...raw,metaData:JSON.stringify({name:'solve',params,return:{type:result}}),exampleTestcases:example});
    const checked=await runner.check(p,p.main);assert.equal(checked.passed,true,JSON.stringify(checked));
  }
});
test('C++ in-place functions check arguments before mutation and printing the modified parameter',async t=>{
  const runner=new CodingRunner(await folder(t));const p=normalizeProblem({...raw,metaData:JSON.stringify({...meta,return:{type:'void'},output:{paramindex:0}})});
  const main=p.main.replace('printAnswer(nums);','for(int i=0;i<lt_nums_n;++i){if(i)cout << " ";cout << nums[i];}cout << "\\n";');
  assert.equal((await runner.check(p,main)).passed,true);
});
test('local C++ execution uses real core code and reports compilation and runtime limits',async t=>{
  const runner=new CodingRunner(await folder(t));
  const code='class Solution { public: vector<int> twoSum(vector<int>& nums, int target) { for(int i=0;i<(int)nums.size();++i)for(int j=i+1;j<(int)nums.size();++j)if(nums[i]+nums[j]==target)return {i,j}; return {}; } };';
  const result=await runner.run(code,problem.main,problem.acmInput);assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.stdout.replace(/\r\n/g,'\n'),'0 1\n1 2\n0 1\n');
  const compile=await runner.run('not C++',problem.main,problem.acmInput);assert.equal(compile.stage,'compile');assert.equal(compile.passed,false);
  const runaway=await runner.run('', 'int main(){ while(true) {} }','');assert.equal(runaway.passed,false);assert.match(runaway.details,/超时/);
});
test('drafts persist exact code and remain isolated across accounts and restarts',async t=>{
  const dir=await folder(t),store=new CodingStore(dir);const draft={version:1,slug:'two-sum',core:'代码\n',main:problem.main,mode:'acm',input:problem.acmInput};
  await store.save('alice',draft);await store.save('bob',{...draft,core:'bob'});await store.save(null,{...draft,core:'local'});
  assert.equal((await new CodingStore(dir).draft('alice','two-sum')).core,'代码\n');assert.equal((await store.draft('bob','two-sum')).core,'bob');assert.equal((await store.draft(null,'two-sum')).core,'local');
  await Promise.all([store.save('alice',{...draft,core:'first'}),store.save('alice',{...draft,core:'last'})]);assert.equal((await store.draft('alice','two-sum')).core,'last');
});
test('corrupt drafts and invalid paths are preserved instead of overwritten',async t=>{
  const store=new CodingStore(await folder(t));const file=store.filename('alice','two-sum');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'damaged');
  await assert.rejects(store.draft('alice','two-sum'),/损坏/);await assert.rejects(store.save('alice',{version:1,slug:'two-sum',core:'',main:'',mode:'leetcode',input:''}),/损坏/);assert.equal(await fs.readFile(file,'utf8'),'damaged');
  assert.throws(()=>store.filename('alice','../escape'));assert.throws(()=>store.save('alice',{slug:'two-sum'}));
});
test('ACM submission gates IO and sends only the untouched core to LeetCode',async t=>{
  const fake=fakeService(new CodingStore(await folder(t)));await fake.service.load('alice','two-sum');const core='class Solution { /* user core */ };';
  const result=await fake.service.submit('alice',{slug:'two-sum',mode:'acm',core,main:problem.main});assert.equal(result.passed,true);
  const post=fake.calls.find(x=>x.route.endsWith('/submit/'));const body=JSON.parse(post.opts.body);assert.equal(body.typed_code,core);assert.equal(body.lang,'cpp');assert.equal(body.question_id,'1');assert.equal('main' in body,false);
  fake.service.runner.check=async()=>({passed:false});const before=fake.calls.length;
  assert.equal((await fake.service.submit('alice',{slug:'two-sum',mode:'acm',core,main:''})).kind,'blocked');assert.equal(fake.calls.length,before);
});
test('LC running uses official endpoint, test input and an honest wrong answer verdict',async t=>{
  const calls=[];const fake=fakeService(new CodingStore(await folder(t)),{request:async(route,opts)=>{calls.push({route,opts});if(route==='/graphql/')return {data:{question:raw}};if(route.endsWith('/interpret_solution/'))return {interpret_id:'runcode_1791023774.127549_OMJPBli8RM'};return {state:'SUCCESS',status_code:10,status_msg:'Accepted',correct_answer:false,compare_result:'101',code_answer:['[]'],expected_code_answer:['[0,1]']};}});
  await fake.service.load('alice','two-sum');const result=await fake.service.run('alice',{slug:'two-sum',mode:'leetcode',core:'class Solution {};',input:raw.exampleTestcases});
  assert.equal(result.passed,false);assert.equal(result.status,'Wrong Answer');assert.equal(JSON.parse(calls[1].opts.body).data_input,raw.exampleTestcases);assert.match(calls[2].route,/runcode_1791023774\.127549_OMJPBli8RM/);
});
test('poll failure preserves the receipt and resuming does not submit twice',async t=>{
  let polls=0,posts=0;const fake=fakeService(new CodingStore(await folder(t)),{request:async route=>{if(route==='/graphql/')return {data:{question:raw}};if(route.endsWith('/submit/')){posts++;return {submission_id:123};}if(++polls===1)throw new Error('offline');return {state:'SUCCESS',status_code:10,status_msg:'Accepted'};}});
  await fake.service.load('alice','two-sum');const first=await fake.service.submit('alice',{slug:'two-sum',mode:'leetcode',core:'class Solution {};'});assert.equal(first.pending,true);
  const loaded=await fake.service.load('alice','two-sum');assert.equal(loaded.pending[0].id,'123');const resumed=await fake.service.resume('alice','123');assert.equal(resumed.passed,true);assert.equal(posts,1);
});
test('account changes block remote actions while old drafts can finish saving to their original account',async t=>{
  const store=new CodingStore(await folder(t)),fake=fakeService(store);await fake.service.load('alice','two-sum');fake.setAccount('bob');
  await assert.rejects(fake.service.submit('alice',{slug:'two-sum',mode:'leetcode',core:'code'}),/切换/);
  await fake.service.save('alice',{version:1,slug:'two-sum',core:'alice draft',main:'',mode:'leetcode',input:''});assert.equal((await store.draft('alice','two-sum')).core,'alice draft');assert.equal(await store.draft('bob','two-sum'),null);
  await assert.rejects(fake.service.save('bob',{slug:'two-sum'}),/载入/);
});
test('cached problem and draft can be loaded offline without accepting inaccessible premium content',async t=>{
  const store=new CodingStore(await folder(t)),fake=fakeService(store);await fake.service.load('alice','two-sum');fake.service.request=async()=>{throw new Error('offline');};
  const result=await fake.service.load('alice','two-sum');assert.equal(result.cached,true);assert.equal(result.problem.slug,'two-sum');await assert.rejects(fake.service.load('alice','not-cached'),/offline/);
});
