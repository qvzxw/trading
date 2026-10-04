// Canvas-Renderer der Chart-Engine. Alle Farben kommen aus der übergebenen
// Palette (vom User anpassbar); Text/Grid nutzen die Theme-Ink-Töne.

export function setupCanvas(canvas) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const W = Math.max(50, Math.round(rect.width));
  const H = Math.max(50, Math.round(rect.height));
  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W, H };
}

const AXIS_W = 64;
const FONT = '10.5px "IBM Plex Mono", monospace';

function priceTicks(lo, hi, n = 6) {
  const span = hi - lo;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

const fmtP = (p) => p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(Math.round(p * 100) / 100);

function drawFrame(ctx, W, H, lo, hi, pal) {
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.font = FONT;
  const y = (p) => H - ((p - lo) / (hi - lo)) * H;
  for (const t of priceTicks(lo, hi, 8)) {
    const yy = y(t);
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W - AXIS_W, yy); ctx.stroke();
    ctx.fillStyle = pal.muted;
    ctx.fillText(fmtP(t), W - AXIS_W + 6, yy + 3.5);
  }
  return y;
}

function hline(ctx, W, y, color, width = 1, dash = null, label = null, pal = null) {
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W - AXIS_W, y); ctx.stroke();
  ctx.restore();
  if (label) {
    ctx.font = FONT;
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = color;
    ctx.fillRect(W - AXIS_W - w, y - 8, w, 16);
    ctx.fillStyle = pal ? pal.bg : '#000';
    ctx.fillText(label, W - AXIS_W - w + 5, y + 3.5);
  }
}

// ---------- Candles ----------

export function drawCandles(canvas, s) {
  const { ctx, W, H } = setupCanvas(canvas);
  const { bars, view, pal } = s;
  const slice = bars.slice(view.start, view.start + view.count);
  if (!slice.length) { ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H); return null; }
  let lo = Infinity, hi = -Infinity;
  for (const b of slice) { if (b.l < lo) lo = b.l; if (b.h > hi) hi = b.h; }
  for (const lv of s.levels || []) { if (lv.price > lo - 40 && lv.price < hi + 40) { lo = Math.min(lo, lv.price); hi = Math.max(hi, lv.price); } }
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad; hi += pad;
  const y = drawFrame(ctx, W, H, lo, hi, pal);
  const plotW = W - AXIS_W;
  const bw = plotW / slice.length;
  const x = (i) => i * bw + bw / 2;

  // Value-Linien der Vortagssession
  if (s.prior) {
    if (s.prior.vah != null) hline(ctx, W, y(s.prior.vah), pal.vah, 1, [5, 4], 'pVAH ' + fmtP(s.prior.vah), pal);
    if (s.prior.val != null) hline(ctx, W, y(s.prior.val), pal.val, 1, [5, 4], 'pVAL ' + fmtP(s.prior.val), pal);
    if (s.prior.poc != null) hline(ctx, W, y(s.prior.poc), pal.poc, 1, [2, 3], 'nPOC ' + fmtP(s.prior.poc), pal);
  }

  // Candles
  for (let i = 0; i < slice.length; i++) {
    const b = slice[i];
    const up = b.c >= b.o;
    const col = up ? pal.up : pal.dn;
    const cx = x(i);
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, bw * 0.12);
    ctx.beginPath(); ctx.moveTo(cx, y(b.h)); ctx.lineTo(cx, y(b.l)); ctx.stroke();
    const top = y(Math.max(b.o, b.c));
    const hgt = Math.max(1, Math.abs(y(b.o) - y(b.c)));
    ctx.fillStyle = col;
    ctx.fillRect(cx - bw * 0.33, top, bw * 0.66, hgt);
  }

  // VWAP
  if (s.vwap) {
    ctx.strokeStyle = pal.vwap; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < slice.length; i++) {
      const v = s.vwap[view.start + i];
      if (v == null) continue;
      const yy = y(v);
      if (i === 0) ctx.moveTo(x(i), yy); else ctx.lineTo(x(i), yy);
    }
    ctx.stroke();
  }

  // User-Levels
  for (const lv of s.levels || []) {
    if (lv.price < lo || lv.price > hi) continue;
    hline(ctx, W, y(lv.price), lv.color, 1.6, lv.hit ? null : [7, 5], `${lv.label || 'LVL'} ${fmtP(lv.price)}`, pal);
  }

  // Letzter Preis
  const last = slice[slice.length - 1];
  hline(ctx, W, y(last.c), last.c >= last.o ? pal.up : pal.dn, 1, [2, 2], fmtP(last.c), pal);

  // Crosshair
  if (s.cross && s.cross.x != null && s.cross.x < plotW) {
    const i = Math.max(0, Math.min(slice.length - 1, Math.floor(s.cross.x / bw)));
    const b = slice[i];
    ctx.strokeStyle = pal.muted; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x(i), 0); ctx.lineTo(x(i), H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, s.cross.y); ctx.lineTo(plotW, s.cross.y); ctx.stroke();
    ctx.setLineDash([]);
    const p = lo + (1 - s.cross.y / H) * (hi - lo);
    ctx.fillStyle = pal.raised;
    ctx.fillRect(W - AXIS_W, s.cross.y - 8, AXIS_W, 16);
    ctx.fillStyle = pal.text;
    ctx.fillText(fmtP(p), W - AXIS_W + 6, s.cross.y + 3.5);
    return { bar: b, price: p, index: view.start + i };
  }
  return null;
}

