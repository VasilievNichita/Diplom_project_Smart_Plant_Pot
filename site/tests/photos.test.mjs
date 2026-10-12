import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {crc32} from 'node:zlib';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {createServer} from '../server/http.mjs';
import {photoArchive,storedZip,MAX_ARCHIVE_BYTES} from '../server/photo-archive.mjs';
import {emptyReview} from '../dist/photo-core.js';

// Synthetic 1px fixture, never a real observation or a training example.
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const fail=(code,fn)=>assert.throws(fn,error=>error.code===code);
function fixture(t){const s=new Store(':memory:');t.after(()=>s.close());return s;}
function add(s,overrides={}){const p={id:randomUUID(),mode:'real',plantId:'chlorophytum',mime:'image/png',name:'private-filename.png',note:'private note',base64:png,...overrides};s.savePhoto(p);return p;}
function review(overrides={}){return {...emptyReview(),expectedRevision:0,quality:'usable',identityConfirmed:true,specimenId:'home-chl-01',source:'own',selected:true,...overrides};}

test('old photos start unlabelled; reviews survive restart and cascade on deletion',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'folium-photo-test-')),file=path.join(dir,'test.sqlite');let s;
  try{
    s=new Store(file);const p=add(s);assert.deepEqual(s.photos('real')[0].review,emptyReview());
    s.reviewPhoto(p.id,review());s.close();s=new Store(file);
    assert.equal(s.photos('real')[0].review.specimenId,'home-chl-01');assert.equal(s.photoDataset().items.length,1);
    s.deletePhoto(p.id);assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM photo_reviews').get().n,0);assert.equal(s.photoDataset().items.length,0);
  }finally{s?.close();await rm(dir,{recursive:true,force:true});}
});
test('selection requires real data, usable quality, identity, specimen and a known source',t=>{
  const s=fixture(t),p=add(s);
  for(const input of [{quality:'unchecked'},{quality:'reject'},{identityConfirmed:false},{specimenId:''},{source:'unknown'},{source:'permitted',sourceReference:' '}])fail('photo_not_eligible',()=>s.reviewPhoto(p.id,review(input)));
  fail('invalid_specimen',()=>s.reviewPhoto(p.id,review({specimenId:'../other'})));
  const demo=add(s,{mode:'demo'});fail('photo_not_eligible',()=>s.reviewPhoto(demo.id,review()));
  assert.equal(s.reviewPhoto(demo.id,review({selected:false})).revision,1);
  assert.equal(s.reviewPhoto(p.id,review({source:'permitted',sourceReference:'Fixture permission for testing only'})).selected,true);
  assert.equal(s.photoDataset().items.length,1);
});
test('human signs validate mutually exclusive answers and stale edits cannot overwrite',t=>{
  const s=fixture(t),p=add(s);
  for(const signs of [[],['unknown','spots'],['no_visible_issue','yellowing'],['disease_x'],['spots','spots']])fail('invalid_photo_signs',()=>s.reviewPhoto(p.id,review({signs})));
  const r=s.reviewPhoto(p.id,review({signs:['spots','yellowing']}));assert.deepEqual(r.signs,['yellowing','spots']);
  fail('photo_review_conflict',()=>s.reviewPhoto(p.id,review({signs:['wilting']})));
  s.reviewPhoto(p.id,review({expectedRevision:1,selected:false,quality:'reject'}));assert.equal(s.photoDataset().items.length,0);
  fail('photo_not_found',()=>s.reviewPhoto('missing',review()));
});
test('exact duplicates are omitted and conflicting labels or specimen identities are blocked',t=>{
  const s=fixture(t),first=add(s),duplicate=add(s),other=add(s,{plantId:'cactus'});
  s.reviewPhoto(first.id,review());s.reviewPhoto(duplicate.id,review());
  const manifest=s.photoDataset();assert.equal(manifest.summary.selected,2);assert.equal(manifest.summary.exported,1);assert.equal(manifest.summary.duplicateImagesOmitted,1);assert.equal(manifest.summary.classes[0].specimens,1);
  fail('specimen_class_conflict',()=>s.reviewPhoto(other.id,review()));
  fail('photo_duplicate_conflict',()=>s.reviewPhoto(other.id,review({specimenId:'home-cactus-01'})));
  fail('photo_duplicate_conflict',()=>s.reviewPhoto(duplicate.id,review({expectedRevision:1,specimenId:'home-chl-02'})));
  fail('photo_duplicate_conflict',()=>s.reviewPhoto(duplicate.id,review({expectedRevision:1,signs:['spots']})));
});
test('export excludes unselected/demo photos, personal notes and unsupported accuracy claims',t=>{
  const s=fixture(t),p=add(s);add(s);add(s,{mode:'demo'});s.savePrefs({email:'private@example.com',telegram:''});s.reviewPhoto(p.id,review());
  const dataset=s.photoDataset(),json=JSON.stringify(dataset);
  assert.equal(dataset.items.length,1);assert.equal(dataset.items[0].split,null);assert.equal(dataset.labelSource,'human');
  for(const secret of ['private-filename','private note','private@example.com','token_hash'])assert.ok(!json.includes(secret));
  assert.equal(dataset.accuracy,undefined);assert.equal(dataset.items[0].diagnosis,undefined);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM commands').get().n,0);
});
function unzipStored(bytes){
  const files=new Map();let offset=0;
  while(bytes.readUInt32LE(offset)===0x04034b50){
    assert.equal(bytes.readUInt16LE(offset+8),0);const size=bytes.readUInt32LE(offset+18),n=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);
    const name=bytes.subarray(offset+30,offset+30+n).toString(),start=offset+30+n+extra,body=bytes.subarray(start,start+size);
    assert.equal(crc32(body),bytes.readUInt32LE(offset+14));files.set(name,body);offset=start+size;
  }
  assert.equal(bytes.readUInt32LE(offset),0x02014b50);assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50);
  assert.equal(bytes.readUInt32LE(bytes.length-6),offset);assert.equal(bytes.readUInt16LE(bytes.length-12),files.size);
  return files;
}
test('ZIP contains coherent original bytes and manifest; unsafe paths and large exports fail',t=>{
  const s=fixture(t);fail('photo_dataset_empty',()=>photoArchive(s));const p=add(s);s.reviewPhoto(p.id,review());
  const files=unzipStored(photoArchive(s)),manifest=JSON.parse(files.get('manifest.json'));
  assert.equal(files.size,2);assert.deepEqual(files.get(manifest.items[0].image),Buffer.from(png,'base64'));
  fail('invalid_archive_entry',()=>storedZip([{name:'../secret',bytes:Buffer.from('no')} ]));
  fail('photo_dataset_too_large',()=>storedZip([{name:'manifest.json',bytes:{length:MAX_ARCHIVE_BYTES}}]));
  fail('photo_dataset_too_large',()=>photoArchive({photoDataset:()=>manifest,db:{prepare:()=>({get:()=>({size:MAX_ARCHIVE_BYTES})})},photo:()=>assert.fail('Must check limit before reading bytes')}));
});
test('photo HTTP routes enforce existing admin boundary and export is read-only',async t=>{
  const s=fixture(t),p=add(s),admin=createServer(s),gateway=createServer(s,{deviceOnly:true});
  for(const server of [admin,gateway]){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));}
  const url=`http://127.0.0.1:${admin.address().port}`,remote=`http://127.0.0.1:${gateway.address().port}`;
  const payload={method:'PUT',headers:{'Content-Type':'application/json','X-Folium-Client':'web'},body:JSON.stringify(review())};
  assert.equal((await fetch(`${url}/api/photos/${p.id}/review`,{...payload,headers:{'Content-Type':'application/json'}})).status,403);
  assert.equal((await fetch(`${url}/api/photos/${p.id}/review`,payload)).status,200);
  assert.equal((await fetch(`${url}/api/photos/${p.id}/review`,payload)).status,409);
  const result=await fetch(`${url}/api/photo-dataset.zip`);assert.equal(result.status,200);assert.equal(result.headers.get('content-type'),'application/zip');unzipStored(Buffer.from(await result.arrayBuffer()));
  for(const endpoint of ['/api/photo-dataset','/api/photo-dataset.zip',`/api/photos/${p.id}/review`])assert.equal((await fetch(remote+endpoint)).status,404);
  assert.equal((await fetch(`${url}/api/photo-dataset`,{headers:{Origin:'https://example.com'}})).status,403);
  for(const asset of ['photo-core.js'])assert.equal((await fetch(`${url}/${asset}`)).status,200);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM commands').get().n,0);
});
