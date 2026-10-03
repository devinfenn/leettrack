const {app, BrowserWindow, ipcMain, session, shell, dialog, powerMonitor} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const {Store} = require('./sync.cjs');
const {Tracker} = require('./tracker.cjs');
const {ReviewStore}=require('./review-store.cjs');
const {resolveMetadata} = require('./metadata.cjs');
const {CodingService}=require('./coding.cjs');
const {CodingStore}=require('./coding-store.cjs');
const {CodingRunner}=require('./coding-runner.cjs');
const {dataDirectory}=require('./app-paths.cjs');

const ROOT = path.resolve(__dirname, '..');
const SMOKE = process.argv.includes('--smoke');
const INSTALL_CHECK = process.argv.includes('--verify-installation');
app.setName('LeetTrack');
if(process.platform==='win32')app.setAppUserModelId('io.github.devinfenn.leettrack');
const DATA = dataDirectory({packaged:app.isPackaged,appData:app.getPath('appData'),root:ROOT,override:process.env.LEETTRACK_DATA_DIR,smoke:SMOKE});
app.setPath('userData', path.join(DATA, 'profile'));
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
const store = new Store(path.join(DATA, 'records'));
const reviewStore=new ReviewStore(path.join(DATA,'reviews'));
let mainWindow, loginWindow, lcSession, tracker, coding, quitting = false;
let probeWrite=Promise.resolve();
const shutdown=new AbortController();
let state = {connection: 'unknown', message: '准备连接力扣中国站', account: null, records: [], lastSync: null, historyComplete: false, historyCursor: null, busy: false, result: null};
const emit = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('state', state); };

async function request(url, options = {}) {
  const response = await lcSession.fetch(url, {...options, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(25000),shutdown.signal,...(options.signal?[options.signal]:[])])});
  if (response.status === 401) { const error = new Error('请在力扣窗口登录，然后点击“立即同步”。'); error.auth = true; throw error; }
  if (response.status === 403) {
    const body = await response.text();
    const parsed = new URL(url);
    const reason=/csrf/i.test(body)?'csrf':/captcha|challenge|verification|人机|验证/i.test(body)?'verification':/limit|history|历史|会员|permission/i.test(body)?'access-restricted':'forbidden';
    await fs.writeFile(path.join(DATA,'http-error.json'),JSON.stringify({path:parsed.pathname,offset:parsed.searchParams.get('offset'),status:403,reason,contentType:response.headers.get('content-type')},null,2));
    const message=reason==='verification'||reason==='csrf'?'力扣需要验证，请打开登录窗口检查后重试。':`力扣暂不允许读取${parsed.searchParams.get('offset')>0?'更早的历史':'提交记录'}（403）。已读取的记录已保存，可以稍后重试。`;
    throw Object.assign(new Error(message),{retryable:false,status:403});
  }
  if (response.status === 429) {
    const value=response.headers.get('retry-after');
    const retryAfterMs=value?(/^\d+$/.test(value)?Number(value)*1000:Math.max(0,Date.parse(value)-Date.now())):60000;
    throw Object.assign(new Error('力扣请求较频繁，稍后会自动重试。'),{status:429,retryAfterMs:Number.isFinite(retryAfterMs)?retryAfterMs:60000});
  }
  if (!response.ok) throw Object.assign(new Error(`力扣接口暂不可用（HTTP ${response.status}），请稍后重试。`),{retryable:response.status>=500,status:response.status});
  if (!response.headers.get('content-type')?.includes('json')) throw Object.assign(new Error('力扣返回了验证页面，请打开登录窗口检查。'),{retryable:false});
  return response.json();
}

async function identity() {
  const body = await request('https://leetcode.cn/graphql/', {
    method: 'POST', headers: {'Content-Type':'application/json', 'Referer':'https://leetcode.cn/'},
    body: JSON.stringify({query:'query LeetTrackIdentity { userStatus { isSignedIn username } }'})
  });
  if (body.errors || !body.data?.userStatus) throw Object.assign(new Error('账号接口格式发生变化，需要检查适配。'),{retryable:false});
  if (!body.data.userStatus.isSignedIn) { const e = new Error('连接你的力扣账号，开始自动记录。'); e.auth = true; throw e; }
  const username = body.data.userStatus.username;
  if (typeof username !== 'string' || !username) throw new Error('无法确认账号身份，本次未读取提交。');
  return username;
}

