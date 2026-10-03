const P=require('./practice.js');
const plans=require('./catalog.js');
const titleKey=value=>String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g,'');
const QUERY='query LeetTrackProblemLookup($search: String!) { problemsetQuestionList(categorySlug: "", skip: 0, limit: 20, filters: {searchKeywords: $search}) { questions { title titleSlug titleCn frontendQuestionId difficulty } } }';
function exactMatch(title,items){
  const matches=items.filter(x=>[x.title,x.titleCn].some(value=>titleKey(value)===titleKey(title)) && /^[a-zA-Z0-9_-]+$/.test(x.titleSlug));
  const unique=new Map(matches.map(x=>[x.titleSlug,x]));
  if(unique.size!==1)return null;
  const x=[...unique.values()][0];
  return {id:String(x.frontendQuestionId || ''),slug:x.titleSlug,title:x.titleCn || x.title,english:x.title,group:'',difficulty:String(x.difficulty || '')};
}
async function resolveMetadata(records,existing=[],lookup,{limit=10,shouldStop=()=>false}={}){
  const extra=[...existing];const tried=new Set();let attempts=0;
  const catalog=[{questions:extra},...plans];
  const candidates=[...P.reviewQueue(records,catalog).filter(x=>!x.done).map(x=>x.question),...P.aggregate(records,catalog)];
  for(const q of candidates){
    if(q.slug || tried.has(q.title))continue;
    if(attempts>=limit || shouldStop())break;
    tried.add(q.title);attempts++;
    try{
      const data=await lookup({query:QUERY,variables:{search:q.title}});
      const meta=exactMatch(q.title,data.data?.problemsetQuestionList?.questions || []);
      if(meta&&!extra.some(x=>x.slug===meta.slug))extra.push(meta);
    }catch(error){if(error.auth || error.retryable===false || error.status===429)break;}
  }
  return extra;
}
module.exports={resolveMetadata,exactMatch};
