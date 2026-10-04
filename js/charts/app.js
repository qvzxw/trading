// Chart-Workstation: Live-Feed (delayed), Candles/TPO/VP/Footprint/Odds,
// User-Levels mit Touch-Alerts (Toast + Sound + Browser-Notification),
// Replay über die Historie und frei einstellbare Farben.

import { SYMBOLS, INTERVALS, fetchBars, loadCache, saveCache, mergeBars, splitSessions, tickFor, demoBars } from './data.js';
import { volumeProfile, tpoProfile, footprint, sessionVwap, computeOdds } from './compute.js';
import { drawCandles, drawVP, drawTPO, drawFootprint } from './paint.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('propcharts.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('propcharts.' + k, JSON.stringify(v)); } catch { /* egal */ } },
};

// ---------- Palette (alles vom User umfärbbar) ----------

const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

const PALETTE_DEFS = [
  ['up', 'Candle up / buy', '#17c584'],
  ['dn', 'Candle down / sell', '#f6465d'],
  ['vwap', 'VWAP', '#f7b731'],
  ['poc', 'POC', '#37c6f5'],
  ['vah', 'VAH', '#17c584'],
  ['val', 'VAL', '#f6465d'],
  ['vpBar', 'VP bars', '#2b5f9e'],
  ['vpVa', 'VP value area', '#3b8ef0'],
  ['lvn', 'LVN marker', '#f7b731'],
  ['tpoLetter', 'TPO letters', '#aab3c2'],
  ['tpoSingle', 'TPO single prints', '#f7b731'],
  ['fpBuy', 'Footprint buy', '#17c584'],
  ['fpSell', 'Footprint sell', '#f6465d'],
  ['level', 'Default level color', '#37c6f5'],
  ['bg', 'Chart background', '#0b0d11'],
  ['grid', 'Grid lines', '#232833'],
];

function buildPalette() {
  const saved = store.get('palette', {});
  const pal = {};
  for (const [key, , def] of PALETTE_DEFS) pal[key] = saved[key] || def;
  pal.text = cssVar('--ink') || '#f2f5fa';
  pal.muted = cssVar('--muted') || '#78818f';
  pal.raised = cssVar('--raised') || '#171b22';
  pal.vaWash = pal.vpVa + '22';
  return pal;
}

// ---------- State ----------

const state = {
  symbol: store.get('symbol', 'NQ=F'),
  interval: store.get('interval', '1m'),
  bars: [],
  sessions: new Map(),
  day: null,
  tab: 'candles',
  view: { start: 0, count: 240 },
  levels: [],
  pal: buildPalette(),
  replay: { on: false, idx: 0, timer: null, speed: 4 },
  cross: null,
  feed: 'connecting', // connecting | live | demo | error
  lastUpdate: null,
  pollTimer: null,
  alertsArmed: true,
};

const levelsKey = () => 'levels.' + state.symbol;

// ---------- Feed ----------

async function loadData(initial = false) {
  const iv = INTERVALS.find((i) => i.id === state.interval) || INTERVALS[0];
  if (initial) {
    const cached = loadCache(state.symbol, state.interval);
    if (cached && cached.bars.length) {
      state.bars = cached.bars;
      afterData();
      setFeed('cache');
    }
  }
  try {
    const { bars, meta } = await fetchBars(state.symbol, state.interval, iv.range);
    const prevLastEpoch = state.bars.length ? state.bars[state.bars.length - 1].epoch : 0;
    state.bars = mergeBars(state.feed === 'demo' ? [] : state.bars, bars);
    saveCache(state.symbol, state.interval, state.bars, meta);
    setFeed('live', meta);
    afterData();
    if (!state.replay.on) checkAlerts(state.bars.filter((b) => b.epoch > prevLastEpoch));
  } catch (e) {
    if (state.bars.length === 0) {
      state.bars = demoBars();
      setFeed('demo');
      afterData();
    } else {
      setFeed('stale');
    }
  }
}

function schedulePoll() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => { if (!state.replay.on) loadData(false); }, 45000);
}

