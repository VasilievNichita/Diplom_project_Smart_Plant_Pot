// Relative calibrated moisture index, not volumetric water content.
export function moistureDecision({values,active,low,high}){
 if(typeof active!=='boolean'||!Number.isFinite(low)||!Number.isFinite(high)||low<0||high>100||low>=high)return 'wait';
 if(!Array.isArray(values)||values.length!==3||values.some(v=>!Number.isFinite(v)||v<0||v>100))return 'wait';
 if(values.at(-1)>=high)return 'satisfied';
 if(active||values.every(v=>v<=low))return 'dose';
 return 'wait';
}
