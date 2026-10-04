'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const A=require('./coding-adapter.cjs');
const J=require('./coding-java.cjs');
const {languageOf}=require('./coding-languages.cjs');
const MAX_OUTPUT=128*1024;
function execute(command,args,{cwd,input='',env=process.env,timeout=2500,signal}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(new Error('操作已取消。'));
    const child=spawn(command,args,{cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',bytes=0,reason=null,settled=false;
    const stop=message=>{
      if(reason)return;reason=message;
      if(child.pid&&process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore',shell:false}).on('error',()=>child.kill());
      else child.kill('SIGKILL');
    };
    const abort=()=>stop('操作已取消。');signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>stop('程序超时，已停止运行。'),timeout);
    const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    child.on('error',error=>{if(settled)return;settled=true;finish();reject(error);});
    child.on('close',code=>{if(settled)return;settled=true;finish();resolve({code,stdout,stderr,error:reason});});
    for(const [stream,key] of [[child.stdout,'stdout'],[child.stderr,'stderr']]){
      stream.setEncoding('utf8');stream.on('data',data=>{bytes+=Buffer.byteLength(data);if(bytes>MAX_OUTPUT)return stop('程序输出过多，已停止运行。');if(key==='stdout')stdout+=data;else stderr+=data;});
    }
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
function compareArguments(observed,expected,sig){
  if(observed.length!==expected.length)return `预期调用 ${expected.length} 次核心函数，实际 ${observed.length} 次。请检查 T 和循环。`;
  for(let i=0;i<expected.length;i++){
    if(!Array.isArray(observed[i])||observed[i].length!==sig.params.length)return `第 ${i+1} 组参数数量错误。`;
    for(let j=0;j<sig.params.length;j++)if(JSON.stringify(observed[i][j])!==JSON.stringify(expected[i][j]))return `第 ${i+1} 组 ${sig.params[j].name}\n预期：${JSON.stringify(expected[i][j])}\n实际：${JSON.stringify(observed[i][j])}`;
  }
  return null;
}
class CodingRunner {
  constructor(directory,{compiler=process.env.LEETTRACK_CXX||'g++',javaCompiler=process.env.LEETTRACK_JAVAC||(process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'javac.exe':'javac'):'javac'),processRunner=execute}={}){this.directory=path.resolve(directory);this.compiler=compiler;this.javaCompiler=javaCompiler;this.execute=processRunner;}
  environment(extra={},command=this.compiler){
    const env={...process.env,...extra};
    if(path.isAbsolute(command)){
      const key=Object.keys(extra).find(k=>k.toLowerCase()==='path')||Object.keys(env).find(k=>k.toLowerCase()==='path');
      const value=key?env[key]:'';for(const k of Object.keys(env))if(k.toLowerCase()==='path')delete env[k];
      env[process.platform==='win32'?'Path':'PATH']=path.dirname(command)+path.delimiter+(value||'');
    }
    return env;
  }
  javaCommand(){return path.isAbsolute(this.javaCompiler)?path.join(path.dirname(this.javaCompiler),process.platform==='win32'?'java.exe':'java'):'java';}
  async availability(language='cpp'){
    languageOf(language);
    if(language==='java'){
      const message='Java ACM 需要 JDK 17 或更新版本。在设置中选择 javac.exe；LeetCode 模式无需本地 JDK。';
      try{
        const results=await Promise.all([this.javaCompiler,this.javaCommand()].map(command=>this.execute(command,['-version'],{timeout:5000,env:this.environment({},this.javaCompiler)})));
        const versions=results.map(p=>(p.stdout+'\n'+p.stderr).trim());
        const available=results.every((p,i)=>p.code===0&&!p.error&&Number(versions[i].match(/(?:javac |version ")(\d+)/)?.[1])>=17);
        return {available,compiler:versions[0].split(/\r?\n/)[0]||this.javaCompiler,message:available?'':message};
      }catch{return {available:false,compiler:this.javaCompiler,message};}
    }
    try{const p=await this.execute(this.compiler,['--version'],{timeout:5000,env:this.environment()});return {available:p.code===0&&!p.error,compiler:p.stdout.split(/\r?\n/)[0]||this.compiler,message:p.code===0&&!p.error?'':'编译器无法运行，请在设置中重新选择 g++。'};}
    catch{return {available:false,compiler:this.compiler,message:'ACM 本地检查需要 g++。安装后，在这里选择 g++.exe；LeetCode 模式可直接使用。'};}
  }
  async job(core,main,operation,{signal,language='cpp'}={}){
    languageOf(language);
    if(typeof core!=='string'||typeof main!=='string'||core.length>200000||main.length>200000)throw new Error('代码内容无效或超过 200 KB。');
    await fs.mkdir(this.directory,{recursive:true});const dir=await fs.mkdtemp(path.join(this.directory,'job-'));
    try{
      if(language==='java'){
        const imports='import java.util.*;\nimport java.io.*;\nimport java.math.*;\n';
        await fs.copyFile(path.join(__dirname,'leettrack-java.java'),path.join(dir,'LT.java'));
        await fs.writeFile(path.join(dir,'Solution.java'),imports+core,'utf8');
        await fs.writeFile(path.join(dir,'Main.java'),imports+main,'utf8');
        let compilation;
        try{compilation=await this.execute(this.javaCompiler,['-J-Dfile.encoding=UTF-8','-J-Dsun.stdout.encoding=UTF-8','-J-Dsun.stderr.encoding=UTF-8','--release','17','-encoding','UTF-8','Main.java','Solution.java','LT.java'],{cwd:dir,timeout:30000,signal,env:this.environment({},this.javaCompiler)});}
        catch(error){if(error.code==='ENOENT')throw new Error('未找到 Java 编译器，请在设置中选择 JDK 的 javac.exe。');throw error;}
        if(compilation.code!==0||compilation.error)return {stage:'compile',passed:false,details:compilation.error||compilation.stderr||'Java 编译失败。'};
        return await operation({dir,execute:(input,extra={})=>this.execute(this.javaCommand(),['-Dfile.encoding=UTF-8','-Dsun.stdout.encoding=UTF-8','-Dsun.stderr.encoding=UTF-8','-Xmx128m','-cp',dir,'Main'],{cwd:dir,input,timeout:2500,signal,...extra,env:this.environment(extra.env,this.javaCompiler)})});
      }
      await fs.copyFile(path.join(__dirname,'leettrack-cpp.hpp'),path.join(dir,'leettrack.hpp'));
      await fs.writeFile(path.join(dir,'solution.cpp'),`#include "leettrack.hpp"\n${core}\n${main}`,'utf8');
      const program=path.join(dir,process.platform==='win32'?'solution.exe':'solution');
      let compilation;try{compilation=await this.execute(this.compiler,['-std=c++17','-O0','-Werror=return-type','solution.cpp','-o',program],{cwd:dir,timeout:30000,signal,env:this.environment()});}
      catch(error){if(error.code==='ENOENT')throw new Error('未找到 C++ 编译器，请在设置中查看本地编译状态。');throw error;}
      if(compilation.code!==0||compilation.error)return {stage:'compile',passed:false,details:compilation.error||compilation.stderr||'编译失败。'};
      return await operation({dir,program,execute:(input,extra={})=>this.execute(program,[],{cwd:dir,input,timeout:2500,signal,...extra,env:this.environment(extra.env)})});
    }finally{
      // A job path must be a direct child of our dedicated directory before removal.
      if(path.dirname(path.resolve(dir))!==this.directory)throw new Error('Invalid job cleanup path');
      await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});
    }
  }
  async check(problem,main,{signal}={}){
    const sig=problem.signature;if(!sig?.supported)throw new Error(sig?.reason||'这道题暂不支持 ACM。');
    const samples=A.examples(problem.examples,sig);const groups=[samples,samples.slice().reverse().concat(samples.slice(0,1))];
    const max=Math.max(...groups.map(x=>x.length));const returns=Array.from({length:max},(_,i)=>A.mockValue(sig.result,i,sig.name,sig.resultSize));
    return this.job((problem.language==='java'?J:A).mockCore(sig,returns),main,async job=>{
      const reports=[];let inputPassed=true,outputPassed=true;
      for(let i=0;i<groups.length;i++){
        if(signal?.aborted)throw new Error('操作已取消。');
        const expected=groups[i];const input=A.stdinFor(expected,sig,{loose:i===1});const trace=path.join(job.dir,'trace.jsonl');
        await fs.writeFile(trace,'','utf8');
        const execution=await job.execute(input,{env:{...process.env,LEETTRACK_TRACE_FILE:trace}});
        const file=await fs.stat(trace);if(file.size>MAX_OUTPUT)throw new Error('函数调用记录过多，已停止检查。');
        let observed=[];try{observed=(await fs.readFile(trace,'utf8')).trim().split(/\r?\n/).filter(Boolean).map(x=>JSON.parse(x));}catch{throw new Error('函数参数记录无法读取。');}
        const inputError=compareArguments(observed,expected,sig);
        const wanted=A.outputFor(returns.slice(0,expected.length).map((value,index)=>sig.isVoid?A.fitShape(value,expected[index][sig.outputIndex],sig.result):value),sig.result);
        const runtimeError=execution.error||(execution.code!==0?'程序异常退出（'+execution.code+'）。\n'+execution.stderr:null);
        const inputOk=!inputError&&!runtimeError;
        const outputOk=!runtimeError&&A.equalOutput(execution.stdout,wanted,sig.result);
        inputPassed&&=inputOk;outputPassed&&=outputOk;
        reports.push({name:i===0?'官方样例的参数':'多组输入与空白字符',inputPassed:inputOk,outputPassed:outputOk,inputError,runtimeError,input,expectedOutput:wanted,actualOutput:execution.stdout,stderr:execution.stderr});
      }
      return {stage:'io',passed:inputPassed&&outputPassed,inputPassed,outputPassed,cases:groups.reduce((n,x)=>n+x.length,0),reports};
    },{signal,language:problem.language||'cpp'});
  }
  async run(core,main,input,{signal,language='cpp'}={}){
    if(typeof input!=='string'||input.length>100000)throw new Error('输入无效或超过 100 KB。');
    return this.job(core,main,async job=>{const p=await job.execute(input);return {stage:'local',passed:!p.error&&p.code===0,stdout:p.stdout,stderr:p.stderr,details:p.error||(p.code!==0?'程序异常退出（'+p.code+'）。':'')};},{signal,language});
  }
}
module.exports={CodingRunner,execute,compareArguments};
