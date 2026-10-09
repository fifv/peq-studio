import { positionPopup, installPopupEvents } from './ui/popover.ts';
import { query, eventElement } from './dom.ts';
import type { Workspace, LevelMethod } from './types.ts';
import { LEVEL_METHODS, curveReferenceLevel, getCurveDisplay } from './curve-level.ts';
import { findCurve } from './curve-library.ts';
import { renderToggle } from './ui/toggle.ts';
import { icon } from './ui/icons.ts';

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
  function position() {
    positionPopup(popup, anchor, { width: 420 });
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
      settings = getCurveDisplay(state);
    for (const [id, value] of Object.entries({
      'alignment-frequency': settings.alignmentHz,
      'reference-level': settings.referenceDb,
      'level-min': settings.minHz,
      'level-max': settings.maxHz,
    })) {
      const el = query<HTMLInputElement | HTMLSelectElement>(`#${id}`, popup);
      if (document.activeElement !== el) el.value = String(value);
    }
    popup.querySelectorAll<HTMLInputElement>('input[name="sample-rate"]').forEach((option) => {
      option.checked = +option.value === state.sampleRate;
    });
    popup.querySelectorAll<HTMLInputElement>('input[name="level-method"]').forEach((option) => {
      option.checked = option.value === settings.method;
    });
    query<HTMLInputElement>('#compensated', popup).checked = settings.compensated;
    query<HTMLInputElement>('#include-preamp', popup).checked = settings.includePreamp;
    const band = settings.method.startsWith('band-');
    query('#level-range', popup).hidden = !band;
    query('#alignment-frequency-field', popup).hidden = settings.method !== '1k';
    query<HTMLInputElement>('#reference-level', popup).disabled = settings.method === 'none';
    query('.level-explanation', popup).textContent =
      settings.method === 'band-energy'
        ? 'Matches average energy across equal octave intervals—like a pink-noise reference. Less sensitive to a single frequency.'
        : settings.method === 'band-average'
          ? 'Matches the average dB response across equal octave intervals in the selected range.'
          : settings.method === '1k'
            ? `Aligns each curve at ${settings.alignmentHz} Hz. Manual offsets are applied afterward.`
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
        <button data-close-settings aria-label="Close display settings">${icon('close')}</button>
      </div>
      <fieldset class="settings-choice-field">
        <legend>Sample rate</legend>
        <div class="settings-segments">
          ${[44100, 48000, 96000, 192000].map((n) => `<label><input type="radio" name="sample-rate" value="${n}" /><span>${n / 1000} <small>kHz</small></span></label>`).join('')}
        </div>
      </fieldset>
      <fieldset class="settings-choice-field">
        <legend>Curve alignment</legend>
        <div class="settings-segments alignment-segments">
          ${Object.entries(LEVEL_METHODS)
            .map(([id, title]) => {
              const labels: Record<LevelMethod, string> = {
                'band-average': 'dB average',
                'band-energy': 'Energy',
                '1k': 'At frequency',
                none: 'Original',
              };
              return `<label title="${title}"><input type="radio" name="level-method" value="${id}" aria-label="${title}" /><span>${labels[id as LevelMethod]}</span></label>`;
            })
            .join('')}
        </div>
      </fieldset>
      <label id="alignment-frequency-field">
        Alignment frequency
        <div class="unit-input">
          <input
            id="alignment-frequency"
            data-adjust="alignment-frequency"
            type="number"
            min="20"
            max="20000"
            step="1"
          />Hz
        </div>
      </label>
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
      ${renderToggle('Compensated view (subtract target)', { id: 'compensated' })}
      <p class="settings-note">
        Relative curve comparison, not a calibrated listening SPL. Drag values up/down or use the
        wheel; Shift for fine adjustment, Alt for 5× wheel speed.
      </p>`;
    popup.addEventListener('change', (event) => {
      const option = eventElement(event);
      if (option instanceof HTMLInputElement && option.name === 'level-method' && option.checked)
        onAlignmentChange(option.value as LevelMethod);
    });
    query('.settings-note', popup).insertAdjacentHTML(
      'beforebegin',
      renderToggle('Filtered curve includes preamp gain', { id: 'include-preamp' }),
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
        close(true);
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
