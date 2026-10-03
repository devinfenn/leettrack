'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'licenses');fs.mkdirSync(output,{recursive:true});
const visited=new Set(),rows=[];
function locate(name,start){
  let directory=start;
  while(true){const file=path.join(directory,'node_modules',name,'package.json');if(fs.existsSync(file))return file;const parent=path.dirname(directory);if(parent===directory)throw new Error('Missing dependency '+name);directory=parent;}
}
function collect(name,start,descend=true){
  const file=locate(name,start);if(visited.has(file))return;visited.add(file);
  const directory=path.dirname(file);const pkg=JSON.parse(fs.readFileSync(file,'utf8'));const key=pkg.name.replace(/[@/]/g,'_')+'-'+pkg.version;
  const target=path.join(output,key);fs.mkdirSync(target,{recursive:true});
  const texts=fs.readdirSync(directory).filter(x=>/^(license|licence|copying|copyright|notice)(?:[.-]|$)/i.test(x)&&fs.statSync(path.join(directory,x)).isFile());
  if(!texts.length)throw new Error('No license text for '+pkg.name);
  for(const text of texts)fs.copyFileSync(path.join(directory,text),path.join(target,text));
  rows.push(`| ${pkg.name} | ${pkg.version} | ${pkg.license||'See license text'} | [License](licenses/${key}/${texts[0]}) |`);
  if(descend)for(const dependency of Object.keys(pkg.dependencies||{}))collect(dependency,directory);
}
const project=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
for(const name of Object.keys(project.dependencies||{}))collect(name,root);
collect('electron',root,false);
fs.writeFileSync(path.join(root,'THIRD_PARTY_NOTICES.md'),'# Third party notices\n\nLeetTrack includes the following libraries. Their original license texts are included in `licenses/`. Electron also ships `LICENSE` and `LICENSES.chromium.html` next to the installed executable.\n\n| Component | Version | License | Full text |\n| --- | --- | --- | --- |\n'+rows.sort().join('\n')+'\n');
console.log('Bundled notices generated for '+rows.length+' dependencies.');
