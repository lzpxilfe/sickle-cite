const {test}=require('node:test');const assert=require('node:assert/strict');const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');
function page(html,url='https://www.kci.go.kr/detail'){
 const dom=new JSDOM(html,{url,runScripts:'outside-only',virtualConsole:new VirtualConsole()});const w=dom.window;const listeners=[];const messages=[];
 w.TextEncoder=TextEncoder;w.browser={runtime:{sendMessage:async message=>{messages.push(message);return {success:true};},onMessage:{addListener(fn){listeners.push(fn);}}},storage:{sync:{get:async()=>({})},onChanged:{addListener(){}}}};
 const inject=()=>{for(const file of ['filename_tools.js','download_tools.js','metadata_tools.js','content_script.js'])w.eval(fs.readFileSync(require.resolve('../'+file),'utf8'));};inject();
 return {w,dom,inject,listeners,messages,send:request=>new Promise(resolve=>listeners[0](request,{},resolve))};
}
const tags='<meta name="citation_title" content="조선시대 연구"><meta name="citation_author" content="김철수">';
test('full content script extracts metadata and filters duplicate/manual/navigation downloads',async()=>{
 const p=page(tags+'<meta name="citation_pdf_url" content="/paper.pdf"><a href="#content">본문 바로가기</a><a href="/paper.pdf">PDF</a><a href="/paper.pdf">PDF 다운로드</a><a href="/manual.pdf">이용안내</a><a href="/file.hwp">파일 다운로드</a><a href="https://get.adobe.com/reader">원문뷰어설치</a>');
 try{const info=await p.send({action:'GET_PAGE_INFO'});assert.equal(info.pageInfo.metadata.title_main,'조선시대 연구');
 const opts=await p.send({action:'GET_DOWNLOAD_OPTIONS'});assert.equal(opts.options.length,1);assert.equal(opts.options[0].url,'https://www.kci.go.kr/paper.pdf');
 p.inject();assert.equal(p.listeners.length,1);
 }finally{p.w.close();}
});
test('generic journal with scholarly tags is enabled, ordinary homepage is inactive',async()=>{
 const p=page(tags+'<a href="/paper.pdf">PDF</a>','https://journal.example.org/paper');
 try{assert.equal((await p.send({action:'GET_DOWNLOAD_OPTIONS'})).options.length,1);}finally{p.w.close();}
 const other=page('<title>일반 홈페이지</title>','https://example.org/');assert.equal(other.listeners.length,0);other.w.close();
});
test('KCI one-argument control produces request for current article',async()=>{
 const p=page(tags+`<a href="javascript:;" onclick="fncDown('KCI_FI123')">KCI 원문 내려받기</a>`,'https://www.kci.go.kr/kciportal/ci/sereArticleSearch/ciSereArtiView.kci?sereArticleSearchBean.artiId=ART123');
 try{const result=await p.send({action:'GET_DOWNLOAD_OPTIONS'});assert.match(result.options[0].url,/artiId=ART123/);assert.match(result.options[0].url,/orteFileId=KCI_FI123/);}finally{p.w.close();}
});
test('word-internal title hyphens survive legacy parser fallback',async()=>{
 const p=page('<meta name="citation_title" content="JSON-LD와 deep-learning 연구"><meta name="citation_author" content="김철수">');
 try{assert.equal((await p.send({action:'GET_PAGE_INFO'})).pageInfo.metadata.title_main,'JSON-LD와 deep-learning 연구');}finally{p.w.close();}
});

