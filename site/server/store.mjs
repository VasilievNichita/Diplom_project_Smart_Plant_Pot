import {DatabaseSync, backup} from 'node:sqlite';
import {randomUUID, randomBytes, createHash} from 'node:crypto';
import {readFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {PLANTS} from '../dist/core.js';
import {requireThat as check, object, string, number, id, mode, timestamp, metrics} from './validation.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const pending = "('queued','delivered','unknown')";
export class Store {
  constructor(filename, {clock = () => Date.now()} = {}) {
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), {recursive: true});
    this.clock = clock;
    this.db = new DatabaseSync(filename, {timeout: 5000});
    this.db.exec('PRAGMA foreign_keys=ON; PRAGMA locking_mode=EXCLUSIVE; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    this.db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
    this.tx(() => {
      this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('schemaVersion', '1');
      this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('serverId', randomUUID());
      this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('prefs', JSON.stringify({email:'', telegram:''}));
      for (const p of PLANTS) this.db.prepare('INSERT OR IGNORE INTO plants VALUES (?,?,?,?)').run(p.id, p.id, p.sensor, p.latin);
      for (const m of ['demo','real']) for (const [i,p] of PLANTS.slice(0,2).entries()) {
        this.db.prepare('INSERT OR IGNORE INTO channels(mode,id,plant_id) VALUES (?,?,?)').run(m, i+1, p.id);
      }
    });
    // A process restart never silently re-arms a pump or redelivers an uncertain command.
    this.db.exec("UPDATE channels SET armed=0; UPDATE commands SET status='unknown' WHERE status='delivered'; UPDATE commands SET status='cancelled' WHERE status='queued';");
  }
  now() { return new Date(this.clock()).toISOString(); }
  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
  async backup(filename) { return backup(this.db, filename); }
  plant(plantId) { const p = this.db.prepare('SELECT * FROM plants WHERE id=?').get(id(plantId)); check(p, 'unknown_plant',404); return p; }
  channel(m, channelId) {
    const c = this.db.prepare('SELECT * FROM channels WHERE mode=? AND id=?').get(mode(m), number(channelId,1,2,false,true));
    check(c, 'unknown_channel',404); return c;
  }
  calibration(plantId) { return this.db.prepare('SELECT * FROM calibrations WHERE plant_id=? ORDER BY rowid DESC LIMIT 1').get(plantId) || null; }
  expire() {
    this.db.prepare("UPDATE commands SET status='expired' WHERE status='queued' AND expires_at<=?").run(this.now());
    const cutoff = new Date(this.clock()-60000).toISOString();
    this.db.prepare("UPDATE commands SET status='unknown' WHERE status='delivered' AND expires_at<=?").run(cutoff);
  }
  config() {
    this.expire();
    return this.db.prepare('SELECT * FROM channels ORDER BY mode,id').all().map(c => ({
      ...c, armed: Boolean(c.armed), sensor_id: this.plant(c.plant_id).sensor_id, calibration: this.calibration(c.plant_id)
    }));
  }
  events({mode: m, before, limit = 200, plantId} = {}) {
    mode(m); number(limit,1,1000,false,true);
    if (plantId) this.plant(plantId);
    const cursor=before==null ? {date:'9999-12-31T23:59:59.999Z',seq:Number.MAX_SAFE_INTEGER} : this.db.prepare('SELECT date,seq FROM events WHERE mode=? AND seq=?').get(m,number(before,1,Number.MAX_SAFE_INTEGER,false,true));
    check(cursor,'invalid_cursor');
    const rows = this.db.prepare('SELECT seq,payload FROM events WHERE mode=? AND (date,seq)<(?,?) AND (? IS NULL OR plant_id=?) ORDER BY date DESC,seq DESC LIMIT ?')
      .all(m,cursor.date,cursor.seq,plantId || null,plantId || null,limit+1);
    const hasMore = rows.length > limit; const items = rows.slice(0,limit);
    return {items: items.map(r => ({...JSON.parse(r.payload),seq:r.seq})), next: hasMore ? items.at(-1).seq : null};
  }
  bootstrap(m) {
    const channels = this.config();
    const page = this.events({mode:m});
    return {
      serverId: this.db.prepare("SELECT value FROM meta WHERE key='serverId'").get().value,
      plants: this.db.prepare('SELECT * FROM plants').all(), channelConfig: channels,
      events: page.items, next: page.next,
      eventCount: this.db.prepare('SELECT COUNT(*) AS n FROM events WHERE mode=?').get(mode(m)).n,
      prefs: JSON.parse(this.db.prepare("SELECT value FROM meta WHERE key='prefs'").get().value),
      devices: this.db.prepare('SELECT id,last_seen,reservoir_ok,firmware FROM devices').all(),
      commands: this.db.prepare('SELECT * FROM commands ORDER BY created_at DESC,rowid DESC LIMIT 30').all(),
      latest: this.db.prepare('SELECT * FROM measurements WHERE seq IN (SELECT MAX(seq) FROM measurements GROUP BY plant_id)').all(),
      serverTime: this.now(), version: 2
    };
  }
  saveEvent(body, {importing = false} = {}) {
    object(body); this.plant(body.plantId); mode(body.mode);
    const allowed = ['observation','watering','feeding','repotting','moving','measurement'];
    if (importing) allowed.push('replacement','photo');
    check(allowed.includes(body.type), 'invalid_event_type');
    const record = {id:id(body.id), plantId:body.plantId, mode:body.mode, type:body.type,
      date: importing ? timestamp(body.date) : this.now(), note:string(body.note,1000,''), ...metrics(body), source: importing?'browser-import':'manual'};
    check(record.note.trim() || Object.values(metrics(body)).some(v=>v!==null), 'empty_event');
    const existing = this.db.prepare('SELECT payload FROM events WHERE id=?').get(record.id);
    if (existing) {
      const old = JSON.parse(existing.payload);
      const comparable = v => JSON.stringify([v.plantId,v.mode,v.type,v.note,...Object.keys(metrics({})).map(k=>v[k])]);
      check(comparable(old)===comparable(record),'id_conflict',409); return old;
    }
    this.insertEvent(record); return record;
  }
  insertEvent(record) {
    this.db.prepare('INSERT INTO events(id,mode,plant_id,date,payload) VALUES (?,?,?,?,?)')
      .run(record.id,record.mode,record.plantId,record.date,JSON.stringify(record));
  }
  importBrowser(body) {
    object(body); check(Array.isArray(body.events) && body.events.length<=5000,'invalid_import');
    return this.tx(() => {
      let added=0;
      for (const event of body.events) {
        const existed = this.db.prepare('SELECT 1 FROM events WHERE id=?').get(id(event.id));
        this.saveEvent(event,{importing:true}); if(!existed) added++;
      }
      // Preserve server settings on later imports from other browsers.
      if (!this.db.prepare("SELECT 1 FROM meta WHERE key='browserImported'").get()) {
        if (body.prefs) this.savePrefs(body.prefs);
        if (Array.isArray(body.channels)) {
          check(body.channels.length===2 && new Set(body.channels).size===2,'invalid_channels');
          body.channels.forEach(p=>this.plant(p)); mode(body.mode);
          const current=this.config().filter(c=>c.mode===body.mode);
          if (current.every(c=>c.revision===1 && !c.armed)) {
            this.db.prepare('DELETE FROM channels WHERE mode=?').run(body.mode);
            body.channels.forEach((p,i)=>this.db.prepare('INSERT INTO channels(mode,id,plant_id) VALUES (?,?,?)').run(body.mode,i+1,p));
          }
        }
        this.db.prepare('INSERT INTO meta VALUES (?,?)').run('browserImported',this.now());
      }
      return {added};
    });
  }
  savePrefs(body) {
    object(body); const prefs={email:string(body.email,160,''),telegram:string(body.telegram,40,'')};
    check(!prefs.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prefs.email),'invalid_email');
    check(!prefs.telegram || /^@?[a-zA-Z0-9_]{5,32}$/.test(prefs.telegram),'invalid_telegram');
    this.db.prepare("UPDATE meta SET value=? WHERE key='prefs'").run(JSON.stringify(prefs)); return prefs;
  }
  swap(channelId, body) {
    object(body); const m=mode(body.mode); this.plant(body.plantId);
    return this.tx(() => {
      this.expire(); const c=this.channel(m,channelId);
      check(c.revision===body.expectedRevision,'revision_conflict',409);
      check(!this.db.prepare('SELECT 1 FROM channels WHERE mode=? AND plant_id=?').get(m,body.plantId),'plant_already_connected',409);
      if(m==='real') check(!this.db.prepare(`SELECT 1 FROM commands WHERE status IN ${pending}`).get(),'command_in_progress',409);
      this.db.prepare('UPDATE channels SET plant_id=?,revision=revision+1,armed=0 WHERE mode=? AND id=?').run(body.plantId,m,channelId);
      this.insertEvent({id:randomUUID(),mode:m,plantId:body.plantId,type:'replacement',date:this.now(),note:`${c.plant_id} → ${body.plantId}`,source:'server'});
      return this.channel(m,channelId);
    });
  }
  savePhoto(body) {
    object(body); const plant=this.plant(body.plantId); mode(body.mode); id(body.id);
    const note=string(body.note,1000,''), name=string(body.name,180,'photo'), date=body.date?timestamp(body.date):this.now();
    check(['image/png','image/jpeg','image/webp'].includes(body.mime),'invalid_photo');
    check(typeof body.base64==='string' && body.base64.length<=13981016 && /^[A-Za-z0-9+/]*={0,2}$/.test(body.base64),'invalid_photo');
    const bytes=Buffer.from(body.base64,'base64'); check(bytes.length>12 && bytes.length<=10*1024*1024,'invalid_photo');
    const matches = body.mime==='image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
      body.mime==='image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255 : bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
    check(matches,'invalid_photo'); const hash=digest(bytes);
    const old=this.db.prepare('SELECT * FROM photos WHERE id=?').get(body.id);
    if(old) {check(old.digest===hash && old.mode===body.mode && old.plant_id===plant.id && old.note===note,'id_conflict',409); return {id:old.id};}
    this.db.prepare('INSERT INTO photos VALUES (?,?,?,?,?,?,?,?,?)').run(body.id,body.mode,plant.id,date,note,name,body.mime,hash,bytes);
    return {id:body.id};
  }
  photos(m) { return this.db.prepare('SELECT id,mode,plant_id AS plantId,date,note,name,mime FROM photos WHERE mode=? ORDER BY date DESC').all(mode(m)); }
  photo(photoId) { const p=this.db.prepare('SELECT * FROM photos WHERE id=?').get(id(photoId)); check(p,'photo_not_found',404); return p; }
  deletePhoto(photoId) { this.db.prepare('DELETE FROM photos WHERE id=?').run(id(photoId)); }
  calibrate(plantId,body) {
    object(body);const p=this.plant(plantId),dry=number(body.dryADC,0,4095,false,true),wet=number(body.wetADC,0,4095,false,true);
    check(Math.abs(dry-wet)>=100,'calibration_span_too_small');
    return this.tx(()=>{
      this.expire(); check(!this.db.prepare(`SELECT 1 FROM commands WHERE status IN ${pending}`).get(),'command_in_progress',409);
      const cal={id:randomUUID(),plant_id:p.id,sensor_id:p.sensor_id,dry_adc:dry,wet_adc:wet,created_at:this.now()};
      this.db.prepare('INSERT INTO calibrations VALUES (?,?,?,?,?,?)').run(...Object.values(cal));
      this.db.prepare("UPDATE channels SET armed=0,revision=revision+1 WHERE mode='real' AND plant_id=?").run(plantId);
      return cal;
    });
  }
  provisionDevice(deviceId='esp32-main') {
    id(deviceId); const token=randomBytes(32).toString('hex');
    check(!this.db.prepare('SELECT 1 FROM devices').get(),'device_already_registered',409);
    this.db.prepare('INSERT INTO devices(id,token_hash) VALUES (?,?)').run(deviceId,digest(token));
    return {deviceId,token};
  }
  authenticate(token) {
    check(typeof token==='string' && token.length===64,'unauthorized',401);
    const d=this.db.prepare('SELECT * FROM devices WHERE token_hash=?').get(digest(token)); check(d,'unauthorized',401); return d.id;
  }
  deviceConfig(deviceId) { return {deviceId,serverTime:this.now(),channels:this.config().filter(c=>c.mode==='real'),maxRuntimeMs:30000,protocol:1,capabilities:['measured-duration-v1','command-resolution-v1']}; }
  telemetry(deviceId,body) {
    object(body); const boot=id(body.bootId),sequence=number(body.sequence,0,2147483647,false,true);
    check(typeof body.reservoirOk==='boolean','invalid_reservoir');
    check(Array.isArray(body.readings)&&body.readings.length<=2,'invalid_readings');
    check(new Set(body.readings.map(r=>r.channelId)).size===body.readings.length,'duplicate_channel');
    const temp=number(body.temperature,-20,60,true),humidity=number(body.humidity,0,100,true),lux=number(body.lux,0,200000,true);
    const observed=body.observedAt?timestamp(body.observedAt):null;
    if(observed) check(Math.abs(Date.parse(observed)-this.clock())<=120000,'stale_observation');
    const hash=digest(JSON.stringify(body));
    return this.tx(()=>{
      const old=this.db.prepare('SELECT digest FROM telemetry_packets WHERE device_id=? AND boot_id=? AND sequence=?').get(deviceId,boot,sequence);
      if(old){check(old.digest===hash,'sequence_conflict',409);return {duplicate:true};}
      const device=this.db.prepare('SELECT * FROM devices WHERE id=?').get(deviceId); check(device,'unknown_device',404);
      if(device.last_boot===boot) check(sequence>device.last_sequence,'out_of_order',409);
      else if(this.db.prepare('SELECT 1 FROM telemetry_packets WHERE device_id=? AND boot_id=?').get(deviceId,boot)) check(false,'old_boot',409);
      const readings=body.readings.map(r=>{
        object(r);const c=this.channel('real',r.channelId),p=this.plant(c.plant_id);
        check(r.bindingRevision===c.revision && r.sensorId===p.sensor_id,'binding_mismatch',409);
        check(['ok','disconnected','error'].includes(r.quality),'invalid_quality');
        const raw=number(r.raw,0,4095,r.quality!=='ok',true),cal=this.calibration(p.id);
        let quality=r.quality, moisture=null;
        if(quality==='ok'&&cal){const value=100*(raw-cal.dry_adc)/(cal.wet_adc-cal.dry_adc);if(value<0||value>100)quality='out_of_range';else moisture=Math.round(value*10)/10;}
        else if(quality==='ok')quality='uncalibrated';
        return {c,p,raw,cal,quality,moisture};
      });
      const now=this.now();
      this.db.prepare('INSERT INTO telemetry_packets VALUES (?,?,?,?,?)').run(deviceId,boot,sequence,hash,now);
      const rebooted=device.last_boot && device.last_boot!==boot;
      if(rebooted) {
        this.db.exec("UPDATE channels SET armed=0 WHERE mode='real'; UPDATE commands SET status='cancelled' WHERE status='queued'; UPDATE commands SET status='unknown' WHERE status='delivered';");
      }
      this.db.prepare('UPDATE devices SET last_seen=?,reservoir_ok=?,firmware=?,last_boot=?,last_sequence=? WHERE id=?').run(now,Number(body.reservoirOk),string(body.firmware,80,''),boot,sequence,deviceId);
      for(const r of readings)this.db.prepare('INSERT INTO measurements(device_id,plant_id,sensor_id,channel_id,binding_revision,date,observed_at,raw,moisture,calibration_id,temperature,humidity,lux,quality) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(deviceId,r.p.id,r.p.sensor_id,r.c.id,r.c.revision,now,observed,r.raw,r.moisture,r.cal?.id||null,temp,humidity,lux,r.quality);
      return {duplicate:false,accepted:readings.length,serverTime:now};
    });
  }
  measurements({plantId,since,limit=500,before}={}) {
    if(plantId)this.plant(plantId); number(limit,1,2000,false,true);
    const rows=this.db.prepare('SELECT * FROM measurements WHERE (? IS NULL OR plant_id=?) AND date>=? AND seq<? ORDER BY seq DESC LIMIT ?')
      .all(plantId||null,plantId||null,since?timestamp(since):'1970-01-01T00:00:00.000Z',before==null?Number.MAX_SAFE_INTEGER:number(before,1,Number.MAX_SAFE_INTEGER,false,true),limit+1);
    return {items:rows.slice(0,limit),next:rows.length>limit?rows[limit-1].seq:null};
  }
  readiness(c) {
    check(c.armed,'channel_disarmed',409);
    check(c.pump_ml_s && this.calibration(c.plant_id),'calibration_required',409);
    const device=this.db.prepare('SELECT * FROM devices').get();check(device,'device_offline',409);
    check(device.last_seen && this.clock()-Date.parse(device.last_seen)<=60000,'device_offline',409);
    check(device.reservoir_ok===1,'reservoir_empty',409);
    const last=this.db.prepare('SELECT * FROM measurements WHERE plant_id=? ORDER BY seq DESC LIMIT 1').get(c.plant_id);
    check(last && last.device_id===device.id && last.binding_revision===c.revision && last.quality==='ok' && this.clock()-Date.parse(last.date)<=60000,'fresh_sensor_required',409);
    return device;
  }
  configureChannel(channelId,body) {
    object(body); check(typeof body.armed==='boolean','invalid_armed');
    return this.tx(()=>{
      this.expire(); const c=this.channel('real',channelId);check(c.revision===body.expectedRevision,'revision_conflict',409);
      check(!this.db.prepare(`SELECT 1 FROM commands WHERE status IN ${pending}`).get(),'command_in_progress',409);
      const flow=number(body.pumpMlPerSecond,.1,100),dose=number(body.maxDoseMl,1,100),daily=number(body.dailyLimitMl,dose,500),cooldown=number(body.cooldownSeconds,60,86400,false,true);
      if(body.armed)this.readiness({...c,armed:1,pump_ml_s:flow});
      this.db.prepare("UPDATE channels SET armed=?,pump_ml_s=?,max_dose_ml=?,daily_limit_ml=?,cooldown_s=? WHERE mode='real' AND id=?")
        .run(Number(body.armed),flow,dose,daily,cooldown,channelId);
      return this.channel('real',channelId);
    });
  }
  queueCommand(body) {
    object(body);check(body.mode==='real','real_mode_required');id(body.requestKey);number(body.volumeMl,1,100);
    return this.tx(()=>{
      this.expire(); const old=this.db.prepare('SELECT * FROM commands WHERE request_key=?').get(body.requestKey);
      if(old){check(old.channel_id===body.channelId && old.requested_ml===body.volumeMl && old.binding_revision===body.expectedRevision,'id_conflict',409);return old;}
      const c=this.channel('real',body.channelId);check(c.revision===body.expectedRevision,'revision_conflict',409);
      const d=this.readiness(c);check(!this.db.prepare(`SELECT 1 FROM commands WHERE status IN ${pending}`).get(),'command_in_progress',409);
      check(body.volumeMl<=c.max_dose_ml,'dose_limit',409);
      const duration=Math.ceil(body.volumeMl/c.pump_ml_s*1000);check(duration<=30000,'runtime_limit',409);
      const last=this.db.prepare("SELECT * FROM commands WHERE channel_id=? AND status NOT IN ('expired','cancelled') ORDER BY created_at DESC LIMIT 1").get(c.id);
      const lastEnd=last && (last.finished_at || (last.delivered_at ? new Date(Date.parse(last.delivered_at)+last.duration_ms).toISOString() : last.created_at));
      check(!lastEnd || this.clock()-Date.parse(lastEnd)>=c.cooldown_s*1000,'cooldown',409);
      const since=new Date(this.clock()-86400000).toISOString();
      const used=this.db.prepare("SELECT COALESCE(SUM(MAX(requested_ml,requested_ml*COALESCE(json_extract(result,'$.actualDurationMs'),0)/duration_ms)),0) AS ml FROM commands WHERE channel_id=? AND created_at>=? AND status NOT IN ('expired','cancelled')").get(c.id,since).ml;
      check(used+body.volumeMl<=c.daily_limit_ml,'daily_limit',409);
      const cmd={id:randomUUID(),request_key:body.requestKey,device_id:d.id,channel_id:c.id,plant_id:c.plant_id,sensor_id:this.plant(c.plant_id).sensor_id,binding_revision:c.revision,requested_ml:body.volumeMl,duration_ms:duration,status:'queued',created_at:this.now(),expires_at:new Date(this.clock()+30000).toISOString()};
      this.db.prepare('INSERT INTO commands(id,request_key,device_id,channel_id,plant_id,sensor_id,binding_revision,requested_ml,duration_ms,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(cmd));
      return cmd;
    });
  }
  claimCommand(deviceId) {
    return this.tx(()=>{
      this.expire();const cmd=this.db.prepare("SELECT * FROM commands WHERE device_id=? AND status='queued' ORDER BY created_at LIMIT 1").get(deviceId); if(!cmd)return null;
      const c=this.channel('real',cmd.channel_id);
      try{check(c.revision===cmd.binding_revision,'binding_mismatch',409);this.readiness(c);}catch(error){this.db.prepare("UPDATE commands SET status='cancelled' WHERE id=?").run(cmd.id);return null;}
      this.db.prepare("UPDATE commands SET status='delivered',delivered_at=? WHERE id=?").run(this.now(),cmd.id);
      return {...cmd,status:'delivered',delivered_at:this.now()};
    });
  }
  commandResult(deviceId,commandId,body) {
    object(body);check(['completed','failed'].includes(body.status),'invalid_result');
    // Record actual output time, including a fault; never require firmware to hide an overrun.
    // This reporting range does not enlarge the 30-second command limit.
    const result={status:body.status,actualDurationMs:number(body.actualDurationMs,0,86400000,false,true),note:string(body.note,500,'')};
    return this.tx(()=>{
      const cmd=this.db.prepare('SELECT * FROM commands WHERE id=? AND device_id=?').get(id(commandId),deviceId);check(cmd,'command_not_found',404);
      if(cmd.result){check(cmd.result===JSON.stringify(result),'result_conflict',409);return cmd;}
      check(['delivered','unknown'].includes(cmd.status),'command_not_delivered',409);
      const overrun=result.actualDurationMs>cmd.duration_ms+50;
      check(!overrun || result.status==='failed','duration_exceeded',409);
      if(overrun)this.disarm();
      this.db.prepare('UPDATE commands SET status=?,result=?,finished_at=? WHERE id=?').run(result.status,JSON.stringify(result),this.now(),cmd.id);
      this.insertEvent({id:randomUUID(),mode:'real',plantId:cmd.plant_id,type:'watering',date:this.now(),note:result.note,source:'controller',commandId:cmd.id,status:result.status,durationMs:result.actualDurationMs,estimatedMl:Math.round(cmd.requested_ml*result.actualDurationMs/cmd.duration_ms*10)/10,waterMl:null});
      return this.db.prepare('SELECT * FROM commands WHERE id=?').get(cmd.id);
    });
  }
  commandResolution(deviceId,commandId) {
    this.expire();
    const cmd=this.db.prepare('SELECT id,status,result FROM commands WHERE id=? AND device_id=?').get(id(commandId),deviceId);
    check(cmd,'command_not_found',404);
    return {id:cmd.id,status:cmd.status,resolution:cmd.result?JSON.parse(cmd.result):null};
  }
  disarm() {
    this.db.exec("UPDATE channels SET armed=0 WHERE mode='real'; UPDATE commands SET status='cancelled' WHERE status='queued';");
    return {disarmed:true, note:'Delivered commands still require a local controller stop or watchdog. This is not a hardware emergency stop.'};
  }
  reconcile(commandId,body) {
    object(body);check(body.pumpsStopped===true,'physical_check_required');
    const note=string(body.note,500);check(note.trim().length>=5,'physical_check_required');
    this.expire();const cmd=this.db.prepare('SELECT * FROM commands WHERE id=?').get(id(commandId));check(cmd,'command_not_found',404);
    check(cmd.status==='unknown','not_uncertain',409);
    this.db.prepare("UPDATE commands SET status='failed',result=?,finished_at=? WHERE id=?").run(JSON.stringify({reconciled:true,note}),this.now(),cmd.id);
    this.disarm();return {reconciled:true};
  }
}
