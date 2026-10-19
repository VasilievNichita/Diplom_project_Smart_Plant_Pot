import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {access,mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {photoArchive} from './photo-archive.mjs';
import {ApiError,requireThat as check,id} from './validation.mjs';
import {readReview} from '../../ml/folium_ml/inspection_ui.mjs';

const execute=promisify(execFile);
const ml=fileURLToPath(new URL('../../ml/',import.meta.url));
export const defaultPython=path.join(ml,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python');
export class PhotoInspection {
  constructor(store,{root,python=defaultPython,worker}={}) {
    this.store=store;
    const database=store.db.prepare('PRAGMA database_list').all().find(r=>r.name==='main').file;
    this.root=root||(database?path.join(path.dirname(database),'photo-inspections'):null);
    this.python=python;
    this.worker=worker||((action,folder)=>execute(python,[path.join(ml,'web_worker.py'),action,folder],{windowsHide:true,timeout:120000,maxBuffer:1024*1024}));
    this.busy=false;
    for(const row of store.db.prepare('SELECT id,payload FROM photo_inspections').all()) {
      const job=JSON.parse(row.payload);
      if(['running','preparing'].includes(job.status)){job.status='failed';job.error='interrupted';this.put(row.id,job);}
    }
  }
  fingerprint(){return createHash('sha256').update(JSON.stringify(this.store.photoDataset().items)).digest('hex');}
  put(key,job){this.store.db.prepare('UPDATE photo_inspections SET payload=? WHERE id=?').run(JSON.stringify(job),key);}
  get(key){
    const row=this.store.db.prepare('SELECT * FROM photo_inspections WHERE id=?').get(id(key));check(row,'inspection_not_found',404);
    const job=JSON.parse(row.payload);
    const unavailable=['audited','prepared'].includes(job.status)&&(!this.root||!existsSync(path.join(this.folder(row.id),'source.zip')));
    return {...job,id:row.id,revision:row.revision,stale:row.fingerprint!==this.fingerprint()||unavailable};
  }
  current(){const row=this.store.db.prepare('SELECT id FROM photo_inspections ORDER BY rowid DESC LIMIT 1').get();return row?this.get(row.id):null;}
  folder(key){check(this.root,'inspection_storage_unavailable',503);return path.join(this.root,id(key));}
  async start(){
    check(!this.busy,'inspection_busy',409);
    const previous=this.current();
    if(previous&&!previous.stale&&!previous.error&&['audited','prepared'].includes(previous.status))return previous;
    check(this.root,'inspection_storage_unavailable',503);
    try{await access(this.python);}catch{throw new ApiError(503,'inspection_python_missing');}
    // Recheck after the asynchronous availability check to serialize competing tabs.
    check(!this.busy,'inspection_busy',409);
    const archive=photoArchive(this.store),fingerprint=this.fingerprint(),key=randomUUID();
    const job={status:'running',createdAt:new Date().toISOString(),error:null,review:null,report:null,records:[],prepared:null};
    this.busy=true;
    try{
      await mkdir(this.folder(key),{recursive:true});
      await writeFile(path.join(this.folder(key),'source.zip'),archive,{flag:'wx'});
      this.store.db.prepare('INSERT INTO photo_inspections(id,fingerprint,payload) VALUES (?,?,?)').run(key,fingerprint,JSON.stringify(job));
    }catch(error){this.busy=false;throw error;}
    this.pending=this.run(key,'audit');
    return this.get(key);
  }
  async run(key,action){
    try {
      await this.worker(action,this.folder(key));
      const value=JSON.parse(await readFile(path.join(this.folder(key),action==='audit'?'result.json':'prepared-result.json'),'utf8'));
      const job=this.get(key);
      if(action==='audit'){job.report=value.report;job.records=value.records;job.status='audited';}
      else{job.prepared=value;job.status='prepared';}
      job.error=null;this.put(key,job);
    }catch{
      // Shutdown may close SQLite while the child is finishing. The next process
      // explicitly marks its unfinished record interrupted instead of resuming it.
      try{const job=this.get(key);job.status='failed';job.error='worker_failed';this.put(key,job);}catch{}
    }finally{this.busy=false;}
  }
  editable(key,revision){
    const job=this.get(key);
    check(this.current()?.id===key&&!job.stale,'inspection_stale',409);
    check(job.revision===revision,'inspection_conflict',409);
    check(!this.busy&&job.status==='audited','inspection_not_editable',409);
    return job;
  }
  save(key,input){
    const job=this.editable(key,input.expectedRevision);
    const audit={auditId:job.report.auditId,purpose:job.report.purpose,pairs:job.report.possibleCrossSpecimenDuplicates};
    const review={format:'folium-photo-pair-review',version:1,auditId:input.auditId,purpose:audit.purpose,
      reviewedAt:new Date().toISOString(),acknowledged:input.acknowledged,pairs:input.pairs};
    try{readReview(audit,review);}catch{throw new ApiError(400,'inspection_invalid_review');}
    job.review=review;
    this.store.db.prepare('UPDATE photo_inspections SET payload=?,revision=revision+1 WHERE id=?').run(JSON.stringify(job),key);
    return this.get(key);
  }
  async prepare(key,input){
    const job=this.editable(key,input.expectedRevision),r=job.report;
    check(r.ok&&r.structuralSplitPossible&&!r.possibleDuplicateListTruncated,'inspection_not_ready',409);
    check(!r.possibleDuplicatePairCount||(job.review?.acknowledged===true&&job.review.pairs.every(p=>p.decision==='different_specimens')),'inspection_unresolved',409);
    this.busy=true;job.status='preparing';this.put(key,job);
    this.pending=(async()=>{
      try{
        if(job.review)await writeFile(path.join(this.folder(key),'decisions.json'),JSON.stringify(job.review),{flag:'wx'});
        await this.run(key,'prepare');
      }catch{job.status='failed';job.error='worker_failed';this.put(key,job);this.busy=false;}
    })();
    return this.get(key);
  }
  async thumbnail(key,photo){
    const job=this.get(key);id(photo);
    check(job.records.some(r=>r.id===photo),'photo_not_found',404);
    return readFile(path.join(this.folder(key),'thumbs',photo+'.jpg'));
  }
}
