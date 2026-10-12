import {requireThat as check} from './validation.mjs';

// Stored ZIP entries: photos are already compressed. Bounded in-memory export
// keeps the snapshot coherent with its manifest in this single-process server.
export const MAX_ARCHIVE_BYTES=100*1024*1024;
const crcTable=Uint32Array.from({length:256},(_,i)=>{
  for(let k=0;k<8;k++)i=(i&1)?0xedb88320^(i>>>1):i>>>1;
  return i>>>0;
});
function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export function storedZip(entries) {
  check(entries.length<=10000,'photo_dataset_too_large',413);
  let size=22;
  const names=new Set();
  for(const e of entries){
    check(/^(manifest\.json|images\/[a-zA-Z0-9_-]{1,80}\.(png|jpg|webp))$/.test(e.name)&&!names.has(e.name),'invalid_archive_entry');
    names.add(e.name);size+=76+2*Buffer.byteLength(e.name)+e.bytes.length;
  }
  check(size<=MAX_ARCHIVE_BYTES,'photo_dataset_too_large',413);
  const parts=[],central=[];let offset=0;
  const now=new Date(),year=Math.min(2107,Math.max(1980,now.getUTCFullYear()));
  const dosDate=((year-1980)<<9)|((now.getUTCMonth()+1)<<5)|now.getUTCDate();
  const dosTime=(now.getUTCHours()<<11)|(now.getUTCMinutes()<<5)|Math.floor(now.getUTCSeconds()/2);
  for(const {name,bytes} of entries){
    const filename=Buffer.from(name),crc=crc32(bytes),header=Buffer.alloc(30),entry=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x0800,6);
    header.writeUInt16LE(dosTime,10);header.writeUInt16LE(dosDate,12); // Export time in UTC, not capture time.
    header.writeUInt32LE(crc,14);header.writeUInt32LE(bytes.length,18);header.writeUInt32LE(bytes.length,22);header.writeUInt16LE(filename.length,26);
    entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(0x0800,8);entry.writeUInt16LE(dosTime,12);entry.writeUInt16LE(dosDate,14);
    entry.writeUInt32LE(crc,16);entry.writeUInt32LE(bytes.length,20);entry.writeUInt32LE(bytes.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);
    parts.push(header,filename,bytes);central.push(entry,filename);offset+=header.length+filename.length+bytes.length;
  }
  const directorySize=central.reduce((sum,b)=>sum+b.length,0),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directorySize,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...parts,...central,end]);
}
export function photoArchive(store) {
  const manifest=store.photoDataset();
  check(manifest.items.length,'photo_dataset_empty',409);
  const entries=[{name:'manifest.json',bytes:Buffer.from(JSON.stringify(manifest,null,2))}];
  let size=entries[0].bytes.length;
  for(const item of manifest.items){
    // Check lengths before allocating the image blobs.
    const row=store.db.prepare('SELECT length(bytes) AS size FROM photos WHERE id=?').get(item.id);
    size+=row.size+256;check(size<MAX_ARCHIVE_BYTES,'photo_dataset_too_large',413);
  }
  for(const item of manifest.items)entries.push({name:item.image,bytes:store.photo(item.id).bytes});
  return storedZip(entries);
}
