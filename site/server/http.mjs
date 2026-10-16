import http from 'node:http';
import {readFile, mkdtemp, unlink, rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ApiError, requireThat as check, object} from './validation.mjs';
import {toCSV} from '../dist/core.js';
import {photoArchive} from './photo-archive.mjs';

const webRoot = fileURLToPath(new URL('../dist/',import.meta.url));
const assets = new Set(['index.html','app.js','core.js','photo-core.js','photo-ui.js','photo-i18n.js','api.js','i18n.js','art.js','styles.css','icon.svg']);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const headers = {
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Content-Security-Policy':"default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'Cross-Origin-Resource-Policy':'same-origin'
};
function json(res,status,value) {res.writeHead(status,{...headers,'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
async function body(req,limit=256*1024) {
  check(req.headers['content-type']?.split(';')[0]==='application/json','json_required',415);
  check(!req.headers['content-encoding'],'encoding_not_supported',415);
  if(Number(req.headers['content-length'])>limit)throw new ApiError(413,'body_too_large');
  const parts=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw new ApiError(413,'body_too_large');parts.push(chunk);}
  let parsed;try{parsed=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new ApiError(400,'invalid_json');}
  return object(parsed);
}
export function createServer(store,{deviceOnly=false}={}) {
  return http.createServer({requestTimeout:20000,headersTimeout:10000,maxHeaderSize:16384},async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost'), route=url.pathname,method=req.method;
      if(!deviceOnly){
        const port=req.socket.localPort;
        check([`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host),'invalid_host',403);
        if(req.headers.origin)check([`http://127.0.0.1:${port}`,`http://localhost:${port}`].includes(req.headers.origin),'cross_origin',403);
        check(!req.headers['sec-fetch-site'] || ['same-origin','none'].includes(req.headers['sec-fetch-site']),'cross_origin',403);
      } else check(!req.headers.origin && !req.headers['sec-fetch-site'],'device_requests_only',403);
      if(route.startsWith('/api/device/')) {
        const deviceId=store.authenticate(req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]);
        if(route==='/api/device/config'&&method==='GET')return json(res,200,store.deviceConfig(deviceId));
        if(route==='/api/device/telemetry'&&method==='POST')return json(res,200,store.telemetry(deviceId,await body(req)));
        if(route==='/api/device/commands/claim'&&method==='POST'){await body(req);return json(res,200,{command:store.claimCommand(deviceId)});}
        const resolution=route.match(/^\/api\/device\/commands\/([\w-]+)$/);
        if(resolution&&method==='GET')return json(res,200,store.commandResolution(deviceId,resolution[1]));
        const match=route.match(/^\/api\/device\/commands\/([\w-]+)\/result$/);
        if(match&&method==='POST')return json(res,200,store.commandResult(deviceId,match[1],await body(req)));
        throw new ApiError(404,'not_found');
      }
      if(deviceOnly)throw new ApiError(404,'not_found');
      if(route.startsWith('/api/')) {
        if(!['GET','HEAD'].includes(method))check(req.headers['x-folium-client']==='web','client_header_required',403);
        const m=url.searchParams.get('mode')||'real';
        if(route==='/api/health'&&method==='GET')return json(res,200,{ok:true,storage:'sqlite',protocol:1});
        if(route==='/api/bootstrap'&&method==='GET')return json(res,200,store.bootstrap(m));
        if(route==='/api/events'&&method==='GET')return json(res,200,store.events({mode:m,before:url.searchParams.has('before')?Number(url.searchParams.get('before')):undefined,plantId:url.searchParams.get('plantId')||undefined,limit:200}));
        if(route==='/api/events'&&method==='POST')return json(res,201,store.saveEvent(await body(req)));
        if(route==='/api/import'&&method==='POST')return json(res,200,store.importBrowser(await body(req,8*1024*1024)));
        if(route==='/api/prefs'&&method==='PUT')return json(res,200,store.savePrefs(await body(req)));
        if(route==='/api/photos'&&method==='GET')return json(res,200,{items:store.photos(m)});
        if(route==='/api/photos'&&method==='POST')return json(res,201,store.savePhoto(await body(req,14*1024*1024)));
        if(route==='/api/photo-dataset'&&method==='GET')return json(res,200,store.photoDataset());
        if(route==='/api/photo-dataset.zip'&&method==='GET') {
          const archive=photoArchive(store);
          res.writeHead(200,{...headers,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="folium-photo-dataset.zip"'});return res.end(archive);
        }
        const review=route.match(/^\/api\/photos\/([\w-]+)\/review$/);
        if(review&&method==='PUT')return json(res,200,store.reviewPhoto(review[1],await body(req)));
        let match=route.match(/^\/api\/photos\/([\w-]+)$/);
        if(match&&method==='GET'){const p=store.photo(match[1]);res.writeHead(200,{...headers,'Content-Type':p.mime,'Content-Disposition':'inline; filename="photo"'});return res.end(p.bytes);}
        if(match&&method==='DELETE'){store.deletePhoto(match[1]);return json(res,200,{deleted:true});}
        match=route.match(/^\/api\/channels\/([12])\/assignment$/);
        if(match&&method==='PUT')return json(res,200,store.swap(Number(match[1]),await body(req)));
        match=route.match(/^\/api\/channels\/([12])\/config$/);
        if(match&&method==='PUT')return json(res,200,store.configureChannel(Number(match[1]),await body(req)));
        match=route.match(/^\/api\/plants\/([\w-]+)\/calibration$/);
        if(match&&method==='POST')return json(res,201,store.calibrate(match[1],await body(req)));
        if(route==='/api/measurements'&&method==='GET')return json(res,200,store.measurements({plantId:url.searchParams.get('plantId')||undefined,since:url.searchParams.get('since')||undefined,before:url.searchParams.has('before')?Number(url.searchParams.get('before')):undefined,limit:url.searchParams.has('limit')?Number(url.searchParams.get('limit')):500}));
        if(route==='/api/commands'&&method==='POST')return json(res,201,store.queueCommand(await body(req)));
        if(route==='/api/disarm'&&method==='POST'){await body(req);return json(res,200,store.disarm());}
        match=route.match(/^\/api\/commands\/([\w-]+)\/reconcile$/);
        if(match&&method==='POST')return json(res,200,store.reconcile(match[1],await body(req)));
        if(route==='/api/devices'&&method==='POST'){const input=await body(req);return json(res,201,store.provisionDevice(input.deviceId));}
        if(route==='/api/export/events.csv'&&method==='GET') {
          const rows=[];let cursor;
          do{const page=store.events({mode:m,before:cursor,limit:1000});rows.push(...page.items);cursor=page.next;}while(cursor);
          res.writeHead(200,{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="folium-events.csv"'});return res.end(toCSV(rows));
        }
        if(route==='/api/backup'&&method==='POST') {
          await body(req);const temp=await mkdtemp(path.join(tmpdir(),'folium-backup-'));
          try{const file=path.join(temp,'folium.sqlite');await store.backup(file);const bytes=await readFile(file);res.writeHead(200,{...headers,'Content-Type':'application/vnd.sqlite3','Content-Disposition':'attachment; filename="folium-backup.sqlite"'});res.end(bytes);}
          finally{await unlink(path.join(temp,'folium.sqlite')).catch(()=>{});await rmdir(temp);}return;
        }
        throw new ApiError(404,'not_found');
      }
      check(method==='GET'||method==='HEAD','method_not_allowed',405);
      const asset=route==='/'?'index.html':route.slice(1);check(assets.has(asset),'not_found',404);
      const bytes=await readFile(path.join(webRoot,asset));res.writeHead(200,{...headers,'Content-Type':mime[path.extname(asset)]||'application/octet-stream'});res.end(method==='HEAD'?undefined:bytes);
    } catch(error) {
      if(res.headersSent){res.end();return;}
      if(!(error instanceof ApiError))console.error('Request failed:',error.code || error.name);
      json(res,error.status||500,{error:error.code && error instanceof ApiError ? error.code:'internal_error'});
    }
  });
}
