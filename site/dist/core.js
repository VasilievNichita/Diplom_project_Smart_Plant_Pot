export const PLANTS = [
  {id:'chlorophytum', latin:'Chlorophytum comosum', sensor:'S-01', color:'green'},
  {id:'tradescantia', latin:'Tradescantia zebrina', sensor:'S-02', color:'purple'},
  {id:'cactus', latin:'Cactaceae · species pending', sensor:'S-03', color:'sand'}
];
export const EVENT_TYPES=['observation','watering','feeding','repotting','moving','measurement','photo','replacement'];
export function initialState(){return {version:1,lang:'ru',mode:'demo',channels:['chlorophytum','tradescantia'],calibrated:[false,false],events:[],photos:[],prefs:{email:'',telegram:''}};}
export function validateState(s){
  if(!s||s.version!==1||!['ru','ro','en'].includes(s.lang)||!['demo','real'].includes(s.mode))throw Error('Invalid settings');
  if(!Array.isArray(s.channels)||s.channels.length!==2||new Set(s.channels).size!==2||s.channels.some(x=>!PLANTS.some(p=>p.id===x)))throw Error('Invalid channels');
  if(!Array.isArray(s.events)||s.events.length>5000||s.events.some(e=>!PLANTS.some(p=>p.id===e.plantId)||!EVENT_TYPES.includes(e.type)||typeof e.note!=='string'||e.note.length>1000||!['demo','real'].includes(e.mode)||!Number.isFinite(Date.parse(e.date))))throw Error('Invalid events');
  return s;
}
export function replacePlant(state,channel,plantId){
  if(![0,1].includes(channel)||!PLANTS.some(p=>p.id===plantId))throw Error('Unknown channel or plant');
  if(state.channels.includes(plantId))throw Error('Plant already connected');
  const next=structuredClone(state),previous=next.channels[channel];
  next.channels[channel]=plantId;next.calibrated[channel]=false;
  return {state:next,previous};
}
export function numeric(value,min,max){if(value===''||value==null)return null;const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)throw Error('Out of range');return n;}
export function addEvent(state,event){
  if(!PLANTS.some(p=>p.id===event.plantId)||!EVENT_TYPES.includes(event.type))throw Error('Invalid event');
  if(typeof event.note!=='string'||event.note.length>1000)throw Error('Invalid note');
  const saved={...event,id:crypto.randomUUID(),date:new Date().toISOString(),mode:state.mode};
  const next={...state,events:[saved,...state.events].slice(0,5000)};return next;
}
export function demoSeries(plantId,range='day'){
  const base={chlorophytum:52,tradescantia:38,cactus:24}[plantId]??50;
  return Array.from({length:25},(_,i)=>Math.round(base+12-i*.55+Math.sin(i*.7)*1.4+(range==='week'?Math.sin(i*.5)*5:0)));
}
export function toCSV(events){
  const fields=['date','mode','plantId','type','waterMl','raw','moisture','temperature','humidity','lux','weight','note'];
  const quote=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
  return '\uFEFF'+[fields.map(quote).join(','),...events.map(e=>fields.map(k=>quote(e[k])).join(','))].join('\r\n');
}
