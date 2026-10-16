export async function request(path, {method='GET',body,signal}={}) {
  const response=await fetch('/api'+path,{method,signal:signal||AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-Folium-Client':'web'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!response.ok){const data=await response.json().catch(()=>({}));const error=new Error(data.error||'server_error');error.code=data.error;throw error;}
  return response.json();
}
export async function photoPayload(photo) {
  const bytes=new Uint8Array(await photo.file.arrayBuffer());let binary='';
  for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return {id:photo.id,plantId:photo.plantId,mode:photo.mode,date:photo.date,note:photo.note,name:photo.file.name||'photo',mime:photo.file.type,base64:btoa(binary)};
}
export async function databaseBackup() {
  const response=await fetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json','X-Folium-Client':'web'},body:'{}',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('backup_failed');return response.blob();
}
export async function photoDatasetArchive() {
  const response=await fetch('/api/photo-dataset.zip',{signal:AbortSignal.timeout(60000)});
  if(!response.ok){const data=await response.json().catch(()=>({}));const error=new Error(data.error||'server_error');error.code=data.error;throw error;}
  return response.blob();
}
