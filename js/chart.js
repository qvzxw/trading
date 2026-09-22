// SVG-Equity-Chart: Equity-Linie, Drawdown-Floor (Step-Linie), Profit-Target,
// EOD-Marker, Bruch-Marker, Crosshair + Tooltip (Maus + Tastatur).

const SVGNS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function niceTicks(min, max, count = 5) {
  if (!(max > min)) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2.5 ? 5 : norm >= 1.5 ? 2.5 : norm >= 1 ? 2 : 1) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(v);
  return ticks;
}

const fmtMoney = (n) => {
  const r = Math.round(n);
  return (r < 0 ? '-' : '') + '$' + Math.abs(r).toLocaleString('en-US');
};
const fmtMoneyFull = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDateShort(epoch) {
  const d = new Date(epoch);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
}
function fmtDateTime(epoch) {
  const d = new Date(epoch);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' }) + ', ' +
         d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// result: Ausgabe von simulate(); account: Account-Konfiguration
export function renderEquityChart(container, result, account) {
  container.textContent = '';
  const points = result.points;
  if (!points || points.length < 2) return;

  const width = Math.max(320, container.clientWidth || 640);
  const height = Math.min(400, Math.max(260, Math.round(width * 0.42)));
  const pad = { top: 16, right: 16, bottom: 28, left: 62 };
  const iw = width - pad.left - pad.right;
  const ih = height - pad.top - pad.bottom;

  const target = account.profitTarget != null ? account.size + account.profitTarget : null;
  const t0 = points[0].epoch, t1 = points[points.length - 1].epoch;
  // Schleife statt Spread: große Exporte sprengen sonst das Argument-Limit von Math.min
  let yMin = account.size, yMax = account.size;
  for (const p of points) {
    if (p.equity < yMin) yMin = p.equity;
    if (p.equity > yMax) yMax = p.equity;
    if (p.floor < yMin) yMin = p.floor;
    if (p.floor > yMax) yMax = p.floor;
  }
  if (target != null) { yMin = Math.min(yMin, target); yMax = Math.max(yMax, target); }
  const ySpan = Math.max(yMax - yMin, 100);
  yMin -= ySpan * 0.06; yMax += ySpan * 0.06;

  const x = (t) => pad.left + ((t - t0) / Math.max(1, t1 - t0)) * iw;
  const y = (v) => pad.top + (1 - (v - yMin) / (yMax - yMin)) * ih;

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`, width: '100%', height,
    role: 'img', 'aria-label': 'Equity curve with drawdown limit and profit target',
    tabindex: '0', class: 'equity-chart',
  }, container);

  // Gradient für die Equity-Fläche (Farben kommen aus dem CSS-Theme)
  const defs = el('defs', {}, svg);
  const grad = el('linearGradient', { id: 'eq-grad', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
  el('stop', { offset: '0%', class: 'eq-grad-a' }, grad);
  el('stop', { offset: '100%', class: 'eq-grad-b' }, grad);

  // Gridlines + Y-Achse
  const yTicks = niceTicks(yMin, yMax, 5);
  for (const v of yTicks) {
    el('line', { x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v), class: 'grid' }, svg);
    el('text', { x: pad.left - 8, y: y(v) + 3.5, 'text-anchor': 'end', class: 'tick' }, svg).textContent = fmtMoney(v);
  }
  // X-Achse: Tagesticks, Dichte nach Breite
  const dayMs = 86400000;
  const nDays = Math.max(1, Math.round((t1 - t0) / dayMs));
  const maxLabels = Math.max(3, Math.floor(iw / 72));
  const stepDays = Math.max(1, Math.ceil(nDays / maxLabels));
  for (let t = t0; t <= t1; t += stepDays * dayMs) {
    el('text', { x: x(t), y: height - 8, 'text-anchor': 'middle', class: 'tick' }, svg).textContent = fmtDateShort(t);
  }

  // Referenzlinien: Start, Target
  el('line', { x1: pad.left, x2: width - pad.right, y1: y(account.size), y2: y(account.size), class: 'refline start' }, svg);
  if (target != null && target <= yMax && target >= yMin) {
    el('line', { x1: pad.left, x2: width - pad.right, y1: y(target), y2: y(target), class: 'refline target' }, svg);
    el('text', { x: width - pad.right, y: y(target) - 5, 'text-anchor': 'end', class: 'reflabel target' }, svg).textContent = `Target ${fmtMoney(target)}`;
  }

  // Drawdown-Floor als Step-Linie: horizontal bis zum neuen X, dann vertikal auf den neuen Floor
  let dFloor = `M ${x(points[0].epoch)} ${y(points[0].floor)}`;
  for (let i = 1; i < points.length; i++) {
    dFloor += ` H ${x(points[i].epoch)} V ${y(points[i].floor)}`;
  }
  el('path', { d: dFloor, class: 'floor-line', fill: 'none' }, svg);

  // Equity-Fläche + Linie
  let dEq = `M ${x(points[0].epoch)} ${y(points[0].equity)}`;
  for (let i = 1; i < points.length; i++) dEq += ` L ${x(points[i].epoch)} ${y(points[i].equity)}`;
  const dArea = dEq + ` L ${x(t1)} ${y(yMin)} L ${x(t0)} ${y(yMin)} Z`;
  el('path', { d: dArea, class: 'equity-area' }, svg);
  el('path', { d: dEq, class: 'equity-line', fill: 'none' }, svg);

  // Bruch-/Pass-Marker: equityAt aus der Engine, weil mehrere Events denselben Zeitstempel teilen können
  if (result.failed && result.failed.epoch != null) {
    const fx = x(result.failed.epoch);
    const fy = y(result.failed.equityAt ?? nearestPoint(points, result.failed.epoch).equity);
    el('circle', { cx: fx, cy: fy, r: 6, class: 'fail-dot' }, svg);
    el('circle', { cx: fx, cy: fy, r: 10, class: 'fail-ring' }, svg);
  }
  if (result.passed && result.passed.epoch != null) {
    const py = y(result.passed.equityAt ?? nearestPoint(points, result.passed.epoch).equity);
    el('circle', { cx: x(result.passed.epoch), cy: py, r: 6, class: 'pass-dot' }, svg);
  }

  // Endpunkt-Marker + Label
  const lastP = points[points.length - 1];
  el('circle', { cx: x(lastP.epoch), cy: y(lastP.equity), r: 4.5, class: 'end-dot' }, svg);

  // ---- Crosshair + Tooltip ----
  const cross = el('g', { class: 'crosshair', opacity: '0' }, svg);
  const crossLine = el('line', { y1: pad.top, y2: height - pad.bottom, class: 'crosshair-line' }, cross);
  const crossDotEq = el('circle', { r: 4.5, class: 'cross-dot equity' }, cross);
  const crossDotFl = el('circle', { r: 4, class: 'cross-dot floor' }, cross);

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  container.appendChild(tip);
  container.style.position = 'relative';

  let idx = -1;
  const showIdx = (i) => {
    idx = Math.max(0, Math.min(points.length - 1, i));
    const p = points[idx];
    const px = x(p.epoch);
    cross.setAttribute('opacity', '1');
    crossLine.setAttribute('x1', px); crossLine.setAttribute('x2', px);
    crossDotEq.setAttribute('cx', px); crossDotEq.setAttribute('cy', y(p.equity));
    crossDotFl.setAttribute('cx', px); crossDotFl.setAttribute('cy', y(p.floor));
    tip.hidden = false;
    tip.textContent = '';
    const head = document.createElement('div');
    head.className = 'tip-head';
    head.textContent = fmtDateTime(p.epoch);
    tip.appendChild(head);
    addTipRow(tip, 'equity', 'Equity', fmtMoneyFull(p.equity));
    addTipRow(tip, 'floor', 'Drawdown limit', fmtMoneyFull(p.floor));
    addTipRow(tip, 'room', 'Room', fmtMoneyFull(p.equity - p.floor));
    const rect = container.getBoundingClientRect();
    const scale = rect.width / width;
    const tipW = tip.offsetWidth || 180;
    let left = px * scale + 12;
    if (left + tipW > rect.width - 8) left = px * scale - tipW - 12;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(0, y(p.equity) * scale - 60)}px`;
  };
  // idx bleibt beim Ausblenden erhalten, damit Pfeiltasten dort weitermachen
  const hide = () => { cross.setAttribute('opacity', '0'); tip.hidden = true; };

  svg.addEventListener('pointermove', (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * width;
    const t = t0 + ((px - pad.left) / iw) * (t1 - t0);
    showIdx(nearestIndex(points, t));
  });
  svg.addEventListener('pointerleave', hide);
  // Klick fokussiert das SVG – dann nicht zum letzten Punkt springen, sondern Hover-Position halten
  svg.addEventListener('focus', () => showIdx(idx >= 0 ? idx : points.length - 1));
  svg.addEventListener('blur', hide);
  svg.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowLeft') { showIdx((idx < 0 ? points.length - 1 : idx) - 1); ev.preventDefault(); }
    if (ev.key === 'ArrowRight') { showIdx((idx < 0 ? points.length - 1 : idx) + 1); ev.preventDefault(); }
  });

  // Legende (2+ Serien)
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  legend.append(
    legendItem('equity', 'Equity'),
    legendItem('floor', 'Drawdown limit'),
  );
  if (target != null) legend.append(legendItem('target', 'Profit target'));
  container.appendChild(legend);
}

function addTipRow(tip, kind, label, value) {
  const row = document.createElement('div');
  row.className = 'tip-row';
  const key = document.createElement('span');
  key.className = `tip-key ${kind}`;
  const name = document.createElement('span');
  name.className = 'tip-label';
  name.textContent = label;
  const val = document.createElement('span');
  val.className = 'tip-value';
  val.textContent = value;
  row.append(key, name, val);
  tip.appendChild(row);
}

function legendItem(kind, label) {
  const item = document.createElement('span');
  item.className = 'legend-item';
  const key = document.createElement('span');
  key.className = `tip-key ${kind}`;
  const text = document.createElement('span');
  text.textContent = label;
  item.append(key, text);
  return item;
}

function nearestIndex(points, t) {
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].epoch < t) lo = mid; else hi = mid;
  }
  return (t - points[lo].epoch) <= (points[hi].epoch - t) ? lo : hi;
}
function nearestPoint(points, t) { return points[nearestIndex(points, t)]; }
