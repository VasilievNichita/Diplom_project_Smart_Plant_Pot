import {mkdir,writeFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const deviceId=process.argv[2]||'esp32-main';
if(!/^[a-zA-Z0-9_-]{1,80}$/.test(deviceId))throw Error('Invalid device ID');
const folder=fileURLToPath(new URL('../../private/',import.meta.url));
await mkdir(folder,{recursive:true});
const target=path.join(folder,`${deviceId}.json`);
try{await access(target);throw Error('Credential file already exists. Do not overwrite it.');}catch(error){if(error.code!=='ENOENT')throw error;}
const response=await fetch(`http://127.0.0.1:${process.env.PORT||4173}/api/devices`,{method:'POST',headers:{'Content-Type':'application/json','X-Folium-Client':'web'},body:JSON.stringify({deviceId})});
if(!response.ok)throw Error(`Provisioning failed (${response.status}): ${(await response.json()).error}`);
const credentials=await response.json();
await writeFile(target,JSON.stringify(credentials,null,2),{flag:'wx',mode:0o600});
console.log(`Credential saved to ${target}. The key was not printed. Keep it out of Git.`);