function setFeed(kind, meta) {
  state.feed = kind;
  state.lastUpdate = kind === 'live' ? new Date() : state.lastUpdate;
  const el = $('feed-chip');
  const time = state.lastUpdate ? state.lastUpdate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '–';
  const delay = meta && meta.delay ? ` · ~${meta.delay}min delayed` : ' · delayed feed';
  if (kind === 'live') { el.textContent = `LIVE${delay} · upd ${time}`; el.className = 'feed-chip live'; }
  else if (kind === 'cache') { el.textContent = 'cached data · connecting…'; el.className = 'feed-chip'; }
  else if (kind === 'stale') { el.textContent = `feed hiccup · showing last state (upd ${time})`; el.className = 'feed-chip warn'; }
  else if (kind === 'demo') { el.textContent = 'DEMO DATA · live feed unreachable here'; el.className = 'feed-chip warn'; }
  else { el.textContent = 'connecting…'; el.className = 'feed-chip'; }
}

function afterData() {
  state.sessions = splitSessions(state.bars);
  const days = [...state.sessions.keys()];
  if (!state.day || !state.sessions.has(state.day)) state.day = days[days.length - 1] || null;
  rebuildDaySelect();
  fitView();
  renderAll();
}

// ---------- Derived ----------

function dayBars() {
  const all = state.sessions.get(state.day) || [];
  if (state.replay.on) return all.slice(0, Math.max(1, state.replay.idx));
  return all;
}

function priorProfile() {
  const days = [...state.sessions.keys()];
  const i = days.indexOf(state.day);
  if (i <= 0) return null;
  const p = volumeProfile(state.sessions.get(days[i - 1]), tickFor(state.symbol));
  return p ? { poc: p.poc, vah: p.vah, val: p.val } : null;
}

// ---------- Rendering ----------

function fitView() {
  const n = dayBars().length;
  state.view.count = Math.min(Math.max(60, n), 400);
  state.view.start = Math.max(0, n - state.view.count);
}

function renderAll() {
  const bars = dayBars();
  const tick = tickFor(state.symbol);
  const info = $('chart-info');
  $('fp-note').hidden = state.tab !== 'footprint';
  for (const t of ['candles', 'tpo', 'vp', 'footprint']) $('stage-' + t).hidden = state.tab !== t;
  $('stage-odds').hidden = state.tab !== 'odds';

  if (state.tab === 'candles') {
    const hit = drawCandles($('cv-candles'), {
      bars, view: clampView(bars), pal: state.pal, levels: state.levels,
      vwap: sessionVwap(bars), prior: priorProfile(), cross: state.cross,
    });
    info.textContent = hit && hit.bar
      ? `O ${hit.bar.o}  H ${hit.bar.h}  L ${hit.bar.l}  C ${hit.bar.c}  V ${hit.bar.v.toLocaleString('en-US')}  ·  cursor ${hit.price.toFixed(2)}`
      : bars.length ? `${state.day} · ${bars.length} bars` : 'no data';
  } else if (state.tab === 'vp') {
    drawVP($('cv-vp'), { profile: volumeProfile(bars, tick), pal: state.pal });
    info.textContent = `${state.day} · session volume profile`;
  } else if (state.tab === 'tpo') {
    drawTPO($('cv-tpo'), { profile: tpoProfile(bars, tick, 30 * 60000, 45), pal: state.pal });
    info.textContent = `${state.day} · 30-min TPO`;
  } else if (state.tab === 'footprint') {
    drawFootprint($('cv-footprint'), { fp: footprint(bars, tick), pal: state.pal, maxCells: 16 });
    info.textContent = `${state.day} · 15-min footprint`;
  } else if (state.tab === 'odds') {
    renderOdds();
    info.textContent = `walk-forward stats · ${state.sessions.size} sessions loaded`;
  }
  renderLevelsPanel();
  $('replay-range').max = (state.sessions.get(state.day) || []).length;
  if (!state.replay.on) $('replay-range').value = $('replay-range').max;
}

function clampView(bars) {
  const v = state.view;
  v.count = Math.max(30, Math.min(v.count, Math.max(30, bars.length)));
  v.start = Math.max(0, Math.min(v.start, Math.max(0, bars.length - v.count)));
  return v;
}

// ---------- Odds ----------

