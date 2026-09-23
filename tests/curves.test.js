import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TARGETS, customCurves, findCurve, searchCurves, removeCustomCurve } from '../src/curve-library.js';
import { initialState, parseCurve, curveValue, validateState } from '../src/model.js';
import { BUILTIN_SOURCES, loadBuiltinCurve } from '../src/curve-library.js';
import { readFile } from 'node:fs/promises';

test('all 13 original built-in targets contain real, ordered response data',()=>{
  assert.equal(BUILTIN_TARGETS.length,13);
  assert.equal(new Set(BUILTIN_TARGETS.map(c=>c.id)).size,13);
  for(const curve of BUILTIN_TARGETS){
    assert.ok(curve.points.length>100);
    assert.ok(curve.points.every(([hz,db],i)=>Number.isFinite(db)&&hz>=20&&hz<=20000&&(!i||hz>curve.points[i-1][0])));
    assert.match(curve.sourceUrl,/^https:\/\/home\.toppingaudio\.com\//);
    assert.equal(curveValue(curve,1000),0);
  }
  const flat=BUILTIN_TARGETS.find(c=>c.name==='Flat');
  assert.ok(flat.points.every(p=>Math.abs(p[1]-flat.points[0][1])<.001));
  assert.ok(BUILTIN_TARGETS.find(c=>c.name==='Harman Target').points.some(p=>Math.abs(p[1])>1));
});
test('all custom imports are shared, including older source-only and target-only imports',()=>{
  const state=initialState();
  const curve=parseCurve('20,0\n1000,3\n20000,-4','Response.csv');
  state.curves=[curve,{...curve,id:'target-1',kind:'target'},{...curve,id:'source-1',kind:'source'}];
  const restored=validateState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(customCurves(restored,'target').map(c=>c.id),[curve.id,'target-1','source-1']);
  assert.deepEqual(customCurves(restored,'source').map(c=>c.id),[curve.id,'target-1','source-1']);
  restored.targetId='source-1';restored.sourceId='target-1';
  assert.equal(findCurve(restored,'target').id,'source-1');
  assert.equal(findCurve(restored,'source').id,'target-1');
});
test('built-in selection survives workspace backup without duplicating catalog data',()=>{
  const state=initialState();state.targetId=BUILTIN_TARGETS[0].id;
  const restored=validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.curves.length,0);
  assert.equal(findCurve(restored,'target').name,BUILTIN_TARGETS[0].name);
  assert.equal(findCurve(restored,'source',state.targetId),BUILTIN_TARGETS[0]);
});
test('curve search matches accented names and measurement systems',()=>{
  assert.equal(searchCurves(BUILTIN_TARGETS,'bruel')[0].name,'Brüel Kjaer Target');
  assert.equal(searchCurves(BUILTIN_TARGETS,'harman kb501x').length,2);
  assert.equal(searchCurves(BUILTIN_TARGETS,'nonexistent').length,0);
});
test('removing a custom curve clears both references and never deletes built-ins',()=>{
  const state=initialState();const curve=parseCurve('20,0\n20000,2','Shared');
  state.curves.push(curve);state.targetId=state.sourceId=curve.id;
  const before=structuredClone(state);
  assert.equal(removeCustomCurve(state,curve.id),true);
  assert.equal(state.curves.length,0);assert.equal(state.targetId,'');assert.equal(state.sourceId,'');
  assert.equal(findCurve(before,'target').id,curve.id);
  state.targetId=BUILTIN_TARGETS[0].id;
  assert.equal(removeCustomCurve(state,state.targetId),false);
  assert.ok(findCurve(state,'target'));
});
test('all 465 headphone responses have complete local files and searchable brand names',async()=>{
  assert.equal(BUILTIN_SOURCES.length,465);
  assert.equal(new Set(BUILTIN_SOURCES.map(c=>c.id)).size,465);
  for(const curve of BUILTIN_SOURCES){
    const data=JSON.parse(await readFile(new URL(`../public/curves/sources/${curve.responseFile}`,import.meta.url),'utf8'));
    assert.equal(data.points.length,curve.pointCount);
    assert.ok(data.points.every(([hz,db],i)=>Number.isFinite(db)&&hz>=20&&hz<=20000&&(!i||hz>data.points[i-1][0])));
  }
  assert.ok(searchCurves(BUILTIN_SOURCES,'akg k712').length>=1);
  assert.ok(searchCurves(BUILTIN_SOURCES,'sennheiser hd 650').length>=1);
});
test('source responses load from local assets, retry failures, and survive selection restore',async()=>{
  const source=searchCurves(BUILTIN_SOURCES,'akg k712')[0];
  await assert.rejects(()=>loadBuiltinCurve('source',source.id,async()=>({ok:false})),/Cannot load/);
  const loaded=await loadBuiltinCurve('source',source.id,async url=>{
    assert.ok(url.startsWith('/curves/sources/'));
    const data=JSON.parse(await readFile(new URL(`../public${decodeURIComponent(url)}`,import.meta.url),'utf8'));
    return {ok:true,json:async()=>data};
  });
  const state=initialState();state.sourceId=source.id;
  assert.ok(findCurve(validateState(JSON.parse(JSON.stringify(state))),'source').points.length>100);
  assert.equal(findCurve(state,'target',source.id),loaded);
  assert.equal(await loadBuiltinCurve('source',source.id,()=>{throw Error('Should be cached');}),loaded);
});
test('either selector can load either built-in collection and restore crossed selections',async()=>{
  const target=BUILTIN_TARGETS[1],source=BUILTIN_SOURCES[1];
  assert.equal(await loadBuiltinCurve('source',target.id),target);
  const state=initialState();state.sourceId=target.id;state.targetId=source.id;
  const restored=validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(findCurve(restored,'source').id,target.id);
  assert.equal(findCurve(restored,'target').id,source.id);
  const loaded=await loadBuiltinCurve('target',source.id,async url=>({ok:true,json:async()=>JSON.parse(await readFile(new URL(`../public${decodeURIComponent(url)}`,import.meta.url),'utf8'))}));
  assert.ok(findCurve(restored,'target').points.length>100);
  assert.equal(await loadBuiltinCurve('source',source.id,()=>{throw Error('Should share cache');}),loaded);
  assert.equal(restored.curves.length,0);
});
