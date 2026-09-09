const assert=require('node:assert/strict');const {test}=require('node:test');const fs=require('fs');const vm=require('vm');const naming=require('../filename_tools');
function worker(store={}){
 const listeners={};const tabs=new Map();
 const context={URL,Blob,TextEncoder,crypto:require('node:crypto').webcrypto,setTimeout,clearTimeout,importScripts(){},SickleCiteFileNaming:naming,
 browser:{storage:{session:{get:async key=>({[key]:store[key]}),set:async values=>Object.assign(store,structuredClone(values))},sync:{get:async()=>({})}},
 runtime:{getURL:path=>'safari-web-extension://unit/'+path,onMessage:{addListener(fn){listeners.message=fn;}},onStartup:{addListener(fn){listeners.startup=fn;}}},
 tabs:{get:async id=>tabs.get(id),onRemoved:{addListener(fn){listeners.removed=fn;}},create:async()=>({id:99})}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../background.js'),'utf8'),context);
 return {context,listeners,tabs,store,async send(message,sender){return new Promise(resolve=>listeners.message(message,sender,resolve));}};
}
const ctx=(id,title='논문 A',extra={})=>({kind:'academic',pageUrl:'https://www.kci.go.kr/detail?artiId='+id,downloadUrl:'',metadata:{title_main:title,authors:['저자']},intent:true,...extra});

test('opener relationship carries metadata, unrelated tab does not',async()=>{
 const w=worker();const paper=ctx('A');await w.send({type:naming.DOWNLOAD_CONTEXT_MESSAGE,context:paper},{tab:{id:1},url:paper.pageUrl});
 w.tabs.set(2,{id:2,openerTabId:1});
 const viewer='https://viewer.dcollection.net/originalViewer.jsp?streamdocsId=1';
 assert.equal((await w.send({type:'SICKLE_CITE_GET_CONTEXT',pageUrl:viewer},{tab:{id:2},url:viewer})).context.metadata.title_main,'논문 A');
 w.tabs.set(3,{id:3});assert.equal((await w.send({type:'SICKLE_CITE_GET_CONTEXT',pageUrl:viewer},{tab:{id:3},url:viewer})).context,null);
});
test('saved contexts survive service worker recreation and retain child association',async()=>{
 const store={};const first=worker(store);const paper=ctx('A');
 await first.send({type:naming.DOWNLOAD_CONTEXT_MESSAGE,context:paper},{tab:{id:1},url:paper.pageUrl});
 const second=worker(store);second.tabs.set(2,{id:2,openerTabId:1});const viewer='https://viewer.dcollection.net/originalViewer.jsp?streamdocsId=1';
 assert.equal((await second.send({type:'SICKLE_CITE_GET_CONTEXT',pageUrl:viewer},{tab:{id:2},url:viewer})).context.metadata.title_main,'논문 A');
 const third=worker(store);third.tabs.set(2,{id:2});
 assert.equal((await third.send({type:'SICKLE_CITE_GET_CONTEXT',pageUrl:viewer},{tab:{id:2},url:viewer})).context.metadata.title_main,'논문 A');
});
test('two papers from the same opener are not guessed, explicit URL disambiguates',async()=>{
 const w=worker();for(const [id,title]of [['A','논문 A'],['B','논문 B']]){const paper=ctx(id,title);await w.send({type:naming.DOWNLOAD_CONTEXT_MESSAGE,context:paper},{tab:{id:1},url:paper.pageUrl});}
 w.tabs.set(2,{id:2,openerTabId:1});
 const viewer='https://viewer.dcollection.net/originalViewer.jsp?streamdocsId=1';
 assert.equal((await w.send({type:'SICKLE_CITE_GET_CONTEXT',pageUrl:viewer},{tab:{id:2},url:viewer})).context,null);
 const known='https://www.kci.go.kr/viewer?artiId=A';
 assert.equal((await w.send({type:'SICKLE_CITE_GET_CONTEXT',pageUrl:known},{tab:{id:2},url:known})).context.metadata.title_main,'논문 A');
});
test('empty viewer title cannot overwrite useful source metadata',async()=>{
 const w=worker();const paper=ctx('A');await w.send({type:naming.DOWNLOAD_CONTEXT_MESSAGE,context:paper},{tab:{id:1},url:paper.pageUrl});
 await w.send({type:naming.DOWNLOAD_CONTEXT_MESSAGE,context:{...paper,metadata:{}}},{tab:{id:1},url:paper.pageUrl});
 assert.equal(w.store.sickleCiteViewerContextsV2.length,1);
 assert.equal(w.store.sickleCiteViewerContextsV2[0].context.metadata.title_main,'논문 A');
});
test('expired context and browser restart cannot rename a new tab',async()=>{
 const w=worker({sickleCiteViewerContextsV2:[{tabId:1,context:{...ctx('A'),capturedAt:Date.now()-31*60000}}]});w.tabs.set(2,{id:2,openerTabId:1});
 const viewer='https://viewer.dcollection.net/originalViewer.jsp';
 assert.equal((await w.send({type:'SICKLE_CITE_GET_CONTEXT',pageUrl:viewer},{tab:{id:2},url:viewer})).context,null);
 const paper=ctx('A');await w.send({type:naming.DOWNLOAD_CONTEXT_MESSAGE,context:paper},{tab:{id:1},url:paper.pageUrl});w.listeners.startup();await new Promise(r=>setImmediate(r));
 assert.equal((await w.send({type:'SICKLE_CITE_GET_CONTEXT',pageUrl:viewer},{tab:{id:2},url:viewer})).context,null);
});

test('StreamDocs receives an explicit sanitized filename in page execution world',async()=>{
 const w=worker();let received;
 w.context.browser.scripting={executeScript:async details=>{
   assert.equal(details.world,'MAIN');assert.equal(details.target.tabId,2);
   const pageWorld={streamdocs:{document:{download:async options=>{received=options;}}}};vm.createContext(pageWorld);
   return [{result:await vm.runInContext('('+details.func.toString()+')('+JSON.stringify(details.args[0])+')',pageWorld)}];
 }};
 const result=await w.send({type:'SICKLE_CITE_VIEWER_DOWNLOAD',filename:'저자/논문.pdf'},{tab:{id:2},url:'https://viewer.dcollection.net/originalViewer.jsp'});
 assert.equal(result.success,true);assert.equal(received.fileName,'저자 논문.pdf');
});
test('concurrent helper jobs remain separate and cannot be read by a web page',async()=>{
 const w=worker();const sender={tab:{id:1},url:'https://www.kci.go.kr/detail'};
 const results=await Promise.all(['A','B'].map(name=>w.send({type:'SICKLE_CITE_OPEN_DOWNLOAD',request:{url:'https://www.kci.go.kr/'+name+'.pdf'},filename:name+'.pdf'},sender)));
 assert.ok(results.every(r=>r.success));const tokens=Object.keys(w.store.sickleCiteDownloadJobs);assert.equal(tokens.length,2);
 assert.equal((await w.send({type:'SICKLE_CITE_GET_DOWNLOAD_JOB',token:tokens[0]},sender)).success,false);
 const download=await w.send({type:'SICKLE_CITE_GET_DOWNLOAD_JOB',token:tokens[0]},{url:'safari-web-extension://unit/download.html#'+tokens[0]});assert.ok(download.job.filename);
});
