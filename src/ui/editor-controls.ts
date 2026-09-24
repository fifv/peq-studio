import type { Channel, CurveDisplay, Filter, NumericSpec, Workspace } from '../types.ts';
import { installNumericControls } from '../numeric-controls.ts';
import { clamp, formatFrequency, signed } from '../utils.ts';

type FilterProperty = Extract<keyof Filter, 'fcHz' | 'gainDb' | 'q'>;
type DisplayProperty = Extract<
  keyof CurveDisplay,
  'targetOffsetDb' | 'sourceOffsetDb' | 'referenceDb' | 'minHz' | 'maxHz'
>;
type Field<P> = { property: P; min: number; max: number; step: number; log?: boolean };
type EditorControl = NumericSpec & { name: string } & (
    | { kind: 'preamp' }
    | { kind: 'display'; property: DisplayProperty }
    | { kind: 'filter'; property: FilterProperty; index: number }
  );

const filterFields: Record<string, Field<FilterProperty>> = {
  frequency: { property: 'fcHz', min: 20, max: 20000, step: 1, log: true },
  gain: { property: 'gainDb', min: -Infinity, max: Infinity, step: 0.1 },
  q: { property: 'q', min: 0.1, max: 20, step: 0.05 },
};
const displayFields: Record<string, Field<DisplayProperty>> = {
  'target-offset': { property: 'targetOffsetDb', min: -120, max: 120, step: 0.1 },
  'source-offset': { property: 'sourceOffsetDb', min: -120, max: 120, step: 0.1 },
  'reference-level': { property: 'referenceDb', min: -60, max: 120, step: 0.1 },
  'level-min': { property: 'minHz', min: 20, max: 19999, step: 1, log: true },
  'level-max': { property: 'maxHz', min: 21, max: 20000, step: 1, log: true },
};

interface EditorControlsOptions {
  getState: () => Workspace;
  getChannel: () => Channel;
  getSelected: () => number;
  onSelect: (index: number) => void;
  onBegin: () => void;
  onChange: () => void;
  onEnd: () => void;
  onRefresh: () => void;
}

/** The same field definitions drive typing, dragging, wheel and keyboard editing. */
export function createEditorControls({
  getState,
  getChannel,
  getSelected,
  onSelect,
  onBegin,
  onChange,
  onEnd,
  onRefresh,
}: EditorControlsOptions) {
  let typingKey: string | null = null;

  function resolve(element: HTMLElement): EditorControl | null {
    const name = element.dataset.adjust;
    if (!name) return null;
    const base = { name, key: name, element };
    if (name === 'preamp')
      return {
        ...base,
        kind: 'preamp',
        value: getChannel().preampDb,
        min: -Infinity,
        max: Infinity,
        step: 0.1,
      };
    const displayField = displayFields[name];
    if (displayField) {
      const display = getState().curveDisplay;
      return {
        ...base,
        ...displayField,
        kind: 'display',
        value: display[displayField.property],
        min: name === 'level-max' ? display.minHz + 1 : displayField.min,
        max: name === 'level-min' ? display.maxHz - 1 : displayField.max,
      };
    }
    const index =
      element.dataset.bandIndex === undefined ? getSelected() : Number(element.dataset.bandIndex);
    const filter = getChannel().filters[index];
    const field = filterFields[name];
    if (!filter || !field || (name === 'gain' && ['LP', 'HP'].includes(filter.type))) return null;
    return {
      ...base,
      ...field,
      kind: 'filter',
      key: `${name}:${index}`,
      index,
      value: filter[field.property],
    };
  }

  function refresh(typingElement: HTMLInputElement | null = null) {
    document.querySelectorAll<HTMLElement>('[data-adjust]').forEach((element) => {
      const control = resolve(element);
      if (!control) return;
      if (element instanceof HTMLInputElement) {
        if (element.type === 'range') {
          element.min = String(Math.min(-24, control.value));
          element.max = String(Math.max(12, control.value));
        }
        if (element !== typingElement) element.value = String(+control.value.toFixed(4));
      } else {
        const label = element.querySelector('.number-value');
        if (!label) return;
        label.textContent =
          control.name === 'frequency'
            ? formatFrequency(control.value)
            : control.name === 'gain'
              ? signed(control.value)
              : String(+control.value.toFixed(2));
        label.classList.toggle('negative', control.name === 'gain' && control.value < 0);
      }
    });
    document
      .querySelectorAll('.band-card')
      .forEach((element, index) => element.classList.toggle('selected', index === getSelected()));
    onRefresh();
  }

  function apply(
    control: EditorControl,
    value: number,
    typingElement: HTMLInputElement | null = null,
  ) {
    value = clamp(value, control.min, control.max);
    switch (control.kind) {
      case 'preamp':
        getChannel().preampDb = value;
        break;
      case 'display':
        getState().curveDisplay[control.property] = value;
        break;
      case 'filter':
        getChannel().filters[control.index][control.property] = value;
        if (getSelected() !== control.index) onSelect(control.index);
        break;
    }
    onChange();
    refresh(typingElement);
  }

  installNumericControls({
    getControl: resolve,
    onBegin: () => {
      typingKey = null;
      onBegin();
    },
    onChange: apply,
    onEnd,
  });
  document.addEventListener('input', (event) => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement) || !element.matches('[data-adjust]')) return;
    const control = resolve(element);
    const value = Number(element.value);
    if (!control || element.value === '' || !Number.isFinite(value)) return;
    if (typingKey !== control.key) {
      onBegin();
      typingKey = control.key;
    }
    apply(control, value, element);
    onEnd();
  });
  document.addEventListener('focusout', (event) => {
    if (event.target instanceof HTMLElement && resolve(event.target)?.key === typingKey) {
      typingKey = null;
      refresh();
    }
  });
  document.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement && resolve(event.target)) {
      refresh();
      onEnd();
    }
  });
  return { refresh };
}
