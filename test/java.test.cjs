'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {normalizeProblem,CodingService}=require('../src/coding.cjs');
const {CodingRunner}=require('../src/coding-runner.cjs');
const {CodingStore}=require('../src/coding-store.cjs');
const core='class Solution { public int[] twoSum(int[] nums, int target) { Map<Integer,Integer> seen=new HashMap<>(); for(int i=0;i<nums.length;i++){if(seen.containsKey(target-nums[i]))return new int[]{seen.get(target-nums[i]),i};seen.put(nums[i],i);}return new int[0];} }';
const raw={questionId:'1',questionFrontendId:'1',titleSlug:'two-sum',translatedTitle:'两数之和',difficulty:'Easy',content:'<p>Two Sum</p>',metaData:JSON.stringify({name:'twoSum',params:[{name:'nums',type:'integer[]'},{name:'target',type:'integer'}],return:{type:'integer[]',size:2}}),exampleTestcases:'[2,7,11,15]\n9\n[3,2,4]\n6\n[3,3]\n6',codeSnippets:[{langSlug:'java',code:core},{langSlug:'cpp',code:'class Solution {};'}]};
const problem=normalizeProblem(raw,'java');
async function folder(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'leettrack-java-'));t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});return dir;}

test('Java metadata selects Java templates and preserves List versus array signatures',()=>{
  assert.equal(problem.language,'java');assert.equal(problem.core,core);assert.match(problem.main,/public class Main/);
  const list=normalizeProblem({...raw,metaData:JSON.stringify({name:'group',params:[{name:'words',type:'string[]'}],return:{type:'list<list<string>>'}}),exampleTestcases:'["a","b"]'},'java');
  assert.equal(list.signature.result.javaType.java,'List<List<String>>');assert.match(list.main,/List<List<String>> answer/);
  assert.throws(()=>normalizeProblem(raw,'python'),/Java 或 C/);
  assert.throws(()=>normalizeProblem({...raw,codeSnippets:raw.codeSnippets.slice(1)},'java'),/Java 模板/);
});

test('Java executes the real core and main and cleans its temporary classes',async t=>{
  const dir=await folder(t),runner=new CodingRunner(dir);
  assert.equal((await runner.availability('java')).available,true);
  const result=await runner.run(core,problem.main,problem.acmInput,{language:'java'});
  assert.equal(result.passed,true,JSON.stringify(result));assert.equal(result.stdout.replace(/\r\n/g,'\n'),'0 1\n1 2\n0 1\n');
  assert.deepEqual(await fs.readdir(dir),[]);
});

test('Java checks actual argument values, T loops and output formatting independently',async t=>{
  const runner=new CodingRunner(await folder(t));
  const valid=await runner.check(problem,problem.main);assert.equal(valid.passed,true,JSON.stringify(valid));assert.equal(valid.cases,7);
  const args=await runner.check(problem,problem.main.replace('twoSum(nums, target)','twoSum(nums, target + 1)'));
  assert.equal(args.inputPassed,false,JSON.stringify(args));assert.equal(args.outputPassed,true);assert.match(args.reports[0].inputError,/target/);
  const count=await runner.check(problem,problem.main.replace('while (T-- > 0)','if (T-- > 0)'));
  assert.equal(count.inputPassed,false,JSON.stringify(count));assert.match(count.reports[0].inputError,/调用/);
  const print=await runner.check(problem,problem.main.replace('            printAnswer(answer);','            System.out.println(Arrays.toString(answer));'));
  assert.equal(print.inputPassed,true,JSON.stringify(print));assert.equal(print.outputPassed,false);
  const missing=await runner.check(problem,'public class Main { public static void main(String[] args){System.out.println("0 1");} }');
  assert.equal(missing.inputPassed,false);
});

test('Java adapters compile and check strings, escaping, booleans, numbers, arrays and nested Lists',async t=>{
  const runner=new CodingRunner(await folder(t));
  for(const [params,result,example] of [
    [[{name:'flags',type:'boolean[]'}],'boolean[]','[true,false,true]'],
    [[{name:'words',type:'string[][]'},{name:'c',type:'character'}],'string[][]','[["a b","c\\\"d"],["中文","","\\\\"]]\n"x"'],
    [[{name:'values',type:'list<list<integer>>'}],'list<list<integer>>','[[1,2],[],[3]]'],
    [[{name:'words',type:'string[]'}],'list<list<string>>','["ab","ba",""]'],
    [[{name:'large',type:'long'},{name:'fraction',type:'double'},{name:'flag',type:'boolean'}],'long','4000000000\n1.25\ntrue'],
    [[{name:'value',type:'double'}],'double','0.5'],
    [[{name:'words',type:'list<string>'}],'list<string>','[]']
  ]){
    const p=normalizeProblem({...raw,metaData:JSON.stringify({name:'solve',params,return:{type:result}}),exampleTestcases:example},'java');
    const checked=await runner.check(p,p.main);assert.equal(checked.passed,true,result+' '+JSON.stringify(checked));
  }
});

