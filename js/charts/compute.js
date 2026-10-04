// Rechenkern der Chart-Engine: Volume Profile (POC/VA/LVN/HVN), TPO
// (Letters, Single Prints, Poor Highs/Lows), Footprint-Approximation,
// Session-VWAP und Walk-Forward-Odds aus der geladenen Historie.

// ---------- Helpers ----------

function binIndex(price, minPrice, binSize) {
  return Math.floor((price - minPrice) / binSize + 1e-9);
}

export function chooseBinSize(low, high, tick, targetBins = 90) {
  const raw = (high - low) / targetBins;
  const mult = Math.max(1, Math.round(raw / tick));
  return mult * tick;
}

// 70%-Value-Area: am POC starten, in 2er-Paaren nach oben/unten erweitern (klassischer Algorithmus)
function valueArea(vols, pocIdx, totalVol, pct = 0.7) {
  let covered = vols[pocIdx];
  let up = pocIdx, dn = pocIdx;
  const target = totalVol * pct;
  while (covered < target && (up < vols.length - 1 || dn > 0)) {
    const upPair = (up + 1 < vols.length ? vols[up + 1] : 0) + (up + 2 < vols.length ? vols[up + 2] : 0);
    const dnPair = (dn - 1 >= 0 ? vols[dn - 1] : 0) + (dn - 2 >= 0 ? vols[dn - 2] : 0);
    if (upPair >= dnPair && up < vols.length - 1) {
      covered += vols[++up] || 0;
      if (up < vols.length - 1 && covered < target) covered += vols[++up] || 0;
    } else if (dn > 0) {
      covered += vols[--dn] || 0;
      if (dn > 0 && covered < target) covered += vols[--dn] || 0;
    } else if (up < vols.length - 1) {
      covered += vols[++up] || 0;
    }
  }
  return { vaLowIdx: dn, vaHighIdx: up };
}

// LVNs/HVNs als zusammenhängende Läufe niedriger/hoher Volumina.
// Lauf-basiert statt striktes lokales Minimum, damit auch flache
// Null-Volumen-Täler zwischen zwei Clustern als LVN erkannt werden.
function findNodes(vols) {
  const n = vols.length;
  const smooth = vols.map((_, i) => {
    let s = 0, c = 0;
    for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < n) { s += vols[j]; c++; } }
    return s / c;
  });
  const maxV = Math.max(...smooth, 1);
  const lowThr = maxV * 0.25, flankThr = maxV * 0.45, highThr = maxV * 0.6;
  const lvns = [], hvns = [];
  const runsBelow = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const low = i < n && smooth[i] < lowThr;
    if (low && start < 0) start = i;
    if (!low && start >= 0) { runsBelow.push([start, i - 1]); start = -1; }
  }
  for (const [a, b] of runsBelow) {
    // LVN nur, wenn auf BEIDEN Seiten echtes Volumen flankiert (kein Profil-Rand)
    const hasAbove = smooth.slice(b + 1).some((v) => v >= flankThr);
    const hasBelow = smooth.slice(0, a).some((v) => v >= flankThr);
    if (hasAbove && hasBelow) lvns.push(Math.round((a + b) / 2));
  }
  start = -1;
  for (let i = 0; i <= n; i++) {
    const high = i < n && smooth[i] >= highThr;
    if (high && start < 0) start = i;
    if (!high && start >= 0) { hvns.push(Math.round((start + i - 1) / 2)); start = -1; }
  }
  return { lvns, hvns };
}

// ---------- Volume Profile ----------

