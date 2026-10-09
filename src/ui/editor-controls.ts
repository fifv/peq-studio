import type { Channel, CurveDisplay, Filter, NumericSpec, Workspace } from '../types.ts';
import { installNumericControls, qAdjustment } from '../numeric-controls.ts';
import { activePreset, clamp, formatFrequency, signed } from '../utils.ts';
import { defaultCurveDisplay } from '../curve-level.ts';
import { newBand } from '../model.ts';
import { adjustBands } from '../band-selection.ts';

type FilterProperty = Extract<keyof Filter, 'fcHz' | 'gainDb' | 'q'>;
type DisplayProperty = Extract<
  keyof CurveDisplay,
  'targetOffsetDb' | 'sourceOffsetDb' | 'referenceDb' | 'alignmentHz' | 'minHz' | 'maxHz'
>;
type Field<P> = { property: P } & Pick<
  NumericSpec,
  'min' | 'max' | 'step' | 'log' | 'precision' | 'wheelRatio'
>;
type EditorControl = NumericSpec & { name: string } & (
    | { kind: 'preamp' }
    | { kind: 'display'; property: DisplayProperty }
    | { kind: 'filter'; property: FilterProperty; index: number }
    | { kind: 'group'; property: FilterProperty; indices: number[] }
  );

const filterFields: Record<string, Field<FilterProperty>> = {
  frequency: { property: 'fcHz', min: 20, max: 20000, step: 1, log: true },
  gain: { property: 'gainDb', min: -Infinity, max: Infinity, step: 0.1 },
  q: { property: 'q', ...qAdjustment },
};
const displayFields: Record<string, Field<DisplayProperty>> = {
  'target-offset': { property: 'targetOffsetDb', min: -120, max: 120, step: 0.1 },
  'source-offset': { property: 'sourceOffsetDb', min: -120, max: 120, step: 0.1 },
  'reference-level': { property: 'referenceDb', min: -60, max: 120, step: 0.1 },
  'alignment-frequency': { property: 'alignmentHz', min: 20, max: 20000, step: 1, log: true },
  'level-min': { property: 'minHz', min: 20, max: 19999, step: 1, log: true },
  'level-max': { property: 'maxHz', min: 21, max: 20000, step: 1, log: true },
};

