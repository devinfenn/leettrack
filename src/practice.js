(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LeetPractice = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const DAY = 86400000;
  const intervals = [1, 3, 7, 14, 30, 60];
  const ratingLabels={independent:'独立做出',hint:'需要提示',failed:'没做出'};
  const formatter = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit'});
  const titleKey = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  const isAccepted = record => !record.pending && ['accepted', '通过'].includes(String(record.status).toLowerCase());
  function dayKey(seconds) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(seconds * 1000)).map(x => [x.type, x.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  const shiftDay = (day, amount) => new Date(Date.parse(day + 'T00:00:00Z') + amount * DAY).toISOString().slice(0,10);
  function indexCatalog(plans) {
    const aliases = new Map();
    for (const plan of plans) for (const item of plan.questions) {
      aliases.set('slug:' + item.slug, item);
      for (const title of [item.title,item.english]) {
        if(!title)continue;
        const key='title:' + titleKey(title);
        if(!aliases.has(key))aliases.set(key,item);
        else if(aliases.get(key)?.slug!==item.slug)aliases.set(key,null);
      }
    }
    return aliases;
  }
  function applyRating(stage,rating){
    if(rating==='independent'){stage=Math.min(Math.max(0,stage+1),intervals.length-1);return {stage,interval:intervals[stage]};}
    if(rating==='hint')return {stage:Math.max(0,stage-1),interval:2};
    if(rating==='failed')return {stage:0,interval:1};
    throw new Error('未知复习反馈');
  }
  function reviewSchedule(days,feedback){
    const events=new Map(days.filter(x=>x.accepted).map(x=>[x.day,{accepted:true}]));
    for(const entry of feedback){const event=events.get(entry.day) || {};if(!event.feedback || entry.at>=event.feedback.at)event.feedback=entry;events.set(entry.day,event);}
    let stage=-1,interval=0,nextReview=null,lastRating=null,lastFeedbackDay=null;
    for(const [day,event] of [...events].sort((a,b)=>a[0].localeCompare(b[0]))){
      if(event.feedback){({stage,interval}=applyRating(stage,event.feedback.rating));lastRating=event.feedback.rating;lastFeedbackDay=day;}
      else if(!lastRating){stage=Math.min(stage+1,intervals.length-1);interval=intervals[stage];}
      // After explicit feedback, a later AC keeps the interval conservative;
      // only an independent result extends it. Each date contributes once.
      nextReview=shiftDay(day,interval);
    }
    return {reviewStage:stage,reviewInterval:interval,nextReview,lastRating,lastFeedbackDay};
  }
  function feedbackPlan(question,rating,day=dayKey(Date.now()/1000)){
    const before=reviewSchedule(question.days.filter(x=>x.day<day),(question.reviewHistory || []).filter(x=>x.day<day));
    const result=applyRating(before.reviewStage,rating);
    return {...result,day,nextReview:shiftDay(day,result.interval)};
  }
  function aggregate(records, plans = [], identityRecords = records, feedback = []) {
    const aliases = indexCatalog(plans);
    const inferred=new Map();
    for (const record of identityRecords) if(record.slug){
      const key='title:'+titleKey(record.title);
      if(!inferred.has(key))inferred.set(key,{slug:record.slug,title:record.title});
      else if(inferred.get(key)?.slug!==record.slug)inferred.set(key,null);
    }
    for(const [key,meta] of inferred)if(!aliases.has(key))aliases.set(key,meta);
    const groups = new Map();
    for (const record of records) {
      const byTitle=aliases.get('title:' + titleKey(record.title));
      const meta = record.slug ? aliases.get('slug:' + record.slug) || (byTitle?.slug===record.slug?byTitle:null) : byTitle;
      const slug = meta?.slug || record.slug;
      const key = slug ? 'slug:' + slug : 'title:' + titleKey(record.title);
      if (!groups.has(key)) groups.set(key, {key, slug, title:meta?.title || record.title, number:meta?.id || '', group:meta?.group || '', difficulty:meta?.difficulty || '', daily:new Map(), lastTimestamp:0,recordIds:[]});
      const question = groups.get(key);
      question.recordIds.push(record.id);
      const day = dayKey(record.timestamp);
      if (!question.daily.has(day)) question.daily.set(day, {day, accepted:false, timestamp:0, id:record.id});
      const entry = question.daily.get(day);
      entry.accepted ||= isAccepted(record);
      if (record.timestamp >= entry.timestamp) {entry.timestamp=record.timestamp; entry.id=record.id;}
      if (record.timestamp >= question.lastTimestamp) {question.lastTimestamp=record.timestamp; question.lastId=record.id;}
    }
    return [...groups.values()].map(question => {
      const days = [...question.daily.values()].sort((a,b) => b.day.localeCompare(a.day));
      const passed = days.filter(x => x.accepted);
      const ids=new Set(question.recordIds);const byDay=new Map();
      for(const entry of feedback.filter(x=>ids.has(x.submissionId)).sort((a,b)=>a.at-b.at))byDay.set(entry.day,entry);
      const reviewHistory=[...byDay.values()].sort((a,b)=>a.day.localeCompare(b.day));
      const schedule=reviewSchedule(days,reviewHistory);
      const {daily, ...rest} = question;
      return {...rest, days, practicedDays:days.length, successfulDays:passed.length, lastDay:days[0].day, reviewHistory,...schedule};
    }).sort((a,b) => b.lastTimestamp - a.lastTimestamp || a.key.localeCompare(b.key));
  }
  function reviewQueue(records, plans = [], today = dayKey(Date.now()/1000), limit = 6, feedback = []) {
    // Eligibility is computed before today's submissions, so completing a
    // question cannot refill the queue and turn six reviews into an endless task.
    const beforeToday = aggregate(records.filter(x => dayKey(x.timestamp) < today), plans, records,feedback.filter(x=>x.day<today));
    const current = new Map(aggregate(records, plans,records,feedback).map(x => [x.key, x]));
    return beforeToday.filter(x => x.nextReview && x.nextReview <= today)
      .sort((a,b) => Number(b.lastRating==='failed')-Number(a.lastRating==='failed') || a.nextReview.localeCompare(b.nextReview) || a.successfulDays - b.successfulDays || a.key.localeCompare(b.key))
      .slice(0, limit).map(old => {
        const question = current.get(old.key);
        const rating=question.reviewHistory.find(x=>x.day===today) || null;
        const acceptedToday=question.days.some(x=>x.day===today&&x.accepted);
        return {question, dueDay:old.nextReview, rating,acceptedToday,awaitingFeedback:acceptedToday&&!rating,done:!!rating||acceptedToday};
      });
  }
  function bookRows(plan, questions) {
    const bySlug = new Map(questions.filter(x => x.slug).map(x => [x.slug,x]));
    return plan.questions.map(meta => bySlug.get(meta.slug) || {key:'slug:' + meta.slug, slug:meta.slug, title:meta.title, number:meta.id, group:meta.group, difficulty:meta.difficulty, days:[], practicedDays:0, successfulDays:0, lastTimestamp:0, lastDay:null, nextReview:null});
  }
  return {dayKey, shiftDay, isAccepted, aggregate, reviewQueue, bookRows, intervals,ratingLabels,feedbackPlan};
});