export function volumeProfile(bars, tick, targetBins = 90) {
  if (!bars.length) return null;
  let low = Infinity, high = -Infinity, total = 0;
  for (const b of bars) { if (b.l < low) low = b.l; if (b.h > high) high = b.h; total += b.v; }
  const binSize = chooseBinSize(low, high, tick, targetBins);
  const nBins = Math.max(1, binIndex(high, low, binSize) + 1);
  const vols = new Array(nBins).fill(0);
  for (const b of bars) {
    const i0 = binIndex(b.l, low, binSize);
    const i1 = binIndex(b.h, low, binSize);
    const per = b.v / (i1 - i0 + 1); // Volumen gleichmäßig über die Bar-Spanne verteilen
    for (let i = i0; i <= i1; i++) vols[i] += per;
  }
  let pocIdx = 0;
  for (let i = 1; i < nBins; i++) if (vols[i] > vols[pocIdx]) pocIdx = i;
  const { vaLowIdx, vaHighIdx } = valueArea(vols, pocIdx, total);
  const { lvns, hvns } = findNodes(vols);
  const price = (i) => low + (i + 0.5) * binSize;
  return {
    low, high, binSize, vols, total,
    poc: price(pocIdx), pocIdx,
    val: low + vaLowIdx * binSize, vah: low + (vaHighIdx + 1) * binSize,
    vaLowIdx, vaHighIdx,
    lvns: lvns.map(price), hvns: hvns.map(price),
    maxVol: Math.max(...vols, 1),
    priceAt: price,
  };
}

// ---------- TPO ----------

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function tpoProfile(bars, tick, blockMs = 30 * 60000, targetBins = 70) {
  if (!bars.length) return null;
  let low = Infinity, high = -Infinity;
  for (const b of bars) { if (b.l < low) low = b.l; if (b.h > high) high = b.h; }
  const binSize = chooseBinSize(low, high, tick, targetBins);
  const nBins = Math.max(1, binIndex(high, low, binSize) + 1);
  const t0 = bars[0].epoch;
  const rows = Array.from({ length: nBins }, () => new Set());
  let nBlocks = 0;
  for (const b of bars) {
    const block = Math.min(LETTERS.length - 1, Math.floor((b.epoch - t0) / blockMs));
    nBlocks = Math.max(nBlocks, block + 1);
    const i0 = binIndex(b.l, low, binSize);
    const i1 = binIndex(b.h, low, binSize);
    for (let i = i0; i <= i1; i++) rows[i].add(block);
  }
  const counts = rows.map((s) => s.size);
  const total = counts.reduce((a, c) => a + c, 0);
  let pocIdx = 0;
  for (let i = 1; i < nBins; i++) if (counts[i] > counts[pocIdx]) pocIdx = i;
  const { vaLowIdx, vaHighIdx } = valueArea(counts, pocIdx, total);
  // Single Prints: Zeilen mit genau 1 TPO, nicht am äußersten Rand
  const singles = [];
  for (let i = 1; i < nBins - 1; i++) if (counts[i] === 1) singles.push(i);
  // Poor High/Low: >=2 TPOs in der äußersten Zeile = unfertige Auktion
  const poorHigh = counts[nBins - 1] >= 2;
  const poorLow = counts[0] >= 2;
  const price = (i) => low + (i + 0.5) * binSize;
  return {
    low, high, binSize, rows, counts, nBlocks, letters: LETTERS,
    poc: price(pocIdx), pocIdx,
    val: low + vaLowIdx * binSize, vah: low + (vaHighIdx + 1) * binSize,
    vaLowIdx, vaHighIdx,
    singles, poorHigh, poorLow,
    maxCount: Math.max(...counts, 1),
    priceAt: price,
  };
}

// ---------- Footprint (Approximation aus 1m/5m-Bars, Tick-Rule) ----------

export function footprint(bars, tick, cellMs = 15 * 60000, targetBins = 60) {
  if (!bars.length) return null;
  let low = Infinity, high = -Infinity;
  for (const b of bars) { if (b.l < low) low = b.l; if (b.h > high) high = b.h; }
  const binSize = chooseBinSize(low, high, tick, targetBins);
  const t0 = Math.floor(bars[0].epoch / cellMs) * cellMs;
  const cells = new Map(); // cellStart -> { bins: Map(binIdx -> {up,dn}), delta, vol, o,h,l,c }
  let prevC = bars[0].o, prevDir = 1;
  for (const b of bars) {
    const dir = b.c > prevC ? 1 : b.c < prevC ? -1 : prevDir;
    prevC = b.c; prevDir = dir;
    const cellStart = Math.floor((b.epoch - t0) / cellMs) * cellMs + t0;
    let cell = cells.get(cellStart);
    if (!cell) { cell = { bins: new Map(), delta: 0, vol: 0, o: b.o, h: b.h, l: b.l, c: b.c }; cells.set(cellStart, cell); }
    cell.h = Math.max(cell.h, b.h); cell.l = Math.min(cell.l, b.l); cell.c = b.c;
    const i0 = binIndex(b.l, low, binSize);
    const i1 = binIndex(b.h, low, binSize);
    const per = b.v / (i1 - i0 + 1);
    for (let i = i0; i <= i1; i++) {
      let bin = cell.bins.get(i);
      if (!bin) { bin = { up: 0, dn: 0 }; cell.bins.set(i, bin); }
      if (dir >= 0) bin.up += per; else bin.dn += per;
    }
    cell.vol += b.v;
    cell.delta += dir >= 0 ? b.v : -b.v;
  }
  let maxBinVol = 1;
  for (const c of cells.values()) for (const bin of c.bins.values()) maxBinVol = Math.max(maxBinVol, bin.up + bin.dn);
  return {
    low, high, binSize, cellMs, maxBinVol,
    cells: [...cells.entries()].sort((a, b) => a[0] - b[0]).map(([start, c]) => ({ start, ...c })),
    priceAt: (i) => low + (i + 0.5) * binSize,
    binIndex: (p) => binIndex(p, low, binSize),
  };
}

