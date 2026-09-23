import test from 'node:test';
import assert from 'node:assert/strict';
import {generateAutoEq,validateAutoEqOptions,defaultAutoEqOptions} from '../src/autoeq.js';
import {defaultCurveDisplay} from '../src/curve-level.js';
import {response,validateChannel,exportPreset,importPreset,newPreset,initialState,validateState} from '../src/model.js';
const hz=Array.from({length:700},(_,i)=>20*1000**(i/699));
const curve=fn=>({points:hz.map(f=>[f,fn(f)])});
const flat=curve(()=>0);
const display={...defaultCurveDisplay(),method:'none'};
const band=(fcHz,gainDb,q=1,type='PK')=>({type,fcHz,gainDb,q,enabled:true});
test('Auto EQ preferences survive reload and backups, with defaults for older workspaces',()=>{
  const state=initialState();
  state.autoEqOptions={maxBands:15,minHz:40,maxHz:15000,maxBoost:4,maxCut:18,minQ:.5,maxQ:8,smoothing:1/3,shelves:false,safePreamp:false};
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))).autoEqOptions,state.autoEqOptions);
  delete state.autoEqOptions;assert.deepEqual(validateState(state).autoEqOptions,defaultAutoEqOptions());
  state.autoEqOptions={maxBands:-3};assert.deepEqual(validateState(state).autoEqOptions,defaultAutoEqOptions());
});
test('Auto EQ recovers a known biquad and respects each sample rate',()=>{
  for(const sampleRate of [44100,48000,96000,192000]){
    const target=curve(f=>response({filters:[band(1350,5,1.7)],preampDb:0},f,sampleRate));
    const result=generateAutoEq({source:flat,target,display,sampleRate,options:{maxBands:1,smoothing:0,shelves:false}});
    assert.equal(result.filters.length,1);assert.ok(result.fit.after<.04,JSON.stringify(result.fit));
    assert.ok(Math.abs(result.filters[0].fcHz-1350)<15);
    assert.ok(Math.abs(result.filters[0].gainDb-5)<.1);
  }
});
test('Auto EQ fits multiple peaks and shelves with safe headroom and exportable filters',()=>{
  const desired=[band(120,4,.7,'LSC'),band(820,-5,2),band(4200,3,1.5)];
  const target=curve(f=>response({filters:desired,preampDb:0},f));
  const result=generateAutoEq({source:flat,target,display,options:{maxBands:5,smoothing:0}});
  assert.ok(result.fit.after<.35,JSON.stringify(result.fit));
  assert.ok(result.fit.after<result.fit.before*.2);
  assert.ok(result.filters.length<=5&&result.filters.some(f=>f.type==='LSC'));
  assert.doesNotThrow(()=>validateChannel(result));
  assert.ok(Math.max(...hz.map(f=>response(result,f)))<=.02);
  assert.deepEqual(importPreset(exportPreset(newPreset('Auto EQ',result)),'roundtrip').left.filters,result.filters);
});
test('Auto EQ honors current alignment and independent curve offsets',()=>{
  const source=curve(()=>80),target=curve(()=>90);
  const aligned={...defaultCurveDisplay(),referenceDb:75};
  assert.equal(generateAutoEq({source,target,display:aligned}).filters.length,0);
  const offset=generateAutoEq({source,target,display:{...aligned,targetOffsetDb:3,sourceOffsetDb:1},options:{safePreamp:false,maxBands:3,smoothing:0}});
  assert.ok(offset.fit.before>1.99&&offset.fit.before<2.01);
  assert.ok(offset.fit.after<.2,JSON.stringify(offset.fit));
  assert.equal(offset.preampDb,0);
  const raw=generateAutoEq({source,target,display,options:{maxBands:3,maxBoost:12,safePreamp:false}});
  assert.ok(raw.fit.before>9.99&&raw.fit.after<.4);
});
test('Auto EQ respects correction limits, fit range and band count',()=>{
  const source=curve(f=>response({filters:[band(100,-18,.7),band(2000,20,2)],preampDb:0},f));
  const result=generateAutoEq({source,target:flat,display,options:{minHz:80,maxHz:6000,minQ:.5,maxQ:3,maxBoost:3,maxCut:8,maxBands:4}});
  assert.ok(result.filters.length<=4);
  assert.ok(result.filters.every(f=>f.fcHz>=80&&f.fcHz<=6000&&f.q>=.5&&f.q<=3));
  const correction=hz.map(f=>response({...result,preampDb:0},f));
  assert.ok(Math.max(...correction)<=3.02);assert.ok(Math.min(...correction)>=-8.02);
  assert.ok(result.fit.after<result.fit.before);
});
test('Auto EQ handles flat curves and rejects missing data and invalid settings',()=>{
  const result=generateAutoEq({source:flat,target:flat,display});
  assert.deepEqual(result.filters,[]);assert.equal(Math.abs(result.preampDb),0);
  assert.throws(()=>generateAutoEq({target:flat}),/source/);
  assert.throws(()=>validateAutoEqOptions({minHz:1000,maxHz:500}),/frequency/);
  assert.throws(()=>validateAutoEqOptions({maxBands:2.5}),/whole number/);
  assert.throws(()=>validateAutoEqOptions({minQ:4,maxQ:2}),/Q/);
  assert.throws(()=>generateAutoEq({source:{points:[[20,0],[100,0]]},target:{points:[[200,0],[1000,0]]},display}),/shared data/);
});
