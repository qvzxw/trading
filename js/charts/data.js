// Live-OHLCV für die Chart-Engine: kostenloser Yahoo-Finance-Chart-Feed
// (NQ=F & Co., ~10-15 Min. delayed) mit CORS-Fallback-Proxies, localStorage-Cache
// und deterministischen Demo-Bars als letzter Rückfallebene.

import { tradingDay } from '../engine.js';

export const SYMBOLS = [
  { id: 'NQ=F', label: 'NQ · Nasdaq-100 futures', tick: 0.25 },
  { id: 'ES=F', label: 'ES · S&P 500 futures', tick: 0.25 },
  { id: 'YM=F', label: 'YM · Dow futures', tick: 1 },
  { id: 'GC=F', label: 'GC · Gold futures', tick: 0.1 },
  { id: 'CL=F', label: 'CL · Crude Oil futures', tick: 0.01 },
  { id: '^NDX', label: 'NDX · Nasdaq-100 index (RTH only)', tick: 0.25 },
  { id: 'BTC-USD', label: 'BTC · Bitcoin spot (24/7)', tick: 1 },
];

export const INTERVALS = [
  { id: '1m', label: '1m · last 5 days', range: '5d', ms: 60000 },
  { id: '5m', label: '5m · last 30 days', range: '30d', ms: 300000 },
];

// Direkt zuerst; öffentliche CORS-Proxies als Fallback (Reihenfolge wird gemerkt)
const PROXIES = [
  (u) => u,
  (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
];
let workingProxy = 0;

function yahooUrl(symbol, interval, range) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${interval}&range=${range}&includePrePost=true`;
}

async function fetchWithTimeout(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function parseYahoo(json) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r || !r.timestamp) throw new Error('empty chart payload');
  const q = r.indicators.quote[0];
  const bars = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    bars.push({ epoch: r.timestamp[i] * 1000, o, h, l, c, v: Math.max(0, q.volume[i] || 0) });
  }
  return { bars, meta: { symbol: r.meta.symbol, last: r.meta.regularMarketPrice, delay: r.meta.exchangeDataDelayedBy || 0 } };
}

// Holt Bars; probiert direkte Verbindung und Proxies der Reihe nach durch.
export async function fetchBars(symbol, interval, range) {
  const url = yahooUrl(symbol, interval, range);
  let lastErr = null;
  for (let k = 0; k < PROXIES.length; k++) {
    const idx = (workingProxy + k) % PROXIES.length;
    try {
      const json = await fetchWithTimeout(PROXIES[idx](url), 9000);
      const parsed = parseYahoo(json);
      if (parsed.bars.length === 0) throw new Error('no bars');
      workingProxy = idx;
      return parsed;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('feed unreachable');
}

// ---------- Cache (letzter guter Stand überlebt Reloads/Offline) ----------

const cacheKey = (s, i) => `propcharts.cache.${s}.${i}`;

export function saveCache(symbol, interval, bars, meta) {
  try {
    const slim = bars.map((b) => [b.epoch, b.o, b.h, b.l, b.c, b.v]);
    localStorage.setItem(cacheKey(symbol, interval), JSON.stringify({ t: 0, meta, slim }));
  } catch { /* voll/blockiert – egal */ }
}

export function loadCache(symbol, interval) {
  try {
    const raw = localStorage.getItem(cacheKey(symbol, interval));
    if (!raw) return null;
    const d = JSON.parse(raw);
    return { bars: d.slim.map((a) => ({ epoch: a[0], o: a[1], h: a[2], l: a[3], c: a[4], v: a[5] })), meta: d.meta || {} };
  } catch { return null; }
}

// Neue Bars in bestehende Serie mergen (Poll-Updates)
export function mergeBars(oldBars, newBars) {
  if (!oldBars || oldBars.length === 0) return newBars.slice();
  const map = new Map(oldBars.map((b) => [b.epoch, b]));
  for (const b of newBars) map.set(b.epoch, b); // neuere Version derselben Bar gewinnt
  return [...map.values()].sort((a, b) => a.epoch - b.epoch);
}

// Bars -> Map(CME-Handelstag -> bars[])
export function splitSessions(bars) {
  const map = new Map();
  for (const b of bars) {
    const day = tradingDay(b.epoch, 'exchange');
    if (!map.has(day)) map.set(day, []);
    map.get(day).push(b);
  }
  return map;
}

export function tickFor(symbol) {
  const s = SYMBOLS.find((x) => x.id === symbol);
  return s ? s.tick : 0.25;
}

// ---------- Demo-Bars (deterministisch) als letzte Rückfallebene ----------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function demoBars() {
  const rnd = mulberry32(31337);
  const bars = [];
  let price = 31000;
  const days = [29, 30, 1, 2, 3];
  const months = [8, 8, 9, 9, 9]; // Sep/Okt 2026 (0-basiert)
  for (let d = 0; d < 5; d++) {
    const drift = (rnd() - 0.45) * 0.9;
    const sessionStartUtc = Date.UTC(2026, months[d], days[d] - 1, 22, 0, 0); // 18:00 ET (EDT)
    for (let i = 0; i < 1380; i++) {
      const epoch = sessionStartUtc + i * 60000;
      const rth = i >= 930 && i <= 1320;
      const uShape = rth ? 1 + 1.6 * Math.exp(-((i - 940) ** 2) / 8000) + 1.2 * Math.exp(-((i - 1310) ** 2) / 6000) : 0.12;
      const vol = Math.max(5, Math.round((rth ? 900 : 90) * uShape * (0.5 + rnd())));
      const sigma = (rth ? 6 : 2.2) * (0.6 + rnd());
      const o = price;
      let c = o + drift * (rth ? 1.4 : 0.4) + (rnd() - 0.5) * 2 * sigma;
      if (rnd() < 0.012) c = o + (rnd() < 0.5 ? -1 : 1) * sigma * (4 + rnd() * 5);
      const h = Math.max(o, c) + rnd() * sigma * 0.9;
      const l = Math.min(o, c) - rnd() * sigma * 0.9;
      const q = (x) => Math.round(x * 4) / 4;
      bars.push({ epoch, o: q(o), h: q(h), l: q(l), c: q(c), v: vol });
      price = c;
    }
    price += (rnd() - 0.5) * 30;
  }
  return bars;
}
