(function (global) {
  'use strict';

  // Inspect declarative PDF/viewer links only; never execute downloaded HTML.
  function viewerUrls(doc, baseUrl, allowCrossOrigin = false) {
    const selectors = [
      ['meta[name="citation_pdf_url"]', 'content'],
      ['embed[src]', 'src'], ['object[data]', 'data'],
      ['iframe[src]', 'src'], ['a[href]', 'href']
    ];
    const urls = new Set();
    for (const [selector, attr] of selectors) {
      for (const element of doc.querySelectorAll(selector)) {
        try {
          const raw = element.getAttribute(attr);
          if (!raw || raw === '#' || raw === 'about:blank') continue;
          const url = new URL(raw, baseUrl);
          if (url.protocol === 'http:' && new URL(baseUrl).protocol === 'https:' && url.hostname === new URL(baseUrl).hostname) url.protocol = 'https:';
          const label = `${element.textContent || ''} ${element.getAttribute('title') || ''} ${url.pathname}`;
          if (/(?:이용안내|매뉴얼|필드명 설명|guide|manual|kci_data_filed)/i.test(label)) continue;
          if (selector === 'iframe[src]' && !/pdf|viewer|streamdocs|original|orte|download/i.test(url.href)) continue;
          if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
          if (selector === 'a[href]' && !/\.pdf(?:$|[?#])/i.test(url.href)) continue;
          // Preserve the site's session and avoid following unrelated frame origins.
          if (url.origin !== new URL(baseUrl).origin && !allowCrossOrigin) continue;
          url.hash = '';
          if (url.href !== new URL(baseUrl).href.split('#')[0]) urls.add(url.href);
        } catch (_) {}
      }
    }
    // Standard PDF.js viewers carry the actual PDF URL in the file parameter.
    try {
      const base = new URL(baseUrl);
      if (/pdfjs|\/viewer\.html/i.test(base.pathname) && base.searchParams.get('file')) {
        const file = new URL(base.searchParams.get('file'), base);
        if (/^https?:$/.test(file.protocol) && (allowCrossOrigin || file.origin === base.origin)) urls.add(file.href);
      }
    } catch (_) {}
    return [...urls];
  }

  async function fetchPdf(request, dependencies = {}) {
    const fetcher = dependencies.fetch || global.fetch.bind(global);
    const parseHtml = dependencies.parseHtml || (text => new DOMParser().parseFromString(text, 'text/html'));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs || 20000);
    const visited = new Set();
    let attempts = 0;
    async function visit(url, options, depth) {
      if (controller.signal.aborted || depth > 3 || attempts >= 6 || visited.has(url)) return null;
      if (!/^https?:\/\//i.test(url)) return null;
      visited.add(url);
      attempts += 1;
      const response = await fetcher(url, { ...options, credentials: 'include', signal: controller.signal });
      if (!response.ok) return null;
      const blob = await response.blob();
      if (!blob.size) return null;
      const header = await blob.slice(0, 5).text();
      if (header === '%PDF-') return new Blob([blob], { type: 'application/pdf' });
      const type = response.headers.get('content-type') || '';
      if (!/text\/html|application\/xhtml\+xml/i.test(type) || blob.size > 2 * 1024 * 1024) return null;
      const doc = parseHtml(await blob.text());
      // Login forms are left to normal site navigation.
      if (doc.querySelector('input[type="password"]')) return null;
      for (const candidate of viewerUrls(doc, response.url || url, dependencies.allowCrossOrigin)) {
        try {
          const pdf = await visit(candidate, { method: 'GET' }, depth + 1);
          if (pdf) return pdf;
        } catch (error) {
          if (controller.signal.aborted) throw error;
        }
      }
      return null;
    }
    try {
      return await visit(request.url, request.options || {}, 0);
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  const api = { viewerUrls, fetchPdf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SickleCiteDownloads = api;
})(globalThis);
