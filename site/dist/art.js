export function icon(name,size=20){const paths={
 leaf:'<path d="M20 4c-10-2-17 4-14 11s16 2 14-11Z"/><path d="M4 21 16 9"/>',
 grid:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
 book:'<path d="M5 3h14v18H5a2 2 0 0 1 0-4h14M5 3a2 2 0 0 0-2 2v14M8 7h7M8 11h5"/>',
 camera:'<path d="M8 5l2-2h4l2 2h4a1 1 0 0 1 1 1v13H3V6a1 1 0 0 1 1-1Z"/><circle cx="12" cy="12" r="4"/>',
 settings:'<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3" fill="currentColor"/><circle cx="16" cy="17" r="3" fill="currentColor"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',chevron:'<path d="m9 5 7 7-7 7"/>',
 drop:'<path d="M12 3C8 9 5 12 5 15a7 7 0 0 0 14 0c0-3-3-6-7-12Z"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
 chevrons:'<path d="m7 4-4 4 4 4M3 8h16m-2 4 4 4-4 4M5 16h16"/>',check:'<path d="m5 12 4 4L19 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',
 download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',wifi:'<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8 16a6 6 0 0 1 8 0"/><circle cx="12" cy="20" r="1"/>',
 info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>',mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',plant:'<path d="m6 15 2 7h8l2-7ZM12 15V7M12 11C3 12 3 4 4 3c8 0 9 5 8 8Zm0-3c0-7 6-8 9-6 0 6-4 8-9 6Z"/>',
 trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',filter:'<path d="M3 5h18L14 13v6l-4 2v-8Z"/>',thermometer:'<path d="M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0ZM12 7v10"/>',back:'<path d="M19 12H5m6-6-6 6 6 6"/>',menu:'<path d="M4 6h16M4 12h16M4 18h16"/>'};
 return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.leaf}</svg>`;}

export function plantArt(type,uid='p'){
 const pot=`<ellipse cx="160" cy="286" rx="71" ry="12" fill="#243a2a" opacity=".08"/><path d="M108 220h104l-10 57q-41 20-84 0Z" fill="url(#${uid}pot)"/><ellipse cx="160" cy="220" rx="52" ry="12" fill="#e2ded2"/><ellipse cx="160" cy="219" rx="44" ry="8" fill="#625640"/><path d="M122 240q38 12 76 0m-74 12q35 12 71 0m-70 12q34 11 67 0" fill="none" stroke="#bcb8aa" opacity=".35"/>`;
 let leaves='';
 if(type==='chlorophytum'){
  const tips=[[45,144],[45,211],[56,98],[72,178],[78,227],[92,78],[108,148],[125,53],[143,97],[165,42],[180,90],[198,63],[210,119],[248,102],[263,171],[281,217],[228,227],[203,171],[101,199]];
  tips.forEach(([x,y],i)=>{const cx=160+(x-160)*.45;leaves+=`<path d="M160 220Q${cx} ${y-90} ${x} ${y}Q${cx+((i%2)*10-5)} ${y-40} 160 220Z" fill="${['#4d7048','#769053','#335942','#92a569'][i%4]}"/><path d="M160 219Q${cx} ${y-65} ${x} ${y}" fill="none" stroke="#d8dfad" stroke-width="${i%3===0?3:1.3}" opacity=".8"/>`;});
 }else if(type==='cactus'){
  leaves=`<path d="M140 218V97a24 24 0 0 1 48 0v121Z" fill="url(#${uid}cactus)"/><path d="M140 177h-18a29 29 0 0 1-29-29v-24a13 13 0 0 1 26 0v22a6 6 0 0 0 6 6h15ZM188 160h18a25 25 0 0 0 25-25v-25a12 12 0 0 0-24 0v23a4 4 0 0 1-4 4h-15Z" fill="#6b875c"/><path d="M157 217V92m14 125V87M107 128v19q0 18 25 17m88-51v24q0 15-25 15" stroke="#aac191" stroke-width="2" fill="none"/>`;
  for(let y=105;y<216;y+=22)for(let x=146;x<185;x+=17)leaves+=`<path d="m${x-3} ${y-2} 6 4m-5 1 4-6" stroke="#e1dbc0" stroke-width="1.2"/>`;
  leaves+='<path d="m160 76-8-15 13 5 6-13 3 16 12-2-10 13Z" fill="#caa290"/>';
 }else{
  const clusters=[[160,208,94,90],[160,216,235,100],[160,216,118,140],[160,205,187,60],[150,211,69,173],[180,216,254,184],[140,218,97,263],[180,218,223,263]];
  clusters.forEach(([sx,sy,ex,ey],i)=>{leaves+=`<path d="M${sx} ${sy}Q${ex} ${sy-20} ${ex} ${ey}" fill="none" stroke="#766577" stroke-width="3"/>`;for(let j=0;j<3;j++){const y=ey+(sy-ey)*j/3,x=ex+(sx-ex)*j/4;const direction=(j+i)%2?-1:1;leaves+=`<g transform="translate(${x},${y}) rotate(${direction*(40+j*10)})"><path d="M0 10C-35-5-34-34 0-47 27-26 30-3 0 10Z" fill="${i%2?'#746879':'#667561'}"/><path d="M0 10C-13-10-13-30 0-47-2-22 3-6 0 10Z" fill="#c4b6c5"/><path d="M0 10C10-6 14-27 0-47 23-23 17-4 0 10Z" fill="#a09a99"/><path d="M0 10V-44" stroke="#dfcbd9" stroke-width=".8"/></g>`;}});
 }
 return `<svg viewBox="0 0 320 310" xmlns="http://www.w3.org/2000/svg" class="plant-art" aria-hidden="true"><defs><linearGradient id="${uid}pot" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#d0c9b9"/><stop offset=".45" stop-color="#eee9db"/><stop offset="1" stop-color="#c7c0af"/></linearGradient><linearGradient id="${uid}cactus" x1="0" x2="1"><stop stop-color="#527453"/><stop offset=".5" stop-color="#829c6a"/><stop offset="1" stop-color="#587650"/></linearGradient></defs>${type==='tradescantia'?pot+leaves:leaves+pot}<ellipse cx="159" cy="289" rx="45" ry="3" fill="#243a2a" opacity=".03"/></svg>`;
}
