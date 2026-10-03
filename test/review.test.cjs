const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const P=require('../src/practice.js');
const {ReviewStore}=require('../src/review-store.cjs');
const {Tracker}=require('../src/tracker.cjs');
const today='2026-10-03',now=Date.parse(today+'T12:00:00+08:00');
const r=(id,day='2026-10-02',title='题目'+id)=>({id:String(id),title,slug:null,timestamp:Date.parse(day+'T12:00:00+08:00')/1000,status:'Accepted',pending:false});
const f=(rating,day=today,id='1',extra=0)=>({submissionId:id,day,rating,at:Date.parse(day+'T12:00:00+08:00')+extra});
async function directory(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'leettrack-review-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}

test('feedback adapts dates without fabricating practices or accepted days',()=>{
  for(const [rating,date] of [['independent','2026-10-06'],['hint','2026-10-05'],['failed','2026-10-04']]){
    const records=[r(1)];const [q]=P.aggregate(records,[],records,[f(rating)]);
    assert.equal(q.nextReview,date);assert.equal(q.practicedDays,1);assert.equal(q.successfulDays,1);
    assert.equal(P.reviewQueue(records,[],today,6,[f(rating)])[0].done,true);
  }
});
test('same-day repeat and edits recompute once; AC does not double advance',()=>{
  const records=[r(1),r(2,today,'题目1')];
  const [q]=P.aggregate(records,[],records,[f('independent'),f('independent',today,'2',1)]);
  assert.equal(q.reviewInterval,3);assert.equal(q.nextReview,'2026-10-06');assert.equal(q.reviewHistory.length,1);
  assert.equal(P.feedbackPlan(q,'independent',today).nextReview,'2026-10-06');
  assert.equal(P.feedbackPlan(q,'failed',today).nextReview,'2026-10-04');
  const [changed]=P.aggregate(records,[],records,[f('independent'),f('failed',today,'2',2)]);
  assert.equal(changed.reviewInterval,1);
});
test('failed reviews take priority tomorrow and today never refills after feedback',()=>{
  const records=Array.from({length:8},(_,i)=>r(i+1,'2026-09-20'));
  const queue=P.reviewQueue(records,[],today);const id=queue[5].question.lastId;
  const feedback=queue.map(x=>f(x.question.lastId===id?'failed':'independent',today,x.question.lastId));
  assert.equal(P.reviewQueue(records,[],today,6,feedback).length,6);
  assert.ok(P.reviewQueue(records,[],today,6,feedback).every(x=>x.done));
  assert.equal(P.reviewQueue(records,[],'2026-10-04',6,feedback)[0].question.lastId,id);
});
test('later automatic AC keeps explicit feedback interval and identity survives metadata',()=>{
  const records=[r(1),r(2,'2026-10-04','题目1')];
  const [q]=P.aggregate(records,[{questions:[{title:'题目1',slug:'one'}]}],records,[f('hint')]);
  assert.equal(q.slug,'one');assert.equal(q.reviewHistory.length,1);assert.equal(q.reviewInterval,2);assert.equal(q.nextReview,'2026-10-06');
});
test('independent feedback increases intervals up to 60 days',()=>{
  const records=[r(1,'2026-09-01')];let day='2026-09-02';const feedback=[];
  for(const interval of [3,7,14,30,60,60]){feedback.push(f('independent',day));const [q]=P.aggregate(records,[],records,feedback);assert.equal(q.reviewInterval,interval);day=q.nextReview;}
});
test('feedback persists across restart, accounts stay separate and concurrent edits keep one daily result',async t=>{
  const dir=await directory(t);const store=new ReviewStore(dir);
  await Promise.all([store.upsert('A',f('independent'),['1','2']),store.upsert('A',f('failed',today,'2',1),['1','2'])]);
  assert.deepEqual((await new ReviewStore(dir).load('A')).feedback,[f('failed',today,'2',1)]);
  assert.equal((await store.load('B')).feedback.length,0);
});
test('invalid local feedback remains untouched and a failed write does not poison later writes',async t=>{
  const dir=await directory(t);const store=new ReviewStore(dir);const file=store.filename('A');
  await fs.writeFile(file,'broken');await assert.rejects(store.upsert('A',f('failed'),['1']),/无法读取/);
  assert.equal(await fs.readFile(file,'utf8'),'broken');
  await store.upsert('B',f('hint'),['1']);assert.equal((await store.load('B')).feedback.length,1);
});
async function trackerFor(t,options={}){
  const reviewStore=new ReviewStore(await directory(t));const saved={username:'A',records:[r(1)],lastSync:'2026-10-02T00:00:00Z',historyComplete:true};
  const store={load:async username=>structuredClone(username==='A'?saved:{username,records:[],lastSync:null}),save:async data=>Object.assign(saved,data)};
  const tracker=new Tracker({store,reviewStore,identify:async()=> 'A',fetchPage:async()=>({submissions_dump:[],has_next:false,last_key:''}),now:()=>now,setTimer:()=>0,clearTimer:()=>{},...options});
  t.after(()=>tracker.dispose());await tracker.restore('A');return {tracker,reviewStore,store};
}
test('Tracker rejects stale accounts, invalid feedback and questions outside the daily queue',async t=>{
  const {tracker,reviewStore}=await trackerFor(t);
  for(const args of [['B','1','failed'],['A','1','other'],['A','999','hint'],['A',1,'hint']])await assert.rejects(tracker.rateReview(...args));
  assert.equal((await reviewStore.load('A')).feedback.length,0);
  assert.deepEqual(await tracker.rateReview('A','1','failed'),{rating:'failed',nextReview:'2026-10-04'});
  const raw=structuredClone(tracker.state.records);await tracker.rateReview('A','1','independent');assert.deepEqual(tracker.state.records,raw);
  await tracker.restore('A');assert.equal(tracker.state.reviewFeedback[0].rating,'independent');
});
test('in-flight network sync cannot overwrite saved feedback',async t=>{
  let release,entered;const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
  const {tracker}=await trackerFor(t,{fetchPage:async()=>{entered();await gate;return {submissions_dump:[],has_next:false,last_key:''};}});
  const sync=tracker.sync();await ready;await tracker.rateReview('A','1','hint');release();await sync;
  assert.equal(tracker.state.reviewFeedback[0].rating,'hint');
});
test('failed feedback save leaves the review pending; corrupt feedback does not block submission load',async t=>{
  const {tracker,reviewStore}=await trackerFor(t);await fs.writeFile(reviewStore.filename('A'),'broken');await tracker.restore('A');
  assert.match(tracker.state.reviewError,/无法读取/);assert.equal(tracker.state.records.length,1);
  await assert.rejects(tracker.rateReview('A','1','failed'),/未保存/);
  assert.equal(P.reviewQueue(tracker.state.records,[],today,6,tracker.state.reviewFeedback)[0].done,false);
  await tracker.sync();assert.equal(tracker.state.connection,'connected');assert.ok(tracker.state.reviewError);
});
test('switching accounts while saving keeps feedback with the original account',async t=>{
  const {tracker,reviewStore}=await trackerFor(t);let release,entered;
  const ready=new Promise(r=>entered=r),gate=new Promise(r=>release=r);const upsert=reviewStore.upsert.bind(reviewStore);
  reviewStore.upsert=async(...args)=>{entered();await gate;return upsert(...args);};
  const saving=tracker.rateReview('A','1','failed');await ready;await tracker.restore('B');release();await saving;
  assert.equal(tracker.state.account,'B');assert.deepEqual(tracker.state.reviewFeedback,[]);
  assert.equal((await reviewStore.load('A')).feedback[0].rating,'failed');assert.equal((await reviewStore.load('B')).feedback.length,0);
  await tracker.restore('A');assert.equal(tracker.state.reviewFeedback[0].rating,'failed');
});
