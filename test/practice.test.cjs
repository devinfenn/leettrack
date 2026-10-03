const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/practice.js');
const plans = [{questions:[{id:'1',slug:'two-sum',title:'两数之和',english:'Two Sum',group:'哈希',difficulty:'EASY'}]}];
let id=0;
function record(day, options={}) {return {id:String(++id),timestamp:Date.parse(day+'T12:00:00+08:00')/1000,title:'Two Sum',slug:null,status:'Accepted',pending:false,...options};}

test('practice dates use Beijing midnight',()=>{
  assert.equal(P.dayKey(Date.parse('2026-10-01T15:59:59Z')/1000),'2026-10-01');
  assert.equal(P.dayKey(Date.parse('2026-10-01T16:00:00Z')/1000),'2026-10-02');
  assert.equal(P.shiftDay('2026-12-31',1),'2027-01-01');
});
test('several submissions on one day count once and retain any accepted result',()=>{
  const records=[record('2026-10-01'),record('2026-10-01',{status:'Wrong Answer',timestamp:Date.parse('2026-10-01T20:00:00+08:00')/1000}),record('2026-10-02')];
  const [q]=P.aggregate(records,plans);
  assert.equal(q.practicedDays,2);assert.equal(q.successfulDays,2);assert.equal(q.days[1].accepted,true);assert.equal(q.days[1].id,records[1].id);
  assert.equal(q.nextReview,'2026-10-05');
});
test('Chinese, English and slug records match one official problem',()=>{
  const qs=P.aggregate([record('2026-09-29'),record('2026-09-30',{title:'两数之和'}),record('2026-10-01',{slug:'two-sum'})],plans);
  assert.equal(qs.length,1);assert.equal(qs[0].practicedDays,3);assert.equal(qs[0].title,'两数之和');
  const rows=P.bookRows(plans[0],qs);assert.equal(rows[0].practicedDays,3);
});
test('unseen official problems have zero practices',()=>{
  const rows=P.bookRows(plans[0],P.aggregate([record('2026-10-01',{title:'Unknown'})],plans));
  assert.equal(rows[0].practicedDays,0);assert.equal(rows[0].lastDay,null);
});
test('pending and failed days never advance the review interval',()=>{
  const [q]=P.aggregate([record('2026-09-28'),record('2026-09-29',{pending:true}),record('2026-09-30',{status:'Wrong Answer'})],plans);
  assert.equal(q.successfulDays,1);assert.equal(q.practicedDays,3);assert.equal(q.nextReview,'2026-09-29');
  const queue=P.reviewQueue([record('2026-10-01'),record('2026-10-02',{pending:true})],plans,'2026-10-02');assert.equal(queue[0].done,false);
});
test('six daily reviews remain the same after accepted submissions today',()=>{
  const records=Array.from({length:8},(_,i)=>record('2026-09-30',{title:'Problem '+i}));
  const before=P.reviewQueue(records,[], '2026-10-02');assert.equal(before.length,6);
  const after=P.reviewQueue([...records,...before.map(x=>record('2026-10-02',{title:x.question.title}))],[],'2026-10-02');
  assert.deepEqual(after.map(x=>x.question.key),before.map(x=>x.question.key));assert.ok(after.every(x=>x.done));
  assert.equal(P.reviewQueue([...records,record('2026-10-02',{title:before[0].question.title,status:'Wrong Answer'})],[],'2026-10-02')[0].done,false);
});
test('a newly available slug today does not break review identity',()=>{
  const rows=P.reviewQueue([record('2026-10-01',{title:'Outside the catalogue'}),record('2026-10-02',{title:'Outside the catalogue',slug:'outside'})],plans,'2026-10-02');
  assert.equal(rows.length,1);assert.equal(rows[0].question.slug,'outside');assert.equal(rows[0].done,true);
});
test('newly solved questions enter reviews tomorrow, and intervals cap at 60 days',()=>{
  assert.equal(P.reviewQueue([record('2026-10-02')],plans,'2026-10-02').length,0);
  const records=Array.from({length:9},(_,i)=>record(P.shiftDay('2026-09-01',i)));
  assert.equal(P.aggregate(records,plans)[0].nextReview,'2026-11-08');
});
test('explicit different slugs and ambiguous titles never collapse into one problem',()=>{
  const questions=P.aggregate([record('2026-10-01',{slug:'two-sum'}),record('2026-10-01',{slug:'other-two-sum'})],plans);
  assert.equal(questions.length,2);
  const ambiguous=[{questions:[...plans[0].questions,{slug:'other-two-sum',title:'两数之和',english:'Two Sum'}]}];
  assert.equal(P.aggregate([record('2026-10-01')],ambiguous)[0].slug,null);
});
