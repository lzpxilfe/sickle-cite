const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const { fetchPdf, viewerUrls } = require('../download_tools');
const naming = require('../filename_tools');

function doc(links = {}, login = false) {
  return {
    querySelector: () => login ? {} : null,
    querySelectorAll: selector => (links[selector] || []).map(value => ({ getAttribute: () => value }))
  };
}
function response(body, type = 'application/pdf', url = 'https://www.kci.go.kr/view') {
  return { ok: true, url, headers: new Headers({ 'content-type': type }), blob: async () => new Blob([body]) };
}

test('long Korean and emoji names keep PDF extension within UTF-8 budget', () => {
  for (const title of ['논문'.repeat(150), '📚'.repeat(150), '한'.repeat(150)]) {
    const name = naming.withPdfExtension(title);
    assert.ok(Buffer.byteLength(name) <= 235);
    assert.ok(name.endsWith('.pdf'));
    assert.ok(!name.includes('\uFFFD'));
    assert.equal(name, Buffer.from(name).toString());
  }
});

test('viewer discovery deduplicates and rejects scripts and unrelated origins', () => {
  assert.deepEqual(viewerUrls(doc({
    'iframe[src]': ['/pdf', 'javascript:alert(1)', 'https://other.test/pdf'],
    'embed[src]': ['/pdf'], 'a[href]': ['/paper.pdf', '/login']
  }), 'https://www.kci.go.kr/view'), ['https://www.kci.go.kr/pdf', 'https://www.kci.go.kr/paper.pdf']);
});

test('POST viewer resolves relative iframe using redirected URL and switches to GET', async () => {
  const calls = [];
  const blob = await fetchPdf({ url: 'https://www.kci.go.kr/start', options: { method: 'POST', body: 'id=1' } }, {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return calls.length === 1 ? response('<iframe/>', 'text/html', 'https://www.kci.go.kr/nested/view') : response('%PDF-1.7\nbody', 'application/octet-stream');
    }, parseHtml: () => doc({ 'iframe[src]': ['paper.pdf'] })
  });
  assert.equal(blob.type, 'application/pdf');
  assert.equal(calls[1].url, 'https://www.kci.go.kr/nested/paper.pdf');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[1].options.method, 'GET');
  assert.equal(calls[1].options.body, undefined);
  assert.ok(calls.every(call => call.options.credentials === 'include'));
});

test('HTML disguised as PDF, ZIP and empty responses are not saved', async () => {
  for (const body of ['<html>Login</html>', 'PK zip', '']) {
    assert.equal(await fetchPdf({ url: 'https://www.kci.go.kr/file' }, { fetch: async () => response(body) }), null);
  }
});

test('login and cyclic viewers stop without retry loops', async () => {
  for (const login of [true, false]) {
    let calls = 0;
    assert.equal(await fetchPdf({ url: 'https://www.kci.go.kr/view' }, {
      fetch: async () => { calls++; return response('<html/>', 'text/html'); },
      parseHtml: () => doc({ 'iframe[src]': ['/view'] }, login)
    }), null);
    assert.equal(calls, 1);
  }
});

test('network timeout aborts and returns control to caller', async () => {
  assert.equal(await fetchPdf({ url: 'https://www.kci.go.kr/file' }, {
    timeoutMs: 10,
    fetch: (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
  }), null);
});

test('background refuses recency-only matches and non-PDF downloads', () => {
  let listener;
  const sandbox = {
    importScripts() {}, URL, SickleCiteFileNaming: naming,
    chrome: { downloads: { onDeterminingFilename: { addListener(fn) { listener = fn; } } } }
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(require.resolve('../background.js'), 'utf8'), sandbox);
  const context = { pageUrl: 'https://www.kci.go.kr/detail?id=A', downloadUrl: 'https://www.kci.go.kr/download?id=A', capturedAt: Date.now() };
  const entry = { context, tabId: 1 };
  assert.equal(sandbox.contextScore(entry, { url: 'https://www.kci.go.kr/download?id=B', tabId: 2 }, Date.now()), 0);
  assert.ok(sandbox.contextScore(entry, { url: context.downloadUrl, finalUrl: 'https://www.kci.go.kr/redirect' }, Date.now()) >= 12);
  assert.equal(listener({ url: context.downloadUrl, filename: 'report.zip', mime: 'application/zip' }, () => assert.fail()), false);
});

test('click interception preserves modifiers, deduplicates and replays failure once', async () => {
  const source = fs.readFileSync(require.resolve('../content_script.js'), 'utf8');
  const handler = source.slice(source.indexOf('async function handlePossibleDownload('), source.indexOf('function optionLabelFromContext('));
  let requests = 0;
  let replays = 0;
  let resolveDownload;
  const control = { click() { replays++; void sandbox.handlePossibleDownload(event()); } };
  const sandbox = {
    URL, location: {href: "https://www.kci.go.kr/view", origin: "https://www.kci.go.kr"},
    pdfFilenameFeatureEnabled: true, isPdfFilenameSupportedPage: () => true,
    safeClosest: () => control, isLikelyDownloadControl: () => true,
    forcedDownloadControls: new WeakSet(), pendingDownloadControls: new WeakSet(),
    lastDownloadContextSentAt: 0, DOWNLOAD_CONTEXT_DEBOUNCE_MS: 300,
    downloadControls: () => [control], buildDownloadContext: () => ({}),
    sendDownloadContext() {}, downloadRequestFromControl: () => ({ url: 'https://www.kci.go.kr/pdf' }),
    filenameForContext: async () => 'paper.pdf',
    downloadRequestWithFilename: () => { requests++; return new Promise(resolve => { resolveDownload = resolve; }); }
  };
  vm.createContext(sandbox);
  vm.runInContext(handler, sandbox);
  function event(extra = {}) {
    return { type: 'click', preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra };
  }
  for (const extra of [{ metaKey: true }, { ctrlKey: true }, { type: 'keydown' }, { button: 1 }]) {
    const e = event(extra);
    await sandbox.handlePossibleDownload(e);
    assert.equal(e.prevented, undefined);
  }
  const first = sandbox.handlePossibleDownload(event());
  await Promise.resolve();
  await sandbox.handlePossibleDownload(event());
  assert.equal(requests, 1);
  resolveDownload(false);
  await first;
  assert.equal(replays, 1);
  assert.equal(requests, 1);
  assert.equal(sandbox.pendingDownloadControls.has(control), false);
});

test('PDF.js file parameter resolves the actual document without executing scripts',async()=>{
 const calls=[];
 const pdf=await fetchPdf({url:'https://www.kci.go.kr/pdfjs/web/viewer.html?file=%2Fpaper.pdf'}, {
  fetch:async url=>{calls.push(url);return calls.length===1?response('<html/>','text/html',url):response('%PDF-1.7');},parseHtml:()=>doc()
 });
 assert.ok(pdf);assert.equal(calls[1],'https://www.kci.go.kr/paper.pdf');
});
