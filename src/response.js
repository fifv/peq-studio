// Preserve upstream coefficients, but allow the response to exceed its ±60 dB
// drawing clamp now that users can enter arbitrary finite band gains.
import {getTransferFunction, normalizeFilterTypeCode} from './vendor/topping-dsp.js';
export {getTransferFunction, normalizeFilterTypeCode};
export function calculateFilterResponseDb(tf,hz,{samplingFrequencyHz=48000}={}) {
  const w=2*Math.PI*Math.min(hz,samplingFrequencyHz/2)/samplingFrequencyHz;
  const magnitude=c=>Math.hypot(c[0]+c[1]*Math.cos(w)+c[2]*Math.cos(2*w),c[1]*Math.sin(w)+c[2]*Math.sin(2*w));
  return 20*(Math.log10(Math.max(Number.MIN_VALUE,magnitude(tf.num)))-Math.log10(Math.max(Number.MIN_VALUE,magnitude(tf.den))));
}
export function calculateCombinedResponseDb(filters,preampDb,hz,options) {
  return filters.reduce((sum,f)=>sum+(f.enabled?calculateFilterResponseDb(getTransferFunction(f.type,f.fcHz,f.gainDb,f.q,options),hz,options):0),preampDb);
}
