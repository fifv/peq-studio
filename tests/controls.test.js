import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustedValue } from '../src/numeric-controls.js';
import { bandColor, initialState, validateState, newBand, newPreset, importPreset, exportPreset, exportText, response } from '../src/model.js';
import { curveReferenceLevel, curveShift, defaultCurveDisplay, normalizeCurveDisplay } from '../src/curve-level.js';
const near=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} ≈ ${b}`);
const flat=db=>({points:[[20,db],[20000,db]]});
test('gains beyond the old limits survive gestures, persistence and both export formats',()=>{
  for(const gain of [-72,-24,24,72]){
    const preset=newPreset('Extended gain',{preampDb:-80,filters:[newBand(1000,gain)]});
    near(response(preset.left,1000),gain-80,1e-5);
    assert.equal(importPreset(exportPreset(preset),'JSON').left.filters[0].gainDb,gain);
    assert.equal(importPreset(exportText(preset.left),'TXT').left.preampDb,-80);
    const state=initialState();state.presets.push(preset);assert.doesNotThrow(()=>validateState(JSON.parse(JSON.stringify(state))));
  }
  near(adjustedValue(12,10,{min:-Infinity,max:Infinity,step:.1}),13);
});
test('broadband energy level is shift invariant and matches requested reference',()=>{
  const settings=defaultCurveDisplay();settings.referenceDb=75;settings.sourceOffsetDb=-2.5;
  near(curveReferenceLevel(flat(83),settings),83);
  near(83+curveShift(flat(83),'source',settings),72.5);
  const curve={points:[[20,10],[100,20],[1000,17],[10000,12],[20000,0]]};
  const shifted={points:curve.points.map(([hz,db])=>[hz,db+24])};
  near(curveReferenceLevel(shifted,settings)-curveReferenceLevel(curve,settings),24);
});
test('broadband energy averages power rather than one frequency or arithmetic dB',()=>{
  const curve={points:[[100,0],[10000,20]]};
  const settings={...defaultCurveDisplay(),minHz:100,maxHz:10000};
  const analytic=10*Math.log10((100-1)/(2*Math.log(10)));
  near(curveReferenceLevel(curve,settings),analytic,.001);
  near(curveReferenceLevel(curve,{...settings,method:'band-average'}),10);
  near(curveReferenceLevel(curve,{...settings,method:'1k'}),10);
  assert.ok(curveReferenceLevel(curve,settings)>13);
});
test('manual offsets apply independently after alignment and in original-level mode',()=>{
  const settings={...defaultCurveDisplay(),targetOffsetDb:3,sourceOffsetDb:-4};
  near(80+curveShift(flat(80),'target',settings),3);
  near(80+curveShift(flat(80),'source',settings),-4);
  near(curveShift(flat(80),'source',{...settings,method:'none'}),-4);
});
test('curve display settings persist and old backups migrate safely',()=>{
  const state=initialState();state.curveDisplay.referenceDb=75;state.curveDisplay.sourceOffsetDb=-2;
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))).curveDisplay,state.curveDisplay);
  delete state.curveDisplay;assert.deepEqual(validateState(state).curveDisplay,defaultCurveDisplay());
  const repaired=normalizeCurveDisplay({method:'bad',minHz:12000,maxHz:100,targetOffsetDb:Infinity});
  assert.equal(repaired.method,'band-energy');assert.equal(repaired.minHz,100);assert.equal(repaired.targetOffsetDb,0);
});
test('filtered-curve preamp switch defaults on for old workspaces and preserves an explicit off',()=>{
  const state=initialState();delete state.curveDisplay.includePreamp;
  assert.equal(validateState(JSON.parse(JSON.stringify(state))).curveDisplay.includePreamp,true);
  state.curveDisplay.includePreamp=false;
  assert.equal(validateState(JSON.parse(JSON.stringify(state))).curveDisplay.includePreamp,false);
});
test('graph zoom survives workspace reload and older workspaces retain the default range',()=>{
  const state=initialState();state.curveDisplay.rangeDb=10;
  assert.equal(validateState(JSON.parse(JSON.stringify(state))).curveDisplay.rangeDb,10);
  delete state.curveDisplay.rangeDb;
  assert.equal(validateState(state).curveDisplay.rangeDb,25);
  assert.equal(normalizeCurveDisplay({rangeDb:NaN}).rangeDb,25);
  assert.equal(normalizeCurveDisplay({rangeDb:-5}).rangeDb,5);
});
test('drag/wheel adjustment clamps correctly and frequency uses proportional increments',()=>{
  near(adjustedValue(-5,2,{min:-24,max:12,step:.1}),-4.8);
  near(adjustedValue(11.9,10,{min:-24,max:12,step:.1}),12);
  near(adjustedValue(1000,1,{min:20,max:20000,step:1,log:true}),1020);
  near(adjustedValue(20000,1,{min:20,max:20000,step:1,log:true}),20000);
  assert.ok(adjustedValue(1000,.1,{min:20,max:20000,step:1,log:true})<1020);
  assert.ok(Array.from({length:128},(_,i)=>bandColor(i)).every(color=>typeof color==='string'&&color!=='undefined'));
});