test('Java in-place checks trace original arguments and retain ragged array shape',async t=>{
  const runner=new CodingRunner(await folder(t));
  for(const [type,input] of [['integer[]','[0,1,0,3,12]'],['character[][]','[["a","b"],[],["z"]]']]){
    const p=normalizeProblem({...raw,metaData:JSON.stringify({name:'solve',params:[{name:'values',type}],return:{type:'void'},output:{paramindex:0}}),exampleTestcases:input},'java');
    const result=await runner.check(p,p.main);assert.equal(result.passed,true,JSON.stringify(result));
  }
});

test('Java reports compiler errors, runtime errors, timeout and unavailable JDK',async t=>{
  const runner=new CodingRunner(await folder(t));
  const compile=await runner.run('not Java',problem.main,problem.acmInput,{language:'java'});assert.equal(compile.stage,'compile');assert.equal(compile.passed,false);
  assert.equal(compile.details.includes('\uFFFD'),false,'Compiler diagnostics must decode as UTF-8');
  const crash=await runner.run('', 'public class Main {public static void main(String[] args){throw new RuntimeException("fixture");}}','',{language:'java'});
  assert.equal(crash.passed,false);assert.match(crash.stderr,/fixture/);
  const runaway=await runner.run('', 'public class Main {public static void main(String[] args){while(true){}}}','',{language:'java'});
  assert.equal(runaway.passed,false);assert.match(runaway.details,/超时/);
  const missing=new CodingRunner(await folder(t),{javaCompiler:path.join(await folder(t),'missing','javac.exe')});
  assert.equal((await missing.availability('java')).available,false);
  assert.equal((await missing.availability('cpp')).available,true);
});

test('Java and legacy C++ drafts remain separate across accounts, corruption and restart',async t=>{
  const dir=await folder(t),store=new CodingStore(dir),base={version:1,slug:'two-sum',core:'legacy C++',main:'',mode:'leetcode',input:''};
  await store.save('alice',base);await store.save('alice',{...base,language:'java',core:'Java draft'});
  await store.save('bob',{...base,language:'java',core:'Bob Java'});
  const restarted=new CodingStore(dir);
  assert.equal((await restarted.draft('alice','two-sum')).core,'legacy C++');
  assert.equal((await restarted.draft('alice','two-sum','java')).core,'Java draft');
  assert.equal((await restarted.draft('bob','two-sum','java')).core,'Bob Java');
  await fs.writeFile(store.filename('alice','two-sum','drafts','java'),'damaged');
  await assert.rejects(store.draft('alice','two-sum','java'),/损坏/);
  await store.save('alice',{...base,core:'C++ still editable'});
  await assert.rejects(store.save('alice',{...base,language:'java'}),/损坏/);
  assert.equal((await store.draft('alice','two-sum')).core,'C++ still editable');
  assert.throws(()=>store.filename('alice','two-sum','drafts','../../escape'),/Java 或 C/);
});

test('Java remote requests preserve language and core, gate ACM IO and isolate pending receipts',async t=>{
  const store=new CodingStore(await folder(t));const calls=[];let ioPassed=true,offline=false,pollFails=false;
  const service=new CodingService({store,runner:{check:async p=>{assert.equal(p.language,'java');return {passed:ioPassed};}},getAccount:()=> 'alice',identity:async()=> 'alice',delay:async()=>{},request:async(route,options)=>{
    calls.push({route,options});if(offline)throw new Error('offline');
    if(route==='/graphql/')return {data:{question:raw}};
    if(route.endsWith('/interpret_solution/'))return {interpret_id:'java-run'};
    if(route.endsWith('/submit/'))return {submission_id:456};
    if(pollFails)throw new Error('temporary failure');
    return {state:'SUCCESS',status_code:10,status_msg:'Accepted',correct_answer:true};
  }});
  await service.load('alice','two-sum');await service.load('alice','two-sum','java');
  const payload={slug:'two-sum',language:'java',mode:'leetcode',core,main:problem.main,input:problem.examples};
  assert.equal((await service.run('alice',payload)).passed,true);
  for(const mode of ['leetcode','acm'])assert.equal((await service.submit('alice',{...payload,mode})).passed,true);
  for(const call of calls.filter(c=>/submit\/|interpret_solution\//.test(c.route))){const body=JSON.parse(call.options.body);assert.equal(body.lang,'java');assert.equal(body.typed_code,core);assert.equal('main' in body,false);}
  ioPassed=false;const count=calls.length;assert.equal((await service.submit('alice',{...payload,mode:'acm'})).kind,'blocked');assert.equal(calls.length,count);
  pollFails=true;assert.equal((await service.run('alice',payload)).pending,true);
  assert.equal((await service.load('alice','two-sum')).pending.length,0);
  assert.equal((await service.load('alice','two-sum','java')).pending[0].id,'java-run');
  pollFails=false;const posts=calls.filter(c=>c.route.endsWith('/interpret_solution/')).length;
  assert.equal((await service.resume('alice','java-run')).passed,true);
  assert.equal(calls.filter(c=>c.route.endsWith('/interpret_solution/')).length,posts);
  offline=true;assert.equal((await service.load('alice','two-sum','java')).problem.language,'java');
  await assert.rejects(service.submit('alice',{...payload,language:'python'}),/Java 或 C/);
});
