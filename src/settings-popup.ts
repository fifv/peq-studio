import { positionPopup, installPopupEvents } from './ui/popover.ts';
import { query, eventElement } from './dom.ts';
import type { Workspace, LevelMethod } from './types.ts';
import { LEVEL_METHODS, curveReferenceLevel } from './curve-level.ts';
import { findCurve } from './curve-library.ts';

export function createSettingsPopup({
  anchor,
  getState,
  onAlignmentChange,
}: {
  anchor: HTMLElement;
  getState: () => Workspace;
  onAlignmentChange: (method: LevelMethod) => void;
}) {
  let popup: HTMLElement | null = null;
  function setAlignmentOpen(open: boolean, focus = false) {
    const trigger = query('#level-method', popup);
    const list = query('#level-method-options', popup);
    trigger.setAttribute('aria-expanded', String(open));
    list.hidden = !open;
    if (focus)
      (open ? list.querySelector<HTMLElement>('[aria-selected="true"]') : trigger)?.focus({
        preventScroll: true,
      });
    position();
  }
  function position() {
    positionPopup(popup, anchor, { width: 360 });
  }

  function close(focus = false) {
    popup?.remove();
    popup = null;
    anchor.setAttribute('aria-expanded', 'false');
    if (focus) anchor.focus();
  }
  function update() {
    if (!popup) return;
    const state = getState(),
      settings = state.curveDisplay;
    for (const [id, value] of Object.entries({
      'sample-rate': state.sampleRate,
      'reference-level': settings.referenceDb,
      'level-min': settings.minHz,
      'level-max': settings.maxHz,
    })) {
      const el = query<HTMLInputElement | HTMLSelectElement>(`#${id}`, popup);
      if (document.activeElement !== el) el.value = String(value);
    }
    query('#level-method .alignment-value', popup).textContent = LEVEL_METHODS[settings.method];
    popup.querySelectorAll<HTMLElement>('[data-level-method]').forEach((option) => {
      const selected = option.dataset.levelMethod === settings.method;
      option.setAttribute('aria-selected', String(selected));
      option.tabIndex = selected ? 0 : -1;
    });
    query<HTMLInputElement>('#compensated', popup).checked = settings.compensated;
    query<HTMLInputElement>('#include-preamp', popup).checked = settings.includePreamp;
    const band = settings.method.startsWith('band-');
    query('#level-range', popup).hidden = !band;
    query<HTMLInputElement>('#reference-level', popup).disabled = settings.method === 'none';
    query('.level-explanation', popup).textContent =
      settings.method === 'band-energy'
        ? 'Matches average energy across equal octave intervals—like a pink-noise reference. Less sensitive to a single frequency.'
        : settings.method === 'band-average'
          ? 'Matches the average dB response across equal octave intervals in the selected range.'
          : settings.method === '1k'
            ? 'Aligns each curve at exactly 1 kHz. Manual offsets are applied afterward.'
            : 'Keeps the imported measurement levels. Only manual offsets are applied.';
    query('.level-readout', popup).textContent = (['target', 'source'] as const)
      .map((kind) => {
        const curve = findCurve(state, kind);
        return curve?.points
          ? `${kind === 'target' ? 'Target' : 'Source'} measured reference: ${curveReferenceLevel({ points: curve.points }, settings).toFixed(1)} dB`
          : '';
      })
      .filter(Boolean)
      .join(' · ');
    position();
  }
  function toggle() {
    if (popup) {
      close();
      return;
    }
    popup = document.createElement('section');
    popup.className = 'settings-popup';
    popup.id = 'display-settings';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Display settings');
    popup.innerHTML = /* HTML */ `<div class="settings-heading">
        <h2>Display settings</h2>
        <button data-close-settings aria-label="Close display settings">×</button>
      </div>
      <label
        >Sample rate<select id="sample-rate">
          ${[44100, 48000, 96000, 192000].map((n) => `<option value="${n}">${n / 1000} kHz</option>`).join('')}
        </select></label
      >
      <div id="alignment-picker-slot"></div>
      <div id="level-range" class="settings-pair">
        <label
          >From
          <div class="unit-input">
            <input
              id="level-min"
              data-adjust="level-min"
              type="number"
              min="20"
              max="19999"
              step="1"
            />Hz
          </div></label
        ><label
          >To
          <div class="unit-input">
            <input
              id="level-max"
              data-adjust="level-max"
              type="number"
              min="21"
              max="20000"
              step="1"
            />Hz
          </div></label
        >
      </div>
      <label
        >Reference level
        <div class="unit-input">
          <input
            id="reference-level"
            data-adjust="reference-level"
            type="number"
            min="-60"
            max="120"
            step="0.1"
          />dB
        </div></label
      >
      <p class="level-explanation"></p>
      <p class="level-readout"></p>
      <label class="check-row"
        ><input type="checkbox" id="compensated" />Compensated view (subtract target)</label
      >
      <p class="settings-note">
        Relative curve comparison, not a calibrated listening SPL. Drag values up/down or use the
        wheel; Shift for fine adjustment.
      </p>`;
    const alignment = document.createElement('div');
    alignment.className = 'alignment-picker';
    alignment.innerHTML = /* HTML */ `<span id="alignment-label" class="alignment-label"
        >Curve alignment</span
      ><button
        type="button"
        id="level-method"
        class="alignment-trigger"
        aria-labelledby="alignment-label alignment-value"
        aria-haspopup="listbox"
        aria-controls="level-method-options"
        aria-expanded="false"
      >
        <span id="alignment-value" class="alignment-value"></span
        ><span class="dropdown-chevron" aria-hidden="true"></span>
      </button>
      <div
        id="level-method-options"
        class="alignment-options"
        role="listbox"
        aria-labelledby="alignment-label"
        hidden
      >
        ${Object.entries(LEVEL_METHODS)
          .map(
            ([id, title]) =>
              `<button type="button" role="option" data-level-method="${id}" aria-selected="false" tabindex="-1"><span>${title}</span><span class="alignment-check" aria-hidden="true">✓</span></button>`,
          )
          .join('')}
      </div>`;
    query('#alignment-picker-slot', popup).replaceWith(alignment);
    query<HTMLButtonElement>('.alignment-trigger', alignment).addEventListener('click', () =>
      setAlignmentOpen(Boolean(query('.alignment-options', alignment).hidden), true),
    );
    alignment.addEventListener('click', (event) => {
      const option = eventElement(event).closest<HTMLElement>('[data-level-method]');
      if (option) onAlignmentChange(option.dataset.levelMethod as LevelMethod);
    });
    alignment.addEventListener('keydown', (event) => {
      const options = [...alignment.querySelectorAll<HTMLElement>('[data-level-method]')];
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (query('.alignment-options', alignment).hidden) {
        setAlignmentOpen(true, true);
        return;
      }
      const index = options.findIndex((option) => option === document.activeElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? options.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next].focus({ preventScroll: true });
    });
    alignment.addEventListener('focusout', (event) => {
      if (!alignment.contains(event.relatedTarget as Node)) setAlignmentOpen(false);
    });
    popup.addEventListener('pointerdown', (event) => {
      if (!alignment.contains(event.target as Node)) setAlignmentOpen(false);
    });
    query('.settings-note', popup).insertAdjacentHTML(
      'beforebegin',
      '<label class="check-row"><input type="checkbox" role="switch" id="include-preamp"/>Filtered curve includes preamp gain</label>',
    );
    document.body.append(popup);
    anchor.setAttribute('aria-expanded', 'true');
    update();
    query<HTMLButtonElement>('[data-close-settings]', popup).addEventListener('click', () =>
      close(true),
    );
    popup.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!query('#level-method-options', popup).hidden) setAlignmentOpen(false, true);
        else close(true);
      }
    });
  }
  installPopupEvents(
    anchor,
    () => popup,
    () => close(),
    position,
  );
  anchor.setAttribute('aria-haspopup', 'dialog');
  anchor.setAttribute('aria-controls', 'display-settings');
  anchor.setAttribute('aria-expanded', 'false');
  return { toggle, update, close };
}
