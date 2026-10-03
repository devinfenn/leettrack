const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resolveMetadata,exactMatch}=require('../src/metadata.cjs');
const P=require('../src/practice.js');
const plans=require('../src/catalog.js');
const meta={title:'Car Pooling',titleCn:'拼车',titleSlug:'car-pooling',frontendQuestionId:'1094',difficulty:'MEDIUM'};
const record={id:'1',timestamp:1791000000,title:'拼车',slug:null,pending:false,status:'Accepted'};
test('problem lookup accepts exact public metadata and rejects fuzzy or ambiguous titles',()=>{
  assert.equal(exactMatch('拼车',[{...meta,titleCn:'拼车 II'},meta]).slug,'car-pooling');
  assert.equal(exactMatch('拼车',[{...meta,titleCn:'拼车 II'}]),null);
  assert.equal(exactMatch('拼车',[meta,{...meta,titleSlug:'another-version'}]),null);
  assert.equal(exactMatch('拼车',[{...meta,titleSlug:'https://example.test'}]),null);
});
test('resolved metadata gives non-book practice a problem link and is reused offline',async()=>{
  let calls=0;const lookup=async()=>{calls++;return {data:{problemsetQuestionList:{questions:[meta]}}};};
  const extra=await resolveMetadata([record],[],lookup);assert.equal(extra.length,1);assert.equal(P.aggregate([record],[{questions:extra},...plans])[0].slug,'car-pooling');
  await resolveMetadata([record],extra,lookup);assert.equal(calls,1);
});
test('official book metadata needs no lookup and failure preserves existing metadata',async()=>{
  let calls=0;await resolveMetadata([{...record,title:'两数之和'}],[],async()=>{calls++;});assert.equal(calls,0);
  const result=await resolveMetadata([record],[],async()=>{throw new Error('offline');});assert.deepEqual(result,[]);
});
