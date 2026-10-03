'use strict';
const $ = id => document.getElementById(id);
const P = window.LeetPractice;
const plans = window.LEETTRACK_CATALOG;
let state, questions = [], queue = [], view = 'today', bookIndex = 0, filter = 'all', reviewKey = null, queueVisible = false, toastTimer,feedbackSaving=false;
const todayKey = () => P.dayKey(Date.now()/1000);
const dateLabel = day => day ? new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',...(day.slice(0,4)!==todayKey().slice(0,4)?{year:'numeric'}:{}),month:'long',day:'numeric'}).format(new Date(day+'T04:00:00Z')) : '—';
const timeLabel = timestamp => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(timestamp*1000));
function element(tag, className, text) {const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function toast(text) {clearTimeout(toastTimer);$('toast').textContent=text;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,4200);}
async function run(action) {try{return await action();}catch{toast('操作未完成，请重试。');}}
function problemButton(question) {const button=element('button','problem-link',question.title);button.title=question.title;button.onclick=()=>writeQuestion(question);return button;}
function openQuestion(question) {return run(()=>question.slug ? window.leettrack.openProblem(question.slug) : window.leettrack.openSubmission(question.lastId));}
function writeQuestion(question){if(!question.slug)return openQuestion(question);switchView('coding',false);return window.LeetCoding.open(question.slug,state?.account||null);}
function switchView(next,activate=true) {view=next;queueVisible=false;document.querySelectorAll('[data-view]').forEach(button=>{const active=button.dataset.view===(view==='records'?'today':view);button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});for(const name of ['today','books','records','review','coding'])$(name+'-page').hidden=name!==view;document.querySelector('main').classList.toggle('coding-active',view==='coding');renderView();document.querySelector('main').scrollTop=0;if(view==='coding'&&activate)window.LeetCoding.activate();}
function render(next) {
  if(typeof state?.revision==='number'&&typeof next.revision==='number'&&next.revision<state.revision)return;
  if(state?.account!==next.account)reviewKey=null;
  state=next;const catalog=[{questions:state.problemMetadata || []},...plans];questions=P.aggregate(state.records,catalog,state.records,state.reviewFeedback || []);queue=P.reviewQueue(state.records,catalog,todayKey(),6,state.reviewFeedback || []);
  window.LeetCoding.updateAccount(state.account,state.problemMetadata||[]);
  $('account-name').textContent=state.account || '力扣中国站';
  $('connection-tag').textContent=state.busy?'同步中':({connected:'已连接',error:'同步需要重试','signed-out':'需要登录',unknown:'正在检查连接'}[state.connection] || '尚未连接');
  $('message').textContent=state.reviewError || state.historyError?.message || state.message;$('message').classList.toggle('error',state.connection==='error'||!!state.historyError||!!state.reviewError);
  $('last-sync').textContent=state.lastSync?'上次同步 '+new Date(state.lastSync).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未同步';
  $('login').textContent=state.connection==='connected'?'切换账号':state.account?'重新登录':'连接账号';
  const connected=state.connection==='connected'&&!!state.account;
  $('account-label').textContent=connected?state.account:'连接账号';
  $('account-entry').classList.toggle('connected',connected);
  $('account-entry').title=connected?state.account+' · 已登录，点击管理账号':'登录力扣中国站';
  $('account-entry').setAttribute('aria-label',connected?'已登录 '+state.account+'，打开账号设置':'连接力扣账号');
  $('sync').disabled=state.busy;$('sync').classList.toggle('busy',state.busy);
  $('sync-label').textContent=state.busy?'同步中':state.connection==='connected'?'已同步':state.connection==='error'?'同步重试':state.connection==='signed-out'?'连接账号':'检查连接';
  $('sync').title=state.busy?state.message:state.connection==='connected'?'立即同步 · '+$('last-sync').textContent:state.message;
  $('export').disabled=!state.records.length;
  for(const id of ['history','records-history']){$(id).disabled=state.historyRunning?state.historyPausing:(state.busy || state.connection!=='connected' || state.historyComplete);$(id).textContent=state.historyRunning?(state.historyPausing?'暂停中':'暂停'):(state.historyComplete?'已补齐':state.historyCursor?'继续补齐':'补齐历史');}
  $('history-note').textContent=state.historyRunning?`已保存 ${state.historyProgress?.total || state.records.length} 条 · 已读取 ${state.historyProgress?.pages || 0} 页`:state.historyComplete?`共 ${state.records.length} 条提交 · 历史已补齐`:state.records.length?`已同步 ${state.records.length} 条，可以继续补齐`:'首次同步后可以补齐历史';
  $('notice').hidden=state.connection!=='error'&&!(state.connection==='signed-out'&&state.account)&&!state.historyError&&!state.reviewError;$('notice').textContent=(state.reviewError || state.historyError?.message || state.message)+(state.retryAt?' 将在 '+timeLabel(state.retryAt/1000)+' 自动重试。':'');
  renderHome();renderView();
}
function renderHome() {
  const today=todayKey();const dayQuestions=questions.filter(q=>q.days.some(x=>x.day===today));
  $('date').textContent=dateLabel(today);$('weekday').textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',weekday:'long'}).format(new Date(today+'T04:00:00Z'));
  const weekday=(new Date(today+'T04:00:00Z').getUTCDay()+6)%7;const monday=P.shiftDay(today,-weekday);
  $('week-strip').replaceChildren();
  for(let i=0;i<7;i++){const day=P.shiftDay(monday,i);const practiced=questions.some(q=>q.days.some(d=>d.day===day));const node=element('span','week-day'+(day===today?' current':'')+(practiced?' practiced':''));node.title=dateLabel(day)+(practiced?' · 有练习记录':' · 暂无记录');node.append(element('span','',['一','二','三','四','五','六','日'][i]),element('strong','',String(Number(day.slice(-2)))),element('i'));$('week-strip').append(node);}
  $('today-count').textContent=dayQuestions.length;$('today-empty').hidden=dayQuestions.length>0;
  const needsLogin=!state.account || state.connection==='signed-out';
  $('today-empty-title').textContent=needsLogin?'从连接账号开始':'今天还没有新的练习';
  $('today-empty-copy').textContent=needsLogin?'登录力扣中国站，练习会自动同步。':'提交后，记录会自动出现在这里。';
  $('empty-login').hidden=!needsLogin;$('daily-footnote').hidden=!dayQuestions.length;
  $('today-list').replaceChildren();
  for(const question of dayQuestions.slice(0,4)){const day=question.days.find(x=>x.day===today);const row=element('div','daily-row');const name=element('div');name.append(problemButton(question),element('div','practice-mark',day.accepted?'已通过':'已练习'));row.append(name,element('span','daily-time',timeLabel(day.timestamp)));$('today-list').append(row);}
  const pending=queue.filter(x=>!x.done);const done=queue.length-pending.length;
  $('review-count').textContent=pending.length;$('review-progress').textContent=queue.length?`${done} / ${queue.length} 已处理`:'';
  $('review-preview').replaceChildren();
  for(const item of pending.slice(0,3)){const row=element('div','preview-row');const content=element('div');const button=problemButton(item.question);button.onclick=()=>{reviewKey=item.question.key;switchView('review');};content.append(button,element('div','preview-meta',dateLabel(item.question.lastDay)+' · 练过 '+item.question.practicedDays+' 天'));row.append(content);$('review-preview').append(row);}
  $('review-empty').hidden=pending.length>0;
  $('review-empty').querySelector('h3').textContent=queue.length?'今天的复习已完成':'今天没有待复习的题';
  $('review-empty').querySelector('p').textContent=queue.length?'可在今日安排中补充或修改反馈。':'通过一道题后，会为你安排下一次复习。';
  $('start-review').hidden=!pending.length;
  $('review-more').textContent=pending.length>3?'还有 '+(pending.length-3)+' 道，进入复习后查看':'';
  $('home-footer-copy').textContent=state.records.length?`已记录 ${questions.length} 道题 · 保存在本地`:'力扣中国站 · 记录保存在本地';
}
function renderView(){if(!state)return;if(view==='books')renderBooks();else if(view==='records')renderRecords();else if(view==='review')renderReview();}
function renderBooks(){
  if(!state)return;
  const plan=plans[bookIndex];const all=P.bookRows(plan,questions);const practiced=all.filter(q=>q.practicedDays>0).length;
  $('book-title').textContent=plan.name;$('book-progress').textContent=`${practiced} / ${all.length} 道有练习记录`;
  $('history-warning').textContent=state.historyComplete?'练习次数按北京时间的不同日期统计':'仅统计已同步记录 · 可以在设置中补齐历史';
  $('book-source').textContent='力扣官方题单 · '+plan.asOf;
  const query=$('book-search').value.trim().toLowerCase();
  const rows=all.filter(q=>(filter==='all'||(filter==='practiced'?q.practicedDays>0:q.practicedDays===0))&&(q.title+' '+q.number+' '+q.slug).toLowerCase().includes(query));
  const scroller=$('book-rows').closest('.table-scroll');const scroll=scroller.scrollTop;
  $('book-empty').hidden=rows.length>0;$('book-rows').replaceChildren();const fragment=document.createDocumentFragment();
  for(const q of rows){const row=element('tr');const name=element('td');const wrap=element('div','question-name');wrap.append(element('span','problem-number',q.number),problemButton(q));name.append(wrap);const count=element('td',q.practicedDays?'day-count':'no-record',q.practicedDays?q.practicedDays+' 天':'暂无记录');row.append(name,count,element('td','',dateLabel(q.lastDay)));fragment.append(row);} $('book-rows').append(fragment);scroller.scrollTop=scroll;
}
function renderRecords(){
  if(!state)return;
  const query=$('record-search').value.trim().toLowerCase();const daily=questions.flatMap(q=>q.days.map(day=>({question:q,day}))).filter(x=>x.question.title.toLowerCase().includes(query)).sort((a,b)=>b.day.timestamp-a.day.timestamp);
  $('records-description').textContent=`${daily.length} 次每日练习 · ${questions.length} 道题`;
  $('records-empty').hidden=daily.length>0;$('records-empty').textContent=query?'没有搜索结果':'暂无练习记录';
  const scroller=$('record-rows').closest('.table-scroll');const scroll=scroller.scrollTop;
  $('record-rows').replaceChildren();const fragment=document.createDocumentFragment();for(const {question,day} of daily){const row=element('tr');const name=element('td');name.append(problemButton({...question,lastId:day.id}));row.append(name,element('td','',day.accepted?'已通过':'已练习'),element('td','',dateLabel(day.day)));fragment.append(row);} $('record-rows').append(fragment);scroller.scrollTop=scroll;
}
function renderReview(){
  if(!queue.length)queueVisible=false;
  $('review-list-button').disabled=!queue.length;
  const pending=queue.filter(x=>!x.done);
  const item=queue.find(x=>x.question.key===reviewKey) || pending[0];reviewKey=item?.question.key || null;
  $('review-position').textContent=item?`${queue.indexOf(item)+1} / ${queue.length}`:queue.length?'已完成 '+queue.length+' 道':'';
  $('review-focus').hidden=!item || queueVisible;$('review-complete').hidden=!!item || queueVisible;$('review-queue').hidden=!queueVisible;
  $('review-list-button').textContent=queueVisible?'回到单题复习':'查看今日安排';
  if(queueVisible){$('review-queue').replaceChildren();for(const entry of queue){const row=element('div','queue-row');const name=element('div');const detail=entry.rating?P.ratingLabels[entry.rating.rating]+' · 下次 '+dateLabel(entry.question.nextReview):entry.acceptedToday?'今日已通过 · 可补充反馈':dateLabel(entry.question.lastDay)+' · 练过 '+entry.question.practicedDays+' 天';name.append(element('span','',entry.question.title),element('p','',detail));const button=element('button','secondary',entry.rating?'修改反馈':entry.acceptedToday?'补充反馈':'复习');button.disabled=feedbackSaving;button.onclick=()=>{reviewKey=entry.question.key;queueVisible=false;renderReview();};row.append(name,button);$('review-queue').append(row);}return;}
  if(!item){$('review-complete-title').textContent=queue.length?'今天的复习已完成':'今天没有待复习的题';$('review-complete-copy').textContent=queue.length?'可在今日安排中补充或修改反馈。':'通过一道题后，按练习历史安排下一次复习。';return;}
  const q=item.question;$('review-category').textContent=q.group || '今日复习';$('review-title').textContent=q.title;
  $('review-meta').replaceChildren(element('span','',`练过 ${q.practicedDays} 天`),element('span','',`上次练习 ${dateLabel(q.lastDay)}`));
  $('review-open').textContent=q.slug?'在这里重做':'打开力扣记录';$('review-open').onclick=()=>writeQuestion(q);
  $('feedback-options').replaceChildren();
  for(const [rating,label] of Object.entries(P.ratingLabels)){
    const plan=P.feedbackPlan(q,rating,todayKey());const selected=item.rating?.rating===rating;
    const button=element('button','feedback-button'+(selected?' selected':''));button.dataset.rating=rating;button.setAttribute('aria-pressed',String(selected));button.disabled=feedbackSaving;
    button.append(element('span','',label),element('small','',dateLabel(plan.nextReview)+' 再复习'));button.onclick=()=>saveFeedback(q,rating);$('feedback-options').append(button);
  }
  $('feedback-status').textContent=feedbackSaving?'正在保存…':item.rating?`已记录：${P.ratingLabels[item.rating.rating]} · 同一天可修改`:item.awaitingFeedback?'今日已通过，可以补充这次的实际感受。':'';
  $('review-skip').disabled=feedbackSaving;
  $('practice-dates').replaceChildren();for(const day of [...q.days].slice(0,8).reverse()){const label=element('span','history-day'+(day.accepted?'':' failed'));label.title=day.accepted?'当天有通过记录':'当天有练习，尚无通过记录';label.append(element('i'),element('span','',dateLabel(day.day)));$('practice-dates').append(label);}
  $('review-next-date').textContent=q.days.length>8?`最近 8 个练习日 · 共 ${q.practicedDays} 天`:'每个日期代表一次练习';
}
async function saveFeedback(question,rating){
  if(feedbackSaving)return;
  const account=state.account;feedbackSaving=true;renderReview();
  try{
    const result=await window.leettrack.rateReview(account,question.lastId,rating);
    if(state.account===account){reviewKey=null;queueVisible=false;toast(P.ratingLabels[rating]+' · 下次复习 '+dateLabel(result.nextReview));}
  }catch(error){if(state.account===account)toast(String(error.message || '复习反馈未保存，请重试。').replace(/^Error invoking remote method '[^']+': Error: /,''));}
  finally{feedbackSaving=false;renderHome();renderView();}
}
for(const [index,plan] of plans.entries()){const option=element('option','',plan.name);option.value=index;$('book-select').append(option);}
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>switchView(button.dataset.view));
document.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b===button));renderBooks();});
$('book-select').onchange=()=>{bookIndex=Number($('book-select').value);renderBooks();};
$('book-search').oninput=renderBooks;$('record-search').oninput=renderRecords;
$('home-button').onclick=$('records-back').onclick=$('review-home').onclick=()=>switchView('today');
$('show-records').onclick=()=>switchView('records');$('home-books').onclick=()=>switchView('books');
$('start-review').onclick=()=>{reviewKey=null;switchView('review');};
$('review-list-button').onclick=()=>{queueVisible=!queueVisible;renderReview();};
$('review-skip').onclick=()=>{const pending=queue.filter(x=>!x.done);const index=pending.findIndex(x=>x.question.key===reviewKey);if(index<0){reviewKey=pending[0]?.question.key || null;renderReview();}else if(pending.length>1){reviewKey=pending[(index+1)%pending.length].question.key;renderReview();}else toast('这是今天最后一道，可以稍后回来复习。');};
$('settings-open').onclick=()=>{$('settings').showModal();void window.LeetCoding.ensureCompiler();};$('settings-close').onclick=()=>$('settings').close();
$('settings').addEventListener('click',event=>{if(event.target===$('settings')){const box=$('settings').getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)$('settings').close();}});
$('login').onclick=$('empty-login').onclick=()=>run(()=>window.leettrack.login());
$('account-entry').onclick=()=>state?.connection==='connected'&&state.account?$('settings').showModal():run(()=>window.leettrack.login());
$('sync').onclick=()=>run(()=>state?.connection==='signed-out'?window.leettrack.login():window.leettrack.sync(false));
$('history').onclick=$('records-history').onclick=()=>run(()=>state.historyRunning?window.leettrack.pauseHistory():window.leettrack.sync(true));
$('export').onclick=()=>run(async()=>{if(await window.leettrack.export())toast('记录已导出。');});
document.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(view!=='books'&&view!=='records')switchView('books');const input=$(view==='records'?'record-search':'book-search');input.focus();input.select();}if(event.key==='Escape'){const input=document.activeElement;if(input?.type==='search'){input.value='';input.dispatchEvent(new Event('input'));input.blur();}else if(view==='review'&&queueVisible){queueVisible=false;renderReview();}}});
window.leettrack.onState(render);run(async()=>render(await window.leettrack.getState()));
window.addEventListener('online',()=>run(()=>window.leettrack.refresh()));
let currentDay=todayKey();setInterval(()=>{const next=todayKey();if(state&&next!==currentDay){currentDay=next;reviewKey=null;render(state);}},30000);
