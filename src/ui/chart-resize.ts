import { query } from '../dom.ts';
import { clamp } from '../utils.ts';
import { CHART_MIN_HEIGHT, CHART_MAX_HEIGHT } from '../chart-view.ts';

export function installChartResize({
  getHeight,
  onChange,
  onEnd,
}: {
  getHeight: () => number | null;
  onChange: (height: number | null) => void;
  onEnd: () => void;
}) {
  const editor = query('.editor');
  const graph = query('.graph-area');
  const handle = query('#chart-resize');
  let drag: { id: number; y: number; height: number; previous: number | null } | null = null;
  function update() {
    const height = getHeight();
    editor.classList.toggle('custom-chart-height', height !== null);
    editor.style.setProperty(
      '--chart-height',
      `${height ?? graph.getBoundingClientRect().height}px`,
    );
    handle.setAttribute(
      'aria-valuenow',
      String(Math.round(height ?? graph.getBoundingClientRect().height)),
    );
    handle.setAttribute(
      'aria-valuetext',
      height === null ? 'Automatic height' : `${Math.round(height)} pixels`,
    );
  }
  function setHeight(height: number | null) {
    onChange(
      height === null ? null : clamp(Math.round(height), CHART_MIN_HEIGHT, CHART_MAX_HEIGHT),
    );
    update();
    const panel = query('.band-panel');
    if (height === null && panel.classList.contains('expanded')) {
      panel.classList.remove('expanded');
      editor.style.setProperty(
        '--expanded-graph-height',
        `${graph.getBoundingClientRect().height}px`,
      );
      panel.classList.add('expanded');
    }
  }
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    drag = {
      id: event.pointerId,
      y: event.clientY,
      height: graph.getBoundingClientRect().height,
      previous: getHeight(),
    };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (event) => {
    if (drag?.id === event.pointerId) setHeight(drag.height + event.clientY - drag.y);
  });
  function finish(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    if (event.type === 'pointercancel') setHeight(drag.previous);
    drag = null;
    handle.classList.remove('dragging');
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    onEnd();
  }
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);
  handle.addEventListener('dblclick', () => {
    setHeight(null);
    onEnd();
  });
  handle.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault();
    setHeight(
      event.key === 'Home'
        ? null
        : (getHeight() ?? graph.getBoundingClientRect().height) +
            (event.key === 'ArrowUp' ? -1 : 1) * (event.shiftKey ? 50 : 10),
    );
    onEnd();
  });
  update();
  return { update };
}