async function codingRequest(route,options={}){
  if(!/^\/(?:graphql\/|problems\/[a-zA-Z0-9_-]+\/(?:submit|interpret_solution)\/|submissions\/detail\/[\w.-]+\/check\/)$/.test(route))throw new Error('Invalid coding endpoint');
  const headers={'Content-Type':'application/json',Origin:'https://leetcode.cn',Referer:'https://leetcode.cn'+(route.startsWith('/problems/')?route.replace(/(?:submit|interpret_solution)\/$/,''):'/problemset/')};
  if(options.method==='POST'){
    const cookies=await lcSession.cookies.get({url:'https://leetcode.cn/'});
    const csrf=cookies.find(x=>x.name==='csrftoken');if(csrf)headers['X-CSRFToken']=csrf.value;
  }
  return request('https://leetcode.cn'+route,{...options,headers});
}

async function sync(history = false) {
  return history?tracker.fillHistory():tracker.sync();
}

function allowed(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && (u.hostname === 'leetcode.cn' || u.hostname.endsWith('.leetcode.cn')); } catch { return false; }
}
function openLogin() {
  if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.show(); loginWindow.focus(); return; }
  loginWindow = new BrowserWindow({width:1060,height:780,title:'连接力扣 · 登录成功后会自动返回 LeetTrack',autoHideMenuBar:true,
    webPreferences:{session:lcSession,nodeIntegration:false,contextIsolation:true,sandbox:true}});
  const window = loginWindow;
  const initialAccount=state.connection==='connected'?state.account:null;
  let observedSignOut=false;
  let checking = false;
  const checkLogin = async () => {
    if (checking || quitting || window.isDestroyed()) return;
    checking = true;
    try {
      const username=await identity();
      if(initialAccount===username&&!observedSignOut)return;
      await lcSession.cookies.flushStore();
      if (!quitting && !window.isDestroyed()) {
        state.message = '登录成功，正在同步你的提交记录…'; emit();
        window.close();
        if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
      }
    } catch (error) {
      if(error.auth)observedSignOut=true;
      if (!error.auth && !quitting && !window.isDestroyed()) {
        state.message = '正在等待登录确认。也可关闭力扣窗口后点击“立即同步”。'; emit();
      }
    } finally { checking = false; }
  };
  const loginTimer = setInterval(checkLogin, 5000);
  window.webContents.on('did-finish-load', checkLogin);
  window.webContents.on('page-title-updated', event => event.preventDefault());
  loginWindow.webContents.on('will-navigate', (event,url) => {if (!allowed(url)) event.preventDefault();});
  loginWindow.webContents.on('will-redirect', (event,url) => {if (!allowed(url)) event.preventDefault();});
  loginWindow.webContents.setWindowOpenHandler(({url}) => {
    if (allowed(url)) loginWindow.loadURL(url).catch(()=>{});
    return {action:'deny'};
  });
  loginWindow.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  loginWindow.on('closed', () => {clearInterval(loginTimer); loginWindow=null; if (!quitting) void sync();});
  loginWindow.loadURL('https://leetcode.cn/accounts/login/').catch(() => {
    state.message='力扣登录页面加载失败，请检查网络后重新打开。'; emit();
  });
}