// ---------- Volume Profile ----------

export function drawVP(canvas, s) {
  const { ctx, W, H } = setupCanvas(canvas);
  const { profile: p, pal } = s;
  if (!p) { ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H); return; }
  const lo = p.low - p.binSize, hi = p.high + p.binSize;
  const y = drawFrame(ctx, W, H, lo, hi, pal);
  const plotW = W - AXIS_W - 10;
  const rowH = Math.max(1, (y(p.low) - y(p.low + p.binSize)));

  for (let i = 0; i < p.vols.length; i++) {
    const price = p.low + i * p.binSize;
    const w = (p.vols[i] / p.maxVol) * plotW * 0.92;
    const inVa = i >= p.vaLowIdx && i <= p.vaHighIdx;
    ctx.fillStyle = i === p.pocIdx ? pal.poc : inVa ? pal.vpVa : pal.vpBar;
    ctx.fillRect(0, y(price + p.binSize) + 0.5, w, Math.max(1, rowH - 1));
  }
  hline(ctx, W, y(p.vah), pal.vah, 1.4, null, 'VAH ' + fmtP(p.vah), pal);
  hline(ctx, W, y(p.val), pal.val, 1.4, null, 'VAL ' + fmtP(p.val), pal);
  hline(ctx, W, y(p.poc), pal.poc, 1.6, null, 'POC ' + fmtP(p.poc), pal);

  ctx.font = FONT;
  for (const price of p.lvns) {
    ctx.fillStyle = pal.lvn;
    ctx.fillText('◄ LVN ' + fmtP(price), plotW * 0.55, y(price) + 3.5);
  }
  for (const price of p.hvns) {
    ctx.fillStyle = pal.muted;
    ctx.fillText('◄ HVN', plotW * 0.78, y(price) + 3.5);
  }
}

// ---------- TPO ----------

