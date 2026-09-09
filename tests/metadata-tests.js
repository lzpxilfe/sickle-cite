const assert=require('node:assert/strict');const {test}=require('node:test');const {JSDOM}=require('jsdom');
const meta=require('../metadata_tools');const naming=require('../filename_tools');
const doc=html=>new JSDOM(html).window.document;

test('RIS multiline, repeated authors and pages',()=>{
 const m=meta.parseRis('TY  - JOUR\nTI  - 신라 토기\n  연구\nAU  - 김철수\nAU  - 이영희\nPY  - 2025/04\nJO  - 고고학보\nSP  - 12\nEP  - 34\nER  -');
 assert.equal(m.title_main,'신라 토기 연구');assert.deepEqual(m.authors,['김철수','이영희']);assert.equal(m.page_last,'34');assert.equal(m.year,'2025');
});
test('BibTeX nested braces, quoted strings and bare values',()=>{
 const m=meta.parseBibtex('@article{kim, title={신라 {토기} 연구}, author="김철수 and 이영희", year=2025, journal={학보}, pages={12--34}}');
 assert.equal(m.title_main,'신라 토기 연구');assert.deepEqual(m.authors,['김철수','이영희']);assert.equal(m.page_last,'34');assert.equal(m.year,'2025');
 assert.deepEqual(meta.parseBibtex('@media { body {color:red} }'),{});
});
test('JSON-LD graph locates an article and ignores site navigation',()=>{
 const m=meta.extract(doc('<script type="application/ld+json">'+JSON.stringify({'@graph':[{'@type':'WebSite',name:'홈'},{'@type':'ScholarlyArticle',headline:'논문 제목',author:[{name:'홍길동'}],datePublished:'2023-01-01'}]})+'</script>'));
 assert.equal(m.title_main,'논문 제목');assert.deepEqual(m.authors,['홍길동']);assert.equal(m.year,'2023');
});
test('AccessON bilingual tags prefer Korean without duplicate translated authors',()=>{
 const m=meta.extract(doc('<meta name="citation_title" lang="en" content="English title"><meta name="citation_title" content="한국어 제목"><meta name="citation_author" lang="en" content="Kim"><meta name="citation_author" content="김철수">'));
 assert.equal(m.title_main,'한국어 제목');assert.deepEqual(m.authors,['김철수']);
});
test('semicolon authors split without breaking surname-comma-given name',()=>{
 const m=meta.extract(doc('<meta name="citation_title" content="Paper"><meta name="citation_author" content="Kim, Hakmin;Kim, Yootaek;">'));
 assert.deepEqual(m.authors,['Kim, Hakmin','Kim, Yootaek']);
});
test('homepage and search OG titles alone do not become papers',()=>{
 assert.equal(meta.extract(doc('<title>검색</title><meta property="og:title" content="논문 검색">')).title_main,'');
});
test('ScienceON scholarly tags work despite global login modal',()=>{
 const m=meta.extract(doc('<input type="password"><meta name="citation_title" content="[논문]고고학 연구"><meta name="citation_author" content="김철수">'));
 assert.equal(m.title_main,'고고학 연구');
});
test('dCollection visible details provide title, authors, publisher and issue',()=>{
 const m=meta.extract(doc('<div class="bookBriefInfo"><h3 class="bookTit">조선시대 건축</h3><div class="writer"><a>김철수</a></div><li class="volume"><a>문화재</a>, 2022, Vol.55 No.1, 281-304</li></div><span class="eleName">발행기관</span><span>문화재연구소</span><span class="eleName">발행년도</span><span>2022</span>'));
 assert.equal(m.title_main,'조선시대 건축');assert.equal(m.publisher,'문화재연구소');assert.equal(m.volume,'55');assert.equal(m.issue,'1');assert.equal(m.page_last,'304');
});
test('proxy host recognition is bounded and leaves encoded paths intact',()=>{
 for(const url of ['https://www-dbpia-co-kr.eproxy.yonsei.ac.kr/journal/articleDetail?nodeId=A', 'https://scholar-kyobobook-co-kr-ssl.openlib.uos.ac.kr/article/detail/1','https://www.riss.kr.proxy.univ.ac.kr/search/detail/DetailView.do?id=1','https://dcollection.uos.ac.kr/item'])assert.ok(naming.isAcademicUrl(url),url);
 for(const url of ['https://notdbpia.com/','https://evil.test/riss.kr','https://dbpia-co-kr.evil.test','https://riss.kr.evil.test'])assert.ok(!naming.isAcademicUrl(url),url);
 assert.equal(new URL(naming.canonicalAcademicUrl('https://www-dbpia-co-kr.eproxy.yonsei.ac.kr/journal/articleDetail?nodeId=A')).search,'?nodeId=A');
});
test('expanded Korean services are recognized',()=>{
 for(const host of ['koreascience.kr','accesson.kr','synapse.koreamed.org','db.koreascholar.com','dl.nanet.go.kr','nl.go.kr','auric.or.kr','kmbase.medric.or.kr','scholarworks.bwise.kr','s-space.snu.ac.kr'])assert.ok(naming.isAcademicUrl('https://'+host+'/'),host);
});
test('KCI single-argument handler preserves institution proxy origin',()=>{
 const m=naming.getKciDownloadInfo("fncDown('KCI_FI123')",'https://www-kci-go-kr.proxy.univ.ac.kr/kciportal/detail?sereArticleSearchBean.artiId=ART123');
 assert.equal(m.articleId,'ART123');assert.equal(new URL(m.url).host,'www-kci-go-kr.proxy.univ.ac.kr');
 assert.equal(naming.getKciDownloadInfo("fncDown('KCI_FI123')",'https://www.kci.go.kr/search'),null);
});
test('listing multiple JSON-LD papers is not mistaken for a single paper',()=>{
 const articles=['A','B'].map(headline=>({'@type':'ScholarlyArticle',headline}));
 assert.equal(meta.extract(doc('<script type="application/ld+json">'+JSON.stringify(articles)+'</script>')).title_main,'');
});
test('Google Scholar result PDFs use their own adjacent title and authors',()=>{
 const d=doc('<div class="gs_r"><a id="pdfA" href="/a.pdf">PDF</a><h3 class="gs_rt"><a href="/a">논문 A</a></h3><div class="gs_a">김철수, 이영희 - 학술지, 2024 - site</div></div><div class="gs_r"><a id="pdfB" href="/b.pdf">PDF</a><h3 class="gs_rt"><a href="/b">논문 B</a></h3><div class="gs_a">홍길동 - 학술지, 2025 - site</div></div>');
 assert.equal(meta.fromControl(d.querySelector('#pdfB')).metadata.title_main,'논문 B');assert.deepEqual(meta.fromControl(d.querySelector('#pdfA')).metadata.authors,['김철수','이영희']);
});
