export function adjustedValue(start, steps, spec) {
  const raw=spec.log ? start*(1.02**steps) : start+steps*spec.step;
  const precision=spec.precision??(spec.step<.1?3:spec.step<1?2:0);
  return +Math.min(spec.max,Math.max(spec.min,raw)).toFixed(precision);
}

/** Delegated controls survive band-editor rerenders. One undo entry per drag or
 * wheel gesture. Click still opens direct typing; only actual drags eat clicks. */
export function installNumericControls({ getControl, onBegin, onChange, onEnd }) {
  let gesture=null,wheel=null,wheelTimer,suppressClick=false;
  const resolve=target=>{const element=target.closest?.('[data-adjust]');return element&&!element.matches(':disabled')?getControl(element):null;};
  function finishWheel(){if(!wheel)return;clearTimeout(wheelTimer);wheel=null;onEnd();}
  document.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;const spec=resolve(event.target);if(!spec)return;
    finishWheel();event.preventDefault();
    gesture={spec,id:event.pointerId,startY:event.clientY,start:spec.value,changed:false};
    spec.element.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove',event=>{
    if(!gesture||gesture.id!==event.pointerId)return;
    const distance=gesture.startY-event.clientY;if(!gesture.changed&&Math.abs(distance)<3)return;
    event.preventDefault();
    if(!gesture.changed){onBegin();gesture.changed=true;document.body.classList.add('adjusting-value');}
    const steps=distance/5*(event.shiftKey?.1:1);
    onChange(gesture.spec,adjustedValue(gesture.start,steps,gesture.spec));
  });
  function finish(event){
    if(!gesture||gesture.id!==event.pointerId)return;
    const {spec,changed}=gesture;gesture=null;document.body.classList.remove('adjusting-value');
    if(spec.element.hasPointerCapture(event.pointerId))spec.element.releasePointerCapture(event.pointerId);
    if(changed){suppressClick=true;onEnd();setTimeout(()=>{suppressClick=false;},0);}
    else if(spec.element.matches('input[type=number]')){spec.element.focus();spec.element.select();}
  }
  document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);
  document.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();suppressClick=false;}},true);
  document.addEventListener('wheel',event=>{
    const spec=resolve(event.target);if(!spec||event.deltaY===0)return;
    event.preventDefault();
    if(!wheel||wheel.key!==spec.key){finishWheel();onBegin();wheel=spec;}
    onChange(spec,adjustedValue(spec.value,(event.deltaY<0?1:-1)*(event.shiftKey?.1:1),spec));
    clearTimeout(wheelTimer);wheelTimer=setTimeout(finishWheel,300);
  },{passive:false});
  document.addEventListener('keydown',event=>{
    if(!['ArrowUp','ArrowDown'].includes(event.key))return;
    const spec=resolve(event.target);if(!spec)return;event.preventDefault();finishWheel();onBegin();
    onChange(spec,adjustedValue(spec.value,(event.key==='ArrowUp'?1:-1)*(event.shiftKey?.1:1),spec));onEnd();
  });
}
