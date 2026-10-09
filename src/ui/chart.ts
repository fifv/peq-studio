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
import { adjustBands, pointsInRectangle } from '../band-selection.ts';
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
  getSelection: () => number[];
  getLayers: () => Layers;
  onViewChange: (window: FrequencyWindow) => void;
  onSelect: (index: number, toggle?: boolean, range?: boolean) => void;
  onSelectMany: (indices: number[]) => void;
  onBegin: () => void;
  onChange: () => void;
  onEnd: () => void;
  onAdd: (_hz: number, db: number) => void;
  onCommit: (index: number, mutate: (filter: Filter) => void) => void;
  onAdjustQ: (indices: number[], event: WheelEvent) => void;
}
export function createChart({
  getState,
  getChannel: current,
  getSelected,
  getSelection,
  getLayers,
  onViewChange,
  onSelect,
  onSelectMany,
  onBegin,
  onChange,
  onEnd,
  onAdd,
  onCommit,
  onAdjustQ,
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
      selection = getSelection(),
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
      if ((f.enabled || selection.includes(i)) && inView(f.fcHz))
        html += /* HTML */ `<g
          data-point="${i}"
          class="control-point"
          role="button"
          aria-pressed="${selection.includes(i)}"
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
            r="${selection.includes(i) ? 7 : 5.5}"
            fill="${f.enabled ? bandColor(i) : '#101827'}"
            stroke="#f8fafc"
            stroke-width="2"
          />${selection.includes(i) ? /* HTML */ `<circle cx="${xOf(f.fcHz)}" cy="${yOf(f.gainDb)}" r="12" stroke="${bandColor(i)}" stroke-opacity=".65" fill="none" />` : ''}</g
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
      html +
      '<g id="chart-hover" aria-hidden="true" pointer-events="none"></g><g id="band-selection-box" aria-hidden="true" pointer-events="none"></g>';
    drawHover();
    drawSelectionBox();
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
  let drag: {
    id: number;
    index: number;
    start: Point;
    originals: { index: number; filter: Filter }[];
    moved: boolean;
  } | null = null;
  let panDrag: { id: number; x: number; view: FrequencyWindow; moved: boolean } | null = null;
  let boxDrag: {
    id: number;
    start: Point;
    end: Point;
    additive: boolean;
    previous: number[];
  } | null = null;
  function drawSelectionBox() {
    const overlay = document.querySelector('#band-selection-box');
    if (!overlay) return;
    overlay.innerHTML = boxDrag
      ? `<rect class="band-selection-rectangle" x="${Math.min(boxDrag.start.x, boxDrag.end.x)}" y="${Math.min(boxDrag.start.y, boxDrag.end.y)}" width="${Math.abs(boxDrag.end.x - boxDrag.start.x)}" height="${Math.abs(boxDrag.end.y - boxDrag.start.y)}"/>`
      : '';
  }
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
    if (event.shiftKey || pointIndex(event) !== undefined || Date.now() - lastPan < 300) return;
    const p = position(event);
    if (p.x < bounds.l || p.x > bounds.r || p.y < bounds.t || p.y > bounds.b) return;
    const v = values(p);
    onAdd(v.hz, v.db);
  });
  svg.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const index = pointIndex(event);
    if (event.shiftKey && index === undefined) {
      const p = position(event);
      if (p.x < bounds.l || p.x > bounds.r || p.y < bounds.t || p.y > bounds.b) return;
      event.preventDefault();
      clearHover();
      boxDrag = {
        id: event.pointerId,
        start: p,
        end: p,
        additive: event.ctrlKey || event.metaKey,
        previous: getSelection(),
      };
      svg.classList.add('selecting-bands');
      svg.setPointerCapture(event.pointerId);
      drawSelectionBox();
      return;
    }
    if (index === undefined) {
      const p = position(event);
      if (p.x < bounds.l || p.x > bounds.r || p.y < bounds.t || p.y > bounds.b) {
        onSelectMany([]);
        draw();
        return;
      }
      event.preventDefault();
      panDrag = { id: event.pointerId, x: p.x, view: { ...getState().chartView }, moved: false };
      svg.setPointerCapture(event.pointerId);
      return;
    }
    event.preventDefault();
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      onSelect(+index, event.ctrlKey || event.metaKey, event.shiftKey);
      draw();
      return;
    }
    if (!getSelection().includes(+index)) onSelect(+index);
    drag = {
      id: event.pointerId,
      index: +index,
      start: position(event),
      moved: false,
      originals: getSelection().map((index) => ({
        index,
        filter: { ...current().filters[index] },
      })),
    };
    svg.setPointerCapture(event.pointerId);
    draw();
  });
  svg.addEventListener('pointermove', (event) => {
    const p = position(event);
    if (boxDrag?.id === event.pointerId) {
      boxDrag.end = { x: clamp(p.x, bounds.l, bounds.r), y: clamp(p.y, bounds.t, bounds.b) };
      drawSelectionBox();
      return;
    }
    if (panDrag?.id === event.pointerId) {
      if (Math.abs(p.x - panDrag.x) > 4) panDrag.moved = true;
      if (panDrag.moved) {
        if (svg.classList.contains('zoomed')) {
          svg.classList.add('panning');
          setWindow(panFrequency(panDrag.view, (panDrag.x - p.x) / (bounds.r - bounds.l)));
        }
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
      if (!drag.moved) {
        if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 3) return;
        drag.moved = true;
        onBegin();
      }
      const value = values(p),
        filter = current().filters[drag.index];
      if (drag.originals.length > 1) {
        const start = values(drag.start);
        const copies = drag.originals.map(({ filter }) => ({ ...filter }));
        adjustBands(copies, 'fcHz', value.hz / start.hz);
        adjustBands(copies, 'gainDb', +(value.db - start.db).toFixed(1));
        drag.originals.forEach(({ index }, i) =>
          Object.assign(current().filters[index], copies[i]),
        );
      } else {
        filter.fcHz = Math.round(value.hz);
        if (!['LP', 'HP'].includes(filter.type)) filter.gainDb = +value.db.toFixed(1);
      }
      onChange();
      draw();
    } else if (!hoverFrame)
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        drawHover();
      });
  });
  function endDrag(event: PointerEvent) {
    if (boxDrag?.id === event.pointerId) {
      const box = boxDrag;
      boxDrag = null;
      svg.classList.remove('selecting-bands');
      lastPan = Date.now();
      if (event.type === 'pointerup') {
        const points = current().filters.flatMap((filter, index) => {
          const point = { x: xOf(filter.fcHz), y: yOf(filter.gainDb) };
          return (filter.enabled || box.previous.includes(index)) &&
            point.x >= bounds.l &&
            point.x <= bounds.r &&
            point.y >= bounds.t &&
            point.y <= bounds.b
            ? [{ index, point }]
            : [];
        });
        const indices = pointsInRectangle(points, box.start, box.end);
        onSelectMany(box.additive ? [...new Set([...box.previous, ...indices])] : indices);
      }
      draw();
    }
    if (panDrag?.id === event.pointerId) {
      if (panDrag.moved) lastPan = Date.now();
      else if (event.type === 'pointerup') {
        onSelectMany([]);
        draw();
      }
      if (event.type === 'pointercancel') setWindow(panDrag.view);
      panDrag = null;
      svg.classList.remove('panning');
    }
    if (drag?.id === event.pointerId) {
      const ended = drag;
      drag = null;
      if (ended.moved) onEnd();
      else if (event.type === 'pointerup') {
        onSelect(ended.index);
        draw();
      }
    }
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('lostpointercapture', endDrag);
  svg.addEventListener('pointerleave', clearHover);
  function cancelSelection() {
    if (!boxDrag) return;
    const id = boxDrag.id;
    boxDrag = null;
    svg.classList.remove('selecting-bands');
    if (svg.hasPointerCapture(id)) svg.releasePointerCapture(id);
    drawSelectionBox();
  }
  window.addEventListener('blur', () => {
    clearHover();
    cancelSelection();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancelSelection();
  });
  svg.addEventListener(
    'wheel',
    (event) => {
      const index = pointIndex(event);
      if (boxDrag) {
        event.preventDefault();
        return;
      }
      if (index === undefined && event.shiftKey && !drag && !panDrag) {
        const p = position(event);
        if (p.x < bounds.l || p.x > bounds.r || p.y < bounds.t || p.y > bounds.b) return;
        event.preventDefault();
        const delta = event.deltaY || event.deltaX;
        zoom(delta < 0 ? 1.25 : 0.8, (p.x - bounds.l) / (bounds.r - bounds.l));
        return;
      }
      const p = position(event);
      if (
        drag ||
        panDrag ||
        event.deltaY === 0 ||
        p.x < bounds.l ||
        p.x > bounds.r ||
        p.y < bounds.t ||
        p.y > bounds.b
      )
        return;
      const selection = getSelection();
      const indices = index !== undefined && !selection.includes(+index) ? [+index] : selection;
      if (!indices.length) return;
      event.preventDefault();
      onAdjustQ(indices, event);
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
