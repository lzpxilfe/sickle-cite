(function (global) {
  'use strict';
  const clean = value => String(typeof value === 'string' || typeof value === 'number' ? value : '')
    .replace(/<\s*\/?\s*(?:em|strong|b|i|span|sup|sub|mark)\b[^>]*>/gi, '')
    .replace(/〈\s*\/?\s*(?:em|strong|b|i|span|sup|sub|mark)\b[^〉]*〉/gi, '')
    .replace(/\s+/g, ' ').trim();
  const present = value => Array.isArray(value) ? value.length > 0 : Boolean(clean(value));
  function merge(primary, fallback) {
    const result = { ...fallback };
    for (const [key, value] of Object.entries(primary || {})) if (present(value)) result[key] = value;
    return result;
  }
  function authors(value) {
    return (Array.isArray(value) ? value : [value]).map(item => clean(typeof item === 'object' ? item?.name : item)).flatMap(value => value.split(/\s*[;；]\s*/)).filter(Boolean);
  }
  function record(fields) {
    const pages = clean(fields.pages).split(/\s*(?:--|[-–])\s*/);
    return {
      authors: authors(fields.authors), title_main: clean(fields.title).replace(/^\[(?:논문|학위논문|연구보고서)\]\s*/, ''),
      journal_name: clean(fields.journal).replace(/\s*=\s*.*$/, '').replace(/\s*\([A-Za-z][^)]*\)\s*$/, ''), publisher: clean(fields.publisher),
      year: (clean(fields.year).match(/\b(?:18|19|20)\d{2}\b/) || [''])[0],
      volume: clean(fields.volume), issue: clean(fields.issue),
      page_first: clean(fields.first || pages[0]), page_last: clean(fields.last || pages[1]),
      doi: clean(fields.doi), abstract: clean(fields.abstract)
    };
  }
  function parseRis(text) {
    const lines = String(text).split(/\r?\n/);
    const fields = {};
    let active = false, last = '';
    for (const line of lines) {
      const match = line.match(/^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/);
      if (match) {
        const [, key, value] = match;
        if (key === 'TY') { if (active) return {}; active = true; }
        if (!active) continue;
        if (key === 'ER') break;
        (fields[key] ||= []).push(value); last = key;
      } else if (active && last && /^\s+\S/.test(line)) fields[last][fields[last].length - 1] += ' ' + line.trim();
    }
    if (!active) return {};
    const get = (...keys) => keys.map(key => fields[key]?.[0]).find(Boolean);
    return record({ title: get('TI', 'T1'), authors: fields.AU || fields.A1, year: get('PY', 'Y1', 'DA'),
      journal: get('JO', 'JF', 'T2'), publisher: get('PB'), volume: get('VL'), issue: get('IS'),
      first: get('SP'), last: get('EP'), doi: get('DO'), abstract: get('AB', 'N2') });
  }
  function parseBibtex(text) {
    // Balanced values support nested title braces without evaluating TeX or JavaScript.
    const source = String(text);
    const start = /@(article|inproceedings|phdthesis|mastersthesis|book|incollection|techreport)\s*\{[^,]+,/i.exec(source);
    if (!start) return {};
    const fields = {};
    let pos = start.index + start[0].length;
    while (pos < source.length) {
      const key = /^\s*,?\s*([\w-]+)\s*=\s*/.exec(source.slice(pos));
      if (!key) break;
      pos += key[0].length;
      let value = '', depth = 0, quote = false;
      const opener = source[pos];
      if (opener === '{' || opener === '"') { depth = opener === '{' ? 1 : 0; quote = opener === '"'; pos++; }
      while (pos < source.length) {
        const ch = source[pos++];
        if (ch === '\\' && pos < source.length) { value += ch + source[pos++]; continue; }
        if (depth && ch === '{') depth++;
        // Handle braces separately so nested groups remain part of the value.
        if (depth && ch === '}') { depth--; if (!depth) break; }
        else if (quote && ch === '"') break;
        else if (!depth && !quote && (ch === ',' || ch === '}')) { pos--; break; }
        value += ch;
      }
      fields[key[1].toLowerCase()] = value.replace(/[{}]/g, '');
    }
    return record({ title: fields.title, authors: fields.author?.split(/\s+and\s+/i), year: fields.year || fields.date,
      journal: fields.journal || fields.booktitle, publisher: fields.publisher || fields.school || fields.institution,
      volume: fields.volume, issue: fields.number, pages: fields.pages, doi: fields.doi, abstract: fields.abstract });
  }
  function structured(doc) {
    const candidates = [];
    for (const node of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const queue = [JSON.parse(node.textContent)];
        let count = 0;
        while (queue.length && count++ < 500) {
          const item = queue.shift();
          if (!item || typeof item !== 'object') continue;
          if (Array.isArray(item)) { queue.push(...item); continue; }
          const types = [].concat(item['@type'] || []);
          if (types.some(type => /^(ScholarlyArticle|Article|Thesis|Report)$/.test(type))) {
            const candidate = record({ title: item.headline || item.name, authors: item.author,
              year: item.datePublished, journal: item.isPartOf?.name, publisher: item.publisher?.name || item.publisher,
              volume: item.volumeNumber, issue: item.issueNumber, first: item.pageStart, last: item.pageEnd,
              pages: item.pagination, abstract: item.abstract });
            if (candidate.title_main) candidates.push(candidate);
          }
          for (const value of Object.values(item)) if (value && typeof value === 'object') queue.push(value);
        }
      } catch (_) {}
    }
    const titles = new Set(candidates.map(item => item.title_main));
    return titles.size === 1 ? candidates[0] : {};
  }
  function extract(doc) {
    if (doc.querySelector('input[type="password"]') && !doc.querySelector('meta[name="citation_title"], meta[name="DC.Title"], .bookBriefInfo')) return {};
    const tags = new Map();
    const primaryTags = new Map();
    for (const node of doc.querySelectorAll('meta[name], meta[property]')) {
      const key = clean(node.getAttribute('name') || node.getAttribute('property')).toLowerCase();
      const value = clean(node.getAttribute('content'));
      if (value) {
        if (!tags.has(key)) tags.set(key, []); tags.get(key).push(value);
        if (!/^en(?:-|$)/i.test(node.getAttribute('lang') || '')) {
          if (!primaryTags.has(key)) primaryTags.set(key, []); primaryTags.get(key).push(value);
        }
      }
    }
    const values = key => primaryTags.get(key)?.length ? primaryTags.get(key) : tags.get(key);
    const get = (...keys) => keys.map(key => values(key)?.find(value => /[가-힣]/.test(value)) || values(key)?.[0]).find(Boolean);
    // OG/title alone also describe login/search/home pages; require scholarly metadata.
    let result = record({ title: get('citation_title', 'dc.title', 'dcterms.title'),
      authors: values('citation_author') || values('dc.creator'),
      journal: get('citation_journal_title'), publisher: get('citation_publisher', 'dc.publisher'),
      year: get('citation_publication_date', 'citation_date', 'citation_year', 'dc.date', 'dcterms.issued'),
      volume: get('citation_volume'), issue: get('citation_issue'), first: get('citation_firstpage'),
      last: get('citation_lastpage'), doi: get('citation_doi'), abstract: get('citation_abstract') });
    result = merge(result, structured(doc));
    for (const node of doc.querySelectorAll('textarea, pre, script[type="application/x-bibtex"], script[type="application/x-research-info-systems"]')) {
      const text = node.value || node.textContent || '';
      if (text.length > 100000) continue;
      // Multi-record exports cannot be associated with a single current paper.
      if ((text.match(/^TY\s{2}-/gm) || []).length > 1 || (text.match(/@(article|phdthesis|mastersthesis|book|inproceedings)\s*\{/gi) || []).length > 1) continue;
      const exported = /^TY\s{2}-/m.test(text) ? parseRis(text) : parseBibtex(text);
      if (exported.title_main) result = merge(exported, result);
    }
    const labels = {};
    for (const node of doc.querySelectorAll('.eleName, dt, th, .infoCont .tit')) {
      const label = clean(node.textContent).replace(/[\s:：]/g, '');
      const next = node.nextElementSibling;
      if (!next || next.matches('th, dt, .eleName, .tit')) continue;
      const value = clean(next.textContent);
      if (value && value.length < 1000) labels[label] = value;
    }
    const labeled = record({
      title: labels['논문명'] || labels['서명'] || labels['제목'] || clean(doc.querySelector('.bookBriefInfo .bookTit')?.textContent),
      authors: labels['저자명']?.split(/\s*[,;·]\s*/) || labels['저자']?.split(/\s*[,;·]\s*/) ||
        [...doc.querySelectorAll('.bookBriefInfo .writer a')].map(n => n.textContent),
      publisher: labels['발행기관'] || labels['발행처'] || labels['발행사'],
      year: labels['발행년도'] || labels['발행연도'] || labels['학위수여년월'],
      journal: labels['학술지명'] || clean(doc.querySelector('.bookBriefInfo .volume a')?.textContent)
    });
    result = merge(result, labeled);
    const volumeText = labels['권호사항'] || labels['수록사항'] || clean(doc.querySelector('.bookBriefInfo .volume')?.textContent);
    const vol = volumeText.match(/Vol\.?\s*(\d+)/i), issue = volumeText.match(/No\.?\s*(\d+)/i);
    const pages = volumeText.match(/(\d+)\s*[-–]\s*(\d+)\s*$/);
    if (vol) result.volume ||= vol[1];
    if (issue) result.issue ||= issue[1];
    if (pages) { result.page_first ||= pages[1]; result.page_last ||= pages[2]; }
    const pageText = labels['수록면'] || labels['페이지'];
    const pageRange = pageText?.match(/(\d+)\s*[-–~]\s*(\d+)/);
    if (pageRange) { result.page_first ||= pageRange[1]; result.page_last ||= pageRange[2]; }
    const degree = labels['학위명'] || labels['학위'] || labels['학위구분'];
    if (degree && /석사|박사/.test(degree) && !/학위논문/.test(result.publisher)) {
      result.publisher = [result.publisher, degree.match(/석사|박사/)[0] + '학위논문'].filter(Boolean).join(' ');
    }
    // Site-specific bilingual display fields supplement English-only export tags.
    const host = doc.location?.hostname || '';
    if (/koreascience/.test(host)) {
      const koreanTitle = [...doc.querySelectorAll('.article-title-row h1')].map(n => clean(n.textContent)).find(t => /[가-힣]/.test(t));
      if (koreanTitle) result.title_main = koreanTitle;
      const koreanJournal = clean(doc.querySelector('.article-title-txt small')?.textContent).replace(/^[（(]|[）)]$/g, '');
      if (/[가-힣]/.test(koreanJournal)) result.journal_name = koreanJournal;
      const koreanAuthors = [...doc.querySelectorAll('a[href*="doi.or.kr/10.PSN/"]')].map(n => clean(n.textContent)).filter(t => /[가-힣]/.test(t));
      if (koreanAuthors.length) result.authors = [...new Set(koreanAuthors)];
    }
    if (/koreascholar/.test(host)) result.publisher ||= clean(doc.querySelector('.book-info .pub a')?.textContent);
    const combinedVolume = result.volume?.match(/(?:Vol\.?|제)\s*(\d+)\s*(?:권)?\s*(?:No\.?|제)?\s*(\d+)\s*호?/i);
    if (combinedVolume) { result.volume = combinedVolume[1]; result.issue ||= combinedVolume[2]; }
    return result;
  }
  function fromControl(control) {
    const titleSelector = '.title a[href], .tit a[href], .gs_rt a[href], .bookTit a[href]';
    let row = control?.parentElement;
    for (let depth = 0; row && row.tagName !== 'BODY' && depth < 7; depth++, row = row.parentElement) {
      const titles = [...row.querySelectorAll(titleSelector)].filter(node => clean(node.textContent));
      const unique = new Map(titles.map(node => [node.href, node]));
      if (unique.size > 1) return null;
      if (unique.size !== 1) continue;
      const title = [...unique.values()][0];
      // These classes describe individual search results, not document-wide headings.
      if (!row.matches('.cont, .listCont, .item, .gs_r, li, tr, article, .search-result')) continue;
      const authorLinks = [...row.querySelectorAll('.writer a, .author a, .authors a')].map(node => clean(node.textContent));
      const authorText = clean(row.querySelector('.writer, .author, .authors, .gs_a')?.textContent).split(' - ')[0];
      const year = clean(row.querySelector('.year, .gs_a')?.textContent).match(/\b(?:19|20)\d{2}\b/);
      return { metadata: record({ title: title.textContent.replace(/^\[PDF\]\s*/i, ''),
        authors: authorLinks.length ? authorLinks : authorText.split(/\s*[,;·]\s*/).filter(Boolean),
        year: year?.[0], journal: row.querySelector('.journal')?.textContent }), detailUrl: title.href };
    }
    return null;
  }
  const api = { extract, merge, parseBibtex, parseRis, fromControl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.SickleCiteMetadata = api;
})(globalThis);
