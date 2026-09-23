import {defaultAutoEqOptions,validateAutoEqOptions} from './autoeq.js';
import {installNumericControls} from './numeric-controls.js';

export function createAutoEqPopup({anchor,getContext,onApply,getOptions,onOptionsChange}){
  let popup=null,worker=null,options=defaultAutoEqOptions();
  const field=(name,title,min,max,step=1,unit='')=>`<label>${title}<div class="unit-input"><input name="${name}" type="number" data-adjust="autoeq" data-adjust-step="${step}" title="Drag up/down or use mouse wheel · Shift for fine adjustment" min="${min}" ${max===null?'':`max="${max}"`} step="${name==='maxBands'?1:'any'}" value="${options[name]}" required/>${unit}</div></label>`;
  installNumericControls({
    getControl:element=>{
      if(!popup?.contains(element)||element.dataset.adjust!=='autoeq'||worker)return null;
      const name=element.name;
      let min=Number(element.min),max=element.max===''?Number.MAX_SAFE_INTEGER:Number(element.max);
      const other=key=>Number(popup.querySelector(`[name="${key}"]`).value);
      if(name==='minHz')max=Math.min(max,other('maxHz')-1);
      if(name==='maxHz')min=Math.max(min,other('minHz')+1);
      if(name==='minQ')max=Math.min(max,other('maxQ'));
      if(name==='maxQ')min=Math.max(min,other('minQ'));
      if(!Number.isFinite(min)||!Number.isFinite(max)||min>max)return null;
      return{element,key:`autoeq:${name}`,value:element.value===''?options[name]:Number(element.value),min,max,step:Number(element.dataset.adjustStep),log:name==='minHz'||name==='maxHz',precision:name==='maxBands'||name.endsWith('Hz')?0:2};
    },
    onBegin:()=>{},
    onChange:(spec,value)=>{spec.element.value=value;spec.element.dispatchEvent(new Event('input',{bubbles:true}));},
    onEnd:()=>{},
  });
  function readOptions(form){
    const data=new FormData(form);
    return validateAutoEqOptions(Object.fromEntries(Object.keys(defaultAutoEqOptions()).map(key=>{
      if(['shelves','safePreamp'].includes(key))return[key,data.has(key)];
      const value=data.get(key);return[key,value===null||value===''?NaN:Number(value)];
    })));
  }
  function position(){
    if(!popup)return;const r=anchor.getBoundingClientRect(),w=Math.min(380,innerWidth-24);
    popup.style.width=`${w}px`;popup.style.left=`${Math.max(12,Math.min(r.right-w,innerWidth-w-12))}px`;
    popup.style.maxHeight=`${innerHeight-24}px`;popup.style.top=`${Math.max(12,Math.min(r.bottom+8,innerHeight-popup.offsetHeight-12))}px`;
  }
  function cancel(){worker?.terminate();worker=null;}
  function close(focus=false){cancel();popup?.remove();popup=null;anchor.setAttribute('aria-expanded','false');if(focus)anchor.focus();}
  function status(text,error=false){if(!popup)return;const el=popup.querySelector('.autoeq-status');el.textContent=text;el.classList.toggle('error',error);position();}
  function busy(value){if(!popup)return;popup.setAttribute('aria-busy',String(value));popup.querySelector('fieldset').disabled=value;popup.querySelector('[type=submit]').disabled=value;popup.querySelector('[type=submit]').textContent=value?'Fitting curves…':'Generate & replace bands';popup.querySelector('[data-cancel]').textContent=value?'Cancel fitting':'Cancel';}
  function update(){
    if(!popup||worker)return;
    try{const context=getContext();popup.querySelector('.autoeq-curves').textContent=`${context.source.name} → ${context.target.name}`;popup.querySelector('.autoeq-scope').textContent=`Replaces all bands for ${context.scope} and enables PEQ. Undo restores the previous settings.`;popup.querySelector('[type=submit]').disabled=false;}
    catch(error){popup.querySelector('.autoeq-curves').textContent=error.message;popup.querySelector('[type=submit]').disabled=true;}
    position();
  }
  function toggle(){
    if(popup){close();return;}
    options=validateAutoEqOptions(getOptions());
    popup=document.createElement('section');popup.className='settings-popup autoeq-popup';popup.id='autoeq-menu';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Auto EQ');
    popup.innerHTML=`<div class="settings-heading"><h2>Auto EQ</h2><button type="button" data-close aria-label="Close Auto EQ">×</button></div><p class="autoeq-curves"></p>
      <form><fieldset><div class="settings-pair">${field('maxBands','Maximum bands',1,null)}<label>Smoothing<select name="smoothing">${[[0,'None'],[1/12,'1/12 octave'],[1/6,'1/6 octave'],[1/3,'1/3 octave'],[1/2,'1/2 octave']].map(([value,label])=>`<option value="${value}" ${options.smoothing===value?'selected':''}>${label}</option>`).join('')}</select></label></div>
      <div class="settings-pair">${field('minHz','From',20,20000,1,'Hz')}${field('maxHz','To',20,20000,1,'Hz')}</div>
      <div class="settings-pair">${field('maxBoost','Maximum boost',0,60,.5,'dB')}${field('maxCut','Maximum cut',0,60,.5,'dB')}</div>
      <details><summary>Filter options</summary><div class="settings-pair">${field('minQ','Minimum Q',.1,20,.1)}${field('maxQ','Maximum Q',.1,20,.1)}</div><label class="check-row"><input name="shelves" type="checkbox" ${options.shelves?'checked':''}/>Allow low / high shelves</label></details>
      <label class="check-row"><input name="safePreamp" type="checkbox" ${options.safePreamp?'checked':''}/>Set safe preamp</label></fieldset>
      <p class="settings-note">Uses current curve alignment and offsets. Safe preamp adds headroom after fitting; otherwise preamp is set to 0 dB.</p>
      <p class="autoeq-scope"></p><p class="autoeq-status" role="status"></p>
      <div class="autoeq-actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">Generate & replace bands</button></div></form>`;
    document.body.append(popup);anchor.setAttribute('aria-expanded','true');update();popup.querySelector('input').focus();
    popup.querySelector('[data-close]').onclick=()=>close(true);popup.querySelector('[data-cancel]').onclick=()=>close(true);
    popup.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}});
    popup.querySelector('details').addEventListener('toggle',position);
    const form=popup.querySelector('form');
    const remember=()=>{if(worker)return;try{options=readOptions(form);onOptionsChange(options);}catch{/* Keep the last valid options while a field is incomplete. */}};
    form.addEventListener('input',remember);form.addEventListener('change',remember);
    popup.querySelector('form').addEventListener('submit',event=>{
      event.preventDefault();if(worker)return;
      let context;
      try{
        options=readOptions(event.target);onOptionsChange(options);
        context=getContext();worker=new Worker(new URL('./autoeq-worker.js',import.meta.url),{type:'module'});
        busy(true);status('Fitting the aligned source to the target…');
        worker.onmessage=({data})=>{
          if(data.type==='progress'){status(`Fitting band ${data.bands} · error ${data.rmse.toFixed(2)} dB`);return;}
          cancel();busy(false);
          if(data.type==='error'){status(data.message,true);return;}
          try{onApply(data.result,context);close(true);}catch(error){status(error.message,true);}
        };
        worker.onerror=event=>{event.preventDefault();cancel();busy(false);status('Auto EQ could not finish. Please try again.',true);};
        worker.postMessage({source:context.source,target:context.target,display:context.display,sampleRate:context.sampleRate,options});
      }catch(error){cancel();busy(false);status(error.message,true);}
    });
  }
  document.addEventListener('pointerdown',event=>{if(popup&&!worker&&!popup.contains(event.target)&&!anchor.contains(event.target))close();});
  window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
  anchor.setAttribute('aria-haspopup','dialog');anchor.setAttribute('aria-controls','autoeq-menu');anchor.setAttribute('aria-expanded','false');
  return{toggle,close,update};
}
