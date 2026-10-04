import { test } from 'node:test';
import assert from 'node:assert/strict';
import { volumeProfile, tpoProfile, footprint, sessionVwap, computeOdds, chooseBinSize } from '../js/charts/compute.js';
import { splitSessions, mergeBars, demoBars } from '../js/charts/data.js';

const bar = (min, o, h, l, c, v = 100) => ({ epoch: Date.UTC(2026, 9, 1, 14, min), o, h, l, c, v });

test('chooseBinSize liefert Tick-Vielfache', () => {
  assert.equal(chooseBinSize(31000, 31090, 0.25, 90) % 0.25, 0);
  assert.ok(chooseBinSize(31000, 31900, 0.25, 90) >= 0.25);
});

test('volumeProfile: POC liegt im dicksten Bereich, VA deckt ~70% ab', () => {
  const bars = [];
  // Viel Volumen um 31050, wenig an den Rändern
  for (let i = 0; i < 60; i++) bars.push(bar(i, 31049, 31052, 31048, 31050, 1000));
  for (let i = 60; i < 70; i++) bars.push(bar(i, 31010, 31012, 31008, 31010, 50));
  for (let i = 70; i < 80; i++) bars.push(bar(i, 31090, 31092, 31088, 31090, 50));
  const p = volumeProfile(bars, 0.25);
  assert.ok(Math.abs(p.poc - 31050) < 3, `POC ${p.poc}`);
  let va = 0;
  for (let i = p.vaLowIdx; i <= p.vaHighIdx; i++) va += p.vols[i];
  assert.ok(va / p.total >= 0.69, `VA nur ${(va / p.total * 100).toFixed(1)}%`);
  assert.ok(p.vah > p.poc && p.val < p.poc);
});

test('volumeProfile: LVN zwischen zwei Clustern wird gefunden', () => {
  const bars = [];
  for (let i = 0; i < 40; i++) bars.push(bar(i, 31000, 31004, 30998, 31002, 800));
  for (let i = 40; i < 46; i++) bars.push(bar(i, 31020, 31022, 31018, 31020, 30)); // dünne Mitte
  for (let i = 46; i < 86; i++) bars.push(bar(i, 31040, 31044, 31038, 31042, 800));
  const p = volumeProfile(bars, 0.25);
  assert.ok(p.lvns.some((x) => x > 31008 && x < 31036), 'kein LVN in der dünnen Mitte: ' + p.lvns.join(','));
});

test('tpoProfile: Letters, Single Prints und Poor High', () => {
  const bars = [];
  // Block A (0-29min) um 31000, Block B um 31010, Spike-Hoch nur in Block B
  for (let i = 0; i < 30; i += 5) bars.push(bar(i, 31000, 31004, 30998, 31002, 10));
  for (let i = 30; i < 60; i += 5) bars.push(bar(i, 31010, 31014, 31008, 31012, 10));
  bars.push({ epoch: Date.UTC(2026, 9, 1, 14, 55), o: 31012, h: 31030, l: 31012, c: 31013, v: 10 });
  const p = tpoProfile(bars, 0.25, 30 * 60000, 40);
  assert.ok(p.nBlocks >= 2);
  assert.ok(p.singles.length > 0, 'keine Single Prints am Spike');
  // Poor Low: unterste Zeile nur von Block A berührt -> 1 TPO -> kein poor low
  assert.equal(p.poorLow, false);
});

test('footprint: Tick-Rule teilt Volumen in Buy/Sell, Delta stimmt', () => {
  const bars = [
    bar(0, 31000, 31001, 30999, 31000, 100),
    bar(1, 31000, 31003, 31000, 31002, 200), // up -> buy
    bar(2, 31002, 31002, 30998, 30999, 300), // down -> sell
  ];
  const fp = footprint(bars, 0.25, 15 * 60000, 30);
  assert.equal(fp.cells.length, 1);
  const c = fp.cells[0];
  assert.equal(Math.round(c.delta), 200 - 300 + 100); // erste Bar erbt Richtung up (prevDir=1)
  let up = 0, dn = 0;
  for (const b of c.bins.values()) { up += b.up; dn += b.dn; }
  assert.ok(Math.abs(up - 300) < 1 && Math.abs(dn - 300) < 1, `up=${up} dn=${dn}`);
});

test('sessionVwap ist volumengewichtet', () => {
  const bars = [bar(0, 100, 100, 100, 100, 100), bar(1, 200, 200, 200, 200, 300)];
  const v = sessionVwap(bars);
  assert.equal(v[1], (100 * 100 + 200 * 300) / 400);
});

test('computeOdds: Level-Touch und Reversal werden gezählt', () => {
  // 3 Sessions, Level 31000: Session 1 touch+reversal hoch, Session 2 kein Touch, Session 3 touch+break runter
  const mk = (day, path) => path.map((p, i) => ({ epoch: Date.UTC(2026, 9, day, 14, i), o: p, h: p + 1, l: p - 1, c: p, v: 10 }));
  const sessions = new Map([
    ['2026-10-01', mk(1, [31010, 31005, 31001, 31012, 31030, ...Array(20).fill(31030)])],
    ['2026-10-02', mk(2, [31050, 31055, 31060, ...Array(22).fill(31060)])],
    ['2026-10-05', mk(5, [31010, 31002, 30990, 30970, ...Array(21).fill(30970)])],
  ]);
  const o = computeOdds(sessions, { level: 31000, reactionPts: 10 });
  assert.equal(o.n, 3);
  assert.equal(o.level.touched, 2);
  assert.equal(o.level.reversedPct, 50);
  assert.equal(o.level.brokePct, 50);
});

test('demoBars: deterministisch, 5 Sessions, Preise auf Viertelpunkte', () => {
  const a = demoBars();
  const b = demoBars();
  assert.equal(a.length, b.length);
  assert.equal(a[123].c, b[123].c);
  assert.equal(splitSessions(a).size, 5);
  assert.equal((a[500].c * 4) % 1, 0);
});

test('mergeBars: neuere Version derselben Bar gewinnt', () => {
  const oldB = [{ epoch: 1000, o: 1, h: 2, l: 0, c: 1, v: 10 }];
  const upd = [{ epoch: 1000, o: 1, h: 3, l: 0, c: 2, v: 25 }, { epoch: 2000, o: 2, h: 3, l: 1, c: 3, v: 5 }];
  const m = mergeBars(oldB, upd);
  assert.equal(m.length, 2);
  assert.equal(m[0].v, 25);
});
