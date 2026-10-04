'use strict';
const scalar={integer:['int','Integer','I'],int:['int','Integer','I'],long:['long','Long','J'],double:['double','Double','D'],float:['double','Double','D'],boolean:['boolean','Boolean','B'],bool:['boolean','Boolean','B'],string:['String','String','S'],character:['char','Character','C'],char:['char','Character','C']};
function typeInfo(raw){
  const text=String(raw).replace(/\s/g,'').replace(/String/g,'string');
  if(text.endsWith('[]')){const child=typeInfo(text.slice(0,-2));return child&&{java:child.java+'[]',boxed:child.java+'[]',recipe:'A'+child.recipe,child};}
  if(/^list<.*>$/.test(text)){const child=typeInfo(text.slice(5,-1));return child&&{java:`List<${child.boxed}>`,boxed:`List<${child.boxed}>`,recipe:'L'+child.recipe,child};}
  const found=scalar[text];return found?{java:found[0],boxed:found[1],recipe:found[2]}:null;
}
function valueOf(value,type){
  if(type.child){const items=value.map(v=>valueOf(v,type.child)).join(', ');return type.recipe[0]==='A'?`new ${type.java}{${items}}`:`new ArrayList<${type.child.boxed}>(Arrays.asList(${items}))`;}
  if(type.recipe==='S')return JSON.stringify(value);
  if(type.recipe==='C')return "'"+value.replace(/\\/g,'\\\\').replace(/'/g,"\\'")+"'";
  if(type.recipe==='J')return String(value)+'L';
  return String(value);
}
function mainTemplate(sig){
  if(!sig.supported)return '';
  const call=`new Solution().${sig.name}(${sig.params.map(p=>p.name).join(', ')})`;
  return `// 第一行 T：测试组数。数组先读长度，字符串用引号包围。\n// LT.Input 支持带引号的字符串；也可以自行读取和打印。\npublic class Main {\n    static void printAnswer(Object answer) { LT.printAnswer(answer); }\n\n    public static void main(String[] args) throws Exception {\n        LT.Input in = new LT.Input(System.in);\n        String first = in.next();\n        if (first == null) return;\n        int T = Integer.parseInt(first);\n        while (T-- > 0) {\n${sig.params.map(p=>`            ${p.type.javaType.java} ${p.name} = (${p.type.javaType.java}) LT.read("${p.type.javaType.recipe}", in);`).join('\n')}\n${sig.isVoid?`            ${call};\n            printAnswer(${sig.params[sig.outputIndex].name});`:`            ${sig.result.javaType.java} answer = ${call};\n            printAnswer(answer);`}\n        }\n    }\n}\n`;
}
function mockCore(sig,returns){
  const type=sig.result.javaType;
  return `class Solution {\n    private static int lt_index = 0;\n    private static final Object[] lt_answers = {${returns.map(v=>valueOf(v,type)).join(',')}};\n    public ${sig.isVoid?'void':type.java} ${sig.name}(${sig.params.map(p=>p.type.javaType.java+' '+p.name).join(', ')}) {\n        LT.trace(new Object[]{${sig.params.map(p=>p.name).join(', ')}});\n        if (lt_index >= lt_answers.length) throw new IllegalStateException("核心函数调用次数过多");\n        ${type.java} lt_answer = (${type.java}) lt_answers[lt_index++];\n        ${sig.isVoid?`LT.fill(${sig.params[sig.outputIndex].name}, lt_answer);`:'return lt_answer;'}\n    }\n}\n`;
}
module.exports={typeInfo,mainTemplate,mockCore};