// ---------- VWAP ----------

export function sessionVwap(bars) {
  const out = new Array(bars.length);
  let pv = 0, vv = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const typ = (b.h + b.l + b.c) / 3;
    pv += typ * b.v; vv += b.v;
    out[i] = vv > 0 ? pv / vv : typ;
  }
  return out;
}

// ---------- Odds (Walk-Forward über die geladene Historie) ----------

// sessions: Map(day -> bars[]) chronologisch; level optional
export function computeOdds(sessions, { level = null, reactionPts = null } = {}) {
  const days = [...sessions.entries()].filter(([, b]) => b.length > 20);
  const n = days.length;
  if (n === 0) return null;
  const reachUps = [], reachDns = [], ranges = [];
  let closedHigher = 0;
  for (const [, b] of days) {
    const open = b[0].o, close = b[b.length - 1].c;
    let hi = -Infinity, lo = Infinity;
    for (const bar of b) { hi = Math.max(hi, bar.h); lo = Math.min(lo, bar.l); }
    reachUps.push(hi - open); reachDns.push(open - lo); ranges.push(hi - lo);
    if (close > open) closedHigher++;
  }
  const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const out = {
    n,
    medianReachUp: med(reachUps),
    medianReachDown: med(reachDns),
    medianRange: med(ranges),
    closedHigherPct: Math.round((closedHigher / n) * 100),
  };
  if (level != null) {
    const R = reactionPts || Math.max(1, Math.round(med(ranges) * 0.15));
    let touched = 0, reversed = 0, broke = 0;
    for (const [, b] of days) {
      // Touch = Bar enthält das Level ODER zwei aufeinanderfolgende Bars überspringen es (Gap)
      let idx = -1, side = 0;
      for (let i = 0; i < b.length; i++) {
        const bar = b[i];
        if (bar.l <= level && level <= bar.h) {
          idx = i;
          side = i > 0 ? (b[i - 1].c >= level ? 1 : -1) : (bar.o >= level ? 1 : -1);
          break;
        }
        if (i > 0) {
          const prev = b[i - 1];
          if (prev.l > level && bar.h < level) { idx = i; side = 1; break; }  // Gap nach unten durchs Level
          if (prev.h < level && bar.l > level) { idx = i; side = -1; break; } // Gap nach oben durchs Level
        }
      }
      if (idx < 0) continue;
      touched++;
      let rev = false, cont = false;
      for (let i = idx; i < b.length && !rev && !cont; i++) {
        if (side === 1) { // Touch von oben -> Reversal = hoch, Continuation = durchbrechen
          if (b[i].h >= level + R) rev = true;
          else if (b[i].l <= level - R) cont = true;
        } else {
          if (b[i].l <= level - R) rev = true;
          else if (b[i].h >= level + R) cont = true;
        }
      }
      if (rev) reversed++; else if (cont) broke++;
    }
    out.level = {
      price: level, reactionPts: R, touched,
      touchPct: Math.round((touched / n) * 100),
      reversedPct: touched ? Math.round((reversed / touched) * 100) : null,
      brokePct: touched ? Math.round((broke / touched) * 100) : null,
    };
  }
  return out;
}
