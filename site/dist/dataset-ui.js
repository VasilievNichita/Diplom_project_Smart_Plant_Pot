export function canPrepare(job,dirty=false){
  const r=job?.report;
  return Boolean(!dirty&&!job?.stale&&job?.status==='audited'&&r?.ok&&r.structuralSplitPossible&&!r.possibleDuplicateListTruncated&&
    (!r.possibleDuplicatePairCount||(job.review?.acknowledged===true&&job.review.pairs.length===r.possibleDuplicatePairCount&&job.review.pairs.every(p=>p.decision==='different_specimens'))));
}
export function createDatasetInspection({t,esc,request,button}){
  let job=null,draft=[],ack=false,dirty=false,busy=false,page=0,current=()=>false,timer,message='';
  const active=()=>busy||['running','preparing'].includes(job?.status);
  const readonly=()=>active()||job?.stale||job?.status!=='audited';
  const root=()=>document.querySelector('#dataset-inspection');
  function view(){return '<section class="panel dataset-inspection" id="dataset-inspection" aria-live="polite"></section>';}
  function adopt(next){
    if(next?.id!==job?.id||next?.revision!==job?.revision){dirty=false;page=0;}
    job=next;
    if(!dirty){draft=job?.review?.pairs.map(p=>({...p}))||job?.report?.possibleCrossSpecimenDuplicates.map(({first,second})=>({first,second,decision:''}))||[];ack=job?.review?.acknowledged||false;}
  }
  function card(id){const p=job.records.find(p=>p.id===id);if(!p)return '';
    return `<div class="dataset-image"><img loading="lazy" width="128" height="128" src="/api/photo-inspection/${job.id}/thumb/${p.id}" alt="${esc(t(p.plantId))}"><strong>${t(p.plantId)}</strong><code>${esc(p.specimenId)}</code><small>${p.width} × ${p.height}</small>${!job.stale?`<a href="/api/photos/${p.id}" target="_blank" rel="noopener">${t('dsOriginal')}</a>${button(t('photoReview'),'photo-review','settings','',`data-id="${p.id}"`)}`:''}</div>`;
  }
  function progress(){return `${t('dsProgress')}: ${draft.filter(p=>p.decision).length}/${draft.length}. ${dirty?t('dsDirty'):''}`;}
  function paint(){
    if(!current()||!root())return;
    const r=job?.report,disabled=readonly()?'disabled':'';
    let out=`<div class="panel-top"><div><h2>${t('dsTitle')}</h2><p class="panel-sub">${t('dsIntro')}</p></div>${button(t('dsStart'),'dataset-start','camera','',active()?'disabled':'')}</div>`;
    if(message)out+=`<p class="notice" role="status">${t(message)}</p>`;
    if(!job)out+=`<p>${t('dsEmpty')}</p>`;
    else out+=`<p class="notice">${t('ds_'+job.status)}</p>${job.stale?`<p class="error-banner">${t('dsStale')}</p>`:''}`;
    if(r){
      if(r.containsSynthetic)out+=`<p class="error-banner">${t('dsSynthetic')}</p>`;
      out+=`<div class="dataset-counts">${r.classes.map(c=>`<div><strong>${t(c.class)}</strong><span>${t('photoCount')}: ${c.images} · ${t('photoSpecimens')}: ${c.specimens}</span></div>`).join('')}</div><p class="hint">${t('dsMin')}</p>`;
      if(r.errors.length)out+=`<details open><summary>${t('dsErrors')} (${r.errors.length})</summary><ul>${r.errors.map(e=>`<li><code>${esc(e.id||'')}</code>: ${esc(e.error)}</li>`).join('')}</ul></details>`;
      out+=`<h3>${t('dsPairs')} (${r.possibleDuplicatePairCount})</h3><p>${t('dsHint')}</p><p class="hint">${t('dsPreview')}</p>`;
      if(r.possibleDuplicateListTruncated)out+=`<p class="error-banner">${t('dsTruncated')}</p>`;
      out+=draft.length?draft.map((p,i)=>`<article class="dataset-pair"><div class="dataset-pair-images">${card(p.first)}${card(p.second)}</div><label for="dataset-pair-${i}">${t('dsChoice')} ${i+1}</label><select id="dataset-pair-${i}" data-dataset-pair="${i}" ${disabled}>${['','different_specimens','same_specimen','uncertain'].map(v=>`<option value="${v}" ${v===p.decision?'selected':''}>${t('ds_'+(v||'unanswered'))}</option>`).join('')}</select></article>`).join(''):`<p>${t('dsNone')}</p>`;
      if(draft.length)out+=`<label class="checkbox-label"><input type="checkbox" id="dataset-ack" ${ack?'checked':''} ${disabled}>${t('dsAck')}</label><p id="dataset-progress">${progress()}</p>${button(t('dsSave'),'dataset-save','download','',disabled)}`;
      out+=`<div class="button-row subsection">${button(t('dsPrepare'),'dataset-prepare','settings','primary',!canPrepare(job,dirty)||busy?'disabled':'')}</div>`;
      if(job.prepared)out+=`<p class="notice">${t('dsPrepared')}</p><div class="dataset-counts">${Object.entries(job.prepared.counts).map(([name,c])=>`<div><strong>${name}</strong><span>${t('photoCount')}: ${c.images} · ${t('photoSpecimens')}: ${c.specimens}</span></div>`).join('')}</div><code>${esc(job.prepared.datasetId)}</code>`;
      const pages=Math.max(1,Math.ceil(job.records.length/30));page=Math.min(page,pages-1);
      out+=`<details><summary>${t('dsCatalogue')} (${job.records.length})</summary><p>${t('dsPage')} ${page+1}/${pages}</p><div class="dataset-gallery">${job.records.slice(page*30,(page+1)*30).map(p=>card(p.id)).join('')}</div><div class="button-row">${button(t('dsPrev'),'dataset-prev','back','',page===0?'disabled':'')}${button(t('dsNext'),'dataset-next','arrow','',page+1===pages?'disabled':'')}</div></details>`;
    }
    root().innerHTML=out;
  }
  async function load(isCurrent){
    current=isCurrent;clearTimeout(timer);
    try{const result=await request('/photo-inspection');if(!isCurrent())return;adopt(result.job);paint();poll(isCurrent);}
    catch{if(isCurrent()){message='dsError';paint();}}
  }
  function poll(isCurrent){clearTimeout(timer);if(['running','preparing'].includes(job?.status))timer=setTimeout(()=>{if(isCurrent())load(isCurrent);},1200);}
  function change(target){
    if(target.dataset.datasetPair!==undefined){draft[Number(target.dataset.datasetPair)].decision=target.value;ack=false;const el=document.querySelector('#dataset-ack');if(el)el.checked=false;dirty=true;}
    else if(target.id==='dataset-ack'){ack=target.checked;dirty=true;}else return;
    const p=document.querySelector('#dataset-progress');if(p)p.textContent=progress();
    const prepare=document.querySelector('[data-action="dataset-prepare"]');if(prepare)prepare.disabled=true;
  }
  async function action(name){
    if(!name.startsWith('dataset-'))return;
    if(name==='dataset-prev'||name==='dataset-next'){page+=name==='dataset-prev'?-1:1;paint();root()?.querySelector('details:last-child')?.setAttribute('open','');return;}
    if(active())return;
    busy=true;message='';paint();const isCurrent=current;
    try{
      let result;
      if(name==='dataset-start')result=await request('/photo-inspection',{method:'POST',body:{}});
      if(name==='dataset-save')result=await request(`/photo-inspection/${job.id}/review`,{method:'PUT',body:{expectedRevision:job.revision,auditId:job.report.auditId,pairs:draft,acknowledged:ack}});
      if(name==='dataset-prepare')result=await request(`/photo-inspection/${job.id}/prepare`,{method:'POST',body:{expectedRevision:job.revision}});
      if(result){dirty=false;adopt(result.job);if(name==='dataset-save')message='dsSaved';}
    }catch(error){message=({inspection_python_missing:'dsPython',inspection_conflict:'dsConflict',inspection_stale:'dsConflict',inspection_unresolved:'dsUnresolved',inspection_not_ready:'dsUnavailable',photo_dataset_empty:'dsEmpty',inspection_busy:'dsBusy'})[error.code]||'dsError';}
    finally{busy=false;if(current()){paint();poll(current);}}
  }
  return {view,load,change,action};
}