function renderOdds() {
  const host = $('odds-host');
  host.textContent = '';
  const odds = computeOdds(state.sessions);
  if (!odds) { host.textContent = 'Not enough sessions loaded yet.'; return; }
  const tile = (label, value, sub) => {
    const t = document.createElement('div'); t.className = 'tile';
    const l = document.createElement('div'); l.className = 'label'; l.textContent = label;
    const v = document.createElement('div'); v.className = 'value'; v.textContent = value;
    t.append(l, v);
    if (sub) { const s = document.createElement('div'); s.className = 'sub'; s.textContent = sub; t.appendChild(s); }
    return t;
  };
  const grid = document.createElement('div'); grid.className = 'tiles';
  grid.append(
    tile('Sessions in sample', String(odds.n), `${state.symbol} · ${state.interval}`),
    tile('Median reach up', '+' + odds.medianReachUp.toFixed(1) + ' pts', 'from session open'),
    tile('Median reach down', '-' + odds.medianReachDown.toFixed(1) + ' pts', 'from session open'),
    tile('Median range', odds.medianRange.toFixed(1) + ' pts', 'high – low'),
    tile('Closed above open', odds.closedHigherPct + '%', 'of sessions'),
  );
  host.appendChild(grid);

  // Pro markiertem Level: Touch-/Reaktions-Odds
  if (state.levels.length) {
    const h = document.createElement('h3'); h.textContent = 'Your levels — walk-forward checked';
    h.style.marginTop = '18px';
    host.appendChild(h);
    const lg = document.createElement('div'); lg.className = 'tiles';
    for (const lv of state.levels) {
      const o = computeOdds(state.sessions, { level: lv.price });
      if (!o || !o.level) continue;
      const L = o.level;
      lg.append(tile(
        `${lv.label || 'LVL'} @ ${lv.price}`,
        L.touched ? `${L.reversedPct ?? '–'}% rev` : 'untested',
        L.touched
          ? `touched in ${L.touchPct}% of sessions (${L.touched}/${o.n}) · ${L.brokePct ?? 0}% broke · ±${L.reactionPts} pts window`
          : `0 touches in ${o.n} sessions`
      ));
    }
    host.appendChild(lg);
    const note = document.createElement('p');
    note.className = 'muted-note';
    note.textContent = 'Reversal = price moved the reaction window away from the level after the first touch before breaking it. Stats come from the loaded history only — small sample, no guarantee.';
    host.appendChild(note);
  }
}

// ---------- Levels & Alerts ----------

function loadLevels() { state.levels = store.get(levelsKey(), []); }
function saveLevels() { store.set(levelsKey(), state.levels); }

function renderLevelsPanel() {
  const host = $('levels-list');
  host.textContent = '';
  for (const lv of state.levels) {
    const row = document.createElement('div'); row.className = 'level-row';
    const sw = document.createElement('input'); sw.type = 'color'; sw.value = lv.color;
    sw.addEventListener('input', () => { lv.color = sw.value; saveLevels(); renderAll(); });
    const price = document.createElement('span'); price.className = 'lv-price'; price.textContent = String(lv.price);
    const label = document.createElement('span'); label.className = 'lv-label'; label.textContent = lv.label || '';
    const hit = document.createElement('span'); hit.className = 'lv-hit' + (lv.hit ? ' on' : ''); hit.textContent = lv.hit ? 'HIT' : 'armed';
    hit.title = 'Click to re-arm the alert';
    hit.addEventListener('click', () => { lv.hit = false; saveLevels(); renderAll(); });
    const del = document.createElement('button'); del.className = 'lv-del'; del.textContent = '✕';
    del.addEventListener('click', () => { state.levels = state.levels.filter((x) => x !== lv); saveLevels(); renderAll(); });
    row.append(sw, price, label, hit, del);
    host.appendChild(row);
  }
}

function addLevel(price, label) {
  if (!Number.isFinite(price)) return;
  state.levels.push({ price: Math.round(price * 100) / 100, label: label || '', color: state.pal.level, hit: false });
  saveLevels();
  renderAll();
}

