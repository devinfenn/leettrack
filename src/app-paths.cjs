'use strict';
const path=require('node:path');
function dataDirectory({packaged,appData,root,override,smoke=false}){
  const base=override?path.resolve(override):packaged?path.join(appData,'LeetTrack'):path.join(root,'.local');
  return smoke?path.join(base,'smoke'):base;
}
module.exports={dataDirectory};
