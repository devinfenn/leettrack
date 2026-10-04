'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
module.exports=async function check(coding,window,root,owner){
  const dir=path.join(root,'artifacts','coding-desktop');await fs.mkdir(dir,{recursive:true});
  try{
    if(!owner)throw new Error('应用尚未连接力扣账号。');
    const language=process.argv.includes('--verify-language=java')?'java':'cpp';
    const {problem}=await coding.load(owner,'two-sum',language);
    const code=language==='java'?'class Solution { public int[] twoSum(int[] nums,int target){ java.util.Map<Integer,Integer> seen=new java.util.HashMap<>(); for(int i=0;i<nums.length;i++){if(seen.containsKey(target-nums[i]))return new int[]{seen.get(target-nums[i]),i};seen.put(nums[i],i);}return new int[0];} }':'class Solution { public: vector<int> twoSum(vector<int>& nums,int target){ unordered_map<int,int> seen; for(int i=0;i<(int)nums.size();++i){if(seen.count(target-nums[i]))return {seen[target-nums[i]],i};seen[nums[i]]=i;}return {}; } };';
    const receipt=process.argv.find(x=>x.startsWith('--verify-run-id='))?.slice('--verify-run-id='.length);
    let result;
    if(receipt&&/^[\w.-]{1,160}$/.test(receipt)&&!['.','..'].includes(receipt)){
      coding.pending.set(receipt,{owner,slug:problem.slug,language,kind:'run'});result=await coding.resume(owner,receipt);
    }else result=await coding.run(owner,{slug:problem.slug,language,mode:'leetcode',core:code,input:problem.examples});
    await fs.writeFile(path.join(dir,'live-run-'+language+'.json'),JSON.stringify({...result,language,verification:'Only Run Code on LeetCode; no formal submission, no draft changes.'},null,2));
    console.log('CODING_LIVE_RUN',language,result.status,result.passed,result.correct,result.total);
    if(result.pending||!result.passed)throw new Error('力扣运行尚未通过，详情见 live-run.json。');
  }catch(error){await fs.writeFile(path.join(dir,'live-error.json'),JSON.stringify({message:error.message},null,2));console.error('CODING_LIVE_CHECK_FAILED',error.message);}
  await window.webContents.executeJavaScript(`document.querySelector('[data-view="coding"]').click()`);
  await new Promise(r=>setTimeout(r,2000));
  await fs.writeFile(path.join(dir,'ready.png'),(await window.webContents.capturePage()).toPNG());
};
