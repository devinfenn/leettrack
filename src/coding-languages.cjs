'use strict';
const languages={cpp:{label:'C++ 17',slug:'cpp'},java:{label:'Java',slug:'java'}};
function languageOf(value='cpp'){
  if(!Object.hasOwn(languages,value))throw new Error('请选择 Java 或 C++。');
  return value;
}
module.exports={languages,languageOf};
