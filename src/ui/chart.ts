import type { Workspace, Preset, Channel, Layers, Point, CurveReading, Filter } from '../types.ts';
import { query as $ } from '../dom.ts';
import { clamp, formatFrequency as fmt, signed } from '../utils.ts';
import { FREQUENCIES, bandColor } from '../model.ts';
import { findCurve } from '../curve-library.ts';
import { curveShift } from '../curve-level.ts';
import { interpolate } from '../curve-math.ts';
import { getTransferFunction, calculateFilterResponseDb } from '../response.ts';
import { hoverMarkup } from '../chart-hover.ts';
interface ChartOptions {
  getState: () => Workspace;
  getPreset: () => Preset;
  getChannel: () => Channel;
  getSelected: () => number;
  getLayers: () => Layers;
  onSelect: (index: number) => void;
  onBegin: () => void;
  onChange: () => void;
  onEnd: () => void;
  onAdd: (_hz: number, db: number) => void;
  onCommit: (index: number, mutate: (filter: Filter) => void) => void;
}
export function createChart({
  getState,
  getPreset: preset,
  getChannel: current,
  getSelected,
  getLayers,
  onSelect,
  onBegin,
  onChange,
  onEnd,
  onAdd,
  onCommit,
}: ChartOptions) {
  const bounds = { l: 54, r: 1175, t: 24, b: 447 };
  const xOf = (hz: number) => bounds.l + (Math.log10(hz / 20) / 3) * (bounds.r - bounds.l);
  let axisMin = -25,
    axisMax = 25;
  const yOf = (db: number) =>
    bounds.t + ((axisMax - db) / (axisMax - axisMin)) * (bounds.b - bounds.t);
  let hoverPoint: Point | null = null,
    hoverFrame = 0,
    hoverReadings: (hz: number) => CurveReading[] = () => [];
  function drawHover() {
    const overlay = $('#chart-hover');
    if (!overlay) return;
    overlay.innerHTML = hoverPoint
      ? hoverMarkup({
          point: hoverPoint,
          ...values(hoverPoint),
          readings: hoverReadings(values(hoverPoint).hz),
          bounds,
          yOf,
        })
      : '';
  }
  function clearHover() {
    hoverPoint = null;
    drawHover();
  }
  function draw() {
    const svg = $<SVGSVGElement>('#chart');
    // Match the plot to its available space without stretching text or band handles.
    const width = svg.clientWidth;
    const height = width > 0 ? (svg.clientHeight / width) * 1200 : 490;
    bounds.b = Math.max(bounds.t + 40, height - 43);
    svg.setAttribute('viewBox', `0 0 1200 ${height}`);
    const state = getState(),
      selected = getSelected(),
      layers = getLayers();
    const c = current(),
      enabled = preset().enabled;
    const targetItem = findCurve(state, 'target'),
      sourceItem = findCurve(state, 'source');
    const target = targetItem?.points ? { ...targetItem, points: targetItem.points } : null,
      source = sourceItem?.points ? { ...sourceItem, points: sourceItem.points } : null;
    const display = state.curveDisplay,
      compensated = display.compensated,
      range = display.rangeDb;
    const targetShift = curveShift(target, 'target', display),
      sourceShift = curveShift(source, 'source', display);
    const targetValue = (hz: number) => (target ? interpolate(target.points, hz) + targetShift : 0);
    const sourceValue = (hz: number) => (source ? interpolate(source.points, hz) + sourceShift : 0);
    const reference = display.method === 'none' ? 0 : display.referenceDb;
    axisMin = Math.min(-range, compensated ? -range : reference - range);
    axisMax = Math.max(range, compensated ? range : reference + range);
    if (display.method === 'none' && !compensated)
      for (const [item, shift] of [
        [target, targetShift],
        [source, sourceShift],
      ] as const)
        if (item) {
          const center = interpolate(item.points, 1000) + shift;
          axisMin = Math.min(axisMin, center - range);
          axisMax = Math.max(axisMax, center + range);
        }
    const curve = (fn: (hz: number, index: number) => number) =>
      FREQUENCIES.map(
        (hz, i) => `${i ? 'L' : 'M'}${xOf(hz).toFixed(2)},${yOf(fn(hz, i)).toFixed(2)}`,
      ).join(' ');
    const offset = (hz: number) => (compensated && target ? targetValue(hz) : 0);
    const sampling = { samplingFrequencyHz: state.sampleRate };
    const transfers = enabled
      ? c.filters
          .filter((f) => f.enabled)
          .map((f) => getTransferFunction(f.type, f.fcHz, f.gainDb, f.q, sampling))
      : [];
    const combined = FREQUENCIES.map((hz) =>
      enabled
        ? transfers.reduce(
            (sum, tf) => sum + calculateFilterResponseDb(tf, hz, sampling),
            c.preampDb,
          )
        : 0,
    );
    let html = `<defs><clipPath id="plot-clip"><rect x="${bounds.l}" y="${bounds.t}" width="${bounds.r - bounds.l}" height="${bounds.b - bounds.t}"/></clipPath></defs>`;
    const major = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const decades = [100, 1000, 10000];
    for (const hz of [
      20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000,
      4000, 5000, 6000, 7000, 8000, 9000, 10000, 20000,
    ])
      html += /* HTML */ `<line
        x1="${xOf(hz)}"
        y1="24"
        x2="${xOf(hz)}"
        y2="${bounds.b}"
        class="grid ${major.includes(hz) ? 'major' : ''} ${decades.includes(hz) ? 'decade' : ''}"
      />`;
    const step = axisMax - axisMin <= 30 ? 5 : axisMax - axisMin > 100 ? 20 : 10;
    for (let db = Math.ceil(axisMin / step) * step; db <= axisMax; db += step)
      html += /* HTML */ `<line
          x1="54"
          x2="1175"
          y1="${yOf(db)}"
          y2="${yOf(db)}"
          class="${db === 0 ? 'zero-line' : 'grid major'}"
        /><text x="42" y="${yOf(db) + 4}" text-anchor="end" class="axis"
          >${db > 0 ? '+' : ''}${db}</text
        >`;
    for (const hz of major)
      html += /* HTML */ `<text
        x="${xOf(hz)}"
        y="${bounds.b + 28}"
        text-anchor="middle"
        class="axis ${decades.includes(hz) ? 'decade' : ''}"
        >${fmt(hz)}</text
      >`;
    html += '<g clip-path="url(#plot-clip)">';
    if (layers.bands && enabled)
      c.filters.forEach((f, i) => {
        if (f.enabled) {
          const tf = getTransferFunction(f.type, f.fcHz, f.gainDb, f.q, {
            samplingFrequencyHz: state.sampleRate,
          });
          html += /* HTML */ `<path
            data-curve-layer="bands"
            d="${curve((hz) => calculateFilterResponseDb(tf, hz, { samplingFrequencyHz: state.sampleRate }))}"
            fill="none"
            stroke="${bandColor(i)}"
            stroke-opacity=".45"
            stroke-width="1.3"
          />`;
        }
      });
    if (layers.target && target)
      html += /* HTML */ `<path
        class="response-path target-path"
        data-curve-layer="target"
        d="${curve((hz) => targetValue(hz) - offset(hz))}"
      />`;
    if (layers.source && source)
      html += /* HTML */ `<path
        class="response-path source-path"
        data-curve-layer="source"
        d="${curve((hz) => sourceValue(hz) - offset(hz))}"
      />`;
    if (layers.combined)
      html += /* HTML */ `<path
        class="response-path combined-path"
        data-curve-layer="combined"
        d="${curve((_hz, i) => combined[i])}"
      />`;
    const filteredPreampAdjustment = enabled && !display.includePreamp ? c.preampDb : 0;
    if (layers.filtered && source)
      html += /* HTML */ `<path
        class="response-path filtered-path"
        data-curve-layer="filtered"
        d="${curve((hz, i) => sourceValue(hz) + combined[i] - filteredPreampAdjustment - offset(hz))}"
      />`;
    c.filters.forEach((f, i) => {
      if (f.enabled)
        html += /* HTML */ `<g
          data-point="${i}"
          class="control-point"
          role="button"
          tabindex="0"
          aria-label="Band ${i + 1}: ${Math.round(f.fcHz)} Hz, ${signed(f.gainDb)} dB. Arrow keys adjust; Shift makes larger steps."
          ><circle cx="${xOf(f.fcHz)}" cy="${yOf(f.gainDb)}" r="17" fill="transparent" /><circle
            class="point-hover-ring"
            cx="${xOf(f.fcHz)}"
            cy="${yOf(f.gainDb)}"
            r="14"
            fill="${bandColor(i)}"
            fill-opacity=".12"
            stroke="${bandColor(i)}"
            stroke-width="1.5"
            pointer-events="none"
          /><circle
            class="point-dot"
            cx="${xOf(f.fcHz)}"
            cy="${yOf(f.gainDb)}"
            r="${i === selected ? 7 : 5.5}"
            fill="${bandColor(i)}"
            stroke="#f8fafc"
            stroke-width="2"
          />${i === selected ? /* HTML */ `<circle cx="${xOf(f.fcHz)}" cy="${yOf(f.gainDb)}" r="12" stroke="${bandColor(i)}" stroke-opacity=".45" fill="none" />` : ''}</g
        >`;
    });
    html += '</g>';
    if (!enabled)
      html += '<text x="614" y="55" text-anchor="middle" class="bypass-label">PEQ BYPASSED</text>';
    hoverReadings = (hz) => {
      const total = enabled
        ? transfers.reduce(
            (sum, tf) => sum + calculateFilterResponseDb(tf, hz, sampling),
            c.preampDb,
          )
        : 0;
      const readings: CurveReading[] = [];
      if (layers.target && target)
        readings.push({ name: 'Target', color: '#548eff', db: targetValue(hz) - offset(hz) });
      if (layers.source && source)
        readings.push({ name: 'Source', color: '#dc6576', db: sourceValue(hz) - offset(hz) });
      if (layers.combined) readings.push({ name: 'Combined', color: '#f5a338', db: total });
      if (layers.filtered && source)
        readings.push({
          name: 'Filtered',
          color: '#40c6b9',
          db: sourceValue(hz) + total - filteredPreampAdjustment - offset(hz),
        });
      const f = c.filters[selected];
      if (layers.bands && enabled && f?.enabled)
        readings.push({
          name: `Band ${selected + 1}`,
          color: bandColor(selected),
          db: calculateFilterResponseDb(
            getTransferFunction(f.type, f.fcHz, f.gainDb, f.q, sampling),
            hz,
            sampling,
          ),
        });
      return readings;
    };
    $<SVGSVGElement>('#chart').innerHTML =
      html + '<g id="chart-hover" aria-hidden="true" pointer-events="none"></g>';
    drawHover();
    const peak = Math.max(...combined);
    $('#peak-status').textContent =
      peak > 0.05
        ? `Peak ${signed(peak)} dB · consider Safe gain`
        : `${enabled ? 'Peak' : 'Bypass'} ${signed(peak)} dB`;
    $('#peak-status').className = peak > 0.05 ? 'warning' : '';
  }

  function position(event: MouseEvent): Point {
    const svg = $<SVGSVGElement>('#chart'),
      point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM()!.inverse());
  }
  function values(point: Point) {
    return {
      hz: 20 * 1000 ** clamp((point.x - bounds.l) / (bounds.r - bounds.l), 0, 1),
      db: axisMax - ((point.y - bounds.t) / (bounds.b - bounds.t)) * (axisMax - axisMin),
    };
  }
  const svg = $<SVGSVGElement>('#chart');
  new ResizeObserver(() => {
    hoverPoint = null;
    draw();
  }).observe(svg);
  let drag: { id: number; index: number } | null = null;
  const pointIndex = (event: Event) =>
    event.target instanceof Element
      ? event.target.closest<SVGGElement>('[data-point]')?.dataset.point
      : undefined;
  svg.addEventListener('dblclick', (event) => {
    if (pointIndex(event) !== undefined) return;
    const p = position(event);
    if (p.x < bounds.l || p.x > bounds.r || p.y < bounds.t || p.y > bounds.b) return;
    const v = values(p);
    onAdd(v.hz, v.db);
  });
  svg.addEventListener('pointerdown', (event) => {
    const index = pointIndex(event);
    if (index === undefined) return;
    event.preventDefault();
    onSelect(+index);
    onBegin();
    drag = { id: event.pointerId, index: +index };
    svg.setPointerCapture(event.pointerId);
    draw();
  });
  svg.addEventListener('pointermove', (event) => {
    const p = position(event);
    hoverPoint =
      event.pointerType !== 'touch' &&
      p.x >= bounds.l &&
      p.x <= bounds.r &&
      p.y >= bounds.t &&
      p.y <= bounds.b
        ? p
        : null;
    if (drag && drag.id === event.pointerId) {
      const value = values(p),
        filter = current().filters[drag.index];
      filter.fcHz = Math.round(value.hz);
      if (!['LP', 'HP'].includes(filter.type)) filter.gainDb = +value.db.toFixed(1);
      onChange();
      draw();
    } else if (!hoverFrame)
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        drawHover();
      });
  });
  function endDrag() {
    if (!drag) return;
    drag = null;
    onEnd();
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('pointerleave', clearHover);
  window.addEventListener('blur', clearHover);
  svg.addEventListener(
    'wheel',
    (event) => {
      const index = pointIndex(event);
      if (index === undefined) return;
      event.preventDefault();
      onCommit(+index, (filter) => {
        filter.q = +clamp(filter.q + (event.deltaY < 0 ? 0.05 : -0.05), 0.1, 20).toFixed(2);
      });
    },
    { passive: false },
  );
  svg.addEventListener('keydown', (event) => {
    const index = pointIndex(event);
    if (
      index === undefined ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    )
      return;
    event.preventDefault();
    onCommit(+index, (filter) => {
      const step = event.shiftKey ? 1 : 0.1;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (!['LP', 'HP'].includes(filter.type))
          filter.gainDb = +(filter.gainDb + (event.key === 'ArrowUp' ? step : -step)).toFixed(1);
      } else
        filter.fcHz = Math.round(
          clamp(
            filter.fcHz *
              (event.key === 'ArrowRight'
                ? event.shiftKey
                  ? 1.1
                  : 1.01
                : event.shiftKey
                  ? 1 / 1.1
                  : 1 / 1.01),
            20,
            20000,
          ),
        );
    });
    svg.querySelector<SVGGElement>(`[data-point="${index}"]`)?.focus();
  });
  return { draw };
}
