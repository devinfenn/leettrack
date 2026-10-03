'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const fs=require('node:fs/promises');
const {dataDirectory}=require('../src/app-paths.cjs');
const {CodingRunner}=require('../src/coding-runner.cjs');
test('installed data stays outside the read-only application archive and development records remain separate',()=>{
  const appData=path.join(os.tmpdir(),'leettrack-appdata');const root=path.join(os.tmpdir(),'Program Files','LeetTrack','resources','app.asar');
  assert.equal(dataDirectory({packaged:true,appData,root}),path.join(appData,'LeetTrack'));
  assert.equal(dataDirectory({packaged:false,appData,root}),path.join(root,'.local'));
  const isolated=path.join(os.tmpdir(),'leettrack-isolated');assert.equal(dataDirectory({packaged:true,appData,root,override:isolated,smoke:true}),path.join(isolated,'smoke'));
});
test('an explicitly selected compiler supplies its DLL directory for both compilation and program execution',async t=>{
  const compiler=process.env.LEETTRACK_TEST_CXX||(process.platform==='win32'?'D:/msys64/ucrt64/bin/g++.exe':null);
  if(!compiler||!(await fs.stat(compiler).catch(()=>null)))return t.skip('This check needs an absolute local g++ path');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'leettrack-installed-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));return fs.rm(dir,{recursive:true,force:true});});
  const runner=new CodingRunner(dir,{compiler});
  const original=runner.execute;
  runner.execute=(command,args,options)=>{
    const env=runner.environment({PATH:path.join(process.env.SystemRoot||'/usr','System32')});
    return original(command,args,{...options,env});
  };
  assert.equal((await runner.availability()).available,true);
  const result=await runner.run('','int main(){vector<string> v={"portable"};cout<<v[0];return 0;}','');
  assert.equal(result.passed,true,result.details);assert.equal(result.stdout,'portable');
});
