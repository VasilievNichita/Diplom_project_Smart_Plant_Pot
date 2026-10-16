import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyReview,selectionIssues,PHOTO_SIGNS,PHOTO_QUALITY,PHOTO_SOURCES} from '../dist/photo-core.js';
import {copy} from '../dist/i18n.js';

test('all photo labels and selection reasons exist in all three interface languages',()=>{
  const keys=[...PHOTO_SIGNS.map(v=>'photoSign_'+v),...PHOTO_QUALITY.map(v=>'photoQuality_'+v),...PHOTO_SOURCES.map(v=>'photoSource_'+v),...selectionIssues({mode:'demo'},emptyReview()).map(v=>'photoNeed_'+v)];
  for(const lang of ['ru','ro','en'])for(const key of keys)assert.ok(copy[lang][key],`${lang}: ${key}`);
});
