const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Tracker}=require('../src/tracker.cjs');
const {normalizeSubmission}=require('../src/sync.cjs');
const P=require('../src/practice.js');
const plans=require('../src/catalog.js');
const NOW=Date.parse('2026-10-03T12:00:00+08:00');
const raw=(id,extra={})=>({id,timestamp:NOW/1000-id*60,title:'Problem '+id,title_slug:'problem-'+id,status_display:'Accepted',is_pending:false,...extra});
const result=(items,hasNext=false)=>({submissions_dump:items,has_next:hasNext,last_key:hasNext?'cursor-'+items.at(-1).id:''});
class MemoryStore{
  constructor(){this.accounts=new Map();this.writes=[];}
  async load(username){return structuredClone(this.accounts.get(username) || {version:1,username,records:[],lastSync:null,historyComplete:false,historyCursor:null});}
  async save(data){this.accounts.set(data.username,structuredClone(data));this.writes.push(structuredClone(data));}
}
function setup(options={}){
  const clock={now:NOW};const timers=[];const store=new MemoryStore();
  const tracker=new Tracker({store,identify:async()=> 'A',fetchPage:async()=>result([]),now:()=>clock.now,setTimer:(cb,delay)=>{const timer={cb,delay};timers.push(timer);return timer;},clearTimer:timer=>{const i=timers.indexOf(timer);if(i>=0)timers.splice(i,1);},...options});
  return {tracker,store,timers,clock};
}
async function seed(store,records,cursor=null){const saved=await store.load('A');await store.save({...saved,records:records.map(normalizeSubmission),lastSync:new Date(NOW-60000).toISOString(),historyCursor:cursor});store.writes=[];}
function paginated(rows,requests){return async args=>{requests.push(args);const slice=rows.slice(args.offset,args.offset+args.limit);return result(slice,args.offset+slice.length<rows.length);};}