function checkAlerts(newBars) {
  if (!state.alertsArmed || !newBars || !newBars.length) return;
  for (const lv of state.levels) {
    if (lv.hit) continue;
    for (const b of newBars) {
      if (b.l <= lv.price && lv.price <= b.h) {
        lv.hit = true;
        fireAlert(lv);
        break;
      }
    }
  }
  saveLevels();
}

function fireAlert(lv) {
  toast(`⚡ Level touched: ${lv.label || 'LVL'} @ ${lv.price}`);
  beep();
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Prop Replay — level touched', { body: `${state.symbol}: ${lv.label || 'level'} @ ${lv.price}` });
    }
  } catch { /* Sandbox ohne Notifications – Toast reicht */ }
}

function toast(msg) {
  const host = $('toast-host');
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

let audioCtx = null;
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value = 880; g.gain.value = 0.06;
    o.start();
    o.frequency.setValueAtTime(1320, audioCtx.currentTime + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25);
    o.stop(audioCtx.currentTime + 0.26);
  } catch { /* kein Audio – egal */ }
}

// ---------- Replay ----------

function setReplay(on) {
  state.replay.on = on;
  clearInterval(state.replay.timer);
  state.replay.timer = null;
  $('replay-play').textContent = on && state.replay.timer ? '⏸' : '▶';
  $('live-btn').classList.toggle('active', !on);
  if (!on) { fitView(); renderAll(); }
}

function replayPlayPause() {
  const bars = state.sessions.get(state.day) || [];
  if (!state.replay.on) {
    state.replay.on = true;
    state.replay.idx = Math.max(10, Math.min(state.replay.idx || 10, bars.length));
  }
  if (state.replay.timer) {
    clearInterval(state.replay.timer);
    state.replay.timer = null;
    $('replay-play').textContent = '▶';
    return;
  }
  $('replay-play').textContent = '⏸';
  $('live-btn').classList.remove('active');
  state.replay.timer = setInterval(() => {
    const all = state.sessions.get(state.day) || [];
    if (state.replay.idx >= all.length) { replayPlayPause(); return; }
    const prevIdx = state.replay.idx;
    state.replay.idx += 1;
    checkAlerts(all.slice(prevIdx, state.replay.idx));
    $('replay-range').value = state.replay.idx;
    fitView();
    renderAll();
  }, 1000 / state.replay.speed);
}

// ---------- UI-Verdrahtung ----------

function rebuildDaySelect() {
  const sel = $('day-select');
  const current = state.day;
  sel.textContent = '';
  for (const day of state.sessions.keys()) {
    const o = document.createElement('option');
    o.value = day; o.textContent = day;
    if (day === current) o.selected = true;
    sel.appendChild(o);
  }
}

