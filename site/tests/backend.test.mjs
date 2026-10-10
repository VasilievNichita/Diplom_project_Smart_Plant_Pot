import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../server/store.mjs';
import {createServer} from '../server/http.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
function fixture(t, filename=':memory:') {
  let now=Date.parse('2026-10-10T10:00:00Z');const s=new Store(filename,{clock:()=>now});
  t.after(()=>s.close());
  return {s,advance:ms=>{now+=ms;}};
}
function setup(s) {
  const credentials=s.provisionDevice();
  s.calibrate('chlorophytum',{dryADC:3000,wetADC:1000});
  s.calibrate('tradescantia',{dryADC:3000,wetADC:1000});
  return credentials;
}
function packet(s,sequence=1,overrides={}) {
  return {bootId:'test-boot',sequence,reservoirOk:true,temperature:22,humidity:50,lux:300,firmware:'test-only',
    readings:s.config().filter(c=>c.mode==='real').map(c=>({channelId:c.id,bindingRevision:c.revision,sensorId:c.sensor_id,raw:2000,quality:'ok'})),...overrides};
}
function arm(s,channel=1,overrides={}) {
  return s.configureChannel(channel,{expectedRevision:s.channel('real',channel).revision,pumpMlPerSecond:2,maxDoseMl:30,dailyLimitMl:50,cooldownSeconds:60,armed:true,...overrides});
}
function queue(s,overrides={}) { return s.queueCommand({mode:'real',requestKey:randomUUID(),channelId:1,expectedRevision:s.channel('real',1).revision,volumeMl:10,...overrides}); }
const fails=(code,fn)=>assert.throws(fn,e=>e.code===code);

