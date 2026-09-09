importScripts('filename_tools.js');
const extensionBrowser = globalThis.browser;
const extensionChrome = globalThis.chrome;
const api = extensionBrowser || extensionChrome;
const fileNaming = globalThis.SickleCiteFileNaming;
const pendingContexts = [];
const CONTEXT_TTL_MS = 30 * 60 * 1000;
const MAX_CONTEXTS = 60;
const CONTEXT_KEY = 'sickleCiteViewerContextsV2';
const contextArea = api?.storage?.session || api?.storage?.local;
let writeQueue = Promise.resolve();
let jobQueue = Promise.resolve();

function callApi(object, method, ...args) {
  if (!object?.[method]) return Promise.resolve(undefined);
  if (extensionBrowser) return Promise.resolve().then(() => object[method](...args));
  return new Promise((resolve, reject) => {
    object[method](...args, result => {
      const error = extensionChrome?.runtime?.lastError;
      if (error) reject(new Error(error.message)); else resolve(result);
    });
  });
}
function settings() {
  return callApi(api?.storage?.sync || api?.storage?.local, 'get', null).then(value => value || {}).catch(() => ({}));
}
function cleanupContexts(now = Date.now()) {
  for (let index = pendingContexts.length - 1; index >= 0; index--) {
    const time = pendingContexts[index]?.context?.capturedAt;
    if (!Number.isFinite(time) || time > now || now - time > CONTEXT_TTL_MS) pendingContexts.splice(index, 1);
  }
  if (pendingContexts.length > MAX_CONTEXTS) pendingContexts.splice(0, pendingContexts.length - MAX_CONTEXTS);
}
const contextsReady = callApi(contextArea, 'get', CONTEXT_KEY).then(value => {
  if (Array.isArray(value?.[CONTEXT_KEY])) pendingContexts.push(...value[CONTEXT_KEY].filter(entry => hasUsefulContext(entry?.context)));
  cleanupContexts();
}).catch(() => {});
function persistContexts() {
  // Serialize writes, taking a fresh snapshot after previous storage calls complete.
  writeQueue = writeQueue.then(() => callApi(contextArea, 'set', { [CONTEXT_KEY]: pendingContexts.slice() })).catch(() => {});
  return writeQueue;
}
function hasUsefulContext(context) {
  if (!context || !/^https?:\/\//.test(context.pageUrl || '')) return false;
  if (context.kind === 'report') return fileNaming.isHeritageUrl(context.pageUrl) && Boolean(context.report?.reportTitle);
  return Boolean(context.metadata?.title_main);
}
function rememberContext(context, sender) {
  if (!hasUsefulContext(context) || !Number.isInteger(sender?.tab?.id)) return;
  if (sender.url && sender.url !== context.pageUrl) return;
  const tabId = sender.tab.id;
  const frameId = sender.frameId || 0;
  const next = { ...context, capturedAt: Date.now() };
  const existing = pendingContexts.findIndex(entry => entry.tabId === tabId && entry.frameId === frameId && entry.context.pageUrl === next.pageUrl && entry.context.downloadUrl === next.downloadUrl);
  if (existing >= 0) pendingContexts.splice(existing, 1);
  pendingContexts.push({ context: next, tabId, frameId });
  cleanupContexts();
}
function paperId(value) {
  try {
    const url = new URL(value);
    const host = fileNaming.academicHost(value) || url.hostname;
    for (const key of ['control_no', 'nodeId', 'artiId', 'sereArticleSearchBean.artiId', 'key', 'cn', 'article_id']) {
      const id = url.searchParams.get(key);
      if (id) return host + ':' + key.replace('sereArticleSearchBean.', '') + ':' + id;
    }
    const pathId = url.pathname.match(/\/(?:article|Article|handle|bitstream|articles)\/([^/?]+(?:\/[^/?]+)?)/i);
    return pathId ? host + ':' + pathId[1].replace(/\.(?:page|pdf|html)$/, '') : '';
  } catch (_) { return ''; }
}
function contextScore(entry, item, now) {
  if (!entry?.context || !item) return 0;
  const context = entry.context;
  const age = now - context.capturedAt;
  if (age < 0 || age > CONTEXT_TTL_MS) return 0;
  const urls = [item.url, item.finalUrl].filter(Boolean);
  const ids = urls.map(paperId).filter(Boolean);
  const contextId = paperId(context.paperUrl || context.pageUrl) || paperId(context.downloadUrl);
  if (ids.length && contextId && !ids.includes(contextId)) return 0;
  let score = 0;
  if (context.downloadUrl && urls.includes(context.downloadUrl)) score += 12;
  if (contextId && ids.includes(contextId)) score += 12;
  if (context.pageUrl && context.pageUrl === (item.referrer || item.tabUrl)) score += 8;
  if (context.intent && entry.tabId === item.tabId && age < 10000) score += 4;
  return score;
}
function chooseContext(item) {
  cleanupContexts();
  const ranked = pendingContexts.map(entry => ({ entry, score: contextScore(entry, item, Date.now()) })).filter(match => match.score >= 4).sort((a, b) => b.score - a.score || b.entry.context.capturedAt - a.entry.context.capturedAt);
  if (ranked[0] && ranked[1] && ranked[0].score === ranked[1].score && ranked[0].entry.context.metadata?.title_main !== ranked[1].entry.context.metadata?.title_main) return null;
  return ranked[0]?.entry || null;
}
function findViewerContext(tab, pageUrl, referrer = '') {
  cleanupContexts();
  const item = { url: pageUrl, referrer, tabId: tab?.id };
  const exact = chooseContext(item);
  if (exact) return exact.context;
  const retained = pendingContexts.find(entry => entry.tabId === tab?.id && (entry.context.pageUrl === pageUrl || (entry.linkedTab && (!entry.linkedUrl || entry.linkedUrl === pageUrl))));
  if (retained) return retained.context;
  const targetId = paperId(pageUrl);
  const candidates = pendingContexts.filter(entry => {
    const sourceId = paperId(entry.context.paperUrl || entry.context.pageUrl);
    if (targetId && sourceId && targetId !== sourceId) return false;
    const related = entry.tabId === tab?.openerTabId || entry.tabId === tab?.id;
    // A real tab relationship plus recent explicit download intent is required.
    return related && entry.context.intent && Date.now() - entry.context.capturedAt < 120000;
  });
  const distinct = new Set(candidates.map(entry => entry.context.metadata?.title_main || entry.context.report?.reportTitle));
  return distinct.size === 1 ? candidates[candidates.length - 1]?.context : null;
}
async function contextForSender(message, sender) {
  await contextsReady;
  if (!sender?.tab || (sender.url && sender.url !== message.pageUrl)) return null;
  const tab = await callApi(api?.tabs, 'get', sender.tab.id).catch(() => null) || sender.tab;
  return findViewerContext(tab, message.pageUrl, message.referrer);
}
api?.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith('SICKLE_CITE_')) return false;
  (async () => {
    await contextsReady;
    const prefs = await settings();
    if (!fileNaming.isPdfFilenameEnabled(prefs)) return { success: false, context: null };
    if (message.type === fileNaming.DOWNLOAD_CONTEXT_MESSAGE) {
      rememberContext(message.context, sender);
      await persistContexts();
      return { success: true };
    }
    if (message.type === 'SICKLE_CITE_GET_CONTEXT') {
      const context = await contextForSender(message, sender);
      if (context) {
        rememberContext({ ...context, pageUrl: message.pageUrl, sourcePageUrl: context.sourcePageUrl || context.pageUrl, downloadUrl: '', intent: false }, sender);
        await persistContexts();
      }
      return { success: true, context };
    }
    if (message.type === 'SICKLE_CITE_VIEWER_DOWNLOAD') {
      if (!sender.tab || !fileNaming.isAcademicUrl(sender.url)) return { success: false, error: '지원하는 학술 뷰어가 아닙니다.' };
      const filename = fileNaming.withPdfExtension(message.filename);
      const frames = [...new Set([0, sender.frameId || 0])];
      for (const frameId of frames) {
        const results = await callApi(api.scripting, 'executeScript', {
          target: { tabId: sender.tab.id, frameIds: [frameId] }, world: 'MAIN',
          func: async function (name) {
            try {
              if (globalThis.streamdocs?.document?.download) {
                await globalThis.streamdocs.document.download({ fileName: name });
                return { success: true, method: 'viewer' };
              }
              const pdf = globalThis.PDFViewerApplication?.pdfDocument;
              if (pdf?.getData) {
                const bytes = await pdf.getData();
                const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
                const a = document.createElement('a');
                a.setAttribute('data-sickle-generated', 'true');
                a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 60000);
                return { success: true, method: 'viewer' };
              }
              return { success: false };
            } catch (error) { return { success: false, error: error.message }; }
          }, args: [filename]
        }).catch(() => []);
        const result = results?.find(item => item.result?.success)?.result;
        if (result) return result;
      }
      return { success: false, error: '뷰어가 파일 저장을 허용하지 않거나 지원하는 뷰어 API가 없습니다. 사이트의 다운로드 버튼을 사용해 주세요.' };
    }
    if (message.type === 'SICKLE_CITE_OPEN_DOWNLOAD') {
      const url = new URL(message.request?.url);
      if (!/^https?:$/.test(url.protocol)) throw new Error('지원하지 않는 다운로드 주소입니다.');
      const token = crypto.randomUUID();
      const job = { request: { url: url.href, options: {
        method: message.request?.options?.method === 'POST' ? 'POST' : 'GET',
        body: message.request?.options?.method === 'POST' ? String(message.request?.options?.body || '') : undefined
      } }, filename: fileNaming.withPdfExtension(message.filename), createdAt: Date.now(), sourceTabId: sender.tab?.id ?? message.tabId };
      // Jobs expire; retaining at most ten also bounds local fallback storage.
      jobQueue = jobQueue.catch(() => {}).then(async () => {
      const stored = await callApi(contextArea, 'get', 'sickleCiteDownloadJobs') || {};
      const jobs = Object.fromEntries(Object.entries(stored.sickleCiteDownloadJobs || {}).filter(([, value]) => Date.now() - value.createdAt < 300000).slice(-9));
      jobs[token] = job;
      await callApi(contextArea, 'set', { sickleCiteDownloadJobs: jobs });
      });
      await jobQueue;
      await callApi(api.tabs, 'create', { url: api.runtime.getURL('download.html') + '#'+ token, active: true });
      return { success: true, method: 'helper' };
    }
    if (message.type === 'SICKLE_CITE_GET_DOWNLOAD_JOB') {
      if (!sender.url?.startsWith(api.runtime.getURL('download.html'))) throw new Error('저장 화면에서만 사용할 수 있습니다.');
      const stored = await callApi(contextArea, 'get', 'sickleCiteDownloadJobs');
      const job = stored?.sickleCiteDownloadJobs?.[message.token];
      if (!job || Date.now() - job.createdAt > 300000) throw new Error('저장 요청이 만료되었습니다. 원문 페이지에서 다시 실행하세요.');
      return { success: true, job };
    }
    if (message.type === 'SICKLE_CITE_PDF_TAB_OPTIONS' && !sender.tab) {
      const tab = await callApi(api?.tabs, 'get', message.tabId);
      if (!tab?.url || !/\.pdf(?:$|[?#])|pdf|viewer|original|download|streamdocs|orte/i.test(tab.url)) return { success: true, options: [] };
      const context = findViewerContext(tab, tab.url);
      if (!context) return { success: true, options: [] };
      return { success: true, options: [{ optionId: 'native-pdf', label: '열린 PDF', url: tab.url, context, nativePdf: true, tabId: tab.id }] };
    }
    return { success: false };
  })().then(sendResponse).catch(error => sendResponse({ success: false, error: error.message }));
  return true;
});
api?.tabs?.onCreated?.addListener(tab => {
  if (!Number.isInteger(tab.openerTabId)) return;
  contextsReady.then(() => {
    cleanupContexts();
    const latest = pendingContexts.filter(entry => entry.tabId === tab.openerTabId && entry.context.intent && Date.now() - entry.context.capturedAt < 10000)
      .sort((a, b) => b.context.capturedAt - a.context.capturedAt);
    if (!latest.length) return;
    if (latest[1] && latest[1].context.capturedAt === latest[0].context.capturedAt && latest[1].context.metadata?.title_main !== latest[0].context.metadata?.title_main) return;
    pendingContexts.push({ ...latest[0], tabId: tab.id, linkedTab: true, context: { ...latest[0].context, intent: false } });
    cleanupContexts(); persistContexts();
  });
});
api?.tabs?.onUpdated?.addListener((tabId, change, tab) => {
  contextsReady.then(() => {
    let changed = false;
    for (let i = pendingContexts.length - 1; i >= 0; i--) {
      const entry = pendingContexts[i];
      if (entry.tabId !== tabId || !entry.linkedTab) continue;
      if (change.url && entry.linkedUrl && change.url !== entry.linkedUrl) { pendingContexts.splice(i, 1); changed = true; }
      else if (change.status === 'complete' && tab.url) { entry.linkedUrl = tab.url; changed = true; }
    }
    if (changed) persistContexts();
  });
});
api?.tabs?.onRemoved?.addListener(tabId => {
  contextsReady.then(() => {
    // Retain contexts briefly for existing child tabs, but remove old tab identity.
    for (const entry of pendingContexts) if (entry.tabId === tabId) entry.tabId = -1;
    persistContexts();
  });
});
api?.runtime?.onStartup?.addListener(() => {
  contextsReady.then(() => { pendingContexts.length = 0; persistContexts(); });
});
api?.downloads?.onDeterminingFilename?.addListener((item, suggest) => {
  const mime = String(item.mime || '').split(';')[0].trim().toLowerCase();
  const pdf = mime === 'application/pdf' || ((!mime || mime === 'application/octet-stream') && /\.pdf$/i.test(item.filename || ''));
  if (!pdf) return false;
  Promise.all([contextsReady, settings()]).then(([, prefs]) => {
    const entry = fileNaming.isPdfFilenameEnabled(prefs) && chooseContext(item);
    suggest(entry ? { filename: fileNaming.renderFilename(entry.context, prefs), conflictAction: 'uniquify' } : undefined);
  }).catch(() => suggest());
  return true;
});
