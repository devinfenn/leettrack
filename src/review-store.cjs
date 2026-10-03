const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const P=require('./practice.js');
class ReviewStore{
  constructor(directory){this.directory=directory;this.writes=Promise.resolve();}
  filename(username){return path.join(this.directory,crypto.createHash('sha256').update(username).digest('hex')+'.json');}
  async load(username){
    try{
      const data=JSON.parse(await fs.readFile(this.filename(username),'utf8'));
      if(data.version!==1 || data.username!==username || !Array.isArray(data.feedback) || data.feedback.some(x=>!x || typeof x.submissionId!=='string' || !/^\d+$/.test(x.submissionId) || !Object.hasOwn(P.ratingLabels,x.rating) || !Number.isFinite(x.at) || !Number.isFinite(new Date(x.at).getTime()) || x.day!==P.dayKey(x.at/1000)))throw new Error('invalid feedback');
      return data;
    }catch(error){
      if(error.code==='ENOENT')return {version:1,username,feedback:[]};
      throw new Error('复习反馈无法读取，原文件已保留。请检查本地复习数据。');
    }
  }
  upsert(username,entry,recordIds){
    const task=this.writes.catch(()=>{}).then(async()=>{
      const saved=await this.load(username);
      const ids=new Set(recordIds);
      const feedback=saved.feedback.filter(x=>!(x.day===entry.day&&ids.has(x.submissionId)));
      feedback.push(entry);
      const next={...saved,feedback};
      await fs.mkdir(this.directory,{recursive:true});const file=this.filename(username);
      await fs.writeFile(file+'.tmp',JSON.stringify(next,null,2),'utf8');await fs.rename(file+'.tmp',file);
      return next;
    });
    this.writes=task.catch(()=>{});return task;
  }
}
module.exports={ReviewStore};
