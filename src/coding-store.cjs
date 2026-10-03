'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const validSlug=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,120}$/.test(s);
const ownerKey=owner=>crypto.createHash('sha256').update(owner||'@local').digest('hex');
function validDraft(draft){return draft?.version===1&&validSlug(draft.slug)&&['leetcode','acm'].includes(draft.mode)&&['core','main'].every(k=>typeof draft[k]==='string'&&draft[k].length<=200000)&&typeof draft.input==='string'&&draft.input.length<=100000&&(draft.inputs==null||['leetcode','acm'].every(k=>typeof draft.inputs[k]==='string'&&draft.inputs[k].length<=100000));}
class CodingStore{
  constructor(directory){this.directory=directory;this.writes=new Map();this.damaged=new Set();}
  filename(owner,slug,kind='drafts'){if(!validSlug(slug))throw new Error('题目标识无效。');return path.join(this.directory,kind,ownerKey(owner),slug+'.json');}
  async draft(owner,slug){
    const file=this.filename(owner,slug);await this.writes.get(file)?.catch(()=>{});
    try{const data=JSON.parse(await fs.readFile(file,'utf8'));if(!validDraft(data)||data.slug!==slug)throw new Error('invalid draft');return data;}
    catch(error){if(error.code==='ENOENT')return null;this.damaged.add(file);throw new Error('本地草稿损坏，原文件已保留。请先复制编辑内容备份。');}
  }
  save(owner,draft){
    if(!validDraft(draft))throw new Error('草稿内容无效。');const file=this.filename(owner,draft.slug);
    const write=(this.writes.get(file)||Promise.resolve()).catch(()=>{}).then(async()=>{
      if(this.damaged.has(file))throw new Error('损坏的草稿未被覆盖，请先备份并处理原文件。');
      await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';
      try{await fs.writeFile(tmp,JSON.stringify({...draft,updatedAt:new Date().toISOString()}),'utf8');await fs.rename(tmp,file);}finally{await fs.unlink(tmp).catch(()=>{});}
      return {saved:true};
    });this.writes.set(file,write);return write;
  }
  async cachedProblem(owner,slug){try{return JSON.parse(await fs.readFile(this.filename(owner,slug,'problems'),'utf8'));}catch{return null;}}
  async cacheProblem(owner,problem){const file=this.filename(owner,problem.slug,'problems');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(problem),'utf8');}
}
module.exports={CodingStore,validSlug,validDraft};
