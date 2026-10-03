const {collectPages,mergeRecords}=require('./sync.cjs');
const P=require('./practice.js');
const plans=require('./catalog.js');
const MINUTE=60000;
class Tracker{
  constructor({store,reviewStore,identify,fetchPage,enrich=async(_records,existing)=>existing,onState=()=>{},onPersist=async()=>{},now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
    Object.assign(this,{store,reviewStore,identify,fetchPage,enrich,onState,onPersist,now,setTimer,clearTimer});
    this.state={connection:'unknown',message:'准备连接力扣中国站',account:null,records:[],problemMetadata:[],lastSync:null,historyComplete:false,historyCursor:null,historyError:null,result:null,busy:false,historyRunning:false,historyPausing:false,historyProgress:null,retryAt:null,revision:0};
    this.lastAttempt=0;this.failures=0;this.inflight=null;this.historyTask=null;this.pauseRequested=false;this.disposed=false;this.timer=null;
    this.state.reviewFeedback=[];this.state.reviewError=null;
  }
  emit(){if(!this.disposed){this.state.revision++;this.onState({...this.state});}}
  async loadReviews(username){try{return {reviewFeedback:this.reviewStore?(await this.reviewStore.load(username)).feedback:[],reviewError:null};}catch(error){return {reviewFeedback:[],reviewError:error.message};}}
  async restore(username){const saved=await this.store.load(username);const reviews=await this.loadReviews(username);this.state={...this.state,...saved,...reviews,problemMetadata:saved.problemMetadata || [],account:username,message:'已载入本地记录，正在检查登录状态…'};this.emit();}
  async rateReview(account,submissionId,rating){
    if(!this.reviewStore || typeof account!=='string' || !account || account!==this.state.account)throw new Error('账号已变化，请在当前账号下重新选择。');
    if(typeof submissionId!=='string' || !/^\d+$/.test(submissionId) || !Object.hasOwn(P.ratingLabels,rating))throw new Error('复习反馈无效。');
    const at=this.now(),day=P.dayKey(at/1000);
    const catalog=[{questions:this.state.problemMetadata || []},...plans];
    const item=P.reviewQueue(this.state.records,catalog,day,6,this.state.reviewFeedback).find(x=>x.question.recordIds.includes(submissionId));
    if(!item)throw new Error('题目不在今天的复习安排中，请刷新后重试。');
    let saved;
    try{saved=await this.reviewStore.upsert(account,{submissionId,day,rating,at},item.question.recordIds);}catch{throw new Error('复习反馈未保存，请检查本地数据后重试。');}
    if(this.state.account===account){this.state.reviewFeedback=saved.feedback;this.state.reviewError=null;this.emit();}
    return {rating,nextReview:P.feedbackPlan(item.question,rating,day).nextReview};
  }
  schedule(delay){
    this.clearTimer(this.timer);this.timer=null;
    if(this.disposed || this.state.historyRunning || delay==null)return;
    this.timer=this.setTimer(()=>{this.timer=null;void this.sync();},delay);
  }
  refresh(){
    if(this.disposed || this.inflight || this.state.historyRunning || this.state.connection==='signed-out' || this.now()-this.lastAttempt<30000)return;
    if(this.state.connection==='error' && (!this.state.retryAt || this.now()<this.state.retryAt))return;
    return this.sync();
  }
  sync(history=false){
    if(this.disposed)return Promise.resolve();
    if(this.inflight)return this.inflight;
    this.clearTimer(this.timer);this.timer=null;
    // Assign the promise before callbacks run, keeping IPC and focus refreshes serial.
    this.inflight=Promise.resolve().then(()=>this.perform(history)).finally(()=>{this.inflight=null;});
    return this.inflight;
  }
  async perform(history){
    this.lastAttempt=this.now();this.state.busy=true;this.state.retryAt=null;
    if(history)this.state.historyError=null;
    this.state.message=history?'正在补齐更早的练习…':'正在检查新增练习…';this.emit();
    let retryDelay=null;
    try{
      const username=await this.identify();
      const switched=this.state.account!==username;
      const saved=await this.store.load(username);
      const reviews=switched?await this.loadReviews(username):{};
      this.state={...this.state,...saved,...reviews,problemMetadata:saved.problemMetadata || [],account:username,connection:'connected',historyError:switched?null:this.state.historyError,result:switched?null:this.state.result};this.emit();
      // A history action was authorized for the previous account only.
      if(history && switched)throw Object.assign(new Error('登录账号发生变化，已切换到当前账号，请重新开始补齐历史。'),{retryable:false});
      if(history && saved.historyComplete){this.state.message='可访问的历史记录已经同步完成。';this.failures=0;retryDelay=5*MINUTE;return true;}
      let interrupted=null;
      const cursor=history?saved.historyCursor:saved.incrementalCursor;
      const batch=await collectPages(async args=>{
        this.state.message=history?`正在补齐历史 · 已保存 ${saved.records.length} 条 · 本批第 ${Math.floor((args.offset-(saved.historyCursor?.offset || 0))/20)+1} 页`:`正在检查新增练习 · 第 ${Math.floor(args.offset/20)+1} 页`;
        this.emit();return this.fetchPage(args);
      },saved.records,{cursor,stopAtKnown:!history,shouldStop:()=>this.disposed || (history&&this.pauseRequested)}).catch(error=>{if(!error.partial)throw error;interrupted=error;return error.partial;});
      if(this.disposed)return false;
      if(await this.identify()!==username)throw Object.assign(new Error('登录账号发生变化，本次结果未保存，请重新同步。'),{retryable:false});
      const merged=mergeRecords(saved.records,batch.records);
      const next={...saved,records:merged.records,lastSync:batch.pages?new Date(this.now()).toISOString():saved.lastSync};
      if(batch.complete){next.historyComplete=true;next.historyCursor=null;next.incrementalCursor=null;next.incrementalWasComplete=false;}
      else if(history || !saved.lastSync){next.historyCursor=batch.cursor || saved.historyCursor;next.historyComplete=false;}
      else if(batch.cursor){
        // Continue large gaps on the next automatic run instead of restarting
        // at page one and mistaking our newly saved prefix for the old overlap.
        next.incrementalCursor=batch.cursor;
        next.incrementalWasComplete=saved.incrementalCursor?saved.incrementalWasComplete:!!saved.historyComplete;
        next.historyComplete=false;
      }else{
        next.incrementalCursor=null;
        if(saved.incrementalCursor&&saved.incrementalWasComplete)next.historyComplete=true;
        next.incrementalWasComplete=false;
      }
      // Commit submissions before optional public metadata lookups.
      await this.store.save(next);
      this.state={...this.state,...next,result:{added:merged.added,updated:merged.updated,pages:batch.pages,at:next.lastSync}};
      if(this.state.historyRunning){const progress=this.state.historyProgress;this.state.historyProgress={pages:progress.pages+batch.pages,added:progress.added+merged.added,total:merged.records.length};}
      this.emit();
      await this.onPersist(username);
      if(interrupted)throw interrupted;
      if((!history || !this.pauseRequested) && !this.disposed){
        const metadata=await this.enrich(next.records,next.problemMetadata || [],()=>this.disposed || (history&&this.pauseRequested));
        if(JSON.stringify(metadata)!==JSON.stringify(next.problemMetadata || [])){next.problemMetadata=metadata;await this.store.save(next);this.state.problemMetadata=metadata;}
      }
      this.failures=0;this.state.connection='connected';
      if(next.historyComplete)this.state.historyError=null;
      this.state.message=history?(next.historyComplete?`历史已补齐 · 共 ${next.records.length} 条提交`:`已保存 ${next.records.length} 条，继续补齐历史…`):`同步完成 · 新增 ${merged.added} 条，更新 ${merged.updated} 条`;
      retryDelay=next.incrementalCursor?MINUTE:next.records.some(x=>x.pending&&x.timestamp>this.now()/1000-3600)?15000:5*MINUTE;
      return true;
    }catch(error){
      this.failures++;this.state.connection=error.auth?'signed-out':'error';
      this.state.message=error.auth || /力扣|接口|记录|分页|账号|提交|本地|历史/.test(error.message)?error.message:'网络连接失败或请求超时。已有记录已保留。';
      if(history&&error.status===403){this.state.connection='connected';this.state.historyError={message:this.state.message,at:this.now()};retryDelay=5*MINUTE;}
      else if(!error.auth && error.retryable!==false){retryDelay=Math.max(error.retryAfterMs || 0,Math.min(30*1000*2**Math.min(this.failures-1,5),15*MINUTE));this.state.retryAt=this.now()+retryDelay;}
      return false;
    }finally{
      this.state.busy=false;this.emit();this.schedule(retryDelay);
    }
  }
  fillHistory(){
    if(this.historyTask)return this.historyTask;
    this.pauseRequested=false;
    this.historyTask=this.runHistory().finally(()=>{this.historyTask=null;});return this.historyTask;
  }
  async runHistory(){
    if(this.inflight)await this.inflight;
    if(this.disposed)return;
    this.state.historyRunning=true;this.state.historyPausing=false;this.state.historyProgress={pages:0,added:0,total:this.state.records.length};this.clearTimer(this.timer);this.timer=null;this.emit();
    try{
      while(!this.pauseRequested&&!this.disposed){
        if(!await this.sync(true))break;
        if(this.state.historyComplete)break;
      }
    }finally{
      this.state.historyRunning=false;
      if(this.pauseRequested&&this.state.connection==='connected'&&!this.state.historyComplete)this.state.message=`历史已暂停 · 已保存 ${this.state.records.length} 条，下次从这里继续。`;
      this.state.historyPausing=false;this.pauseRequested=false;
      this.emit();
      this.schedule(this.state.connection==='connected'?5*MINUTE:this.state.retryAt?Math.max(0,this.state.retryAt-this.now()):null);
    }
  }
  pauseHistory(){if(!this.state.historyRunning)return;this.pauseRequested=true;this.state.historyPausing=true;this.state.message='正在暂停，将保存当前已读取的记录…';this.emit();}
  dispose(){this.disposed=true;this.pauseRequested=true;this.clearTimer(this.timer);this.timer=null;}
}
module.exports={Tracker};