app.whenReady().then(async () => {
  await fs.mkdir(DATA,{recursive:true});
  lcSession = session.fromPartition('persist:leetcode-cn');
  // Use Chromium's ordinary UA for site compatibility; session stays inside this app.
  lcSession.setUserAgent(lcSession.getUserAgent().replace(/\s(?:Electron|LeetTrack|leettrack)\/\S+/g,''));
  tracker=new Tracker({store,reviewStore,identify:identity,fetchPage:async({offset,lastKey,limit})=>{
    const params=new URLSearchParams({offset:String(offset),limit:String(limit),lastkey:lastKey});
    const data=await request('https://leetcode.cn/api/submissions/?'+params,{headers:{Referer:'https://leetcode.cn/submissions/'}});
    await new Promise(resolve=>setTimeout(resolve,2500));return data;
  },enrich:(records,existing,shouldStop)=>resolveMetadata(records,existing,async body=>{
    const result=await request('https://leetcode.cn/graphql/',{method:'POST',headers:{'Content-Type':'application/json',Referer:'https://leetcode.cn/problemset/'},body:JSON.stringify(body)});
    await new Promise(resolve=>setTimeout(resolve,1000));return result;
  },{shouldStop}),onPersist:async username=>{
    const pointer=path.join(DATA,'last-account.json');
    await fs.writeFile(pointer+'.tmp',JSON.stringify({username}),'utf8');await fs.rename(pointer+'.tmp',pointer);
    await lcSession.cookies.flushStore().catch(()=>{});
  },onState:next=>{
    state=next;emit();
    if(!state.busy){
      const snapshot=JSON.stringify({connection:state.connection,message:state.message,total:state.records.length,lastSync:state.lastSync,result:state.result,historyComplete:state.historyComplete,historyRunning:state.historyRunning,historyProgress:state.historyProgress,retryAt:state.retryAt,metadata:state.problemMetadata?.length || 0},null,2);
      probeWrite=probeWrite.then(async()=>{const file=path.join(DATA,'probe-status.json');await fs.writeFile(file+'.tmp',snapshot,'utf8');await fs.rename(file+'.tmp',file);}).catch(()=>{});
    }
  }});
  try {
    const {username} = JSON.parse(await fs.readFile(path.join(DATA,'last-account.json'),'utf8'));
    await tracker.restore(username);
  } catch (error) { if (error.code !== 'ENOENT') state.message='本地记录尚未加载，连接账号后会重新检查。'; }
  mainWindow = new BrowserWindow({width:1240,height:860,minWidth:980,minHeight:680,title:'LeetTrack',backgroundColor:'#f4f7fa',autoHideMenuBar:true,
    titleBarStyle:'hidden',titleBarOverlay:{color:'#f1f5f9',symbolColor:'#8a94a4',height:52},
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  mainWindow.webContents.on('will-navigate', event=>event.preventDefault());
  function handle(channel, fn) {ipcMain.handle(channel,(event,...args)=> {
    if (event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Invalid caller');
    return fn(...args);
  });}
  let selectedCompiler;
  try{const prefs=JSON.parse(await fs.readFile(path.join(DATA,'preferences.json'),'utf8'));if(typeof prefs.compiler==='string'&&path.isAbsolute(prefs.compiler))selectedCompiler=prefs.compiler;}catch{}
  const codingRunner=new CodingRunner(path.join(DATA,'coding','jobs'),selectedCompiler?{compiler:selectedCompiler}:{});
  coding=new CodingService({store:new CodingStore(path.join(DATA,'coding')),runner:codingRunner,request:codingRequest,identity,getAccount:()=>state.account,
    onProgress:progress=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('coding-progress',progress);},
    onSubmitted:owner=>{if(!quitting&&state.account===owner)void sync();}});
  handle('coding-load',(owner,slug)=>coding.load(owner,slug));
  handle('coding-save',(owner,draft)=>coding.save(owner,draft));
  handle('coding-check',(owner,slug,main)=>coding.check(owner,slug,main));
  handle('coding-run',(owner,payload)=>coding.run(owner,payload));
  handle('coding-submit',(owner,payload)=>coding.submit(owner,payload));
  handle('coding-poll',(owner,id)=>coding.resume(owner,id));
  handle('coding-cancel',()=>coding.cancel());
  handle('coding-compiler',()=>codingRunner.availability());
  handle('coding-choose-compiler',async()=>{
    if(coding.active)throw new Error('请等待当前编程操作结束后再更换编译器。');
    const result=await dialog.showOpenDialog(mainWindow,{title:'选择 g++ 编译器',properties:['openFile'],filters:[{name:'C++ 编译器 (g++.exe)',extensions:['exe']}]});
    if(result.canceled)return null;
    const candidate=result.filePaths[0];if(!path.isAbsolute(candidate)||!/^g\+\+(?:\.exe)?$/i.test(path.basename(candidate)))throw new Error('请选择编译器目录中的 g++.exe。');
    const previous=codingRunner.compiler;codingRunner.compiler=candidate;
    try{
      const detected=await codingRunner.availability();if(!detected.available)throw new Error('这个 g++ 无法运行，请确认安装完整后重试。');
      const file=path.join(DATA,'preferences.json');await fs.writeFile(file+'.tmp',JSON.stringify({compiler:candidate},null,2),'utf8');await fs.rename(file+'.tmp',file);
      return detected;
    }catch(error){codingRunner.compiler=previous;throw error;}
  });
  handle('coding-compiler-guide',()=>shell.openExternal('https://www.msys2.org/'));
  let closing=false,flushingDraft=false;
  mainWindow.on('close',event=>{
    if(closing)return;
    event.preventDefault();if(flushingDraft)return;flushingDraft=true;coding.dispose();
    mainWindow.webContents.executeJavaScript('window.LeetCoding.flush()').then(saved=>{
      flushingDraft=false;if(saved===false){dialog.showErrorBox('草稿未保存','请先复制代码备份，或处理保存问题后再关闭。');return;}
      closing=true;mainWindow.close();
    }).catch(()=>{flushingDraft=false;closing=true;mainWindow.close();});
  });
  handle('get-state',()=>state);
  handle('login',openLogin);
  handle('sync',history=>sync(history===true));
  handle('pause-history',()=>tracker.pauseHistory());
  handle('refresh',()=>tracker.refresh());
  handle('rate-review',(account,id,rating)=>tracker.rateReview(account,id,rating));
  handle('open-problem',slug=> { if(typeof slug==='string' && /^[a-zA-Z0-9_-]+$/.test(slug)) return shell.openExternal('https://leetcode.cn/problems/'+slug+'/'); });
  handle('open-submission',id=> { if(typeof id==='string' && /^\d+$/.test(id)) return shell.openExternal('https://leetcode.cn/submissions/detail/'+id+'/'); });
  handle('export', async()=> {
    const result = await dialog.showSaveDialog(mainWindow,{defaultPath:'LeetTrack-records.json',filters:[{name:'JSON',extensions:['json']}]});
    if(!result.canceled && result.filePath) {const snapshot=state;const reviews=await reviewStore.load(snapshot.account);await fs.writeFile(result.filePath,JSON.stringify({version:2,account:snapshot.account,lastSync:snapshot.lastSync,records:snapshot.records,reviewFeedback:reviews.feedback},null,2),'utf8');}
    return !result.canceled;
  });
  await mainWindow.loadFile(path.join(__dirname,'index.html'));
  mainWindow.show();
  if(INSTALL_CHECK){
    await require('./installation-check.cjs')({app,mainWindow,DATA,codingRunner,store,reviewStore});
    app.exit(0);return;
  }
  if (!app.isPackaged && process.argv.includes('--ui-check')) {
    await require('./ui-check.cjs')(mainWindow, ROOT);
  }
  if (SMOKE) {
    await new Promise(resolve=>setTimeout(resolve,1000));
    const target=app.isPackaged?path.join(DATA,'verification'):path.join(ROOT,'artifacts');
    await fs.mkdir(target,{recursive:true});
    await fs.writeFile(path.join(target,'desktop.png'),(await mainWindow.webContents.capturePage()).toPNG());
    console.log('SMOKE_OK'); app.quit(); return;
  }
  if (!app.isPackaged && process.argv.includes('--verify-history')) {
    await sync();
    if(state.connection==='connected')await tracker.fillHistory();
    if(state.connection==='connected')await sync();
    await fs.mkdir(path.join(ROOT,'artifacts','core-verification'),{recursive:true});
    await fs.writeFile(path.join(ROOT,'artifacts','core-verification','real-sync.json'),JSON.stringify({connection:state.connection,total:state.records.length,historyComplete:state.historyComplete,historyProgress:state.historyProgress,lastSync:state.lastSync,result:state.result,metadata:state.problemMetadata?.length || 0},null,2));
    await fs.writeFile(path.join(ROOT,'artifacts','core-verification','real-desktop.png'),(await mainWindow.webContents.capturePage()).toPNG());
    await probeWrite.catch(()=>{});
    console.log('REAL_HISTORY_RESULT',state.connection,state.records.length,state.historyComplete);
    app.quit();return;
  } else if (!app.isPackaged && process.argv.includes('--verify-sync')) {
    await sync();
    if (state.connection === 'connected') await sync();
    await fs.mkdir(path.join(ROOT,'artifacts'),{recursive:true});
    await fs.writeFile(path.join(ROOT,'artifacts','connected.png'),(await mainWindow.webContents.capturePage()).toPNG());
  } else void sync();
  if (process.argv.includes('--connect')) openLogin();
  if (!app.isPackaged && process.argv.includes('--verify-coding')) {
    await sync();
    await require('./coding-live-check.cjs')(coding,mainWindow,ROOT,state.account);
  }
  mainWindow.on('focus',()=>{if(!loginWindow)void tracker.refresh();});
  powerMonitor.on('resume',()=>{if(!loginWindow)void tracker.refresh();});
}).catch(error => {
  console.error('STARTUP_FAILED', error.message);
  if (SMOKE||INSTALL_CHECK) app.exit(1);
  else dialog.showErrorBox('LeetTrack 启动失败', '界面未能加载，请重新打开程序。');
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{quitting=true;tracker?.dispose();coding?.dispose();shutdown.abort();});
app.on('activate',()=>mainWindow?.show());
app.on('second-instance',()=>{if(mainWindow){if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus();}});