function buildStaticUi() {
  const symSel = $('symbol-select');
  for (const s of SYMBOLS) {
    const o = document.createElement('option');
    o.value = s.id; o.textContent = s.label;
    if (s.id === state.symbol) o.selected = true;
    symSel.appendChild(o);
  }
  const ivSel = $('interval-select');
  for (const i of INTERVALS) {
    const o = document.createElement('option');
    o.value = i.id; o.textContent = i.label;
    if (i.id === state.interval) o.selected = true;
    ivSel.appendChild(o);
  }
  symSel.addEventListener('change', () => {
    state.symbol = symSel.value; store.set('symbol', state.symbol);
    state.bars = []; state.day = null; loadLevels(); setReplay(false);
    setFeed('connecting'); loadData(true);
  });
  ivSel.addEventListener('change', () => {
    state.interval = ivSel.value; store.set('interval', state.interval);
    state.bars = []; setReplay(false);
    setFeed('connecting'); loadData(true);
  });
  $('day-select').addEventListener('change', () => { state.day = $('day-select').value; setReplay(false); fitView(); renderAll(); });

  // Tabs
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tab = btn.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      renderAll();
    });
  });

  // Candles-Interaktion: Crosshair, Zoom, Pan
  const cv = $('cv-candles');
  let dragging = null;
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect();
    if (dragging != null) {
      const bars = dayBars();
      const perBar = (r.width - 64) / state.view.count;
      const shift = Math.round((dragging - e.clientX) / perBar);
      if (shift !== 0) {
        state.view.start += shift;
        clampView(bars);
        dragging = e.clientX;
      }
    }
    state.cross = { x: e.clientX - r.left, y: e.clientY - r.top };
    renderAll();
  });
  cv.addEventListener('pointerleave', () => { state.cross = null; renderAll(); });
  cv.addEventListener('pointerdown', (e) => { dragging = e.clientX; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointerup', (e) => { dragging = null; try { cv.releasePointerCapture(e.pointerId); } catch { /* ok */ } });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const bars = dayBars();
    const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    const anchorFrac = state.cross ? state.cross.x / cv.getBoundingClientRect().width : 0.5;
    const anchorBar = state.view.start + anchorFrac * state.view.count;
    state.view.count = Math.round(state.view.count * factor);
    clampView(bars);
    state.view.start = Math.round(anchorBar - anchorFrac * state.view.count);
    clampView(bars);
    renderAll();
  }, { passive: false });

  // Level-Form
  $('level-add').addEventListener('click', () => {
    addLevel(parseFloat($('level-price').value), $('level-label').value.trim());
    $('level-price').value = ''; $('level-label').value = '';
  });
  $('level-at-cursor').addEventListener('click', () => {
    if (!state.cross) { toast('Hover the candles chart first, then click this.'); return; }
    const bars = dayBars();
    const slice = bars.slice(state.view.start, state.view.start + state.view.count);
    if (!slice.length) return;
    let lo = Infinity, hi = -Infinity;
    for (const b of slice) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); }
    const pad = (hi - lo) * 0.06 || 1;
    lo -= pad; hi += pad;
    const r = $('cv-candles').getBoundingClientRect();
    addLevel(lo + (1 - state.cross.y / r.height) * (hi - lo), $('level-label').value.trim());
  });
  $('notify-btn').addEventListener('click', async () => {
    try {
      const p = await Notification.requestPermission();
      toast(p === 'granted' ? 'Browser notifications enabled ✓' : 'Notifications blocked – in-app alerts still work.');
    } catch { toast('Notifications not available here – in-app alerts still work.'); }
  });

  // Panels
  $('panel-levels-btn').addEventListener('click', () => togglePanel('levels'));
  $('panel-colors-btn').addEventListener('click', () => togglePanel('colors'));

  // Replay
  $('replay-play').addEventListener('click', replayPlayPause);
  $('replay-range').addEventListener('input', () => {
    state.replay.on = true;
    state.replay.idx = +$('replay-range').value;
    fitView(); renderAll();
  });
  $('replay-speed').addEventListener('change', () => { state.replay.speed = +$('replay-speed').value; if (state.replay.timer) { replayPlayPause(); replayPlayPause(); } });
  $('live-btn').addEventListener('click', () => { setReplay(false); loadData(false); });

  // Farben
  const grid = $('color-grid');
  for (const [key, label] of PALETTE_DEFS) {
    const row = document.createElement('label');
    row.className = 'color-row';
    const input = document.createElement('input');
    input.type = 'color'; input.value = state.pal[key];
    input.addEventListener('input', () => {
      const saved = store.get('palette', {});
      saved[key] = input.value;
      store.set('palette', saved);
      state.pal = buildPalette();
      renderAll();
    });
    const span = document.createElement('span'); span.textContent = label;
    row.append(input, span);
    grid.appendChild(row);
  }
  $('color-reset').addEventListener('click', () => {
    store.set('palette', {});
    state.pal = buildPalette();
    document.querySelectorAll('#color-grid input').forEach((inp, i) => { inp.value = PALETTE_DEFS[i][2]; });
    renderAll();
  });

  window.addEventListener('resize', renderAll);
}

function togglePanel(which) {
  const panel = $('side-panel');
  const show = panel.dataset.active !== which || panel.hidden;
  panel.hidden = !show;
  panel.dataset.active = show ? which : '';
  $('panel-levels').hidden = which !== 'levels';
  $('panel-colors').hidden = which !== 'colors';
  $('panel-levels-btn').setAttribute('aria-pressed', String(show && which === 'levels'));
  $('panel-colors-btn').setAttribute('aria-pressed', String(show && which === 'colors'));
}

// ---------- Init ----------

loadLevels();
buildStaticUi();
setFeed('connecting');
loadData(true);
schedulePoll();