test('events validate data, remain separate and are idempotent',t=>{
  const {s}=fixture(t),event={id:randomUUID(),mode:'real',plantId:'cactus',type:'observation',note:'first'};
  s.saveEvent(event);s.saveEvent(event);
  assert.equal(s.events({mode:'real'}).items.length,1);assert.equal(s.events({mode:'demo'}).items.length,0);
  fails('id_conflict',()=>s.saveEvent({...event,note:'different'}));
  fails('invalid_number',()=>s.saveEvent({...event,id:randomUUID(),humidity:101}));
  fails('invalid_number',()=>s.saveEvent({...event,id:randomUUID(),raw:'42'}));
  fails('invalid_event_type',()=>s.saveEvent({...event,id:randomUUID(),type:'replacement'}));
});
test('legacy import is transactional and repeated imports do not duplicate or overwrite',t=>{
  const {s}=fixture(t),event={id:randomUUID(),mode:'demo',plantId:'cactus',type:'observation',note:'legacy',date:'2026-10-01T10:00:00Z'};
  fails('invalid_event_type',()=>s.importBrowser({events:[event,{...event,id:randomUUID(),type:'bad'}]}));
  assert.equal(s.events({mode:'demo'}).items.length,0);
  const input={mode:'demo',channels:['cactus','tradescantia'],prefs:{email:'',telegram:''},events:[event]};
  assert.equal(s.importBrowser(input).added,1);assert.equal(s.importBrowser(input).added,0);
  assert.equal(s.channel('demo',1).plant_id,'cactus');assert.equal(s.channel('real',1).plant_id,'chlorophytum');
  s.savePrefs({email:'sample@example.com',telegram:''});s.importBrowser(input);assert.equal(s.bootstrap('real').prefs.email,'sample@example.com');
});
test('pagination has no missing or duplicated records',t=>{
  const {s}=fixture(t);
  for(let i=0;i<205;i++)s.saveEvent({id:randomUUID(),mode:'real',plantId:'cactus',type:'observation',note:String(i)});
  const page=s.events({mode:'real'}),next=s.events({mode:'real',before:page.next});
  assert.equal(page.items.length,200);assert.equal(next.items.length,5);assert.equal(next.next,null);
  assert.equal(new Set([...page.items,...next.items].map(e=>e.id)).size,205);
});
test('late imports keep chronological order and date-based pagination',t=>{
  const {s}=fixture(t);
  s.saveEvent({id:randomUUID(),mode:'real',plantId:'cactus',type:'observation',note:'today'});
  s.importBrowser({events:[{id:randomUUID(),mode:'real',plantId:'cactus',type:'observation',note:'yesterday',date:'2026-10-09T10:00:00Z'}]});
  const first=s.events({mode:'real',limit:1});assert.equal(first.items[0].note,'today');
  assert.equal(s.events({mode:'real',before:first.next}).items[0].note,'yesterday');
});
test('photos are stored as bytes, content checked and upload retries deduplicated',t=>{
  const {s}=fixture(t),photo={id:randomUUID(),plantId:'cactus',mode:'real',mime:'image/png',name:'test.png',note:'test',base64:png};
  s.savePhoto(photo);s.savePhoto(photo);assert.equal(s.photos('real').length,1);assert.deepEqual(Buffer.from(s.photo(photo.id).bytes),Buffer.from(png,'base64'));
  fails('invalid_photo',()=>s.savePhoto({...photo,id:randomUUID(),mime:'image/jpeg'}));
  fails('id_conflict',()=>s.savePhoto({...photo,plantId:'tradescantia'}));
  s.deletePhoto(photo.id);assert.equal(s.photos('real').length,0);
});
test('plant swap preserves history, disarms and isolates demo from physical channels',t=>{
  const {s}=fixture(t);s.saveEvent({id:randomUUID(),plantId:'tradescantia',mode:'real',type:'observation',note:'retained'});
  s.swap(2,{mode:'demo',plantId:'cactus',expectedRevision:1});assert.equal(s.channel('real',2).plant_id,'tradescantia');
  s.swap(2,{mode:'real',plantId:'cactus',expectedRevision:1});assert.equal(s.channel('real',2).armed,0);
  assert.equal(s.events({mode:'real',plantId:'tradescantia'}).items[0].note,'retained');
  fails('revision_conflict',()=>s.swap(2,{mode:'real',plantId:'tradescantia',expectedRevision:1}));
  fails('plant_already_connected',()=>s.swap(2,{mode:'real',plantId:'chlorophytum',expectedRevision:2}));
});
test('device auth is scoped and tokens never appear in bootstrap',t=>{
  const {s}=fixture(t),{token,deviceId}=setup(s);assert.equal(s.authenticate(token),deviceId);
  fails('unauthorized',()=>s.authenticate('bad'));fails('unauthorized',()=>s.authenticate('0'.repeat(64)));
  assert.ok(!JSON.stringify(s.bootstrap('real')).includes(token));assert.ok(!JSON.stringify(s.bootstrap('real')).includes('token_hash'));
});
test('telemetry retries do not refresh timestamps; old sequence and wrong binding are rejected',t=>{
  const {s,advance}=fixture(t),{deviceId}=setup(s),p=packet(s);s.telemetry(deviceId,p);advance(61000);
  assert.equal(s.telemetry(deviceId,p).duplicate,true);fails('device_offline',()=>arm(s));
  fails('sequence_conflict',()=>s.telemetry(deviceId,{...p,reservoirOk:false}));
  const bad=packet(s,2);bad.readings[1].bindingRevision=99;fails('binding_mismatch',()=>s.telemetry(deviceId,bad));
  assert.equal(s.measurements().items.length,2);
  s.telemetry(deviceId,packet(s,3));fails('out_of_order',()=>s.telemetry(deviceId,packet(s,2)));
});
test('invalid calibration and out of range/disconnected probes cannot arm irrigation',t=>{
  const {s}=fixture(t),{deviceId}=setup(s);
  fails('calibration_span_too_small',()=>s.calibrate('cactus',{dryADC:2000,wetADC:2001}));
  const p=packet(s);p.readings[0].raw=4000;s.telemetry(deviceId,p);
  assert.equal(s.measurements({plantId:'chlorophytum'}).items[0].quality,'out_of_range');fails('fresh_sensor_required',()=>arm(s));
  p.sequence=2;p.readings[0].raw=null;p.readings[0].quality='disconnected';s.telemetry(deviceId,p);fails('fresh_sensor_required',()=>arm(s));
});
test('queue enforces arming, freshness, reservoir, runtime and dose limits',t=>{
  const {s,advance}=fixture(t),{deviceId}=setup(s);s.telemetry(deviceId,packet(s));
  fails('channel_disarmed',()=>queue(s));arm(s);
  fails('real_mode_required',()=>queue(s,{mode:'demo'}));fails('dose_limit',()=>queue(s,{volumeMl:31}));
  arm(s,1,{pumpMlPerSecond:.1});fails('runtime_limit',()=>queue(s,{volumeMl:10}));arm(s);
  s.telemetry(deviceId,packet(s,2,{reservoirOk:false}));fails('reservoir_empty',()=>queue(s));
  s.telemetry(deviceId,packet(s,3));advance(61000);fails('device_offline',()=>queue(s));
  s.telemetry(deviceId,packet(s,4,{readings:[]}));fails('fresh_sensor_required',()=>queue(s));
});
test('claim hands off only once, duplicate request/result are safe and swap is blocked',t=>{
  const {s}=fixture(t),{deviceId}=setup(s);s.telemetry(deviceId,packet(s));arm(s);
  const key=randomUUID(),command=queue(s,{requestKey:key});assert.equal(queue(s,{requestKey:key}).id,command.id);
  fails('id_conflict',()=>queue(s,{requestKey:key,volumeMl:11}));fails('command_in_progress',()=>queue(s));
  fails('command_in_progress',()=>s.swap(1,{mode:'real',plantId:'cactus',expectedRevision:s.channel('real',1).revision}));
  assert.equal(s.claimCommand(deviceId).id,command.id);assert.equal(s.claimCommand(deviceId),null);
  const result={status:'completed',actualDurationMs:5000,note:'test only'};
  s.commandResult(deviceId,command.id,result);s.commandResult(deviceId,command.id,result);
  assert.equal(s.events({mode:'real'}).items.length,1);const event=s.events({mode:'real'}).items[0];assert.equal(event.waterMl,null);assert.equal(event.estimatedMl,10);
  fails('result_conflict',()=>s.commandResult(deviceId,command.id,{...result,actualDurationMs:1000}));
  fails('cooldown',()=>queue(s));
});
test('water budget is rolling and failed outcomes conservatively reserve the requested dose',t=>{
  const {s,advance}=fixture(t),{deviceId}=setup(s);s.telemetry(deviceId,packet(s));arm(s,1,{dailyLimitMl:30});
  const c=queue(s,{volumeMl:25});s.claimCommand(deviceId);s.commandResult(deviceId,c.id,{status:'failed',actualDurationMs:0,note:'test'});
  advance(61000);s.telemetry(deviceId,packet(s,2));fails('daily_limit',()=>queue(s));
  advance(86400000);s.telemetry(deviceId,packet(s,3));assert.equal(queue(s).status,'queued');
});
test('cooldown starts after the reported pump finish, not when the request was queued',t=>{
  const {s,advance}=fixture(t),{deviceId}=setup(s);s.telemetry(deviceId,packet(s));arm(s);
  const c=queue(s);advance(20000);s.claimCommand(deviceId);advance(5000);
  s.commandResult(deviceId,c.id,{status:'completed',actualDurationMs:5000});
  advance(36000);s.telemetry(deviceId,packet(s,2));fails('cooldown',()=>queue(s));
  advance(25000);s.telemetry(deviceId,packet(s,3));assert.equal(queue(s).status,'queued');
});
test('expired/unsafe queued commands are never delivered and uncertain delivery needs reconciliation',t=>{
  const {s,advance}=fixture(t),{deviceId}=setup(s);s.telemetry(deviceId,packet(s));arm(s);
  const c=queue(s);advance(31000);assert.equal(s.claimCommand(deviceId),null);assert.equal(s.bootstrap('real').commands[0].status,'expired');
  s.telemetry(deviceId,packet(s,2));const unsafe=queue(s);s.telemetry(deviceId,packet(s,3,{reservoirOk:false}));assert.equal(s.claimCommand(deviceId),null);
  assert.equal(s.bootstrap('real').commands.find(x=>x.id===unsafe.id).status,'cancelled');
  s.telemetry(deviceId,packet(s,4));const uncertain=queue(s);s.claimCommand(deviceId);advance(91000);s.telemetry(deviceId,packet(s,5));
  fails('command_in_progress',()=>queue(s));assert.equal(s.bootstrap('real').commands.find(x=>x.id===uncertain.id).status,'unknown');
  fails('physical_check_required',()=>s.reconcile(uncertain.id,{pumpsStopped:false,note:'test'}));
  s.reconcile(uncertain.id,{pumpsStopped:true,note:'Checked locally, test only'});assert.equal(s.channel('real',1).armed,0);
});
test('device reboot disarms both channels and does not revive old boot packets',t=>{
  const {s}=fixture(t),{deviceId}=setup(s);s.telemetry(deviceId,packet(s));arm(s);const c=queue(s);s.claimCommand(deviceId);
  s.telemetry(deviceId,packet(s,1,{bootId:'new-boot'}));assert.equal(s.channel('real',1).armed,0);assert.equal(s.bootstrap('real').commands[0].status,'unknown');
  fails('old_boot',()=>s.telemetry(deviceId,packet(s,2)));
});
test('restart persists events/photos and marks delivered commands uncertain',async t=>{
  const temp=await mkdtemp(path.join(tmpdir(),'folium-test-'));const filename=path.join(temp,'test.sqlite');
  t.after(async()=>{assert.equal(path.dirname(temp),path.resolve(tmpdir()));await rm(temp,{recursive:true,force:true});});
  let s=new Store(filename);const {deviceId}=setup(s);s.telemetry(deviceId,packet(s));arm(s);queue(s);s.claimCommand(deviceId);
  s.saveEvent({id:randomUUID(),mode:'real',plantId:'cactus',type:'observation',note:'persisted'});
  s.savePhoto({id:randomUUID(),mode:'real',plantId:'cactus',note:'retained',mime:'image/png',base64:png});
  const copy=path.join(temp,'backup.sqlite');await s.backup(copy);
  const snapshot=new DatabaseSync(copy);assert.equal(snapshot.prepare('SELECT COUNT(*) AS n FROM photos').get().n,1);snapshot.close();
  s.close();s=new Store(filename);try{assert.equal(s.events({mode:'real'}).items[0].note,'persisted');assert.equal(s.photos('real').length,1);assert.equal(s.bootstrap('real').commands[0].status,'unknown');assert.equal(s.channel('real',1).armed,0);}finally{s.close();}
});
test('HTTP contracts reject cross-origin writes, protect device routes and persist bytes through API',async t=>{
  const {s}=fixture(t),server=createServer(s);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=(url,method='GET',data,extra={})=>fetch(base+url,{method,headers:{'Content-Type':'application/json','X-Folium-Client':'web',...extra},...(data===undefined?{}:{body:JSON.stringify(data)})});
  assert.equal((await call('/api/health')).status,200);
  assert.equal((await call('/api/device/config')).status,401);
  assert.equal((await call('/api/prefs','PUT',{},{Origin:'https://evil.example'})).status,403);
  assert.equal((await call('/api/prefs','PUT',{}, {'X-Folium-Client':''})).status,403);
  assert.equal((await call('/api/prefs','PUT',null)).status,400);
  assert.equal((await call('/server/schema.sql')).status,404);
  const event={id:randomUUID(),mode:'real',plantId:'cactus',type:'observation',note:'HTTP test'};
  const [a,b]=await Promise.all([call('/api/events','POST',event),call('/api/events','POST',event)]);assert.equal(a.status,201);assert.equal(b.status,201);
  const boot=await (await call('/api/bootstrap')).json();assert.equal(boot.events.length,1);
  const photo={id:randomUUID(),mode:'real',plantId:'cactus',note:'test',mime:'image/png',base64:png};assert.equal((await call('/api/photos','POST',photo)).status,201);
  const downloaded=await call('/api/photos/'+photo.id);assert.equal(downloaded.headers.get('content-type'),'image/png');assert.equal(Buffer.from(await downloaded.arrayBuffer()).toString('base64'),png);
  const backupResponse=await call('/api/backup','POST',{});assert.equal(backupResponse.status,200);assert.equal(Buffer.from(await backupResponse.arrayBuffer()).subarray(0,15).toString(),'SQLite format 3');
  const {token}=s.provisionDevice();const auth={Authorization:'Bearer '+token};
  assert.equal((await call('/api/device/config','GET',undefined,auth)).status,200);
  const gateway=createServer(s,{deviceOnly:true});await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{gateway.close(resolve);gateway.closeAllConnections();}));
  const gate=`http://127.0.0.1:${gateway.address().port}`;
  assert.equal((await fetch(gate+'/api/bootstrap')).status,404);
  assert.equal((await fetch(gate+'/api/device/config',{headers:auth})).status,200);
  assert.equal((await fetch(gate+'/api/device/config',{headers:{...auth,Origin:'http://evil.example'}})).status,403);
});