test('RISS JavaScript provider links remain intact and are not misparsed as URLs',async()=>{
 const p=page(tags+`<a href="#redirect" onclick="if(ServicePauseChk('1'))ButtonSet.urlDownload('abc','def','type','','');">ScienceON</a>`,'https://m.riss.kr/search/detail/DetailView.do?control_no=A');
 try{const result=await p.send({action:'GET_DOWNLOAD_OPTIONS'});assert.equal(result.options.length,1);assert.equal(result.options[0].url,'');}finally{p.w.close();}
});
test('unidentified PDF is left to original site rather than given a generic name',async()=>{
 const p=page('<a href="/file.pdf">PDF</a>');
 try{await p.send({action:'GET_PAGE_INFO'});const link=p.w.document.querySelector('a');const event=new p.w.MouseEvent('click',{bubbles:true,cancelable:true});link.dispatchEvent(event);assert.equal(event.defaultPrevented,false);}finally{p.w.close();}
});
test('file upload fields and bibliography downloads are not PDF options',async()=>{
 const p=page(tags+'<input type="file" name="pdfFile"><input type="hidden" id="fulltext_kind"><button onclick="fncTextDown()">Download</button><button onclick="fnExcelDown()">엑셀 다운로드</button>');
 try{assert.equal((await p.send({action:'GET_DOWNLOAD_OPTIONS'})).options.length,0);}finally{p.w.close();}
});

test('standalone Safari save page exposes a named file only after a verified PDF',async()=>{
 const html=fs.readFileSync(require.resolve('../download.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://extension.test/download.html#job',runScripts:'outside-only'});const w=dom.window;
 w.browser={runtime:{sendMessage:async()=>({success:true,job:{request:{url:'https://www.kci.go.kr/a.pdf'},filename:'김철수, 논문.pdf'}})}};
 w.SickleCiteFileNaming=require('../filename_tools');
 w.SickleCiteDownloads={fetchPdf:async()=>new Blob(['%PDF-1.7'])};w.URL.createObjectURL=()=> 'blob:verified-pdf';w.URL.revokeObjectURL=()=>{};
 try{await w.eval(fs.readFileSync(require.resolve('../download_page.js'),'utf8'));assert.equal(w.document.getElementById('save').hidden,false);assert.equal(w.document.getElementById('save').download,'김철수, 논문.pdf');assert.match(w.document.getElementById('status').textContent,/준비/);}finally{w.close();}
});
test('standalone Safari save page leaves PDF suffix to Safari exactly once',async()=>{
 const html=fs.readFileSync(require.resolve('../download.html'),'utf8');
 const dom=new JSDOM(html,{url:'https://extension.test/download.html#job',runScripts:'outside-only'});const w=dom.window;
 Object.defineProperty(w.navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 Version/17.0 Safari/605.1.15'});
 w.browser={runtime:{sendMessage:async()=>({success:true,job:{request:{url:'https://www.kci.go.kr/a.pdf'},filename:'논문.pdf.pdf'}})}};
 w.SickleCiteFileNaming=require('../filename_tools');w.SickleCiteDownloads={fetchPdf:async()=>new Blob(['%PDF-1.7'])};w.URL.createObjectURL=()=> 'blob:verified-pdf';w.URL.revokeObjectURL=()=>{};
 try{await w.eval(fs.readFileSync(require.resolve('../download_page.js'),'utf8'));assert.equal(w.document.getElementById('filename').textContent,'논문.pdf');assert.equal(w.document.getElementById('save').download,'논문');}finally{w.close();}
});
test('standalone save page leaves no download link when authentication fails',async()=>{
 const dom=new JSDOM(fs.readFileSync(require.resolve('../download.html'),'utf8'),{url:'https://extension.test/download.html#job',runScripts:'outside-only'});const w=dom.window;
 w.browser={runtime:{sendMessage:async()=>({success:true,job:{request:{url:'https://www.kci.go.kr/a.pdf'},filename:'논문.pdf'}})}};w.SickleCiteFileNaming=require('../filename_tools');w.SickleCiteDownloads={fetchPdf:async()=>null};
 try{await w.eval(fs.readFileSync(require.resolve('../download_page.js'),'utf8'));assert.equal(w.document.getElementById('save').hidden,true);assert.match(w.document.getElementById('status').textContent,/로그인/);assert.equal(w.document.getElementById('copy').hidden,false);}finally{w.close();}
});