export function drawTPO(canvas, s) {
  const { ctx, W, H } = setupCanvas(canvas);
  const { profile: p, pal } = s;
  if (!p) { ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H); return; }
  const lo = p.low - p.binSize, hi = p.high + p.binSize;
  const y = drawFrame(ctx, W, H, lo, hi, pal);
  const rowH = y(p.low) - y(p.low + p.binSize);
  const fontPx = Math.max(7, Math.min(13, rowH - 1));
  ctx.font = `${fontPx}px "IBM Plex Mono", monospace`;
  const chW = ctx.measureText('M').width + 1;

  // Value Area Hintergrund
  ctx.fillStyle = pal.vaWash;
  ctx.fillRect(0, y(p.vah), W - AXIS_W, y(p.val) - y(p.vah));

  for (let i = 0; i < p.rows.length; i++) {
    const price = p.low + i * p.binSize;
    const blocks = [...p.rows[i]].sort((a, b) => a - b);
    const yy = y(price) - rowH * 0.15;
    const isSingle = p.counts[i] === 1;
    for (let k = 0; k < blocks.length; k++) {
      const letter = p.letters[blocks[k]] || '·';
      ctx.fillStyle = i === p.pocIdx ? pal.poc : isSingle ? pal.tpoSingle : pal.tpoLetter;
      ctx.fillText(letter, 4 + k * chW, yy);
    }
    if (isSingle) {
      ctx.fillStyle = pal.tpoSingle;
      ctx.fillText('— single', 4 + blocks.length * chW + 6, yy);
    }
  }
  if (p.poorHigh) { ctx.fillStyle = pal.dn; ctx.fillText('POOR HIGH', 6, y(p.high) - 4); }
  if (p.poorLow) { ctx.fillStyle = pal.dn; ctx.fillText('POOR LOW', 6, y(p.low) + rowH + 10); }
  hline(ctx, W, y(p.poc), pal.poc, 1.4, [2, 3], 'POC ' + fmtP(p.poc), pal);
}

// ---------- Footprint (Approximation) ----------

export function drawFootprint(canvas, s) {
  const { ctx, W, H } = setupCanvas(canvas);
  const { fp, pal } = s;
  if (!fp || !fp.cells.length) { ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H); return; }
  const cells = fp.cells.slice(-Math.max(4, s.maxCells || 14));
  // y-Range nur aus den sichtbaren Zellen – sonst quetscht die ganze
  // Session-Spanne die letzten Zellen in ein schmales Band
  let cLo = Infinity, cHi = -Infinity;
  for (const c of cells) { if (c.l < cLo) cLo = c.l; if (c.h > cHi) cHi = c.h; }
  const lo = cLo - fp.binSize, hi = cHi + fp.binSize;
  const y = drawFrame(ctx, W, H, lo, hi, pal);
  const plotW = W - AXIS_W;
  const cw = plotW / cells.length;
  const rowH = Math.max(1, y(fp.low) - y(fp.low + fp.binSize));
  ctx.font = FONT;

  cells.forEach((cell, ci) => {
    const x0 = ci * cw;
    const half = (cw - 8) / 2;
    for (const [binIdx, bin] of cell.bins) {
      const price = fp.priceAt(binIdx) - fp.binSize / 2;
      const yy = y(price + fp.binSize) + 0.5;
      const hgt = Math.max(1, rowH - 1);
      const dnW = (bin.dn / fp.maxBinVol) * half;
      const upW = (bin.up / fp.maxBinVol) * half;
      ctx.fillStyle = pal.fpSell;
      ctx.fillRect(x0 + 4 + half - dnW, yy, dnW, hgt);
      ctx.fillStyle = pal.fpBuy;
      ctx.fillRect(x0 + 4 + half, yy, upW, hgt);
    }
    // Close-Markierung + Zell-Delta unten
    ctx.strokeStyle = pal.muted; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0 + 2, y(cell.c)); ctx.lineTo(x0 + cw - 2, y(cell.c)); ctx.stroke();
    const d = Math.round(cell.delta);
    ctx.fillStyle = d >= 0 ? pal.up : pal.dn;
    const txt = (d >= 0 ? '+' : '') + d.toLocaleString('en-US');
    ctx.fillText(txt, x0 + 6, H - 6);
    const t = new Date(cell.start);
    ctx.fillStyle = pal.muted;
    ctx.fillText(String(t.getUTCHours()).padStart(2, '0') + ':' + String(t.getUTCMinutes()).padStart(2, '0') + 'z', x0 + 6, 12);
    if (ci > 0) {
      ctx.strokeStyle = pal.grid;
      ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, H); ctx.stroke();
    }
  });
}
