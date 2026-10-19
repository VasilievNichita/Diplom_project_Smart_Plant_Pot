import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {deflateSync,crc32} from 'node:zlib';
import {Store} from '../server/store.mjs';
import {PhotoInspection,defaultPython} from '../server/photo-inspection.mjs';
import {createServer} from '../server/http.mjs';
import {canPrepare,createDatasetInspection} from '../dist/dataset-ui.js';
import {inspectionCopy} from '../dist/dataset-i18n.js';

// Procedural noise fixtures in disposable databases, never actual observations.
function png(seed,alter=false){
  const raw=Buffer.alloc(96*(1+128*3));let n=seed;
  for(let y=0;y<96;y++)for(let x=1;x<=128*3;x++){n=(Math.imul(n,1664525)+1013904223)>>>0;raw[y*385+x]=n>>>24;}
  if(alter)raw[1]^=1;
  function chunk(type,data){const tag=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,crc]);}
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(128);ihdr.writeUInt32BE(96,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
function add(s,key,plant,group,bytes){
  s.savePhoto({id:key,plantId:plant,mode:'real',mime:'image/png',name:'synthetic.png',note:'Synthetic test only',base64:bytes.toString('base64')});
  s.reviewPhoto(key,{expectedRevision:0,identityConfirmed:true,quality:'usable',specimenId:group,source:'own',sourceReference:'Synthetic software fixture',signs:['unknown'],selected:true});
}
async function setup(t,near=false){
  const root=await mkdtemp(path.join(tmpdir(),'folium-inspection-')),s=new Store(path.join(root,'test.sqlite'));
  let i=1;
  for(const plant of ['chlorophytum','tradescantia','cactus'])for(let group=0;group<3;group++){add(s,`photo-${i}`,plant,`${plant}-${group}`,png(i));i++;}
  if(near)add(s,'near-photo','chlorophytum','chlorophytum-1',png(1,true));
  const service=new PhotoInspection(s,{root:path.join(root,'jobs')});
  t.after(async()=>{await service.pending;s.close();assert.ok(root.startsWith(path.join(tmpdir(),'folium-inspection-')));await rm(root,{recursive:true,force:true});});
  return {root,s,service};
}
const pythonMissing=!existsSync(defaultPython);

test('real worker audit and preparation preserve specimen splits and never create irrigation commands',{skip:pythonMissing},async t=>{
  const {s,service,root}=await setup(t);
  const started=await service.start();assert.equal(started.status,'running');
  await assert.rejects(service.start(),e=>e.code==='inspection_busy');
  await service.pending;
  const job=service.current();assert.equal(job.status,'audited');assert.equal(job.report.ok,true);assert.equal(job.records.length,9);
  assert.equal(job.report.possibleDuplicatePairCount,0);assert.equal(canPrepare(job),true);
  assert.equal((await service.thumbnail(job.id,'photo-1')).subarray(0,2).toString('hex'),'ffd8');
  assert.equal((await service.start()).id,job.id);
  await service.prepare(job.id,{expectedRevision:0});await service.pending;
  const ready=service.current();assert.equal(ready.status,'prepared');assert.equal(ready.prepared.counts.test.specimens,3);
  const manifest=JSON.parse(await readFile(path.join(root,'jobs',job.id,'prepared','manifest.json')));
  const groups=new Map();for(const r of manifest.items){if(groups.has(r.specimenId))assert.equal(groups.get(r.specimenId),r.split);groups.set(r.specimenId,r.split);}
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM commands').get().n,0);
});
test('near pairs require complete saved decisions; stale edits and concurrent saves are rejected',{skip:pythonMissing},async t=>{
  const {s,service}=await setup(t,true);await service.start();await service.pending;
  let job=service.current();assert.equal(job.status,'audited');assert.equal(job.report.possibleDuplicatePairCount,1);
  assert.equal(canPrepare(job),false);
  await assert.rejects(service.prepare(job.id,{expectedRevision:0}),e=>e.code==='inspection_unresolved');
  const input={expectedRevision:0,auditId:job.report.auditId,acknowledged:false,pairs:job.report.possibleCrossSpecimenDuplicates.map(({first,second})=>({first,second,decision:'same_specimen'}))};
  job=service.save(job.id,input);assert.equal(job.revision,1);assert.equal(canPrepare(job),false);
  assert.throws(()=>service.save(job.id,input),e=>e.code==='inspection_conflict');
  assert.throws(()=>service.save(job.id,{...input,expectedRevision:1,pairs:[]}),e=>e.code==='inspection_invalid_review');
  const restored=new PhotoInspection(s,{root:service.root});assert.equal(restored.current().review.pairs[0].decision,'same_specimen');
  const review=s.photos('real').find(p=>p.id==='photo-1').review;
  s.reviewPhoto('photo-1',{...review,expectedRevision:review.revision,selected:false});
  assert.equal(service.current().stale,true);
  assert.throws(()=>service.save(job.id,{...input,expectedRevision:1}),e=>e.code==='inspection_stale');
  await assert.rejects(service.prepare(job.id,{expectedRevision:1}),e=>e.code==='inspection_stale');
});
test('missing Python and interrupted jobs produce recoverable states',async t=>{
  const {s,root}=await setup(t);
  const missing=new PhotoInspection(s,{root:path.join(root,'jobs'),python:path.join(root,'missing.exe')});
  await assert.rejects(missing.start(),e=>e.code==='inspection_python_missing');
  s.db.prepare('INSERT INTO photo_inspections(id,fingerprint,payload) VALUES (?,?,?)').run('interrupted','x',JSON.stringify({status:'running'}));
  const restarted=new PhotoInspection(s,{root:path.join(root,'jobs')});assert.equal(restarted.current().error,'interrupted');assert.equal(restarted.current().status,'failed');
});
test('inspection HTTP routes preserve host, origin, device boundaries and hide private files',async t=>{
  const {s,root}=await setup(t),server=createServer(s,{inspectionOptions:{root:path.join(root,'http-jobs')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url+'/api/photo-inspection')).status,200);
  assert.equal((await fetch(url+'/api/photo-inspection',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(url+'/api/photo-inspection',{headers:{Origin:'https://other.example'}})).status,403);
  assert.equal((await fetch(url+'/data/photo-inspections/source.zip')).status,404);
  assert.equal((await fetch(url+'/dataset-ui.js')).status,200);
  if(!pythonMissing){
    const send=(route,body,method='POST')=>fetch(url+route,{method,headers:{'Content-Type':'application/json','X-Folium-Client':'web'},body:JSON.stringify(body)});
    const started=await send('/api/photo-inspection',{});assert.equal(started.status,202);
    async function completed(){
      for(let i=0;i<100;i++){
        const {job}=await (await fetch(url+'/api/photo-inspection')).json();
        if(!['running','preparing'].includes(job.status))return job;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.fail('Worker did not finish within five seconds');
    }
    const audited=await completed();assert.equal(audited.status,'audited');
    const saved=await send(`/api/photo-inspection/${audited.id}/review`,{expectedRevision:0,auditId:audited.report.auditId,acknowledged:true,pairs:[]},'PUT');assert.equal(saved.status,200);
    assert.equal((await send(`/api/photo-inspection/${audited.id}/prepare`,{expectedRevision:1})).status,202);
    assert.equal((await completed()).status,'prepared');
    assert.equal((await fetch(url+`/api/photo-inspection/${audited.id}/thumb/photo-1`)).status,200);
    assert.equal((await fetch(url+`/api/photo-inspection/${audited.id}/thumb/not-in-snapshot`)).status,404);
  }
  const device=createServer(s,{deviceOnly:true});await new Promise(resolve=>device.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>device.close(resolve)));
  assert.equal((await fetch(`http://127.0.0.1:${device.address().port}/api/photo-inspection`)).status,404);
});
test('all UI languages and readiness gates cover incomplete, changed and truncated audits',()=>{
  for(const lang of ['ru','ro','en'])assert.deepEqual(Object.keys(inspectionCopy[lang]).sort(),Object.keys(inspectionCopy.en).sort());
  const job={status:'audited',stale:false,report:{ok:true,structuralSplitPossible:true,possibleDuplicateListTruncated:false,possibleDuplicatePairCount:1},review:{acknowledged:true,pairs:[{decision:'different_specimens'}]}};
  assert.equal(canPrepare(job),true);
  for(const change of [{stale:true},{status:'preparing'},{review:{acknowledged:false,pairs:[]}},{report:{...job.report,possibleDuplicateListTruncated:true}},{report:{...job.report,structuralSplitPossible:false}}])assert.equal(canPrepare({...job,...change}),false);
  assert.equal(canPrepare(job,true),false);
});
test('UI edits clear acknowledgement, save to API, and only then enable preparation',async()=>{
  const oldDocument=globalThis.document;
  const target={innerHTML:''},ackElement={checked:true},progressElement={textContent:''},prepareButton={disabled:false};
  globalThis.document={querySelector:selector=>({'#dataset-inspection':target,'#dataset-ack':ackElement,'#dataset-progress':progressElement,'[data-action="dataset-prepare"]':prepareButton})[selector]};
  try{
    let job={id:'job-1',revision:0,status:'audited',stale:false,records:[{id:'first',plantId:'cactus',specimenId:'specimen-1',width:128,height:96},{id:'second',plantId:'cactus',specimenId:'specimen-2',width:128,height:96}],report:{auditId:'a'.repeat(64),ok:true,structuralSplitPossible:true,possibleDuplicateListTruncated:false,possibleDuplicatePairCount:1,possibleCrossSpecimenDuplicates:[{first:'first',second:'second'}],classes:[],errors:[]},review:null};
    const writes=[];
    const request=async(url,options)=>{
      if(options){writes.push({url,...options});job={...job,revision:1,review:{pairs:options.body.pairs,acknowledged:options.body.acknowledged}};}
      return {job:structuredClone(job)};
    };
    const ui=createDatasetInspection({t:key=>inspectionCopy.en[key]||key,esc:value=>String(value).replaceAll('<','&lt;'),request,button:(text,action,icon,style,extra='')=>`<button data-action="${action}" ${extra}>${text}</button>`});
    await ui.load(()=>true);
    assert.match(target.innerHTML,/data-dataset-pair="0"/);
    ui.change({dataset:{datasetPair:'0'},value:'different_specimens'});
    assert.equal(ackElement.checked,false);assert.equal(prepareButton.disabled,true);
    ui.change({dataset:{},id:'dataset-ack',checked:true});
    await ui.action('dataset-save');
    assert.equal(writes.length,1);assert.equal(writes[0].method,'PUT');assert.equal(writes[0].body.acknowledged,true);
    assert.equal(writes[0].body.pairs[0].decision,'different_specimens');assert.equal(writes[0].body.expectedRevision,0);
    assert.equal(canPrepare(job),true);assert.match(target.innerHTML,/Decisions saved on the server/);
    const previous=target.innerHTML;await ui.load(()=>false);assert.equal(target.innerHTML,previous);
  }finally{globalThis.document=oldDocument;}
});
