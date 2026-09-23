import { LEVEL_METHODS, curveReferenceLevel } from './curve-level.js';
import { findCurve } from './curve-library.js';

export function createSettingsPopup({ anchor, getState, onAlignmentChange }) {
  let popup=null;
  function setAlignmentOpen(open, focus=false){
    const trigger=popup.querySelector('#level-method');
    const list=popup.querySelector('#level-method-options');
    trigger.setAttribute('aria-expanded',String(open));
    list.hidden=!open;
    if(focus)(open?list.querySelector('[aria-selected="true"]'):trigger)?.focus({preventScroll:true});
    position();
  }
  function position(){
    if(!popup)return;const r=anchor.getBoundingClientRect(),w=Math.min(360,innerWidth-24);
    popup.style.width=`${w}px`;popup.style.left=`${Math.max(12,Math.min(r.right-w,innerWidth-w-12))}px`;
    popup.style.maxHeight=`${innerHeight-24}px`;
    popup.style.top=`${Math.max(12,Math.min(r.bottom+8,innerHeight-popup.offsetHeight-12))}px`;
  }
  function close(focus=false){popup?.remove();popup=null;anchor.setAttribute('aria-expanded','false');if(focus)anchor.focus();}
  function update(){
    if(!popup)return;
    const state=getState(),settings=state.curveDisplay;
    for(const [id,value] of Object.entries({'sample-rate':state.sampleRate,'reference-level':settings.referenceDb,'level-min':settings.minHz,'level-max':settings.maxHz})){
      const el=popup.querySelector(`#${id}`);if(document.activeElement!==el)el.value=value;
    }
    popup.querySelector('#level-method .alignment-value').textContent=LEVEL_METHODS[settings.method];
    popup.querySelectorAll('[data-level-method]').forEach(option=>{
      const selected=option.dataset.levelMethod===settings.method;
      option.setAttribute('aria-selected',String(selected));
      option.tabIndex=selected?0:-1;
    });
    popup.querySelector('#compensated').checked=settings.compensated;
    popup.querySelector('#include-preamp').checked=settings.includePreamp;
    const band=settings.method.startsWith('band-');
    popup.querySelector('#level-range').hidden=!band;
    popup.querySelector('#reference-level').disabled=settings.method==='none';
    popup.querySelector('.level-explanation').textContent=settings.method==='band-energy'?'Matches average energy across equal octave intervals—like a pink-noise reference. Less sensitive to a single frequency.':settings.method==='band-average'?'Matches the average dB response across equal octave intervals in the selected range.':settings.method==='1k'?'Aligns each curve at exactly 1 kHz. Manual offsets are applied afterward.':'Keeps the imported measurement levels. Only manual offsets are applied.';
    popup.querySelector('.level-readout').textContent=['target','source'].map(kind=>{
      const curve=findCurve(state,kind);return curve?.points?`${kind==='target'?'Target':'Source'} measured reference: ${curveReferenceLevel(curve,settings).toFixed(1)} dB`:'';
    }).filter(Boolean).join(' · ');
    position();
  }
  function toggle(){
    if(popup){close();return;}
    popup=document.createElement('section');popup.className='settings-popup';popup.id='display-settings';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Display settings');
    popup.innerHTML=`<div class="settings-heading"><h2>Display settings</h2><button data-close-settings aria-label="Close display settings">×</button></div><label>Sample rate<select id="sample-rate">${[44100,48000,96000,192000].map(n=>`<option value="${n}">${n/1000} kHz</option>`).join('')}</select></label><label>Curve alignment<select id="level-method">${Object.entries(LEVEL_METHODS).map(([id,title])=>`<option value="${id}">${title}</option>`).join('')}</select></label><div id="level-range" class="settings-pair"><label>From<div class="unit-input"><input id="level-min" data-adjust="level-min" type="number" min="20" max="19999" step="1"/>Hz</div></label><label>To<div class="unit-input"><input id="level-max" data-adjust="level-max" type="number" min="21" max="20000" step="1"/>Hz</div></label></div><label>Reference level<div class="unit-input"><input id="reference-level" data-adjust="reference-level" type="number" min="-60" max="120" step="0.1"/>dB</div></label><p class="level-explanation"></p><p class="level-readout"></p><label class="check-row"><input type="checkbox" id="compensated"/>Compensated view (subtract target)</label><p class="settings-note">Relative curve comparison, not a calibrated listening SPL. Drag values up/down or use the wheel; Shift for fine adjustment.</p>`;
    const alignment=document.createElement('div');
    alignment.className='alignment-picker';
    alignment.innerHTML=`<span id="alignment-label" class="alignment-label">Curve alignment</span><button type="button" id="level-method" class="alignment-trigger" aria-labelledby="alignment-label alignment-value" aria-haspopup="listbox" aria-controls="level-method-options" aria-expanded="false"><span id="alignment-value" class="alignment-value"></span><span class="alignment-chevron" aria-hidden="true">⌄</span></button><div id="level-method-options" class="alignment-options" role="listbox" aria-labelledby="alignment-label" hidden>${Object.entries(LEVEL_METHODS).map(([id,title])=>`<button type="button" role="option" data-level-method="${id}" aria-selected="false" tabindex="-1"><span>${title}</span><span class="alignment-check" aria-hidden="true">✓</span></button>`).join('')}</div>`;
    popup.querySelector('#level-method').parentElement.replaceWith(alignment);
    alignment.querySelector('.alignment-trigger').addEventListener('click',()=>setAlignmentOpen(alignment.querySelector('.alignment-options').hidden,true));
    alignment.addEventListener('click',event=>{
      const option=event.target.closest('[data-level-method]');
      if(option)onAlignmentChange(option.dataset.levelMethod);
    });
    alignment.addEventListener('keydown',event=>{
      const options=[...alignment.querySelectorAll('[data-level-method]')];
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      event.preventDefault();
      if(alignment.querySelector('.alignment-options').hidden){setAlignmentOpen(true,true);return;}
      const index=options.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
      options[next].focus({preventScroll:true});
    });
    alignment.addEventListener('focusout',event=>{if(!alignment.contains(event.relatedTarget))setAlignmentOpen(false);});
    popup.addEventListener('pointerdown',event=>{if(!alignment.contains(event.target))setAlignmentOpen(false);});
    popup.querySelector('.settings-note').insertAdjacentHTML('beforebegin','<label class="check-row"><input type="checkbox" role="switch" id="include-preamp"/>Filtered curve includes preamp gain</label>');
    document.body.append(popup);anchor.setAttribute('aria-expanded','true');update();
    popup.querySelector('[data-close-settings]').addEventListener('click',()=>close(true));
    popup.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!popup.querySelector('#level-method-options').hidden)setAlignmentOpen(false,true);else close(true);}});
  }
  document.addEventListener('pointerdown',event=>{if(popup&&!popup.contains(event.target)&&!anchor.contains(event.target))close();});
  window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
  anchor.setAttribute('aria-haspopup','dialog');anchor.setAttribute('aria-controls','display-settings');anchor.setAttribute('aria-expanded','false');
  return {toggle,update,close};
}
