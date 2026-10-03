'use strict';
const TYPES={integer:'int',int:'int',long:'long long',double:'double',float:'double',boolean:'bool',bool:'bool',string:'string',character:'char',char:'char'};
const identifier=value=>typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
function typeOf(value){
  let name=String(value||'void').replace(/\s/g,'').replace(/String/g,'string');
  const normalize=s=>s.startsWith('list<')&&s.endsWith('>')?normalize(s.slice(5,-1))+'[]':s;
  name=normalize(name);let depth=0;
  while(name.endsWith('[]')){depth++;name=name.slice(0,-2);}
  if(!TYPES[name]||depth>2)return null;
  return {base:name,depth,cpp:'vector<'.repeat(depth)+TYPES[name]+'>'.repeat(depth),name};
}
function signature(metadata){
  let meta;try{meta=typeof metadata==='string'?JSON.parse(metadata):metadata;}catch{return {supported:false,reason:'题目函数元信息无法读取。'};}
  if(!meta||meta.systemdesign||meta.manual||!identifier(meta.name)||!Array.isArray(meta.params)||!meta.params.length||meta.params.length>12)return {supported:false,reason:'这类题暂用 LeetCode 模式；ACM 首版支持普通函数题。'};
  const names=new Set();const params=meta.params.map(p=>({name:p.name,type:typeOf(p.type)}));
  if(params.some(p=>!identifier(p.name)||p.name.startsWith('lt_')||names.has(p.name)||!names.add(p.name)||!p.type))return {supported:false,reason:'ACM 首版支持数字、布尔、字符串和一维、二维数组；链表、树和设计题可用 LeetCode 模式。'};
  const isVoid=!meta.return?.type||meta.return.type==='void';
  const outputIndex=isVoid?meta.output?.paramindex:null;
  if(isVoid&&(!Number.isInteger(outputIndex)||!params[outputIndex]))return {supported:false,reason:'这道原地修改题缺少输出参数信息，暂用 LeetCode 模式。'};
  const result=isVoid?params[outputIndex].type:typeOf(meta.return.type);
  if(!result)return {supported:false,reason:'这道题的返回类型暂未适配 ACM，可用 LeetCode 模式。'};
  return {supported:true,name:meta.name,params,result,isVoid,outputIndex,resultSize:Number.isInteger(meta.return?.size)&&meta.return.size>=0&&meta.return.size<=100000?meta.return.size:null};
}
function validateValue(value,type){
  if(type.depth)return Array.isArray(value)&&value.length<=100000&&value.every(x=>validateValue(x,{...type,depth:type.depth-1}));
  if(['integer','int','long'].includes(type.base))return Number.isSafeInteger(value);
  if(['double','float'].includes(type.base))return typeof value==='number'&&Number.isFinite(value);
  if(['boolean','bool'].includes(type.base))return typeof value==='boolean';
  if(['character','char'].includes(type.base))return typeof value==='string'&&Buffer.byteLength(value)===1;
  return typeof value==='string'&&value.length<=100000&&!/[\r\n\0]/.test(value);
}
function examples(raw,sig){
  if(!sig.supported)return [];
  const lines=String(raw||'').trim().split(/\r?\n/).filter(x=>x.trim());const result=[];
  if(lines.length%sig.params.length)throw new Error('题目样例格式暂未适配。可先使用 LeetCode 模式运行。');
  for(let i=0;i<lines.length;i+=sig.params.length){
    const args=lines.slice(i,i+sig.params.length).map((line,j)=>{
      let value;try{value=JSON.parse(line);}catch{throw new Error('样例参数不是受支持的 JSON 值。');}
      if(!validateValue(value,sig.params[j].type))throw new Error('样例包含暂不支持的参数值：'+sig.params[j].name);
      return value;
    });result.push(args);
  }
  if(!result.length)throw new Error('题目暂未提供可用样例。');
  return result;
}
function quoted(value){return '"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';}
function inputValue(value,type){
  if(type.depth===2)return [String(value.length),...value.map(row=>inputValue(row,{...type,depth:1}))].join('\n');
  if(type.depth===1)return String(value.length)+'\n'+value.map(x=>inputValue(x,{...type,depth:0})).join(' ');
  if(['string','character','char'].includes(type.base))return quoted(value);
  if(['boolean','bool'].includes(type.base))return value?'1':'0';
  return String(value);
}
function stdinFor(cases,sig,{loose=false}={}){
  let text=String(cases.length)+'\n'+cases.map(args=>args.map((value,i)=>inputValue(value,sig.params[i].type)).join('\n')).join('\n')+'\n';
  // Change only whitespace outside quoted strings, preserving the sample values.
  if(loose){let inside=false,escape=false,out='';for(const c of text){if(!inside&&c===' ')out+=' \t ';else if(!inside&&c==='\n')out+='\r\n';else out+=c;if(escape){escape=false;continue;}if(inside&&c==='\\'){escape=true;continue;}if(c==='"')inside=!inside;}text=out;}
  return text;
}
function mockValue(type,index,method,size=null){
  if(type.depth){
    const length=size??(type.depth===1&&method==='twoSum'?2:(index%2?3:1));
    return Array.from({length},(_,i)=>mockValue({...type,depth:type.depth-1},index+i,method));
  }
  if(['integer','int','long'].includes(type.base))return method==='twoSum'?index%2:(index%2?17:4);
  if(['double','float'].includes(type.base))return index%2?1.25:0.5;
  if(['boolean','bool'].includes(type.base))return index%2===0;
  if(['character','char'].includes(type.base))return index%2?'z':'a';
  return index%2?'second':'first';
}
function fitShape(seed,shape,type){if(!type.depth)return seed;return shape.map((value,i)=>fitShape(seed[i%seed.length],value,{...type,depth:type.depth-1}));}
function outputValue(value,type){
  if(type.depth===2)return value.map(row=>outputValue(row,{...type,depth:1})).join('\n');
  if(type.depth===1)return value.map(x=>['string','character','char'].includes(type.base)?quoted(x):outputValue(x,{...type,depth:0})).join(' ');
  if(['boolean','bool'].includes(type.base))return value?'1':'0';
  return String(value);
}
function outputFor(values,type){return values.map(value=>outputValue(value,type)+'\n').join('');}
function equalOutput(actual,expected,type){
  const norm=s=>String(s).replace(/\r\n/g,'\n').split('\n').map(line=>line.trimEnd()).join('\n').replace(/\n+$/,'');
  const a=norm(actual),b=norm(expected);
  if(!['float','double'].includes(type.base))return a===b;
  const rows=s=>s.split('\n').map(line=>line.trim().split(/\s+/).filter(Boolean));const aa=rows(a),bb=rows(b);
  return aa.length===bb.length&&aa.every((row,i)=>row.length===bb[i].length&&row.every((token,j)=>/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(token)&&Number.isFinite(Number(token))&&Math.abs(Number(token)-Number(bb[i][j]))<=1e-6*Math.max(1,Math.abs(Number(bb[i][j])))));
}
function cppValue(value,type){
  if(type.depth)return type.cpp+'{'+value.map(x=>cppValue(x,{...type,depth:type.depth-1,cpp:type.cpp.slice(7,-1)})).join(',')+'}';
  if(['string','character','char'].includes(type.base))return type.base==='string'?'string('+JSON.stringify(value)+')':"'"+value.replace(/\\/g,'\\\\').replace(/'/g,"\\'")+"'";
  if(['boolean','bool'].includes(type.base))return value?'true':'false';
  return String(value)+(type.base==='long'?'LL':'');
}
function readCode(p){
  const name=p.name,t=p.type,scalar=(expr,type)=>['string'].includes(type.base)?`cin >> quoted(${expr});`:['character','char'].includes(type.base)?`{ string lt_text; cin >> quoted(lt_text); ${expr} = lt_text.empty() ? '\\0' : lt_text[0]; }`:type.depth&&['boolean','bool'].includes(type.base)?`{ bool lt_value; cin >> lt_value; ${expr} = lt_value; }`:`cin >> ${expr};`;
  if(!t.depth)return `        ${t.cpp} ${name}{};\n        ${scalar(name,t)}`;
  if(t.depth===1)return `        int lt_${name}_n; cin >> lt_${name}_n;\n        ${t.cpp} ${name}(lt_${name}_n);\n        for (int lt_i = 0; lt_i < lt_${name}_n; ++lt_i) ${scalar(name+'[lt_i]',t)}`;
  return `        int lt_${name}_rows; cin >> lt_${name}_rows;\n        ${t.cpp} ${name}(lt_${name}_rows);\n        for (auto& lt_row : ${name}) {\n            int lt_n; cin >> lt_n; lt_row.resize(lt_n);\n            for (int lt_i = 0; lt_i < lt_n; ++lt_i) ${scalar('lt_row[lt_i]',t)}\n        }`;
}
function mainTemplate(sig){
  if(!sig.supported)return '';
  const call=`Solution().${sig.name}(${sig.params.map(p=>p.name).join(', ')})`;
  return `// 第一行 T：测试组数。数组先读长度，字符串用引号包围。\n// 可使用 printAnswer 打印，也可以自己写输出。\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    int T;\n    if (!(cin >> T)) return 0;\n    while (T--) {\n${sig.params.map(readCode).join('\n')}\n        if (!cin) return 1;\n${sig.isVoid?'        '+call+';\n        printAnswer('+sig.params[sig.outputIndex].name+');':'        auto answer = '+call+';\n        printAnswer(answer);'}\n    }\n    return 0;\n}\n`;
}
function mockCore(sig,returns){
  const declaration=sig.params.map((p,i)=>p.type.cpp+(p.type.depth||p.type.base==='string'||sig.outputIndex===i?'&':'')+' '+p.name).join(', ');
  const save=sig.params.map(p=>'lt_json('+p.name+')').join(' + "," + ');
  const values=returns.map(v=>cppValue(v,sig.result)).join(',');
  const output=sig.isVoid?'auto lt_original = '+sig.params[sig.outputIndex].name+';\n        lt_fill(lt_original, lt_answer);\n        '+sig.params[sig.outputIndex].name+' = lt_original;':'return lt_answer;';
  return `class Solution {\npublic:\n    ${sig.isVoid?'void':sig.result.cpp} ${sig.name}(${declaration}) {\n        ofstream lt_trace(getenv("LEETTRACK_TRACE_FILE"), ios::app);\n        lt_trace << "[" << ${save} << "]\\n";\n        lt_trace.close();\n        static size_t lt_index = 0;\n        static vector<${sig.result.cpp}> lt_answers = {${values}};\n        if (lt_index >= lt_answers.size()) throw runtime_error("核心函数调用次数过多");\n        auto lt_answer = lt_answers[lt_index++];\n        ${output}\n    }\n};\n`;
}
function contract(sig){
  if(!sig.supported)return sig.reason;
  return '第一行是测试组数 T。每组按函数参数顺序读取：\n'+sig.params.map(p=>`${p.name}：${p.type.depth===2?'先读行数，再逐行读长度和元素':p.type.depth===1?'先读长度，再读全部元素':p.type.base==='string'?'双引号字符串，支持空格和空字符串':['character','char'].includes(p.type.base)?'单字符，可用双引号包围':['boolean','bool'].includes(p.type.base)?'0 或 1':'一个数字'}`).join('\n')+'\n\n输出：每组答案换行；一维数组元素用空格分隔；二维数组逐行打印；数组中的字符串用双引号包围；布尔值输出 0/1。允许行尾空格和末尾空行，浮点数误差 1e-6。';
}
module.exports={signature,typeOf,validateValue,examples,stdinFor,mockValue,fitShape,outputFor,equalOutput,mainTemplate,mockCore,contract};
