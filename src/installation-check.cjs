'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {CodingStore}=require('./coding-store.cjs');
const {CodingRunner}=require('./coding-runner.cjs');
module.exports=async({app,mainWindow,DATA,codingRunner,store,reviewStore})=>{
  if(!process.env.LEETTRACK_DATA_DIR)throw new Error('安装验证需要指定隔离数据目录。');
  const directory=path.join(DATA,'verification');await fs.mkdir(directory,{recursive:true});
  await mainWindow.webContents.executeJavaScript(`(async()=>{
    await new Promise(r=>setTimeout(r,150));
    if(!window.leettrack||!window.LeetCoding||!window.LeetEditor)throw new Error('Packaged renderer resources missing');
    if(document.getElementById('account-label').textContent!=='连接账号')throw new Error('Installer contains an account');
    const settings=document.getElementById('settings');document.getElementById('settings-open').click();
    await window.LeetCoding.ensureCompiler(true);
    if(!settings.open||!document.getElementById('coding-choose-compiler')||!document.getElementById('coding-choose-java-compiler'))throw new Error('Compiler setup is missing');
    if(document.getElementById('coding-language').options.length!==2)throw new Error('Language selector is missing');
    settings.close();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    if(document.documentElement.scrollWidth>innerWidth)throw new Error('Packaged layout overflows');
  })()`);
  await fs.writeFile(path.join(directory,'app.png'),(await mainWindow.webContents.capturePage()).toPNG());
  const account='installation-check';const at=Date.now();
  const records=[{id:'1',timestamp:Math.floor(at/1000),title:'Installation fixture',slug:'two-sum',status:'Accepted',pending:false}];
  await store.save({version:1,username:account,records,lastSync:new Date(at).toISOString(),historyComplete:true,historyCursor:null});
  assert.equal((await store.load(account)).records.length,1);
  const day=require('./practice.js').dayKey(at/1000);
  await reviewStore.upsert(account,{submissionId:'1',rating:'independent',at,day},['1']);
  assert.equal((await reviewStore.load(account)).feedback.length,1);
  const drafts=new CodingStore(path.join(DATA,'coding'));
  await drafts.save(null,{version:1,slug:'two-sum',core:'// Installation fixture',main:'',mode:'leetcode',input:''});
  assert.equal((await drafts.draft(null,'two-sum')).core,'// Installation fixture');
  await drafts.save(null,{version:1,language:'java',slug:'two-sum',core:'// Java installation fixture',main:'',mode:'leetcode',input:''});
  assert.equal((await drafts.draft(null,'two-sum','java')).core,'// Java installation fixture');
  assert.equal((await drafts.draft(null,'two-sum')).core,'// Installation fixture');
  const detected=await codingRunner.availability();let localRun=null;
  if(detected.available){localRun=await codingRunner.run('','int main(){cout << "installed C++ works";return 0;}','');assert.equal(localRun.stdout,'installed C++ works');assert.equal(localRun.passed,true);}
  const javaDetected=await codingRunner.availability('java');let javaRun=null;
  if(javaDetected.available){javaRun=await codingRunner.run('','public class Main {public static void main(String[] args){LT.printAnswer("installed Java works");}}','',{language:'java'});assert.equal(javaRun.stdout.trim(),'installed Java works');assert.equal(javaRun.passed,true);}
  const missing=new CodingRunner(path.join(DATA,'coding','missing-check'),{compiler:path.join(DATA,'nonexistent','g++.exe')});
  assert.equal((await missing.availability()).available,false);
  await fs.unlink(store.filename(account));await fs.unlink(reviewStore.filename(account));await fs.unlink(drafts.filename(null,'two-sum'));
  await fs.unlink(drafts.filename(null,'two-sum','drafts','java'));
  const report={packaged:app.isPackaged,version:app.getVersion(),dataDirectory:DATA,resourcesPath:process.resourcesPath,ui:true,records:true,reviews:true,drafts:true,compiler:detected,localRun:localRun?.passed??null,javaCompiler:javaDetected,javaRun:javaRun?.passed??null,missingCompilerHandled:true};
  await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2),'utf8');
  console.log('INSTALLATION_CHECK_OK',JSON.stringify(report));
};
