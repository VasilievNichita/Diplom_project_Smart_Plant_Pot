import {PHOTO_SIGNS, PHOTO_QUALITY, PHOTO_SOURCES, selectionIssues, photoStatus} from './photo-core.js';
import {createDatasetInspection} from './dataset-ui.js';

export function createPhotoLibrary({t,esc,date,button,icon,openModal,request,getMode,onError}) {
  let photos=[],plant='all',status='all';
  const inspection=createDatasetInspection({t,esc,request,button});
  const options=(values,prefix,selected)=>values.map(v=>`<option value="${v}" ${v===selected?'selected':''}>${t(prefix+v)}</option>`).join('');
  function view(){return `<div class="page-heading"><h1>${t('photoTitle')}</h1><p>${t('photoIntro')}</p></div>
    <div class="toolbar">${button(t('upload'),'photo','camera')}<span class="privacy-note">${t('photoPrivacy')}</span></div>
    <section class="photo-guide panel"><div><span class="eyebrow">${t('photoHumanLabel')}</span><h2>${t('photoGuideTitle')}</h2><p>${t('photoGuideText')}</p></div><details><summary>${t('photoHowTo')}</summary><p>${t('photoCaptureHelp')}</p><p>${t('photoNoDiagnosis')}</p></details></section>
    ${getMode()==='real'?`<section class="panel dataset-panel"><div class="panel-top"><div><h2>${t('photoDataset')}</h2><p class="panel-sub">${t('photoDatasetHelp')}</p></div>${button(t('photoExport'),'photo-export','download','','id="photo-export" disabled')}</div><div id="photo-dataset-summary" aria-live="polite">${t('serverLoading')}</div></section>`:`<p class="notice">${t('photoDemoHelp')}</p>`}
    ${getMode()==='real'?inspection.view():''}
    <div class="toolbar photo-filters"><label for="photo-plant-filter">${t('plant')}<select id="photo-plant-filter" class="filter">${options(['all','chlorophytum','tradescantia','cactus'],'',plant)}</select></label><label for="photo-status-filter">${t('photoReviewStatus')}<select id="photo-status-filter" class="filter">${options(['all','unreviewed','reviewed','selected','rejected'],'photoStatus_',status)}</select></label></div>
    <div id="photo-list" aria-live="polite"><p class="hint">${t('serverLoading')}</p></div>`;
  }
  function cards(){
    const target=document.querySelector('#photo-list');if(!target)return;
    const list=photos.filter(p=>(plant==='all'||p.plantId===plant)&&(status==='all'||photoStatus(p)===status));
    target.className=list.length?'photo-grid':'';
    if(!list.length){target.innerHTML=`<section class="panel"><div class="empty-state">${icon('camera',36)}<h3>${t(photos.length?'emptyFilter':'photoEmpty')}</h3><p>${t('photoEmptyText')}</p></div></section>`;return;}
    target.innerHTML=list.map(p=>{const url='/api/photos/'+encodeURIComponent(p.id),r=p.review;return `<article class="photo-card"><button class="photo-open" data-action="photo-review" data-id="${p.id}" aria-label="${t('photoReview')}: ${t(p.plantId)}"><img src="${url}" loading="lazy" alt="${t(p.plantId)} · ${date(p.date)}"></button><div class="photo-body"><span class="photo-tag ${photoStatus(p)}">${t('photoStatus_'+photoStatus(p))}</span><h3>${t(p.plantId)}</h3><p>${date(p.date)} <span class="badge">${t(p.mode==='demo'?'demoLabel':'realLabel')}</span></p><p>${esc(p.note)}</p>${r.revision?`<div class="photo-signs">${r.signs.map(s=>`<span>${t('photoSign_'+s)}</span>`).join('')}</div>`:''}<div class="button-row">${button(t('photoReview'),'photo-review','settings','',`data-id="${p.id}"`)}<a class="btn" href="${url}" download="${esc(p.name)}">${icon('download',14)}${t('download')}</a>${button(t('delete'),'delete-photo','trash','danger',`data-id="${p.id}"`)}</div></div></article>`;}).join('');
  }
  async function load(isCurrent){
    try{
      const mode=getMode();const [list,dataset]=await Promise.all([request('/photos?mode='+mode),mode==='real'?request('/photo-dataset'):null]);
      if(!isCurrent())return;photos=list.items;cards();
      if(dataset){
        const {summary}=dataset;
        document.querySelector('#photo-dataset-summary').innerHTML=`<div class="dataset-counts">${summary.classes.map(c=>`<div><strong>${t(c.id)}</strong><span>${t('photoCount')}: ${c.images} · ${t('photoSpecimens')}: ${c.specimens}</span></div>`).join('')}</div><p class="hint">${t('photoUnique')}: ${summary.exported} · ${t('photoDuplicates')}: ${summary.duplicateImagesOmitted}</p><p class="hint">${t('photoSplitHelp')}</p>`;
        document.querySelector('#photo-export').disabled=!summary.exported;
        await inspection.load(isCurrent);
      }
    }catch(error){if(isCurrent()){const target=document.querySelector('#photo-list');if(target)target.innerHTML=`<p class="error-banner">${t('serverError')}</p>`;const summary=document.querySelector('#photo-dataset-summary');if(summary)summary.textContent=t('serverError');onError(error);}}
  }
  function open(id){
    const p=photos.find(p=>p.id===id);if(!p)return;const r=p.review;
    openModal('photoReview',`<div class="photo-review-layout"><div class="photo-inspection"><img src="/api/photos/${p.id}" alt="${t(p.plantId)}"><h3>${t(p.plantId)}</h3><p>${esc(p.note)}</p><p class="hint">${date(p.date)} · ${t('photoHumanLabel')}</p><p class="hint">${t('photoNoDiagnosis')}</p></div>
      <form id="photo-review-form" data-id="${p.id}" data-revision="${r.revision}" data-mode="${p.mode}">
        <label class="checkbox-label"><input type="checkbox" name="identityConfirmed" ${r.identityConfirmed?'checked':''}><span>${t('photoConfirmIdentity')} <strong>${t(p.plantId)}</strong></span></label>
        <div class="field"><label for="photo-quality">${t('photoQuality')}</label><select id="photo-quality" name="quality">${options(PHOTO_QUALITY,'photoQuality_',r.quality)}</select></div>
        <fieldset class="photo-sign-fields"><legend>${t('photoVisibleSigns')}</legend>${PHOTO_SIGNS.map(s=>`<label><input type="checkbox" name="signs" value="${s}" ${r.signs.includes(s)?'checked':''}><span>${t('photoSign_'+s)}</span></label>`).join('')}</fieldset>
        <div class="field"><label for="photo-specimen">${t('photoSpecimen')}</label><input id="photo-specimen" name="specimenId" maxlength="64" pattern="[A-Za-z0-9_-]{1,64}" value="${esc(r.specimenId)}" placeholder="home-plant-01"><small>${t('photoSpecimenHelp')}</small></div>
        <div class="field"><label for="photo-source">${t('photoSource')}</label><select id="photo-source" name="source">${options(PHOTO_SOURCES,'photoSource_',r.source)}</select></div>
        <div class="field"><label for="photo-source-ref">${t('photoSourceRef')}</label><textarea id="photo-source-ref" name="sourceReference" maxlength="1000">${esc(r.sourceReference)}</textarea><small>${t('photoSourceHelp')}</small></div>
        <label class="checkbox-label"><input type="checkbox" name="selected" ${r.selected?'checked':''}><span>${t('photoSelect')}</span></label><p class="hint" id="photo-selection-help" aria-live="polite"></p>
        <p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="btn" data-action="close">${t('cancel')}</button><button type="submit" class="btn primary">${t('save')}</button></div>
      </form></div>`);
    document.querySelector('#modal').classList.add('photo-review-dialog');updateHelp();
  }
  function body(form){const data=new FormData(form);return {expectedRevision:Number(form.dataset.revision),identityConfirmed:data.get('identityConfirmed')==='on',quality:data.get('quality'),specimenId:data.get('specimenId').trim(),source:data.get('source'),sourceReference:data.get('sourceReference').trim(),signs:data.getAll('signs'),selected:data.get('selected')==='on'};}
  function updateHelp(){const form=document.querySelector('#photo-review-form');if(!form)return;const issues=selectionIssues({mode:form.dataset.mode},body(form));document.querySelector('#photo-selection-help').textContent=issues.length?t('photoStillNeeded')+' '+issues.map(i=>t('photoNeed_'+i)).join('; '):t('photoEligible');}
  function change(target){
    inspection.change(target);
    if(target.id==='photo-plant-filter'){plant=target.value;cards();}
    if(target.id==='photo-status-filter'){status=target.value;cards();}
    const form=target.closest('#photo-review-form');if(!form)return;
    if(target.name==='signs'){
      const fields=[...form.querySelectorAll('[name=signs]')],exclusive=['unknown','no_visible_issue'];
      if(target.checked)for(const input of fields)if(input!==target&&(exclusive.includes(target.value)||exclusive.includes(input.value)))input.checked=false;
      if(!fields.some(input=>input.checked))fields.find(input=>input.value==='unknown').checked=true;
    }
    updateHelp();
  }
  return {view,load,open,body,change,updateHelp,action:inspection.action};
}
