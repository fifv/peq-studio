import type { NumericSpec } from './types.ts';
export function adjustedValue(
  start: number,
  steps: number,
  spec: Pick<NumericSpec, 'min' | 'max' | 'step' | 'precision' | 'log'>,
) {
  const raw = spec.log ? start * 1.02 ** steps : start + steps * spec.step;
  const precision = spec.precision ?? (spec.step < 0.1 ? 3 : spec.step < 1 ? 2 : 0);
  return +Math.min(spec.max, Math.max(spec.min, raw)).toFixed(precision);
}

/** Delegated controls survive band-editor rerenders. One undo entry per drag or
 * wheel gesture. Click still opens direct typing; only actual drags eat clicks. */
export function installNumericControls<T extends NumericSpec>({
  getControl,
  onBegin,
  onChange,
  onEnd,
}: {
  getControl: (element: HTMLElement) => T | null;
  onBegin: () => void;
  onChange: (spec: T, value: number) => void;
  onEnd: () => void;
}) {
  let gesture: {
      spec: T;
      id: number;
      startX: number;
      startY: number;
      start: number;
      changed: boolean;
      range: { min: number; max: number; travel: number } | null;
    } | null = null,
    wheel: T | null = null,
    wheelTimer: ReturnType<typeof setTimeout> | undefined,
    suppressClick = false;
  const resolve = (target: EventTarget | null) => {
    const element = target instanceof Element ? target.closest<HTMLElement>('[data-adjust]') : null;
    return element && !element.matches(':disabled') ? getControl(element) : null;
  };
  function finishWheel() {
    if (!wheel) return;
    clearTimeout(wheelTimer);
    wheel = null;
    onEnd();
  }
  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const spec = resolve(event.target);
    if (!spec) return;
    finishWheel();
    const slider =
      spec.element instanceof HTMLInputElement && spec.element.type === 'range'
        ? spec.element
        : null;
    event.preventDefault();
    if (slider) {
      slider.focus();
      slider.dataset.draggingRange = '';
    }
    gesture = {
      spec,
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      start: spec.value,
      changed: false,
      // Use the thumb's travel distance, but anchor movement to the initial value.
      // Pressing anywhere on the track therefore never jumps the gain.
      range: slider
        ? {
            min: Number(slider.min),
            max: Number(slider.max),
            travel: Math.max(1, slider.getBoundingClientRect().height - 16),
          }
        : null,
    };
    spec.element.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', (event) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const distance = gesture.startY - event.clientY;
    if (!gesture.changed) {
      if (gesture.spec.element.closest('[data-horizontal-scroll]')) {
        const horizontal = Math.abs(event.clientX - gesture.startX);
        if (Math.max(horizontal, Math.abs(distance)) < 6) return;
        if (horizontal > Math.abs(distance)) {
          if (gesture.spec.element.hasPointerCapture(event.pointerId))
            gesture.spec.element.releasePointerCapture(event.pointerId);
          gesture = null;
          return;
        }
      } else if (Math.abs(distance) < 3) return;
    }
    event.preventDefault();
    if (!gesture.changed) {
      onBegin();
      gesture.changed = true;
      document.body.classList.add('adjusting-value');
    }
    const steps = (distance / 5) * (event.shiftKey ? 0.1 : 1);
    const { range } = gesture;
    const value = range
      ? adjustedValue(
          gesture.start,
          Math.round((distance * (range.max - range.min)) / range.travel / gesture.spec.step),
          {
            ...gesture.spec,
            min: range.min,
            max: range.max,
          },
        )
      : adjustedValue(gesture.start, steps, gesture.spec);
    onChange(gesture.spec, value);
  });
  function finish(event?: PointerEvent) {
    if (!gesture || (event && gesture.id !== event.pointerId)) return;
    const { spec, changed, id } = gesture;
    gesture = null;
    delete spec.element.dataset.draggingRange;
    document.body.classList.remove('adjusting-value');
    if (spec.element.hasPointerCapture(id)) spec.element.releasePointerCapture(id);
    if (changed) {
      suppressClick = true;
      onEnd();
      setTimeout(() => {
        suppressClick = false;
      }, 0);
    } else if (spec.element.matches('input[type=number]')) {
      spec.element.focus();
      (spec.element as HTMLInputElement).select();
    }
  }
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
  window.addEventListener('blur', () => finish());
  document.addEventListener(
    'click',
    (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClick = false;
        return;
      }
      if (event.detail !== 3) return;
      const spec = resolve(event.target);
      if (!spec) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finishWheel();
      const value = Math.min(spec.max, Math.max(spec.min, spec.resetValue));
      if (value === spec.value) return;
      onBegin();
      onChange(spec, value);
      onEnd();
    },
    true,
  );
  document.addEventListener(
    'wheel',
    (event) => {
      const spec = resolve(event.target);
      if (!spec || event.deltaY === 0) return;
      event.preventDefault();
      if (!wheel || wheel.key !== spec.key) {
        finishWheel();
        onBegin();
        wheel = spec;
      }
      onChange(
        spec,
        adjustedValue(spec.value, (event.deltaY < 0 ? 1 : -1) * (event.shiftKey ? 0.1 : 1), spec),
      );
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(finishWheel, 300);
    },
    { passive: false },
  );
  document.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const spec = resolve(event.target);
    if (!spec) return;
    event.preventDefault();
    finishWheel();
    onBegin();
    onChange(
      spec,
      adjustedValue(
        spec.value,
        (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 0.1 : 1),
        spec,
      ),
    );
    onEnd();
  });
}
