import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleApi } from '../cloud/api.mjs';
function environment() {
  const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../drizzle/0000_secret_magus.sql',import.meta.url),'utf8'));
  const wrap=(sql,args=[])=>({bind(...values){return wrap(sql,values);},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return db.prepare(sql).run(...args);}});
  const files=new Map();return {DB:{prepare:sql=>wrap(sql)},BUCKET:{async put(k,v,meta){files.set(k,{body:typeof v==='string'?new TextEncoder().encode(v):v,httpMetadata:meta?.httpMetadata});},async get(k){return files.get(k)||null;},async delete(k){files.delete(k);}}};
}
async function call(env,path,payload,services) { const r=await handleApi(new Request('https://facility.test'+path,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),env,services);return {status:r.status,value:await r.json()}; }
test('key absence is explicit, without an upstream call or simulated success',async()=>{
  const env=environment();let used=false;const services={fetch(){used=true;throw new Error('unexpected call');}};
  const settings=await call(env,'/api/settings');assert.equal(settings.value.hasUpstageApiKey,false);assert.equal(settings.value.settings.aiMode,'upstage');
  const r=await call(env,'/api/ai/test',{},services);assert.equal(r.status,503);assert.match(r.value.error,/Upstage API 키/);assert.equal(used,false);
});
test('state survives new requests, strips settings, and rejects stale or concurrent changes',async()=>{
  const env=environment();const first=await call(env,'/api/state',{baseRevision:0,data:{equipments:[{id:'E1'}],settings:{externalApiKey:'never-store'}}});assert.equal(first.value.revision,1);
  const loaded=await call(env,'/api/state');assert.equal(loaded.value.data.equipments[0].id,'E1');assert.equal(loaded.value.data.settings,undefined);
  const stale=await call(env,'/api/state',{baseRevision:0,data:{equipments:[]}});assert.equal(stale.status,409);assert.equal(stale.value.conflict,true);
  const pair=await Promise.all([call(env,'/api/state',{baseRevision:1,data:{equipments:[{id:'E2'}]}}),call(env,'/api/state',{baseRevision:1,data:{equipments:[{id:'E3'}]}})]);assert.deepEqual(pair.map(x=>x.status).sort(),[200,409]);
});
test('backup restoration increments revision and creates a safety copy',async()=>{
  const env=environment();await call(env,'/api/state',{data:{equipments:[{id:'E1'}]}});const b=await call(env,'/api/backup',{});
  await call(env,'/api/state',{baseRevision:1,data:{equipments:[{id:'E2'}]}});const r=await call(env,'/api/restore',{name:b.value.path});assert.equal(r.value.ok,true);assert.notEqual(r.value.safetyBackup,b.value.path);
  const s=await call(env,'/api/state');assert.equal(s.value.revision,3);assert.equal(s.value.data.equipments[0].id,'E1');
});
test('keys cannot be persisted or exposed by the settings API',async()=>{
  const env={...environment(),UPSTAGE_API_KEY:'unit-test-secret'};let r=await call(env,'/api/settings',{externalApiKey:'do-not-store'});assert.equal(r.status,400);
  r=await call(env,'/api/settings');assert.equal(r.value.hasUpstageApiKey,true);assert.ok(!JSON.stringify(r.value).includes('unit-test-secret'));
});
test('Solar requests use the server key and preserve manual structured output',async()=>{
  const env={...environment(),UPSTAGE_API_KEY:'unit-test-secret'};let seen;
  const services={async fetch(url,options){seen={url,options};return Response.json({choices:[{message:{content:JSON.stringify({summary:'펌프 매뉴얼',consumables:[],inspections:[],warnings:[]})}}]});}};
  const r=await call(env,'/api/analyze',{kind:'manual',equipment:{id:'P1'},text:'설명서'},services);assert.equal(r.value.result.summary,'펌프 매뉴얼');
  assert.equal(seen.url,'https://api.upstage.ai/v1/chat/completions');assert.equal(seen.options.headers.Authorization,'Bearer unit-test-secret');assert.equal(JSON.parse(seen.options.body).response_format.type,'json_object');
});
test('PDF runs through Document Parse and Solar and remains review-only',async()=>{
  const env={...environment(),UPSTAGE_API_KEY:'unit-test-secret'}, urls=[];
  const services={async fetch(url,options){urls.push(url);if(url.includes('document-digitization')){assert.equal(options.body.get('model'),'document-parse');return Response.json({elements:[{page:1,content:{text:'2026년 7월 전력 사용량 100 kWh'}}]});}return Response.json({choices:[{message:{content:'{"rows":[{"ym":"2026-07","kind":"전력","usage":100,"unit":"kWh","page":1,"confidence":"high"}],"warnings":[]}'}}]});}};
  const r=await handleApi(new Request('https://facility.test/api/energy/document?filename=bill.pdf',{method:'POST',headers:{'Content-Type':'application/pdf'},body:'sample-pdf'}),env,services);const result=await r.json();assert.equal(result.reviewRequired,true);assert.equal(result.result.rows[0].usage,100);assert.equal(urls.length,2);assert.equal((await call(env,'/api/state')).value.data,null);
});
test('uploaded documents can be read back, and local paths are refused',async()=>{
  const env=environment();const r=await handleApi(new Request('https://facility.test/api/files?filename=manual.pdf&equipmentId=E1',{method:'POST',headers:{'Content-Type':'application/pdf'},body:'sample-pdf'}),env);const f=await r.json();assert.equal(f.ok,true);
  const got=await handleApi(new Request('https://facility.test/api/files/download?path='+encodeURIComponent(f.path)),env);assert.equal(await got.text(),'sample-pdf');
  const blocked=await call(env,'/api/files/read',{path:'../../server/config.local.json'});assert.equal(blocked.status,400);
});
test('foreign-origin mutations are rejected',async()=>{
  const r=await handleApi(new Request('https://facility.test/api/state',{method:'POST',headers:{Origin:'https://other.test'},body:'{}'}),environment());assert.equal(r.status,403);
});
test('inspection job is repeatable and does not send mail',async()=>{
  const env=environment();await call(env,'/api/state',{data:{equipments:[{id:'E1',name:'공기압축기',inspections:[{id:'I1',lastDate:'2020-01-31',cycleMonths:12,name:'검사'}]}]}});
  const first=await call(env,'/api/jobs/run',{});assert.equal(first.value.queued,1);const second=await call(env,'/api/jobs/run',{});assert.equal(second.value.queued,0);
  const q=(await call(env,'/api/state')).value.data.notificationQueue;assert.equal(q.length,1);assert.equal(q[0].status,'대기');
});
test('law query never substitutes a similarly named law',async()=>{
  const env={...environment(),LAW_API_OC:'unit-test-oc'};const services={async fetch(){return Response.json({law:[{'법령명한글':'다른 법령','법령일련번호':'123'}]});}};
  const r=await call(env,'/api/laws/query',{law:'전기안전관리법'},services);assert.equal(r.status,404);
});
