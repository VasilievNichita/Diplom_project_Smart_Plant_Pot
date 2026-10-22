import test from 'node:test';
import assert from 'node:assert/strict';
import {moistureDecision} from '../server/irrigation-policy.mjs';
test('moisture policy requires three valid values and uses hysteresis',()=>{
 const decide=(values,active=false)=>moistureDecision({values,active,low:30,high:45});
 assert.equal(decide([20,22,25]),'dose');assert.equal(decide([20,31,25]),'wait');
 assert.equal(decide([31,33,35],true),'dose');assert.equal(decide([31,33,45],true),'satisfied');
 for(const values of [[],[20,20],[20,null,20],[20,NaN,20],[-1,20,20],[20,101,20]])assert.equal(decide(values,true),'wait');
 for(const limits of [{low:NaN,high:50},{low:50,high:30},{low:20,high:101}])assert.equal(moistureDecision({values:[10,10,10],active:true,...limits}),'wait');
});
