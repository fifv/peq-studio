import { builtinCurves, TARGET_CATALOG_VERSION, SOURCE_CATALOG_VERSION, customCurves, findCurve, searchCurves } from './curve-library.js';

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let openPicker = null;
const collections={custom:'Custom',target:'Built-in targets',source:'Headphone library'};
const collectionOf=curve=>curve?.builtin?curve.kind:'custom';

/** A local, searchable curve library. The popup is portaled to avoid clipping. */
export function createCurvePicker({ root, kind, getState, onSelect, onDelete, onImport }) {
  const label = kind === 'target' ? 'Target curve' : 'Source response';
  let view = collectionOf(findCurve(getState(), kind));
  let query = '', popup = null, lastSelectedId = getState()[`${kind}Id`], loading = false, error = '';
  root.className = 'curve-field';
  root.innerHTML = `<span class="curve-field-label" id="${kind}-field-label">${label}</span><button id="${kind}-select" class="curve-trigger" aria-label="${label}" aria-haspopup="dialog" aria-expanded="false" aria-controls="${kind}-curve-menu"></button>`;
  const heading=document.createElement('div');heading.className='curve-field-heading';
  heading.append(root.firstElementChild);root.prepend(heading);
  heading.insertAdjacentHTML('beforeend',`<label class="curve-offset">Offset <span><input id="${kind}-offset" data-adjust="${kind}-offset" type="number" min="-120" max="120" step="0.1" aria-label="${kind==='target'?'Target':'Source'} curve offset" title="Drag up/down or use mouse wheel"/>dB</span></label>`);
  const trigger = root.querySelector('button');
  const items = () => view === 'custom' ? customCurves(getState(), kind) : builtinCurves(view);
  function update() {
    const selected = findCurve(getState(), kind);
    if (lastSelectedId !== getState()[`${kind}Id`]) {
      lastSelectedId = getState()[`${kind}Id`];
      if (selected && !loading) {
        view = collectionOf(selected); query = '';
        if (popup) renderPopup();
      }
    }
    trigger.innerHTML = `<span class="curve-trigger-name">${escapeHtml(selected?.name ?? 'None')}</span><span class="curve-trigger-count">(${items().length})</span><span class="curve-chevron" aria-hidden="true">⌄</span>`;
    trigger.title = selected?.name ?? 'None';
    root.querySelector('input[data-adjust]').value=getState().curveDisplay[`${kind}OffsetDb`];
    if (popup) { renderList(); position(); }
  }
  function position() {
    if (!popup) return;
    const anchor = trigger.getBoundingClientRect(), width = Math.min(360, innerWidth-24);
    popup.style.width = `${width}px`;
    popup.style.left = `${Math.max(12, Math.min(anchor.left, innerWidth-width-12))}px`;
    const spaceBelow = innerHeight-anchor.bottom-20, spaceAbove = anchor.top-20;
    const below = spaceBelow >= 280 || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(160, below ? spaceBelow : spaceAbove);
    popup.style.maxHeight = `${maxHeight}px`;
    popup.style.top = `${below ? anchor.bottom+8 : Math.max(12,anchor.top-Math.min(popup.scrollHeight,maxHeight)-8)}px`;
  }
  function close(returnFocus = false) {
    popup?.remove(); popup = null; trigger.setAttribute('aria-expanded','false');
    if (openPicker === controller) openPicker = null;
    if (returnFocus) trigger.focus();
  }
  function revealSelected(){
    const list=popup?.querySelector('.curve-list'),row=list?.querySelector('.curve-library-row.selected');
    if(!row)return;
    const listRect=list.getBoundingClientRect(),rowRect=row.getBoundingClientRect();
    // Scroll only the list, leaving the editor and popup in place.
    list.scrollTop+=rowRect.top-listRect.top-(list.clientHeight-rowRect.height)/2;
  }
  function renderList() {
    if (!popup) return;
    const state=getState(), results=searchCurves(items(), query), list=popup.querySelector('.curve-list');
    list.innerHTML = results.map(curve => `<div class="curve-library-row ${state[`${kind}Id`]===curve.id?'selected':''}"><button class="curve-choice" data-curve-id="${escapeHtml(curve.id)}" aria-pressed="${state[`${kind}Id`]===curve.id}" title="${escapeHtml(curve.name)}"><span class="curve-check" aria-hidden="true">${state[`${kind}Id`]===curve.id?'✓':''}</span><span><span class="curve-choice-name">${escapeHtml(curve.name)}</span>${curve.measurementSystem?`<small>${escapeHtml(curve.measurementSystem)}</small>`:''}</span></button>${view==='custom'?`<button class="curve-delete" data-delete-id="${escapeHtml(curve.id)}" aria-label="Delete ${escapeHtml(curve.name)}" title="Delete curve">×</button>`:''}</div>`).join('') || `<div class="curve-empty"><strong>${query ? 'No matching curves' : `No custom curves yet`}</strong><span>${query ? 'Try another name or measurement system.' : 'Import a frequency response file to get started.'}</span></div>`;
    popup.querySelector('.curve-library-status').textContent = loading ? 'Loading local response…' : error || `${results.length} ${results.length===1?'curve':'curves'}${view!=='custom'?` · bundled ${view==='target'?TARGET_CATALOG_VERSION:SOURCE_CATALOG_VERSION}`:' · saved on this device'}`;
    popup.setAttribute('aria-busy',String(loading));
    popup.querySelectorAll('.curve-choice').forEach(button=>{button.disabled=loading;});
    popup.querySelector('[data-clear]').disabled = !state[`${kind}Id`];
  }
  function renderPopup() {
    popup.innerHTML = `<div class="curve-library-tabs" role="tablist" aria-label="Curve collection">${Object.entries(collections).map(([id,title])=>`<button role="tab" aria-selected="${view===id}" data-view="${id}" tabindex="${view===id?0:-1}" id="${kind}-${id}-tab" aria-controls="${kind}-curve-panel">${title}</button>`).join('')}</div>
      <div class="curve-library-panel" id="${kind}-curve-panel" role="tabpanel" aria-labelledby="${kind}-${view}-tab">
        <div class="curve-library-search"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search curves" aria-label="Search curves" value="${escapeHtml(query)}"/>
        ${view==='custom'?`<button class="curve-import-button" data-import aria-label="Import curve" title="Import curve"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 8V5h7l2 3h9v11H3V8Zm0 3h18l-3 8H3Z"/></svg></button>`:''}</div>
        <div class="curve-list" aria-label="${collections[view]} curves"></div>
        <div class="curve-library-footer"><span class="curve-library-status" role="status"></span><button data-clear>Clear selection</button></div>
      </div>`;
    popup.querySelector('input').addEventListener('input',event=>{query=event.target.value;renderList();position();});
    renderList();position();
  }
  function open() {
    if(popup){close();return;}
    openPicker?.close();openPicker=controller;
    const selected=findCurve(getState(),kind);
    if(selected)view=collectionOf(selected);
    query='';
    popup=document.createElement('div');popup.id=`${kind}-curve-menu`;popup.className='curve-library-popup';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Curve library');
    document.body.append(popup);trigger.setAttribute('aria-expanded','true');
    renderPopup();popup.querySelector('input').focus({preventScroll:true});revealSelected();
    popup.addEventListener('click',async event=>{
      const tab=event.target.closest('[data-view]');
      if(tab){view=tab.dataset.view;query='';renderPopup();popup.querySelector(`[data-view="${view}"]`).focus();update();return;}
      const choice=event.target.closest('[data-curve-id]'),clear=event.target.closest('[data-clear]');if(choice||clear){
        const activePopup=popup,scrollTop=popup.querySelector('.curve-list').scrollTop;
        loading=true;error='';renderList();
        try { await onSelect(choice?.dataset.curveId ?? ''); }
        catch(e){error=e.message;}
        finally {
          loading=false;
          if(popup){
            renderList();
            if(popup===activePopup){
              popup.querySelector('.curve-list').scrollTop=scrollTop;
              (popup.querySelector('.curve-choice[aria-pressed="true"]')??popup.querySelector('input')).focus({preventScroll:true});
            }
          }
        }
        return;
      }
      const remove=event.target.closest('[data-delete-id]');if(remove){onDelete(remove.dataset.deleteId);update();popup.querySelector('input').focus();return;}
      if(event.target.closest('[data-import]')){close();onImport();return;}
    });
    popup.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return;}
      if(event.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight'].includes(event.key)){
        event.preventDefault();const views=Object.keys(collections);view=views[(views.indexOf(view)+(event.key==='ArrowRight'?1:views.length-1))%views.length];query='';renderPopup();popup.querySelector(`[data-view="${view}"]`).focus();update();return;
      }
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||(!event.target.matches('input,.curve-choice')))return;
      if(event.target.matches('input')&&['Home','End'].includes(event.key))return;
      const options=[...popup.querySelectorAll('.curve-choice')];if(!options.length)return;
      event.preventDefault();const index=options.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?options.length-1:event.key==='ArrowDown'?(index+1)%options.length:index<0?options.length-1:(index-1+options.length)%options.length;
      options[next].focus();
    });
  }
  trigger.addEventListener('click',open);
  trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();if(!popup)open();}});
  document.addEventListener('pointerdown',event=>{if(popup&&!popup.contains(event.target)&&!root.contains(event.target))close();});
  window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
  const controller={update,close};update();return controller;
}
