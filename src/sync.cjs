const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

function normalizeSubmission(raw) {
  const id = String(raw.id ?? '');
  const timestamp = Number(raw.timestamp);
  const slug = raw.title_slug ?? raw.titleSlug ?? raw.question?.titleSlug ?? null;
  const title = raw.title ?? raw.question?.title ?? slug;
  if (!/^\d+$/.test(id) || !Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp*1000).getTime()) || typeof title !== 'string' || !title.trim() || (slug !== null && (typeof slug !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(slug)))) {
    throw new Error('提交数据格式已变化，未覆盖本地记录。');
  }
  return {
    id, timestamp, slug,
    title,
    language: String(raw.lang ?? ''),
    status: String(raw.status_display ?? raw.statusDisplay ?? '未知'),
    pending: /^(true|1|pending)$/i.test(String(raw.is_pending ?? raw.isPending ?? false)),
    runtime: String(raw.runtime ?? ''), memory: String(raw.memory ?? '')
  };
}

function parsePage(data) {
  if (!data || !Array.isArray(data.submissions_dump) || typeof data.has_next !== 'boolean') {
    throw new Error('提交接口返回格式不符合预期，需要适配后再同步。');
  }
  const items = data.submissions_dump.map(normalizeSubmission);
  if (data.has_next && items.length === 0) throw new Error('分页返回为空，已停止，避免跳过记录。');
  return { items, hasNext: data.has_next, lastKey: String(data.last_key ?? '') };
}

function mergeRecords(existing, incoming) {
  const map = new Map(existing.map(x => [x.id, x]));
  let added = 0, updated = 0;
  for (const item of incoming) {
    const old = map.get(item.id);
    if (!old) added++;
    else if (JSON.stringify(old) !== JSON.stringify(item)) updated++;
    map.set(item.id, item);
  }
  return { records: [...map.values()].sort((a,b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id)), added, updated };
}

async function collectPages(fetchPage, existing, {cursor = null, maxPages = 10, stopAtKnown = true, shouldStop = () => false} = {}) {
  const known = new Map(existing.map(x => [x.id, x]));
  const unresolved = new Set(existing.filter(x => x.pending).map(x => x.id));
  let offset = cursor?.offset ?? 0, lastKey = cursor?.lastKey ?? '';
  let records = [], pages = 0, complete = false, caughtUp = false;
  const seenPages = new Set();
  for (; pages < maxPages;) {
    if (shouldStop()) break;
    let page;
    try { page = parsePage(await fetchPage({offset, lastKey, limit: 20})); }
    catch (error) {
      if (pages > 0) error.partial = {records,pages,complete:false,caughtUp:false,cursor:{offset,lastKey}};
      throw error;
    }
    const signature = page.items.map(x => x.id).join(',');
    if (signature && seenPages.has(signature)) {
      const error = new Error('接口重复返回同一页，已停止分页。');
      error.retryable = false;
      error.partial = {records,pages,complete:false,caughtUp:false,cursor:{offset,lastKey}};
      throw error;
    }
    seenPages.add(signature);
    records.push(...page.items); pages++;
    for (const item of page.items) unresolved.delete(item.id);
    offset += page.items.length; lastKey = page.lastKey;
    if (!page.hasNext) { complete = true; break; }
    // Read two overlapping pages so recent pending verdicts can be refreshed.
    if (stopAtKnown && pages >= 2 && !unresolved.size && page.items.every(x => known.has(x.id) && !known.get(x.id).pending)) {
      caughtUp = true; break;
    }
  }
  return { records, pages, complete, caughtUp, cursor: complete || caughtUp ? null : {offset, lastKey} };
}

class Store {
  constructor(directory) { this.directory = directory; }
  filename(username) { return path.join(this.directory, crypto.createHash('sha256').update(username).digest('hex') + '.json'); }
  async load(username) {
    try {
      const data = JSON.parse(await fs.readFile(this.filename(username), 'utf8'));
      if (data.version !== 1 || data.username !== username || !Array.isArray(data.records)) throw new Error('invalid store');
      if (data.records.some(x => !x || typeof x.id!=='string' || !/^\d+$/.test(x.id) || !Number.isFinite(x.timestamp) || x.timestamp <= 0 || !Number.isFinite(new Date(x.timestamp*1000).getTime()) || typeof x.title !== 'string' || !x.title.trim() || typeof x.pending !== 'boolean' || typeof x.status !== 'string' || (x.slug != null && (typeof x.slug!=='string'|| !/^[a-zA-Z0-9_-]+$/.test(x.slug))))) throw new Error('invalid records');
      if(data.problemMetadata!=null && (!Array.isArray(data.problemMetadata) || data.problemMetadata.some(x=>!x || typeof x.slug!=='string' || !/^[a-zA-Z0-9_-]+$/.test(x.slug) || typeof x.title!=='string' || !x.title.trim() || typeof x.english!=='string')))throw new Error('invalid metadata');
      if (data.historyCursor && (!Number.isSafeInteger(data.historyCursor.offset) || data.historyCursor.offset < 0 || typeof data.historyCursor.lastKey !== 'string')) throw new Error('invalid cursor');
      if (data.incrementalCursor && (!Number.isSafeInteger(data.incrementalCursor.offset) || data.incrementalCursor.offset < 0 || typeof data.incrementalCursor.lastKey !== 'string')) throw new Error('invalid incremental cursor');
      if (data.lastSync && !Number.isFinite(Date.parse(data.lastSync))) throw new Error('invalid date');
      return data;
    } catch (error) {
      if (error.code === 'ENOENT') return {version: 1, username, records: [], lastSync: null, historyComplete: false, historyCursor: null};
      const failure = new Error('本地记录无法读取，已保留原文件，请先检查数据文件。');
      failure.retryable = false;
      throw failure;
    }
  }
  async save(data) {
    await fs.mkdir(this.directory, {recursive:true});
    const file = this.filename(data.username);
    await fs.writeFile(file + '.tmp', JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(file + '.tmp', file);
  }
}

module.exports = { normalizeSubmission, parsePage, mergeRecords, collectPages, Store };