test('new submissions and pending verdict updates drive daily count and review completion',async()=>{
  const prior=raw(1,{title:'两数之和',title_slug:null,timestamp:Date.parse('2026-10-02T12:00:00+08:00')/1000});
  const old=[...Array.from({length:59},(_,i)=>raw(60-i,{status_display:'Wrong Answer',timestamp:Date.parse('2026-10-02T12:00:00+08:00')/1000})),prior];
  let newRows=[raw(62,{title:'两数之和',title_slug:null,status_display:'Wrong Answer'}),raw(61,{title:'两数之和',title_slug:null,is_pending:true,status_display:'Pending'}),...old];
  const {tracker,store}=setup({fetchPage:async args=>result(newRows.slice(args.offset,args.offset+20),args.offset+20<newRows.length)});
  await seed(store,old,{offset:60,lastKey:'older'});await tracker.restore('A');
  await tracker.sync();
  assert.equal(tracker.state.result.added,2);assert.equal(tracker.state.records.length,62);
  let q=P.aggregate(tracker.state.records,plans).find(x=>x.slug==='two-sum');assert.equal(q.practicedDays,2);assert.equal(q.successfulDays,1);
  assert.equal(P.reviewQueue(tracker.state.records,plans,'2026-10-03').find(x=>x.question.slug==='two-sum').done,false);
  assert.deepEqual(tracker.state.historyCursor,{offset:60,lastKey:'older'});
  newRows=newRows.map(x=>x.id===61?{...x,is_pending:false,status_display:'Accepted'}:x);
  await Promise.all([tracker.sync(),tracker.sync(),tracker.sync()]);
  assert.equal(tracker.state.result.added,0);assert.equal(tracker.state.result.updated,1);assert.equal(tracker.state.records.length,62);
  q=P.aggregate(tracker.state.records,plans).find(x=>x.slug==='two-sum');assert.equal(q.practicedDays,2);assert.equal(q.successfulDays,2);
  assert.equal(q.nextReview,'2026-10-06');assert.equal(P.reviewQueue(tracker.state.records,plans,'2026-10-03').find(x=>x.question.slug==='two-sum').done,true);
  tracker.dispose();
});
test('one history action spans batches and a completed history action does not refetch',async()=>{
  const requests=[];const rows=Array.from({length:241},(_,i)=>raw(1000-i));
  const {tracker,store}=setup({fetchPage:paginated(rows,requests)});
  await seed(store,rows.slice(0,20),{offset:20,lastKey:'initial'});await tracker.restore('A');await tracker.fillHistory();
  assert.equal(requests[0].offset,20);assert.equal(tracker.state.records.length,241);assert.equal(tracker.state.historyComplete,true);assert.equal(tracker.state.historyCursor,null);
  assert.equal(tracker.state.historyProgress.pages,12);assert.equal(store.writes[0].records.length,220);assert.equal(store.writes.at(-1).records.length,241);
  const n=requests.length;await tracker.fillHistory();assert.equal(requests.length,n);tracker.dispose();
});
test('history pause saves the current page and a new instance resumes from the stored cursor',async()=>{
  const rows=Array.from({length:81},(_,i)=>raw(1000-i));const requests=[];let tracker;
  const context=setup({fetchPage:async args=>{requests.push(args);tracker.pauseHistory();return result(rows.slice(args.offset,args.offset+20),true);}});tracker=context.tracker;
  await seed(context.store,rows.slice(0,20),{offset:20,lastKey:'initial'});await tracker.restore('A');await tracker.fillHistory();
  assert.equal(requests.length,1);assert.equal(tracker.state.records.length,40);assert.equal(tracker.state.historyCursor.offset,40);assert.match(tracker.state.message,/暂停/);assert.equal(tracker.state.historyRunning,false);tracker.dispose();
  const next=setup({store:context.store,fetchPage:paginated(rows,requests)});await next.tracker.restore('A');await next.tracker.fillHistory();
  assert.equal(requests[1].offset,40);assert.equal(next.tracker.state.records.length,81);assert.equal(next.tracker.state.historyComplete,true);next.tracker.dispose();
});
test('a failed later history page preserves partial data and resumes without duplicates',async()=>{
  const rows=Array.from({length:81},(_,i)=>raw(1000-i));const requests=[];let fail=true;
  const {tracker,store}=setup({fetchPage:async args=>{requests.push(args);if(fail&&args.offset===40)throw new Error('offline');return result(rows.slice(args.offset,args.offset+20),args.offset+20<rows.length);}});
  await seed(store,rows.slice(0,20),{offset:20,lastKey:'initial'});await tracker.restore('A');await tracker.fillHistory();
  assert.equal(tracker.state.connection,'error');assert.equal(tracker.state.records.length,40);assert.equal((await store.load('A')).historyCursor.offset,40);assert.equal(tracker.state.historyRunning,false);
  fail=false;await tracker.fillHistory();assert.equal(tracker.state.records.length,81);assert.equal(new Set(tracker.state.records.map(x=>x.id)).size,81);assert.equal(tracker.state.historyComplete,true);tracker.dispose();
});
test('network failures schedule backoff and a successful automatic retry restores polling',async()=>{
  let n=0;const {tracker,store,timers,clock}=setup({fetchPage:async()=>{if(!n++)throw new Error('offline');return result([raw(1)]);}});
  await tracker.sync();assert.equal(tracker.state.connection,'error');assert.equal(tracker.state.retryAt,NOW+30000);assert.equal(timers[0].delay,30000);
  await tracker.refresh();assert.equal(n,1);assert.equal((await store.load('A')).records.length,0);
  clock.now+=30000;await timers[0].cb();await tracker.inflight;
  assert.equal(tracker.state.connection,'connected');assert.equal(tracker.state.records.length,1);assert.equal(tracker.state.retryAt,null);assert.equal(timers.at(-1).delay,300000);tracker.dispose();
});
test('authentication and verification failures stop automatic retries; rate limits are respected',async()=>{
  for(const error of [Object.assign(new Error('力扣需要验证'),{retryable:false}),Object.assign(new Error('需要登录'),{auth:true})]){
    const {tracker,timers}=setup({identify:async()=>{throw error;}});await tracker.sync();assert.equal(timers.length,0);assert.equal(tracker.state.retryAt,null);tracker.dispose();
  }
  const {tracker,timers}=setup({identify:async()=>{throw Object.assign(new Error('力扣请求较频繁'),{retryAfterMs:120000,status:429});}});await tracker.sync();assert.equal(timers[0].delay,120000);tracker.dispose();
});
test('switching accounts during pagination never commits records to either account',async()=>{
  let n=0;const {tracker,store}=setup({identify:async()=>++n===1?'A':'B',fetchPage:async()=>result([raw(2)])});
  await seed(store,[raw(1)]);await tracker.restore('A');await tracker.sync();
  assert.equal(tracker.state.connection,'error');assert.match(tracker.state.message,/账号发生变化/);assert.deepEqual((await store.load('A')).records.map(x=>x.id),['1']);assert.equal((await store.load('B')).records.length,0);assert.equal(store.writes.length,0);tracker.dispose();
});
test('history continuation does not follow an account switch silently',async()=>{
  let calls=0;const {tracker,store}=setup({identify:async()=> 'B',fetchPage:async()=>{calls++;return result([raw(2)]);}});await seed(store,[raw(1)],{offset:1,lastKey:'a'});await tracker.restore('A');await tracker.fillHistory();
  assert.equal(calls,0);assert.equal(tracker.state.account,'B');assert.equal(tracker.state.records.length,0);assert.equal((await store.load('A')).records.length,1);tracker.dispose();
});
test('disposing during a page read prevents any later commit or retry',async()=>{
  let tracker;const c=setup({fetchPage:async()=>{tracker.dispose();return result([raw(2)]);}});tracker=c.tracker;await seed(c.store,[raw(1)]);await tracker.restore('A');await tracker.sync();assert.equal(c.store.writes.length,0);assert.equal(c.timers.length,0);
});
test('a history access restriction preserves ordinary incremental polling',async()=>{
  const rows=Array.from({length:40},(_,i)=>raw(1000-i));
  const {tracker,store,timers}=setup({fetchPage:async args=>{if(args.offset>=40)throw Object.assign(new Error('力扣暂不允许读取更早历史'),{status:403,retryable:false});return result(rows.slice(args.offset,args.offset+20),true);}});
  await seed(store,rows,{offset:40,lastKey:'older'});await tracker.restore('A');await tracker.fillHistory();
  assert.equal(tracker.state.connection,'connected');assert.ok(tracker.state.historyError);assert.equal(timers.at(-1).delay,300000);
  await tracker.sync();assert.equal(tracker.state.connection,'connected');assert.equal(tracker.state.result.added,0);assert.equal(tracker.state.historyComplete,false);tracker.dispose();
});
test('an offline gap larger than 200 submissions is continued automatically across restart',async()=>{
  const rows=Array.from({length:550},(_,i)=>raw(2000-i));const requests=[];
  const first=setup({fetchPage:paginated(rows,requests)});await seed(first.store,rows.slice(430));
  const saved=await first.store.load('A');saved.historyComplete=true;await first.store.save(saved);await first.tracker.restore('A');await first.tracker.sync();
  assert.equal(first.tracker.state.records.length,320);assert.equal(first.tracker.state.incrementalCursor.offset,200);assert.equal(first.tracker.state.historyComplete,false);assert.equal(first.timers.at(-1).delay,60000);first.tracker.dispose();
  const resumed=setup({store:first.store,fetchPage:paginated(rows,requests)});await resumed.tracker.restore('A');await resumed.tracker.sync();
  assert.equal(requests[10].offset,200);assert.equal(resumed.tracker.state.incrementalCursor.offset,400);
  await resumed.tracker.sync();assert.equal(resumed.tracker.state.records.length,550);assert.equal(new Set(resumed.tracker.state.records.map(x=>x.id)).size,550);assert.equal(resumed.tracker.state.incrementalCursor,null);assert.equal(resumed.tracker.state.historyComplete,true);resumed.tracker.dispose();
});
