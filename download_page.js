(async function () {
  const api = globalThis.browser || globalThis.chrome;
  const status = document.getElementById('status');
  function call(object, method, ...args) {
    if (globalThis.browser) return object[method](...args);
    return new Promise((resolve, reject) => object[method](...args, value => {
      const error = globalThis.chrome.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve(value);
    }));
  }
  try {
    const response = await call(api.runtime, 'sendMessage', { type: 'SICKLE_CITE_GET_DOWNLOAD_JOB', token: location.hash.slice(1) });
    if (!response?.success) throw new Error(response?.error || '저장 요청을 찾지 못했습니다.');
    const { job } = response;
    document.getElementById('filename').textContent = job.filename;
    const copy = document.getElementById('copy');
    copy.hidden = false;
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(job.filename); copy.textContent = '복사됨'; }
      catch (_) { status.textContent = '위 파일명을 선택하여 복사해 주세요.'; }
    };
    const source = document.getElementById('source');
    if (Number.isInteger(job.sourceTabId)) {
      source.hidden = false;
      source.onclick = () => call(api.tabs, 'update', job.sourceTabId, { active: true }).catch(() => { status.textContent = '원문 탭이 닫혔습니다.'; });
    }
    if (job.request.options?.method === 'POST') {
      job.request.options.body = new URLSearchParams(job.request.options.body);
    }
    const blob = await globalThis.SickleCiteDownloads.fetchPdf(job.request, { allowCrossOrigin: true, timeoutMs: 60000 });
    if (!blob) throw new Error('PDF 원문을 받지 못했습니다. 원문 탭에서 로그인·이용 권한을 확인한 후 다시 실행하세요. 페이지가 JavaScript 전용 뷰어이면 사이트의 저장 기능을 사용하고 위 파일명을 붙여 넣으세요.');
    const url = URL.createObjectURL(blob);
    const save = document.getElementById('save');
    save.href = url;
    save.download = job.filename;
    save.hidden = false;
    status.textContent = 'PDF가 준비되었습니다. 저장 버튼을 눌러 인용 파일명으로 저장하세요.';
    save.addEventListener('click', () => { status.textContent = '저장을 요청했습니다. Safari 다운로드 목록에서 결과를 확인하세요.'; });
    window.addEventListener('pagehide', () => URL.revokeObjectURL(url), { once: true });
  } catch (error) {
    status.textContent = error.message;
  }
})();
