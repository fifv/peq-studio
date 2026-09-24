import { positionPopup, installPopupEvents } from './ui/popover.ts';
import { query } from './dom.ts';
import type { AutoEqContext, AutoEqOptions, AutoEqResult, AutoEqMessage } from './types.ts';
import { errorMessage } from './utils.ts';
import { defaultAutoEqOptions, validateAutoEqOptions } from './autoeq.ts';
import { installNumericControls } from './numeric-controls.ts';
import { renderToggle } from './ui/toggle.ts';

export function createAutoEqPopup({
  anchor,
  getContext,
  onApply,
  getOptions,
  onOptionsChange,
}: {
  anchor: HTMLElement;
  getContext: () => AutoEqContext;
  onApply: (result: AutoEqResult, context: AutoEqContext) => void;
  getOptions: () => AutoEqOptions;
  onOptionsChange: (options: AutoEqOptions) => void;
}) {
  let popup: HTMLElement | null = null,
    worker: Worker | null = null,
    options = defaultAutoEqOptions();
  const field = (
    name: keyof AutoEqOptions,
    title: string,
    min: number,
    max: number | null,
    step = 1,
    unit = '',
  ) =>
    `<label>${title}<div class="unit-input"><input name="${name}" type="number" data-adjust="autoeq" data-adjust-step="${step}" title="Drag up/down or use mouse wheel · Shift for fine adjustment" min="${min}" ${max === null ? '' : `max="${max}"`} step="${name === 'maxBands' ? 1 : 'any'}" value="${options[name]}" required/>${unit}</div></label>`;
  installNumericControls({
    getControl: (element) => {
      if (
        !popup?.contains(element) ||
        element.dataset.adjust !== 'autoeq' ||
        worker ||
        !(element instanceof HTMLInputElement)
      )
        return null;
      const name = element.name as keyof AutoEqOptions;
      let min = Number(element.min),
        max = element.max === '' ? Number.MAX_SAFE_INTEGER : Number(element.max);
      const other = (key: string) =>
        Number(query<HTMLInputElement>(`[name="${key}"]`, popup).value);
      if (name === 'minHz') max = Math.min(max, other('maxHz') - 1);
      if (name === 'maxHz') min = Math.max(min, other('minHz') + 1);
      if (name === 'minQ') max = Math.min(max, other('maxQ'));
      if (name === 'maxQ') min = Math.max(min, other('minQ'));
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
      return {
        element,
        key: `autoeq:${name}`,
        value: element.value === '' ? Number(options[name]) : Number(element.value),
        resetValue: Number(defaultAutoEqOptions()[name]),
        min,
        max,
        step: Number(element.dataset.adjustStep),
        log: name === 'minHz' || name === 'maxHz',
        precision: name === 'maxBands' || name.endsWith('Hz') ? 0 : 2,
      };
    },
    onBegin: () => {},
    onChange: (spec, value) => {
      (spec.element as HTMLInputElement).value = String(value);
      spec.element.dispatchEvent(new Event('input', { bubbles: true }));
    },
    onEnd: () => {},
  });
  function readOptions(form: HTMLFormElement) {
    const data = new FormData(form);
    return validateAutoEqOptions(
      Object.fromEntries(
        Object.keys(defaultAutoEqOptions()).map((key) => {
          if (['shelves', 'safePreamp'].includes(key)) return [key, data.has(key)];
          const value = data.get(key);
          return [key, value === null || value === '' ? NaN : Number(value)];
        }),
      ),
    );
  }
  function position() {
    positionPopup(popup, anchor, { width: 380 });
  }

  function cancel() {
    worker?.terminate();
    worker = null;
  }
  function close(focus = false) {
    cancel();
    popup?.remove();
    popup = null;
    anchor.setAttribute('aria-expanded', 'false');
    if (focus) anchor.focus();
  }
  function status(text: string, error = false) {
    if (!popup) return;
    const el = query('.autoeq-status', popup);
    el.textContent = text;
    el.classList.toggle('error', error);
    position();
  }
  function busy(value: boolean) {
    if (!popup) return;
    popup.setAttribute('aria-busy', String(value));
    query<HTMLFieldSetElement>('fieldset', popup).disabled = value;
    query<HTMLButtonElement>('[type=submit]', popup).disabled = value;
    query<HTMLButtonElement>('[type=submit]', popup).textContent = value
      ? 'Fitting curves…'
      : 'Generate & replace bands';
    query<HTMLButtonElement>('[data-cancel]', popup).textContent = value
      ? 'Cancel fitting'
      : 'Cancel';
  }
  function update() {
    if (!popup || worker) return;
    try {
      const context = getContext();
      query('.autoeq-curves', popup).textContent =
        `${context.source.name} → ${context.target.name}`;
      query('.autoeq-scope', popup).textContent =
        `Replaces all bands for ${context.scope} and enables PEQ. Undo restores the previous settings.`;
      query<HTMLButtonElement>('[type=submit]', popup).disabled = false;
    } catch (error) {
      query('.autoeq-curves', popup).textContent = errorMessage(error);
      query<HTMLButtonElement>('[type=submit]', popup).disabled = true;
    }
    position();
  }
  function toggle() {
    if (popup) {
      close();
      return;
    }
    options = validateAutoEqOptions(getOptions());
    popup = document.createElement('section');
    popup.className = 'settings-popup autoeq-popup';
    popup.id = 'autoeq-menu';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', 'Auto EQ');
    popup.innerHTML = /* HTML */ `<div class="settings-heading">
        <h2>Auto EQ</h2>
        <button type="button" data-close aria-label="Close Auto EQ">×</button>
      </div>
      <p class="autoeq-curves"></p>
      <form>
        <fieldset>
          <div class="settings-pair">
            ${field('maxBands', 'Maximum bands', 1, null)}<label
              >Smoothing<select name="smoothing">
                ${[
                  [0, 'None'],
                  [1 / 12, '1/12 octave'],
                  [1 / 6, '1/6 octave'],
                  [1 / 3, '1/3 octave'],
                  [1 / 2, '1/2 octave'],
                ]
                  .map(
                    ([value, label]) =>
                      `<option value="${value}" ${options.smoothing === value ? 'selected' : ''}>${label}</option>`,
                  )
                  .join('')}
              </select></label
            >
          </div>
          <div class="settings-pair">
            ${field('minHz', 'From', 20, 20000, 1, 'Hz')}${field('maxHz', 'To', 20, 20000, 1, 'Hz')}
          </div>
          <div class="settings-pair">
            ${field('maxBoost', 'Maximum boost', 0, 60, 0.5, 'dB')}${field('maxCut', 'Maximum cut', 0, 60, 0.5, 'dB')}
          </div>
          <details>
            <summary>Filter options</summary>
            <div class="settings-pair">
              ${field('minQ', 'Minimum Q', 0.1, 20, 0.1)}${field('maxQ', 'Maximum Q', 0.1, 20, 0.1)}
            </div>
            ${renderToggle('Allow low / high shelves', { name: 'shelves', checked: options.shelves })}
          </details>
          ${renderToggle('Set safe preamp', { name: 'safePreamp', checked: options.safePreamp })}
        </fieldset>
        <p class="settings-note">
          Uses current curve alignment and offsets. Safe preamp adds headroom after fitting;
          otherwise preamp is set to 0 dB.
        </p>
        <p class="autoeq-scope"></p>
        <p class="autoeq-status" role="status"></p>
        <div class="autoeq-actions">
          <button type="button" data-cancel>Cancel</button
          ><button type="submit" class="primary">Generate & replace bands</button>
        </div>
      </form>`;
    document.body.append(popup);
    anchor.setAttribute('aria-expanded', 'true');
    update();
    query<HTMLInputElement>('input', popup).focus();
    query<HTMLButtonElement>('[data-close]', popup).onclick = () => close(true);
    query<HTMLButtonElement>('[data-cancel]', popup).onclick = () => close(true);
    popup.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    });
    query('details', popup).addEventListener('toggle', position);
    const form = query<HTMLFormElement>('form', popup);
    const remember = () => {
      if (worker) return;
      try {
        options = readOptions(form);
        onOptionsChange(options);
      } catch {
        /* Keep the last valid options while a field is incomplete. */
      }
    };
    form.addEventListener('input', remember);
    form.addEventListener('change', remember);
    query<HTMLFormElement>('form', popup).addEventListener('submit', (event) => {
      event.preventDefault();
      if (worker) return;
      let context: AutoEqContext;
      try {
        options = readOptions(form);
        onOptionsChange(options);
        context = getContext();
        worker = new Worker(new URL('./autoeq-worker.ts', import.meta.url), { type: 'module' });
        busy(true);
        status('Fitting the aligned source to the target…');
        worker.onmessage = ({ data }: MessageEvent<AutoEqMessage>) => {
          if (data.type === 'progress') {
            status(`Fitting band ${data.bands} · error ${data.rmse.toFixed(2)} dB`);
            return;
          }
          cancel();
          busy(false);
          if (data.type === 'error') {
            status(data.message, true);
            return;
          }
          try {
            onApply(data.result, context);
            close(true);
          } catch (error) {
            status(errorMessage(error), true);
          }
        };
        worker.onerror = (event) => {
          event.preventDefault();
          cancel();
          busy(false);
          status('Auto EQ could not finish. Please try again.', true);
        };
        worker.postMessage({
          source: context.source,
          target: context.target,
          display: context.display,
          sampleRate: context.sampleRate,
          options,
        });
      } catch (error) {
        cancel();
        busy(false);
        status(errorMessage(error), true);
      }
    });
  }
  installPopupEvents(
    anchor,
    () => popup,
    () => close(),
    position,
    () => !worker,
  );
  anchor.setAttribute('aria-haspopup', 'dialog');
  anchor.setAttribute('aria-controls', 'autoeq-menu');
  anchor.setAttribute('aria-expanded', 'false');
  return { toggle, close, update };
}
