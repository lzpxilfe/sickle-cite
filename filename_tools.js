(function initSickleCiteFileNaming(global) {
  "use strict";

  const PDF_FILENAME_ENABLED_KEY = "pdfFilenameEnabled";
  const DOWNLOAD_CONTEXT_MESSAGE = "SICKLE_CITE_DOWNLOAD_CONTEXT";
  const GET_DOWNLOAD_OPTIONS_ACTION = "GET_DOWNLOAD_OPTIONS";
  const START_NAMED_DOWNLOAD_ACTION = "START_NAMED_DOWNLOAD";
  const MAX_FILENAME_LENGTH = 180;

  const ACADEMIC_DOMAINS_PATTERN = /(?:^|\.)riss\.kr$|(?:^|\.)kci\.go\.kr$|(?:^|\.)kiss\.kstudy\.com$|(?:^|\.)dbpia\.(?:com|co\.kr)$|(?:^|\.)earticle\.net$|(?:^|\.)scholar\.kyobobook\.co\.kr$|(?:^|\.)koreascience\.or\.kr$|scienceon\.kisti\.re\.kr$|(?:^|\.)krm\.or\.kr$|(?:^|\.)dcollection\.net$|history\.seoul\.go\.kr$/i;
  const HERITAGE_DOMAINS_PATTERN = /(?:^|\.)heritage\.go\.kr$|(?:^|\.)cha\.go\.kr$|(?:^|\.)khs\.go\.kr$|(?:^|\.)e-minwon\.go\.kr$|(?:^|\.)nrich\.go\.kr$/i;

  const DEFAULT_STYLE_SETTINGS = {
    titleSeparator: " — ",
    volumePrefix: "",
    volumeSuffix: "",
    volumeIssueSeparator: "",
    issuePrefix: "(",
    issueSuffix: ")",
    eitherPrefix: "",
    eitherSuffix: "",
    titleBracketLeft: "「",
    titleBracketRight: "」",
    journalBracketLeft: "『",
    journalBracketRight: "』",
    citationOrder: ["authors", "title", "source", "publisher", "year", "pages"],
    pageRangeInclude: false,
    pageRangeSeparator: "–",
    pageRangeUnit: "쪽"
  };

  function normalizeSpaces(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeUrl(value) {
    try {
      return decodeURIComponent(String(value || ""));
    } catch (_error) {
      return String(value || "");
    }
  }

  function hostFromUrl(url) {
    if (!url) return "";
    try {
      const parsed = new URL(String(url));
      if (parsed.protocol === "blob:" && parsed.pathname) {
        return hostFromUrl(parsed.pathname);
      }
      return parsed.hostname.toLowerCase();
    } catch (_error) {
      return "";
    }
  }

  const ACADEMIC_HOSTS = {
    'riss.kr': 'RISS', 'riss.or.kr': 'RISS', 'kci.go.kr': 'KCI', 'kiss.kstudy.com': 'KISS',
    'dbpia.com': 'DBpia', 'dbpia.co.kr': 'DBpia', 'earticle.net': 'eArticle',
    'scholar.kyobobook.co.kr': '스콜라', 'koreascience.or.kr': 'KoreaScience',
    'scienceon.kisti.re.kr': 'ScienceON', 'krm.or.kr': 'KRM',
    'dcollection.net': 'dCollection', 'history.seoul.go.kr': '서울역사',
    'koreascience.kr': 'KoreaScience', 'koreascholar.com': '코리아스칼라',
    'accesson.kr': 'AccessON', 'koreamed.org': 'KoreaMed',
    'nanet.go.kr': '국회도서관', 'nl.go.kr': '국립중앙도서관',
    'scholar.google.com': 'Google Scholar', 'scholar.google.co.kr': 'Google Scholar',
    'auric.or.kr': 'AURIC', 'kmbase.medric.or.kr': 'KMbase',
    'scholarworks.bwise.kr': 'ScholarWorks', 'ndsl.kr': 'ScienceON'
  };

  function academicHost(url) {
    const host = hostFromUrl(url);
    for (const domain of Object.keys(ACADEMIC_HOSTS)) {
      if (host === domain || host.endsWith('.' + domain)) return domain;
      // EZproxy hosts encode the original domain using dots or hyphens.
      // Restrict automatic proxy recognition to academic institution domains.
      if (!/\.(?:ac\.kr|edu|edu\.[a-z]{2})$/.test(host)) continue;
      const prefix = host.replace(/\.(?:ac\.kr|edu|edu\.[a-z]{2})$/, '');
      const encoded = domain.replace(/\./g, '-');
      if (prefix.startsWith(domain + '.') || prefix.startsWith(encoded + '.') ||
          prefix.startsWith(encoded + '-ssl.') || prefix.includes('.' + domain + '.') ||
          prefix.includes('.' + encoded + '.') || prefix.includes('.' + encoded + '-ssl.') ||
          prefix.includes('-' + encoded + '.') || prefix.includes('-' + encoded + '-ssl.')) return domain;
    }
    if (/^(?:dcollection|repository|s-space|scholarworks|dspace)\.[a-z0-9.-]+\.ac\.kr$/.test(host)) return 'dcollection.net';
    return '';
  }

  function academicSource(url) { return ACADEMIC_HOSTS[academicHost(url)] || ''; }

  function canonicalAcademicUrl(url) {
    try {
      const parsed = new URL(url);
      const host = academicHost(url);
      if (host) parsed.hostname = 'www.' + host;
      return parsed.href;
    } catch (_) { return String(url || ''); }
  }

  function isAcademicUrl(url) { return Boolean(academicHost(url)); }

  function isHeritageUrl(url) {
    const host = hostFromUrl(url);
    return Boolean(host && HERITAGE_DOMAINS_PATTERN.test(host));
  }

  function isAllowedUrl(url) {
    return isAcademicUrl(url) || isHeritageUrl(url);
  }

  function isAllowedDownloadItem(item) {
    return [
      item && item.url,
      item && item.finalUrl,
      item && item.referrer,
      item && item.tabUrl
    ].some(isAllowedUrl);
  }

  function isPdfFilenameEnabled(settings) {
    return !settings || settings[PDF_FILENAME_ENABLED_KEY] !== false;
  }

  function stripKnownExtension(value) {
    return String(value || "")
      .replace(/(?:\.pdf)+$/i, "")
      .replace(/\.[A-Za-z0-9]{1,8}$/i, "");
  }

  function isSafariUserAgent(userAgent) {
    const value = String(userAgent || "");
    return /Safari\//.test(value) &&
      !/(?:Chrome|Chromium|CriOS|FxiOS|EdgA|EdgiOS|OPR|OPiOS)\//.test(value);
  }

  // Safari appends the MIME-derived extension to Blob downloads. Giving it a
  // filename that already ends in .pdf produces "paper.pdf.pdf" on macOS.
  function downloadAttributeFilename(filename, userAgent) {
    const complete = withPdfExtension(filename);
    return isSafariUserAgent(userAgent) ? stripKnownExtension(complete) : complete;
  }

  function extensionFromFilename(value) {
    const clean = String(value || "").split(/[?#]/)[0];
    const match = clean.match(/\.([A-Za-z0-9]{1,8})$/);
    return match ? `.${match[1].toLowerCase()}` : "";
  }

  function filenameFromUrl(url) {
    if (!url) return "";
    try {
      const parsed = new URL(String(url), "https://example.invalid");
      const candidates = [
        parsed.searchParams.get("filename"),
        parsed.searchParams.get("fileName"),
        parsed.searchParams.get("file"),
        parsed.searchParams.get("pdf_name"),
        parsed.pathname.split("/").pop()
      ];
      for (const candidate of candidates) {
        if (candidate) {
          return decodeURIComponent(String(candidate).split("/").pop());
        }
      }
    } catch (_error) {
      const withoutQuery = String(url).split(/[?#]/)[0];
      try {
        return decodeURIComponent(withoutQuery.split("/").pop() || "");
      } catch (_decodeError) {
        return withoutQuery.split("/").pop() || "";
      }
    }
    return "";
  }

  function splitJsArguments(argsText) {
    const args = [];
    let current = "";
    let quote = "";
    let escaped = false;
    const text = String(argsText || "");

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      if (char === "\\") {
        current += char;
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) {
          quote = "";
        } else {
          current += char;
        }
        continue;
      }
      if (char === "'" || char === "\"") {
        quote = char;
        continue;
      }
      if (char === ",") {
        args.push(current.trim());
        current = "";
        continue;
      }
      current += char;
    }

    args.push(current.trim());
    return args.map(arg => arg.replace(/^['"]|['"]$/g, ""));
  }

  function jsCallArguments(source, functionName) {
    const text = String(source || "");
    const match = text.match(new RegExp(`${functionName}\\s*\\(([^)]*)\\)`, "i"));
    return match ? splitJsArguments(match[1]) : null;
  }

  function getKciDownloadInfo(source, baseUrl) {
    const args = jsCallArguments(source, "fncDown");
    if (!args || !args.length) return null;
    let pageArticle = '';
    try { pageArticle = new URL(baseUrl).searchParams.get('sereArticleSearchBean.artiId') || ''; } catch (_) {}
    const articleId = normalizeSpaces(args.length > 1 ? args[0] : pageArticle);
    const fileId = normalizeSpaces(args.length > 1 ? args[1] : args[0]);
    if (!articleId || !fileId) return null;

    const path = `/kciportal/ci/sereArticleSearch/ciSereArtiOrteServHistIFrame.kci?sereArticleSearchBean.artiId=${encodeURIComponent(articleId)}&sereArticleSearchBean.orteFileId=${encodeURIComponent(fileId)}`;
    let url = path;
    try {
      url = new URL(path, baseUrl || "https://www.kci.go.kr").href;
    } catch (_error) {}

    return { articleId, fileId, url };
  }

  function sanitizeFilenameBase(value, maxBaseLength) {
    const cleaned = stripKnownExtension(value)
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, " ")
      .replace(/\s+([」』〉》≫])/g, "$1")
      .replace(/([「『〈《≪])\s+/g, "$1")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .trim();

    const limit = Number(maxBaseLength) || MAX_FILENAME_LENGTH;
    // Leave room for the extension and browser-added duplicate suffixes.
    let result = "";
    let bytes = 0;
    for (const char of cleaned.normalize("NFC")) {
      const size = new TextEncoder().encode(char).length;
      if (result.length + char.length > limit || bytes + size > 231) break;
      result += char;
      bytes += size;
    }
    return result.replace(/[. ]+$/g, "").trim();
  }

  function withPdfExtension(base) {
    const clean = sanitizeFilenameBase(base, MAX_FILENAME_LENGTH - 4);
    return `${clean || "Sickle-Cite PDF"}.pdf`;
  }

  function normalizeCitationOrder(order) {
    const defaults = DEFAULT_STYLE_SETTINGS.citationOrder;
    if (!Array.isArray(order)) return defaults.slice();
    const seen = new Set();
    const normalized = order.filter(key => defaults.includes(key) && !seen.has(key) && seen.add(key));
    defaults.forEach(key => {
      if (!seen.has(key)) normalized.push(key);
    });
    return normalized;
  }

  function normalizeStyleSettings(settings) {
    const merged = Object.assign({}, DEFAULT_STYLE_SETTINGS, settings || {});
    merged.citationOrder = normalizeCitationOrder(merged.citationOrder);
    if (typeof merged.pageRangeInclude !== "boolean") {
      merged.pageRangeInclude = Boolean(merged.pageRangeInclude);
    }
    return merged;
  }

  function getTitleSegment(meta, style) {
    const titleMain = normalizeSpaces(meta && meta.title_main);
    const titleSub = normalizeSpaces(meta && meta.title_sub);
    const checkedSeparator = titleSub ? style.titleSeparator : "";
    const titleText = `${titleMain}${checkedSeparator}${titleSub}`.trim();
    if (!titleText) return "";
    return `${style.titleBracketLeft}${titleText}${style.titleBracketRight}`;
  }

  function getVolumeIssueSegment(meta, style) {
    const volume = normalizeSpaces(meta && meta.volume);
    const issue = normalizeSpaces(meta && meta.issue);
    const hasVol = volume !== "";
    const hasIss = issue !== "";

    if (hasVol && hasIss) {
      return `${style.volumePrefix}${volume}${style.volumeSuffix}${style.volumeIssueSeparator}${style.issuePrefix}${issue}${style.issueSuffix}`.trim();
    }

    if (hasVol || hasIss) {
      return `${style.eitherPrefix}${volume}${issue}${style.eitherSuffix}`.trim();
    }

    return "";
  }

  function getSourceSegment(meta, style) {
    const journalName = normalizeSpaces(meta && meta.journal_name);
    const journalSegment = journalName ? `${style.journalBracketLeft}${journalName}${style.journalBracketRight}` : "";
    const volumeIssueSegment = getVolumeIssueSegment(meta, style);
    if (journalSegment && volumeIssueSegment) return `${journalSegment} ${volumeIssueSegment}`;
    return journalSegment || volumeIssueSegment;
  }

  function getPageRangeSegment(meta, style) {
    const first = normalizeSpaces(meta && meta.page_first);
    const last = normalizeSpaces(meta && meta.page_last);
    if (!style.pageRangeInclude || !first || !last) return "";
    return `${first}${style.pageRangeSeparator}${last}${style.pageRangeUnit}`;
  }

  function getCitationSegments(meta, settings) {
    const style = normalizeStyleSettings(settings);
    const authors = Array.isArray(meta && meta.authors)
      ? meta.authors.map(normalizeSpaces).filter(Boolean).join("·")
      : normalizeSpaces(meta && meta.authors);

    return {
      authors,
      year: normalizeSpaces(meta && meta.year),
      title: getTitleSegment(meta || {}, style),
      source: getSourceSegment(meta || {}, style),
      publisher: normalizeSpaces(meta && meta.publisher),
      pages: getPageRangeSegment(meta || {}, style)
    };
  }

  function getCombinedCitation(meta, settings) {
    const style = normalizeStyleSettings(settings);
    const segments = getCitationSegments(meta || {}, style);
    const ordered = style.citationOrder
      .map(key => segments[key])
      .filter(segment => typeof segment === "string" && segment.trim() !== "");
    if (!ordered.length) return "";
    return `${ordered.join(", ")}.`;
  }

  function renderAcademicFilename(meta, settings) {
    const citation = getCombinedCitation(meta || {}, settings);
    return withPdfExtension(citation || "논문 PDF");
  }

  function normalizeComparable(value) {
    return normalizeSpaces(value)
      .replace(/[ㆍ·]/g, "")
      .replace(/[(){}\[\]<>「」『』,.;:，。·ㆍ\-_\s]/g, "")
      .toLowerCase();
  }

  function deriveAttachmentTitle(reportTitle, fileTitle, originalFilename) {
    const fileStem = stripKnownExtension(normalizeSpaces(fileTitle || originalFilename || ""));
    const report = normalizeSpaces(reportTitle);
    if (!fileStem) return "";
    if (/^(원본|이미지|본문|파일|다운로드|내려받기|download|file|report|includeFileDownLoad)(?:\s*(?:다운로드|내려받기))?$/i.test(fileStem)) return "";
    if (normalizeComparable(fileStem) === normalizeComparable(report)) return "";

    const meaningfulSuffix = fileStem.match(/((?:제\s*)?\d+\s*권\s*\([^)]*\)|(?:제\s*)?\d+\s*권|도면\s*\d+|도판\s*\d+|부록\s*\d*|별책|상권|하권|본문편?|도판편?|원색도판|사진도판)(?:.*)?$/);
    if (meaningfulSuffix && meaningfulSuffix[1]) {
      return normalizeSpaces(meaningfulSuffix[1]);
    }

    return fileStem;
  }

  function renderReportFilename(reportContext) {
    const context = reportContext || {};
    const agency = normalizeSpaces(context.agency);
    const year = normalizeSpaces(context.year);
    const reportTitle = normalizeSpaces(context.reportTitle || context.title);
    const fileTitle = normalizeSpaces(context.fileTitle);
    const originalFilename = normalizeSpaces(context.originalFilename);
    const attachmentTitle = normalizeSpaces(
      context.attachmentTitle || deriveAttachmentTitle(reportTitle, fileTitle, originalFilename)
    );
    const shouldAddAttachment = Boolean((context.multipleFiles || context.sequenceNumber) && attachmentTitle);
    const sequence = normalizeSpaces(context.sequenceNumber);
    const suffix = shouldAddAttachment ? ` ${attachmentTitle}` : (sequence ? ` ${sequence}` : "");
    const parts = [
      agency || "발행기관 미상",
      year || "연도 미상",
      reportTitle ? `『${reportTitle}』${suffix}` : `${stripKnownExtension(originalFilename) || "국가유산 보고서"}${suffix}`
    ];
    return withPdfExtension(parts.filter(Boolean).join(", "));
  }

  function renderFilename(context, settings) {
    if (!context) return withPdfExtension("Sickle-Cite PDF");
    if (context.kind === "report") return renderReportFilename(context.report || context);
    return renderAcademicFilename(context.metadata || context, settings);
  }

  const api = {
    ACADEMIC_DOMAINS_PATTERN,
    academicHost,
    academicSource,
    canonicalAcademicUrl,
    DEFAULT_STYLE_SETTINGS,
    DOWNLOAD_CONTEXT_MESSAGE,
    GET_DOWNLOAD_OPTIONS_ACTION,
    HERITAGE_DOMAINS_PATTERN,
    PDF_FILENAME_ENABLED_KEY,
    START_NAMED_DOWNLOAD_ACTION,
    deriveAttachmentTitle,
    downloadAttributeFilename,
    extensionFromFilename,
    filenameFromUrl,
    getKciDownloadInfo,
    getCombinedCitation,
    hostFromUrl,
    isAcademicUrl,
    isAllowedDownloadItem,
    isAllowedUrl,
    isHeritageUrl,
    isSafariUserAgent,
    isPdfFilenameEnabled,
    normalizeSpaces,
    normalizeStyleSettings,
    normalizeUrl,
    renderAcademicFilename,
    renderFilename,
    renderReportFilename,
    sanitizeFilenameBase,
    stripKnownExtension,
    withPdfExtension
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.SickleCiteFileNaming = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
