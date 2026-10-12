// Human observations, not disease diagnoses or model predictions.
export const PHOTO_SIGNS = ['unknown','no_visible_issue','yellowing','wilting','dry_edges','spots','visible_pest'];
export const PHOTO_QUALITY = ['unchecked','usable','reject'];
export const PHOTO_SOURCES = ['unknown','own','permitted'];
export function emptyReview() {
  return {revision:0,quality:'unchecked',identityConfirmed:false,specimenId:'',source:'unknown',sourceReference:'',signs:['unknown'],selected:false,updatedAt:null};
}
export function selectionIssues(photo, review) {
  const issues=[];
  if(photo.mode!=='real')issues.push('real_only');
  if(review.quality!=='usable')issues.push('quality');
  if(!review.identityConfirmed)issues.push('identity');
  if(!/^[a-zA-Z0-9_-]{1,64}$/.test(review.specimenId))issues.push('specimen');
  if(!['own','permitted'].includes(review.source)||(review.source==='permitted'&&!review.sourceReference.trim()))issues.push('source');
  return issues;
}
export function photoStatus(photo) {
  const r=photo.review;
  return r.selected?'selected':r.quality==='reject'?'rejected':r.revision?'reviewed':'unreviewed';
}
