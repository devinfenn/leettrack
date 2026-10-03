'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
module.exports=async function check(coding,window,root,owner){
  const dir=path.join(root,'artifacts','coding-desktop');await fs.mkdir(dir,{recursive:true});
  try{
    if(!owner)throw new Error('应用尚未连接力扣账号。');
    const {problem}=await coding.load(owner,'two-sum');
    const code='class Solution { public: vector<int> twoSum(vector<int>& nums,int target){ unordered_map<int,int> seen; for(int i=0;i<(int)nums.size();++i){if(seen.count(target-nums[i]))return {seen[target-nums[i]],i};seen[nums[i]]=i;}return {}; } };';
    const receipt=process.argv.find(x=>x.startsWith('--verify-run-id='))?.slice('--verify-run-id='.length);
    let result;
    if(receipt&&/^[\w.-]{1,160}$/.test(receipt)&&!['.','..'].includes(receipt)){
      coding.pending.set(receipt,{owner,slug:problem.slug,kind:'run'});result=await coding.resume(owner,receipt);
    }else result=await coding.run(owner,{slug:problem.slug,mode:'leetcode',core:code,input:problem.examples});
    await fs.writeFile(path.join(dir,'live-run.json'),JSON.stringify({...result,verification:'Only Run Code on LeetCode; no formal submission, no draft changes.'},null,2));
    console.log('CODING_LIVE_RUN',result.status,result.passed,result.correct,result.total);
    if(result.pending||!result.passed)throw new Error('力扣运行尚未通过，详情见 live-run.json。');
  }catch(error){await fs.writeFile(path.join(dir,'live-error.json'),JSON.stringify({message:error.message},null,2));console.error('CODING_LIVE_CHECK_FAILED',error.message);}
  await window.webContents.executeJavaScript(`document.querySelector('[data-view="coding"]').click()`);
  await new Promise(r=>setTimeout(r,2000));
  await fs.writeFile(path.join(dir,'ready.png'),(await window.webContents.capturePage()).toPNG());
};
