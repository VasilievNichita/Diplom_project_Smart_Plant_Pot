import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {Store} from '../server/store.mjs';
import {createServer} from '../server/http.mjs';
const defaultFile=fileURLToPath(new URL('../../data/folium.sqlite',import.meta.url));
const filename=process.env.FOLIUM_DB?path.resolve(process.env.FOLIUM_DB):defaultFile;
const store=new Store(filename),port=Number(process.env.PORT||4173);
const server=createServer(store);
server.on('error',error=>{console.error(`Server failed: ${error.code}`);store.close();process.exit(1);});
server.listen(port,'127.0.0.1',()=>console.log(`Folium: http://127.0.0.1:${server.address().port}\nSQLite: ${filename}\nIrrigation starts disarmed.`));
let gateway;
if(process.env.FOLIUM_DEVICE_HOST) {
  gateway=createServer(store,{deviceOnly:true});
  gateway.on('error',error=>{console.error(`Device gateway failed: ${error.code}`);stop();});
  gateway.listen(Number(process.env.FOLIUM_DEVICE_PORT||4174),process.env.FOLIUM_DEVICE_HOST,()=>console.log(`Device gateway: port ${gateway.address().port}; Bearer authentication required.`));
}
let closing=false;
function stop(){if(closing)return;closing=true;store.disarm();server.close(()=>{if(gateway)gateway.close(()=>store.close());else store.close();});server.closeIdleConnections();gateway?.closeIdleConnections();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
