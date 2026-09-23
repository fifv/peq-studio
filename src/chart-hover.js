const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const dbText = value => `${value > 0 ? '+' : ''}${(Math.abs(value) < .005 ? 0 : value).toFixed(2)} dB`;

// Keep adjacent curve readings separate while preserving their vertical order.
export function placeReadings(readings, top, bottom, gap = 23) {
  const sorted = readings.map(item => ({ ...item })).sort((a, b) => a.y - b.y);
  sorted.forEach((item, index) => { item.labelY = Math.max(top, item.y, index ? sorted[index - 1].labelY + gap : top); });
  for (let index = sorted.length - 1; index >= 0; index--) {
    sorted[index].labelY = Math.min(sorted[index].labelY, index === sorted.length - 1 ? bottom : sorted[index + 1].labelY - gap);
  }
  return sorted;
}

export function hoverMarkup({ point, hz, db, readings, bounds, yOf }) {
  const { l, r, t, b } = bounds;
  const frequency = `${hz < 1000 ? hz.toFixed(1) : hz.toFixed(0)} Hz`;
  const badge = (x, y, width, text, className = '') => `<g class="hover-badge ${className}" transform="translate(${x},${y})"><rect x="${-width / 2}" y="-11" width="${width}" height="22" rx="4"/><text text-anchor="middle" y="4">${text}</text></g>`;
  let html = `<path class="hover-crosshair" d="M${point.x} ${t}V${b}M${l} ${point.y}H${r}"/><circle class="hover-pointer" cx="${point.x}" cy="${point.y}" r="2.5"/>`;
  html += badge(clamp(point.x, l + 43, r - 43), b + 25, 86, frequency, 'hover-frequency');
  html += badge(l + 40, clamp(point.y, t + 12, b - 12), 76, dbText(db));
  const leftward = point.x > r - 205;
  const textX = point.x + (leftward ? -15 : 15);
  const items = readings.filter(item => Number.isFinite(item.db)).map(item => ({ ...item, y: clamp(yOf(item.db), t + 6, b - 6) }));
  for (const item of placeReadings(items, t + 13, b - 15)) {
    const width = item.name.length * 6.1 + 88;
    const rectX = leftward ? textX - width : textX;
    const offscale = yOf(item.db) < t || yOf(item.db) > b;
    html += `<g class="hover-reading" style="--reading-color:${item.color}"><path class="hover-leader" d="M${point.x} ${item.y}L${textX + (leftward ? -5 : 5)} ${item.labelY}"/><circle cx="${point.x}" cy="${item.y}" r="3.5" class="hover-curve-dot"${offscale ? ' stroke-dasharray="2 2"' : ''}/><rect x="${rectX}" y="${item.labelY - 10}" width="${width}" height="20" rx="4"/><text x="${rectX + 7}" y="${item.labelY + 4}">${item.name} <tspan class="hover-reading-value">${dbText(item.db)}${offscale ? (yOf(item.db) < t ? ' ↑' : ' ↓') : ''}</tspan></text></g>`;
  }
  return html;
}
