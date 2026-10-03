const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {normalizeSubmission,parsePage,mergeRecords,collectPages,Store} = require('../src/sync.cjs');
const raw = (id, extra={}) => ({id, timestamp:1780000000+id,title:'两数之和',title_slug:'two-sum',status_display:'Accepted',lang:'python3',...extra});
const page=(ids,has_next=false,last_key='')=>({submissions_dump:ids.map(id=>raw(id)),has_next,last_key});

test('China submissions endpoint omits title_slug: retain title and submission identity',()=>{
  const item=normalizeSubmission({id:12345,title:'Two Sum',timestamp:1780000000,lang:'cpp',status_display:'Accepted',url:'/submissions/detail/12345/',is_pending:false});
  assert.equal(item.slug,null);assert.equal(item.title,'Two Sum');assert.equal(item.id,'12345');
  assert.equal(normalizeSubmission(raw(2,{is_pending:'Not Pending'})).pending,false);
  assert.equal(normalizeSubmission(raw(2,{is_pending:'Pending'})).pending,true);
  assert.throws(()=>normalizeSubmission({id:12345,timestamp:1780000000}));
});

test('record whitelist excludes source code and session fields',()=>{
  const result=normalizeSubmission(raw(1,{code:'secret code',cookie:'secret session'}));
  assert.equal(result.id,'1');assert.equal(result.title,'两数之和');assert.equal(result.code,undefined);assert.equal(result.cookie,undefined);
});
test('repeat sync is idempotent and pending verdict can change',()=>{
  const first=mergeRecords([], [normalizeSubmission(raw(1,{is_pending:true,status_display:'Pending'}))]);
  const second=mergeRecords(first.records,[normalizeSubmission(raw(1))]);
  assert.equal(second.added,0);assert.equal(second.updated,1);assert.equal(second.records.length,1);assert.equal(second.records[0].pending,false);
  assert.equal(mergeRecords(second.records,second.records).updated,0);
});
test('new submissions accumulate without replacing older records',()=>{
  const result=mergeRecords([normalizeSubmission(raw(1))],[normalizeSubmission(raw(2))]);
  assert.deepEqual(result.records.map(x=>x.id),['2','1']);assert.equal(result.added,1);
});
test('malformed payload fails instead of being treated as an empty successful sync',()=>{
  for(const data of [{}, {submissions_dump:[],has_next:true},{submissions_dump:[{id:3}],has_next:false}]) assert.throws(()=>parsePage(data));
});
test('pagination passes cursor and offset; capped run preserves continuation',async()=>{
  const requests=[];
  const result=await collectPages(async args=>{requests.push(args);return page([args.offset+1],true,'cursor-'+args.offset);},[],{maxPages:2});
  assert.deepEqual(requests,[{offset:0,lastKey:'',limit:20},{offset:1,lastKey:'cursor-0',limit:20}]);
  assert.deepEqual(result.cursor,{offset:2,lastKey:'cursor-1'});assert.equal(result.complete,false);
  const next=await collectPages(async args=>{assert.equal(args.offset,2);assert.equal(args.lastKey,'cursor-1');return page([3]);},[],{cursor:result.cursor,stopAtKnown:false});
  assert.equal(next.complete,true);assert.equal(next.cursor,null);
});
test('incremental sync overlaps two pages and detects pending changes',async()=>{
  const old=[1,2,3].map(id=>normalizeSubmission(raw(id)));
  let calls=0;
  const result=await collectPages(async()=>{calls++;return page(calls===1?[4,3]:[2,1],true);},old);
  assert.equal(calls,2);assert.equal(result.caughtUp,true);assert.equal(result.complete,false);
});
test('repeated pagination is rejected to avoid looping or false completeness',async()=>{
  await assert.rejects(()=>collectPages(async()=>page([1],true),[]),/重复/);
});
test('network error halfway through does not return a false completed result',async()=>{
  let n=0;await assert.rejects(()=>collectPages(async()=>{if(n++)throw new Error('offline');return page([1],true);},[]), error=>{
    assert.equal(error.message,'offline');assert.equal(error.partial.complete,false);
    assert.equal(error.partial.records.length,1);assert.equal(error.partial.cursor.offset,1);return true;
  });
});
test('records persist across Store instances and accounts are isolated',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'leettrack-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const store=new Store(dir);const a=await store.load('account-A');a.records=[normalizeSubmission(raw(1))];await store.save(a);
  assert.equal((await new Store(dir).load('account-A')).records.length,1);
  assert.equal((await store.load('account-B')).records.length,0);
  await fs.writeFile(store.filename('account-A'),'corrupt');
  await assert.rejects(()=>store.load('account-A'),/原文件/);
  assert.equal(await fs.readFile(store.filename('account-A'),'utf8'),'corrupt');
});
test('pending verdict beyond the overlap is refreshed before stopping incremental sync',async()=>{
  const old=[1,2,3,4].map(id=>normalizeSubmission(raw(id,{is_pending:id===3})));
  let calls=0;const result=await collectPages(async()=>page([++calls],true),old);
  assert.equal(calls,4);assert.equal(result.caughtUp,true);assert.equal(result.records.find(x=>x.id==='3').pending,false);
});
test('valid JSON with invalid saved records is rejected without overwriting',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'leettrack-invalid-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const store=new Store(dir);const saved=await store.load('A');saved.records=[{id:'bad',timestamp:'x',title:'题目'}];await store.save(saved);
  const original=await fs.readFile(store.filename('A'),'utf8');await assert.rejects(()=>store.load('A'),/保留原文件/);assert.equal(await fs.readFile(store.filename('A'),'utf8'),original);
  saved.records=[];saved.problemMetadata={invalid:true};await store.save(saved);await assert.rejects(()=>store.load('A'),/保留原文件/);
});
