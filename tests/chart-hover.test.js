import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeReadings, hoverMarkup } from '../src/chart-hover.js';

test('overlapping curve readings stay ordered, separated, and inside the plot', () => {
  for(const center of [24,200,447]){
    const result=placeReadings(Array.from({length:5},(_,i)=>({y:center+i})),37,432);
    assert.ok(result[0].labelY>=37);
    assert.ok(result.at(-1).labelY<=432);
    result.slice(1).forEach((item,i)=>assert.ok(item.labelY-result[i].labelY>=23));
  }
});

test('hover shows precise cursor values and marks offscreen curve values', () => {
  const markup=hoverMarkup({point:{x:1100,y:200},hz:1234,db:-3.25,readings:[{name:'Source',color:'#dc6576',db:40}],bounds:{l:54,r:1175,t:24,b:447},yOf:db=>235-db*8});
  assert.match(markup,/1234 Hz/);
  assert.match(markup,/-3.25 dB/);
  assert.match(markup,/\+40.00 dB ↑/);
  assert.doesNotMatch(markup,/NaN|Infinity/);
});
