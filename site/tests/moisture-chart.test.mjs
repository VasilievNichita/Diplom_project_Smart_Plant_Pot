import test from 'node:test';
import assert from 'node:assert/strict';
import {moistureChart} from '../dist/moisture-chart.js';
test('chart retains actual timestamps and values, excludes invalid readings and escapes labels',()=>{
 const html=moistureChart([{name:'<script>',points:[{time:1000,value:42.5},{time:5000,value:60},{time:2000,value:null},{time:2500,value:110}]}],{since:0,until:3000,locale:'en-GB',label:'Humidity'});
 assert.ok(html.includes('&quot;time&quot;:1000'));assert.ok(html.includes('&quot;value&quot;:42.5'));
 assert.ok(!html.includes('&quot;value&quot;:60'));assert.ok(!html.includes('&quot;value&quot;:110'));assert.ok(!html.includes('<script>'));
 assert.match(html,/type="range"/);assert.match(html,/aria-label="Humidity"/);
});
test('empty charts disable exploration and invalid windows fail explicitly',()=>{
 const options={since:0,until:3000,locale:'en-GB',label:'Humidity'};
 const html=moistureChart([{name:'Plant',points:[{time:null,value:20},{time:NaN,value:20},{time:1000,value:Infinity}]}],options);
 assert.match(html,/data-points="\[\]"/);assert.match(html,/disabled/);assert.ok(!html.includes('NaN'));
 assert.throws(()=>moistureChart([],{...options,until:0}),RangeError);
});
