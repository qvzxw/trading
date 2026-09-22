// Tests gegen einen ECHTEN TradingView-Paper-Trading-Export (Juli 2026, MES-Trades),
// Quelle: öffentliches blotterbook-Repo. Verifiziert Header-Varianten der 2026er Generation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTradingViewExport, mergeParsed } from '../js/parse.js';
import { simulate } from '../js/engine.js';

const dir = new URL('./fixtures/', import.meta.url);
const balanceCsv = readFileSync(new URL('balance-history-2026.csv', dir), 'utf8');
const ordersCsv = readFileSync(new URL('order-history-2026.csv', dir), 'utf8');

test('Echter 2026-Export: Balance History wird vollständig geparst', () => {
  const p = parseTradingViewExport(balanceCsv, 'balance.csv');
  assert.ok(p.balanceEvents.length >= 40, `nur ${p.balanceEvents.length} Events`);
  assert.ok(p.detected.includes('Balance History'));
  // Erste Datenzeile: -31.25 auf MES-Short-Close
  const e = p.balanceEvents[0];
  assert.equal(e.pnl, -31.25);
  assert.equal(e.balanceAfter, 100186);
  assert.equal(e.symbol, 'CME_MINI:MES1!');
  // Kein Event ohne Zeitstempel
  assert.ok(p.balanceEvents.every((x) => x.time));
});

test('Echter 2026-Export: Order History liefert nur Filled-Orders mit Closing time', () => {
  const p = parseTradingViewExport(ordersCsv, 'orders.csv');
  assert.ok(p.fills.length > 10, `nur ${p.fills.length} Fills`);
  assert.ok(p.fills.every((f) => f.price != null && f.qty > 0));
  // Sample enthält MES (auch als Kontraktmonat MESM2026), MNQ und MCL
  const roots = new Set(p.fills.map((f) => f.root));
  assert.ok(roots.has('MES') && roots.size <= 4, [...roots].join(','));
  // Cancelled-Orders wurden gefiltert: Datei hat 99 Datenzeilen, nicht alle Filled
  const lines = ordersCsv.trim().split('\n').length - 1;
  assert.ok(p.fills.length < lines);
});

test('Echter 2026-Export: komplette Simulation läuft durch', () => {
  const merged = mergeParsed([
    parseTradingViewExport(balanceCsv, 'balance.csv'),
    parseTradingViewExport(ordersCsv, 'orders.csv'),
  ]);
  const account = {
    size: 100000, profitTarget: 6000,
    drawdown: { type: 'eod_trailing', amount: 3000, breachCheck: 'realtime', lockFloorAt: 100000 },
    dailyLoss: { amount: 2000, onHit: 'lock' }, maxContracts: 10, maxMicros: 100,
    consistency: { pct: 50, scope: 'eval' }, minDays: 0,
  };
  const r = simulate({ account, parsed: merged, options: { timeZone: 'America/New_York' } });
  assert.notEqual(r.status, 'empty');
  assert.ok(r.days.length >= 3, `nur ${r.days.length} Handelstage`);
  assert.ok(Number.isFinite(r.stats.netPnl));
  assert.ok(Number.isFinite(r.stats.minRoom));
  assert.ok(r.points.length > 10);
  // Balance-Konsistenz: Endstand = 100000 + Summe aller P&L (Fixture hat keine Resets)
  const sum = merged.balanceEvents.reduce((a, e) => a + e.pnl, 0);
  assert.ok(Math.abs(r.stats.netPnl - sum) < 0.01);
  // Kontraktnutzung aus Fills vorhanden (MES = 0.1 Mini)
  assert.ok(r.stats.usage && r.stats.usage.maxTotalMinis > 0);
});

test('Leere Export-Datei (0 Bytes) crasht nicht', () => {
  const p = parseTradingViewExport('', 'positions.csv');
  assert.equal(p.balanceEvents.length, 0);
  assert.equal(p.fills.length, 0);
  assert.ok(p.warnings.length > 0);
});

test('Deutsche Alt-Header (Saldo vor/nach) werden erkannt', () => {
  const csv = [
    'Zeit,Saldo vor,Saldo nach,Realisierter G&V (wert),Realisierter G&V (währung),Aktion',
    '2026-07-01 23:57:27,100217.25,100186,-31.25,USD,"Close short position for symbol CME_MINI:MES1! at price 7549.00 for 1 units."',
  ].join('\n');
  const p = parseTradingViewExport(csv, 'saldo.csv');
  assert.equal(p.balanceEvents.length, 1);
  assert.equal(p.balanceEvents[0].balanceBefore, 100217.25);
  assert.equal(p.balanceEvents[0].pnl, -31.25);
});

test('Commission-Einträge zählen als P&L-Ereignis', () => {
  const csv = [
    'Time,Balance before,Balance after,Realized PnL (value),Realized PnL (currency),Action',
    '2026-07-01 10:00:00,100000,99998.5,,USD,"Commission for: Enter position for symbol CME_MINI:MES1! at price 7549.00 for 1 units"',
  ].join('\n');
  const p = parseTradingViewExport(csv, 'comm.csv');
  assert.equal(p.balanceEvents.length, 1);
  assert.equal(p.balanceEvents[0].pnl, -1.5); // aus Balance-Differenz
  assert.equal(p.balanceEvents[0].adjustment, undefined);
});
