import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Store} from '../server/store.mjs';
import {createServer} from '../server/http.mjs';

// Intentionally cannot target the user's database, real controller, or another URL.
const store=new Store(':memory:'),server=createServer(store);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
async function call(route,method='GET',body,token) {
  const response=await fetch(base+'/api'+route,{method,headers:{'Content-Type':'application/json','X-Folium-Client':'web',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();if(!response.ok)throw Error(`${route}: ${result.error}`);return result;
}
try {
  const {token}=await call('/devices','POST',{deviceId:'simulated-esp32'});
  for(const plant of ['chlorophytum','tradescantia'])await call('/plants/'+plant+'/calibration','POST',{dryADC:3000,wetADC:1000});
  const config=await call('/device/config','GET',undefined,token);
  await call('/device/telemetry','POST',{bootId:randomUUID(),sequence:1,reservoirOk:true,temperature:23,humidity:45,lux:400,firmware:'SIMULATOR-NO-HARDWARE',readings:config.channels.map(c=>({channelId:c.id,bindingRevision:c.revision,sensorId:c.sensor_id,raw:2200,quality:'ok'}))},token);
  console.log('SIMULATION: two channels reported readings into an isolated in-memory database.');
  await call('/channels/1/config','PUT',{expectedRevision:config.channels[0].revision,pumpMlPerSecond:2,maxDoseMl:30,dailyLimitMl:100,cooldownSeconds:1800,armed:true});
  const queued=await call('/commands','POST',{mode:'real',requestKey:randomUUID(),channelId:1,expectedRevision:config.channels[0].revision,volumeMl:10});
  const {command}=await call('/device/commands/claim','POST',{},token);assert.equal(command.id,queued.id);
  assert.equal((await call('/device/commands/claim','POST',{},token)).command,null);
  await call('/device/commands/'+command.id+'/result','POST',{status:'completed',actualDurationMs:command.duration_ms,note:'SIMULATION ONLY: no physical pump operated.'},token);
  const boot=await call('/bootstrap?mode=real');assert.equal(boot.commands[0].status,'completed');assert.equal(boot.events[0].estimatedMl,10);
  console.log('SIMULATION: requested 10 ml, delivered one 5000 ms command, acknowledged its simulated result.');
  console.log('PASS: no real database, device credentials, sensor observations, or pumps were changed.');
} finally {
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});store.close();
}
