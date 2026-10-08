import type { Workspace, Channel, Layers, Point, CurveReading, Filter } from '../types.ts';
import { query as $ } from '../dom.ts';
import { clamp, formatFrequency as fmt, signed } from '../utils.ts';
import { FREQUENCIES, bandColor } from '../model.ts';
import { findCurve } from '../curve-library.ts';
import { displayedCurves } from '../curve-export.ts';
import { interpolate } from '../curve-math.ts';
import { getTransferFunction, calculateFilterResponseDb } from '../response.ts';
import { hoverMarkup } from '../chart-hover.ts';
import { getCurveDisplay } from '../curve-level.ts';
import { adjustedWheelValue, qAdjustment } from '../numeric-controls.ts';
import {
  defaultChartView,
  frequencyAt,
  frequencyPosition,
  panFrequency,
  zoomFrequency,
  type FrequencyWindow,
} from '../chart-view.ts';
interface ChartOptions {
  getState: () => Workspace;
  getChannel: () => Channel;
  getSelected: () => number;
  getLayers: () => Layers;
  onViewChange: (window: FrequencyWindow) => void;
  onSelect: (index: number) => void;
  onBegin: () => void;
  onChange: () => void;
  onEnd: () => void;
  onAdd: (_hz: number, db: number) => void;
  onCommit: (index: number, mutate: (filter: Filter) => void) => void;
}
export function createChart({
  getState,
  getChannel: current,
  getSelected,
  getLayers,
  onViewChange,
  onSelect,
  onBegin,
  onChange,
  onEnd,
  onAdd,
  onCommit,
}: ChartOptions) {
  const bounds = { l: 54, r: 1175, t: 12, b: 447 };
  const xOf = (hz: number) =>
    bounds.l + frequencyPosition(getState().chartView, hz) * (bounds.r - bounds.l);
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
    // Use CSS-pixel coordinates so labels, strokes, and handles keep their size
    // when the graph gets wider or taller.
    const width = svg.clientWidth || 1200;
    const height = svg.clientHeight || 490;
    bounds.r = Math.max(bounds.l + 40, width - 25);
    bounds.b = Math.max(bounds.t + 40, height - 43);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const state = getState(),
      selected = getSelected(),
      layers = getLayers();
    const c = current();
    const targetItem = findCurve(state, 'target'),
      sourceItem = findCurve(state, 'source');
    const target = targetItem?.points ? { ...targetItem, points: targetItem.points } : null,
      source = sourceItem?.points ? { ...sourceItem, points: sourceItem.points } : null;
    const display = getCurveDisplay(state),
      compensated = display.compensated,
      range = display.rangeDb;
    const { targetShift, sourceShift, targetValue, sourceValue, offset, filteredValue } =
      displayedCurves(source, target, display);
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
    const frequencies = Array.from({ length: 512 }, (_, i) =>
      frequencyAt(state.chartView, i / 511),
    );
    const curve = (fn: (hz: number, index: number) => number) =>
      frequencies
        .map((hz, i) => `${i ? 'L' : 'M'}${xOf(hz).toFixed(2)},${yOf(fn(hz, i)).toFixed(2)}`)
        .join(' ');
    const sampling = { samplingFrequencyHz: state.sampleRate };
    const transfers = c.filters
      .filter((f) => f.enabled)
      .map((f) => getTransferFunction(f.type, f.fcHz, f.gainDb, f.q, sampling));
    // Preview the configured EQ independently of the playback switches.
    const combinedAt = (hz: number) =>
      transfers.reduce((sum, tf) => sum + calculateFilterResponseDb(tf, hz, sampling), c.preampDb);
    const combined = frequencies.map(combinedAt);
    let html = `<defs><clipPath id="plot-clip"><rect x="${bounds.l}" y="${bounds.t}" width="${bounds.r - bounds.l}" height="${bounds.b - bounds.t}"/></clipPath></defs>`;
    const major = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const decades = [100, 1000, 10000];
    const inView = (hz: number) =>
      hz >= state.chartView.minHz - 0.001 && hz <= state.chartView.maxHz + 0.001;
    const grid = [
      20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 2000, 3000,
      4000, 5000, 6000, 7000, 8000, 9000, 10000, 20000,
    ].filter(inView);
    // Add useful labels at closer zoom levels, keeping adjacent labels apart.
    const labels = new Set(major.filter(inView));
    if (state.chartView.maxHz / state.chartView.minHz < 100) {
      const step =
        10 ** Math.floor(Math.log10((state.chartView.maxHz - state.chartView.minHz) / 8));
      for (
        let hz = Math.ceil(state.chartView.minHz / step) * step;
        hz <= state.chartView.maxHz;
        hz += step
      ) {
        if ([...labels].every((other) => Math.abs(xOf(hz) - xOf(other)) > 80)) {
          labels.add(hz);
          if (!grid.includes(hz)) grid.push(hz);
        }
      }
    }
    for (const hz of grid)
      html += /* HTML */ `<line
        x1="${xOf(hz)}"
        y1="${bounds.t}"
        x2="${xOf(hz)}"
        y2="${bounds.b}"
        class="grid ${major.includes(hz) ? 'major' : ''} ${decades.includes(hz) ? 'decade' : ''}"
      />`;
    const step = axisMax - axisMin <= 30 ? 5 : axisMax - axisMin > 100 ? 20 : 10;
    for (let db = Math.ceil(axisMin / step) * step; db <= axisMax; db += step)
      html += /* HTML */ `<line
          x1="${bounds.l}"
          x2="${bounds.r}"
          y1="${yOf(db)}"
          y2="${yOf(db)}"
          class="${db === 0 ? 'zero-line' : 'grid major'}"
        /><text x="42" y="${yOf(db) + 4}" text-anchor="end" class="axis"
          >${db > 0 ? '+' : ''}${db}</text
        >`;
    for (const hz of [...labels].sort((a, b) => a - b))
      html += /* HTML */ `<text
        x="${xOf(hz)}"
        y="${bounds.b + 28}"
        text-anchor="middle"
        class="axis ${decades.includes(hz) ? 'decade' : ''}"
        >${state.chartView.maxHz / state.chartView.minHz < 10 ? String(Math.round(hz)) : fmt(hz)}</text
      >`;
    html += '<g clip-path="url(#plot-clip)">';
    if (layers.bands)
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
    if (layers.filtered && source)
      html += /* HTML */ `<path
        class="response-path filtered-path"
        data-curve-layer="filtered"
        d="${curve((hz, i) => filteredValue(hz, combined[i], c.preampDb, true))}"
      />`;
    c.filters.forEach((f, i) => {
      if (f.enabled && inView(f.fcHz))
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
    hoverReadings = (hz) => {
      const total = combinedAt(hz);
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
          db: filteredValue(hz, total, c.preampDb, true),
        });
      const f = c.filters[selected];
      if (layers.bands && f?.enabled)
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
    const peak = Math.max(...FREQUENCIES.map(combinedAt));
    $('#peak-status').textContent =
      peak > 0.05 ? `Peak ${signed(peak)} dB · consider Safe gain` : `Peak ${signed(peak)} dB`;
    $('#peak-status').className = peak > 0.05 ? 'warning' : '';
    const full = state.chartView.maxHz / state.chartView.minHz >= 999.99;
    $('#chart').classList.toggle('zoomed', !full);
    $<HTMLButtonElement>('[data-action="zoom-frequency-out"]').disabled = full;
    $<HTMLButtonElement>('[data-action="reset-frequency"]').disabled = full;
    $<HTMLButtonElement>('[data-action="zoom-frequency-in"]').disabled =
      state.chartView.maxHz / state.chartView.minHz <= 2 ** (1 / 6) + 0.00001;
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
      hz: frequencyAt(
        getState().chartView,
        clamp((point.x - bounds.l) / (bounds.r - bounds.l), 0, 1),
      ),
      db: axisMax - ((point.y - bounds.t) / (bounds.b - bounds.t)) * (axisMax - axisMin),
    };
  }
  const svg = $<SVGSVGElement>('#chart');
  new ResizeObserver(() => {
    hoverPoint = null;
    draw();
  }).observe(svg);
  let drag: { id: number; index: number } | null = null;
  let panDrag: { id: number; x: number; view: FrequencyWindow; moved: boolean } | null = null;
  let lastPan = 0;
  function setWindow(window: FrequencyWindow) {
    onViewChange(window);
    hoverPoint = null;
    draw();
  }
  function zoom(factor: number, anchor = 0.5) {
    setWindow(zoomFrequency(getState().chartView, factor, anchor));
  }
  const pointIndex = (event: Event) =>
    event.target instanceof Element
      ? event.target.closest<SVGGElement>('[data-point]')?.dataset.point
      : undefined;
  svg.addEventListener('dblclick', (event) => {
    if (pointIndex(event) !== undefined || Date.now() - lastPan < 300) return;
    const p = position(event);
    if (p.x < bounds.l || p.x > bounds.r || p.y < bounds.t || p.y > bounds.b) return;
    const v = values(p);
    onAdd(v.hz, v.db);
  });
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const index = pointIndex(event);
    if (index === undefined) {
      const p = position(event);
      if (
        p.x < bounds.l ||
        p.x > bounds.r ||
        p.y < bounds.t ||
        p.y > bounds.b ||
        !svg.classList.contains('zoomed')
      )
        return;
      event.preventDefault();
      panDrag = { id: event.pointerId, x: p.x, view: { ...getState().chartView }, moved: false };
      svg.setPointerCapture(event.pointerId);
      return;
    }
    event.preventDefault();
    onSelect(+index);
    onBegin();
    drag = { id: event.pointerId, index: +index };
    svg.setPointerCapture(event.pointerId);
    draw();
  });
  svg.addEventListener('pointermove', (event) => {
    const p = position(event);
    if (panDrag?.id === event.pointerId) {
      if (Math.abs(p.x - panDrag.x) > 4) panDrag.moved = true;
      if (panDrag.moved) {
        svg.classList.add('panning');
        setWindow(panFrequency(panDrag.view, (panDrag.x - p.x) / (bounds.r - bounds.l)));
      }
      return;
    }
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
  function endDrag(event: PointerEvent) {
    if (panDrag?.id === event.pointerId) {
      if (panDrag.moved) lastPan = Date.now();
      if (event.type === 'pointercancel') setWindow(panDrag.view);
      panDrag = null;
      svg.classList.remove('panning');
    }
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (!drag) return;
    drag = null;
    onEnd();
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('lostpointercapture', endDrag);
  svg.addEventListener('pointerleave', clearHover);
  window.addEventListener('blur', clearHover);
  svg.addEventListener(
    'wheel',
    (event) => {
      const index = pointIndex(event);
      if (index === undefined && event.shiftKey && !drag && !panDrag) {
        const p = position(event);
        if (p.x < bounds.l || p.x > bounds.r || p.y < bounds.t || p.y > bounds.b) return;
        event.preventDefault();
        const delta = event.deltaY || event.deltaX;
        zoom(delta < 0 ? 1.25 : 0.8, (p.x - bounds.l) / (bounds.r - bounds.l));
        return;
      }
      if (index === undefined || event.deltaY === 0) return;
      event.preventDefault();
      onCommit(+index, (filter) => {
        filter.q = adjustedWheelValue(filter.q, event, qAdjustment);
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
  return {
    draw,
    zoom,
    resetZoom: () => {
      const { minHz, maxHz } = defaultChartView();
      setWindow({ minHz, maxHz });
    },
  };
}