interface EditorControlsOptions {
  getState: () => Workspace;
  getChannel: () => Channel;
  getSelected: () => number;
  getSelection?: () => number[];
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
  getSelection = () => [getSelected()],
  onSelect,
  onBegin,
  onChange,
  onEnd,
  onRefresh,
}: EditorControlsOptions) {
  let typingKey: string | null = null;
  const groupValues = { fcHz: 1, gainDb: 0, q: 1 };
  let groupFilters: Filter[] | null = null;
  let groupIndices = '';
  let groupDraft: HTMLInputElement | null = null;
  function resetGroup() {
    Object.assign(groupValues, { fcHz: 1, gainDb: 0, q: 1 });
  }
  function finishAdjustment() {
    onEnd();
    resetGroup();
    refresh();
  }

  function resolve(element: HTMLElement): EditorControl | null {
    const name = element.dataset.adjust;
    if (!name) return null;
    const base = { name, key: name, element };
    if (name.startsWith('group-')) {
      const field = filterFields[name.slice(6)];
      if (!field) return null;
      const signature = getSelection().join(',');
      if (groupFilters !== getChannel().filters || groupIndices !== signature) {
        resetGroup();
        groupDraft = null;
        groupFilters = getChannel().filters;
        groupIndices = signature;
      }
      const indices = getSelection().filter((index) => {
        const filter = getChannel().filters[index];
        return filter && (field.property !== 'gainDb' || !['LP', 'HP'].includes(filter.type));
      });
      if (!indices.length) return null;
      const filters = indices.map((index) => getChannel().filters[index]);
      const value = groupValues[field.property];
      return {
        ...base,
        ...field,
        precision: 7,
        kind: 'group',
        property: field.property,
        indices,
        key: `${name}:${indices.join(',')}`,
        value,
        resetValue: field.property === 'gainDb' ? 0 : 1,
        min:
          field.property === 'gainDb'
            ? field.min
            : value * Math.max(...filters.map((f) => field.min / f[field.property])),
        max:
          field.property === 'gainDb'
            ? field.max
            : value * Math.min(...filters.map((f) => field.max / f[field.property])),
      };
    }
    if (name === 'preamp')
      return {
        ...base,
        kind: 'preamp',
        value: getChannel().preampDb,
        resetValue: 0,
        min: -Infinity,
        max: Infinity,
        step: 0.1,
      };
    const displayField = displayFields[name];
    if (displayField) {
      const display = activePreset(getState()).curveAlignment;
      return {
        ...base,
        ...displayField,
        kind: 'display',
        value: display[displayField.property],
        resetValue: defaultCurveDisplay()[displayField.property],
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
      resetValue: newBand()[field.property],
    };
  }

  function refresh(typingElement: HTMLInputElement | null = null) {
    document.querySelectorAll<HTMLElement>('[data-adjust]').forEach((element) => {
      const control = resolve(element);
      if (!control) return;
      if (element instanceof HTMLInputElement) {
        if (element.type === 'range' && !element.hasAttribute('data-dragging-range')) {
          element.min = String(Math.min(-24, control.value));
          element.max = String(Math.max(12, control.value));
        }
        if (element !== typingElement && element !== groupDraft) {
          const displayValue =
            control.kind === 'group' && control.property !== 'gainDb'
              ? (control.value - 1) * 100
              : control.value;
          element.value = String(+displayValue.toFixed(4));
        }
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
      .forEach((element, index) =>
        element.classList.toggle('selected', getSelection().includes(index)),
      );
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
        activePreset(getState()).curveAlignment[control.property] = value;
        break;
      case 'filter':
        getChannel().filters[control.index][control.property] = value;
        if (getSelected() !== control.index) onSelect(control.index);
        break;
      case 'group': {
        const filters = control.indices.map((index) => getChannel().filters[index]);
        const previous = groupValues[control.property];
        adjustBands(
          filters,
          control.property,
          control.property === 'gainDb' ? value - previous : value / previous,
        );
        groupValues[control.property] = value;
        break;
      }
    }
    onChange();
    refresh(typingElement);
  }

  installNumericControls({
    getControl: resolve,
    onBegin: () => {
      typingKey = null;
      groupDraft = null;
      onBegin();
    },
    onChange: apply,
    onEnd: finishAdjustment,
  });
  document.addEventListener('input', (event) => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement) || !element.matches('[data-adjust]')) return;
    const control = resolve(element);
    if (control?.kind === 'group') {
      groupDraft = element;
      return;
    }
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
    if (event.target === groupDraft) {
      applyGroupDraft(groupDraft!);
      return;
    }
    if (event.target instanceof HTMLElement && resolve(event.target)?.key === typingKey) {
      typingKey = null;
      refresh();
    }
  });
  document.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement && resolve(event.target)) {
      if (resolve(event.target)?.kind === 'group') {
        if (event.target === groupDraft) applyGroupDraft(event.target);
        return;
      }
      if (event.target.type === 'range') {
        typingKey = null;
        return;
      }
      refresh();
      onEnd();
    }
  });
  function applyGroupDraft(element: HTMLInputElement) {
    const control = resolve(element);
    const typed = Number(element.value);
    groupDraft = null;
    if (
      control?.kind !== 'group' ||
      element.value === '' ||
      !Number.isFinite(typed) ||
      typed === 0
    ) {
      refresh();
      return;
    }
    onBegin();
    apply(control, control.property === 'gainDb' ? typed : 1 + typed / 100);
    finishAdjustment();
  }
  document.addEventListener('keydown', (event) => {
    if (!(event.target instanceof HTMLInputElement) || resolve(event.target)?.kind !== 'group')
      return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.target === groupDraft) applyGroupDraft(event.target);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      groupDraft = null;
      refresh();
    }
  });
  return { refresh };
}
