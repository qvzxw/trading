import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, toEpoch, tradingDay, pnlFromFills, contractUsage, consistencyState } from '../js/engine.js';

const T = (iso) => ({ epochIfExplicit: Date.parse(iso) });

function acct(overrides = {}) {
  return {
    size: 50000, profitTarget: 3000,
    drawdown: { type: 'eod_trailing', amount: 2000, breachCheck: 'realtime', lockFloorAt: null },
    dailyLoss: null, maxContracts: 5, maxMicros: 50, consistency: null, minDays: 1,
    ...overrides,
  };
}

function ev(iso, pnl, extra = {}) {
  return { time: T(iso), pnl, actionText: '', ...extra };
}

test('Handelstag: 19:00 New York gehört zum nächsten Tag (CME-Session)', () => {
  // 2026-09-21 23:30 UTC = 19:30 New York (EDT) -> Handelstag 22.09.
  assert.equal(tradingDay(Date.parse('2026-09-21T23:30:00Z'), 'exchange'), '2026-09-22');
  // 2026-09-22 15:00 UTC = 11:00 New York -> Handelstag 22.09.
  assert.equal(tradingDay(Date.parse('2026-09-22T15:00:00Z'), 'exchange'), '2026-09-22');
});

test('toEpoch: naive Berliner Zeit wird korrekt konvertiert (Sommerzeit)', () => {
  const e = toEpoch({ y: 2026, mo: 9, d: 22, h: 20, mi: 39, s: 30 }, 'Europe/Berlin');
  assert.equal(e, Date.parse('2026-09-22T18:39:30Z')); // Berlin Sept = UTC+2
});

test('EOD-Trailing: Floor steigt nur mit Tagesschluss-Hochs und lockt am Cap', () => {
  const account = acct({ drawdown: { type: 'eod_trailing', amount: 2000, breachCheck: 'realtime', lockFloorAt: 50100 } });
  const parsed = {
    balanceEvents: [
      ev('2026-09-01T15:00:00Z', 1500),  // EOD 51500 -> Floor danach 49500
      ev('2026-09-02T15:00:00Z', 900),   // EOD 52400 -> Floor 50100 (Cap greift: 50400 -> 50100)
      ev('2026-09-03T15:00:00Z', -1000), // 51400, Floor bleibt 50100
    ],
    fills: [], warnings: [],
  };
  const r = simulate({ account, parsed, options: { timeZone: 'UTC' } });
  assert.equal(r.status, 'ongoing');
  assert.equal(r.days[0].floor, 48000);      // Starttag: 50000 - 2000
  assert.equal(r.days[1].floor, 49500);      // nach Tag 1: 51500 - 2000
  assert.equal(r.days[2].floor, 50100);      // Cap (Lock bei 50100), nicht 50400
});

test('EOD-Trailing realtime: Intraday-Berührung des Limits = Fail', () => {
  const account = acct();
  const parsed = {
    balanceEvents: [
      ev('2026-09-01T14:00:00Z', -1500),
      ev('2026-09-01T15:00:00Z', -500),  // Equity 48000 = Floor 48000 -> Bruch
      ev('2026-09-01T16:00:00Z', 3000),  // Erholung zählt nicht mehr
    ],
    fills: [], warnings: [],
  };
  const r = simulate({ account, parsed, options: { timeZone: 'UTC' } });
  assert.equal(r.status, 'failed');
  assert.equal(r.failed.type, 'drawdown');
});

test('EOD-Trailing mit breachCheck=eod: Intraday-Dip unter das Limit ist erlaubt', () => {
  const account = acct({ drawdown: { type: 'eod_trailing', amount: 2000, breachCheck: 'eod', lockFloorAt: null } });
  const parsed = {
    balanceEvents: [
      ev('2026-09-01T14:00:00Z', -2500), // Intraday 47500 < 48000, aber kein Realtime-Check
      ev('2026-09-01T15:00:00Z', 1000),  // EOD 48500 > 48000 -> kein Fail
    ],
    fills: [], warnings: [],
  };
  const r = simulate({ account, parsed, options: { timeZone: 'UTC' } });
  assert.equal(r.status, 'ongoing');
  assert.equal(r.violations.filter((v) => v.hard).length, 0);
});

test('Intraday-Trailing (Apex-Stil): Watermark zieht mit jedem Zwischenhoch', () => {
  const account = acct({ drawdown: { type: 'intraday_trailing', amount: 2500, breachCheck: 'realtime', lockFloorAt: null }, profitTarget: 3000 });
  const parsed = {
    balanceEvents: [
      ev('2026-09-01T14:00:00Z', 2000),  // Equity 52000 -> Floor danach 49500
      ev('2026-09-01T15:00:00Z', -2400), // 49600 > 49500 ok
      ev('2026-09-02T15:00:00Z', -200),  // 49400 <= 49500 -> Fail (Floor trailt intraday, nicht EOD)
    ],
    fills: [], warnings: [],
  };
  const r = simulate({ account, parsed, options: { timeZone: 'UTC' } });
  assert.equal(r.status, 'failed');
  assert.equal(r.failed.type, 'drawdown');
});

test('Statischer Drawdown bleibt fix', () => {
  const account = acct({ drawdown: { type: 'static', amount: 625, breachCheck: 'realtime', lockFloorAt: null }, size: 100000, profitTarget: 2000 });
  const parsed = {
    balanceEvents: [
      ev('2026-09-01T14:00:00Z', 1500),
      ev('2026-09-02T14:00:00Z', -2000), // 99500 > 99375 -> ok
    ],
    fills: [], warnings: [],
  };
  const r = simulate({ account, parsed, options: { timeZone: 'UTC' } });
  assert.equal(r.status, 'ongoing');
  assert.equal(r.days[1].floor, 99375);
});

test('Daily Loss Limit onHit=fail beendet die Auswertung', () => {
  const account = acct({ dailyLoss: { amount: 1000, onHit: 'fail' } });
  const parsed = {
    balanceEvents: [
      ev('2026-09-01T14:00:00Z', -600),
      ev('2026-09-01T15:00:00Z', -500), // Tages-P&L -1100 -> DLL
    ],
    fills: [], warnings: [],
  };
  const r = simulate({ account, parsed, options: { timeZone: 'UTC' } });
  assert.equal(r.status, 'failed');
  assert.equal(r.failed.type, 'daily_loss');
});

test('Daily Loss Limit onHit=lock ist nur eine Warnung', () => {
  const account = acct({ dailyLoss: { amount: 1000, onHit: 'lock' } });
  const parsed = {
    balanceEvents: [
      ev('2026-09-01T14:00:00Z', -1200),
      ev('2026-09-02T14:00:00Z', 4500),
    ],
    fills: [], warnings: [],
  };
  const r = simulate({ account, parsed, options: { timeZone: 'UTC' } });
  assert.equal(r.status, 'passed');
  assert.equal(r.violations.length, 1);
  assert.equal(r.violations[0].hard, false);
});

test('Bestanden: Target + Mindesttage müssen beide erfüllt sein', () => {
  const account = acct({ minDays: 2 });
  const parsed = {
    balanceEvents: [
      ev('2026-09-01T14:00:00Z', 3500),  // Target am Tag 1 erreicht, aber minDays=2
      ev('2026-09-02T14:00:00Z', 100),
    ],
    fills: [], warnings: [],
  };
  const r = simulate({ account, parsed, options: { timeZone: 'UTC' } });
  assert.equal(r.status, 'passed');
  assert.equal(r.passed.day, '2026-09-02');
});

test('Consistency blockt den Pass, bis der Anteil stimmt', () => {
  const account = acct({ consistency: { pct: 50, scope: 'eval' }, minDays: 1 });
  const parsed = {
    balanceEvents: [
      ev('2026-09-01T14:00:00Z', 3000),  // bester Tag 3000 = 100% vom Profit -> kein Pass
      ev('2026-09-02T14:00:00Z', 2000),  // total 5000, 3000/5000 = 60% -> immer noch nicht
      ev('2026-09-03T14:00:00Z', 1500),  // total 6500, 3000/6500 = 46% -> Pass
    ],
    fills: [], warnings: [],
  };
  const r = simulate({ account, parsed, options: { timeZone: 'UTC' } });
  assert.equal(r.status, 'passed');
  assert.equal(r.passed.day, '2026-09-03');
  assert.equal(r.stats.consistency.ok, true);
});

test('Payout-Consistency (scope payout) blockt das Bestehen nicht', () => {
  const account = acct({ consistency: { pct: 50, scope: 'payout' }, minDays: 1 });
  const parsed = {
    balanceEvents: [ev('2026-09-01T14:00:00Z', 3500)], // ein einziger großer Tag
    fills: [], warnings: [],
  };
  const r = simulate({ account, parsed, options: { timeZone: 'UTC' } });
  assert.equal(r.status, 'passed');
});

test('Reset im Export: nur Daten nach dem letzten Reset zählen', () => {
  const account = acct();
  const parsed = {
    balanceEvents: [
      ev('2026-08-30T14:00:00Z', -5000),
      ev('2026-08-31T09:00:00Z', 0, { reset: true, actionText: 'Reset paper trading account' }),
      ev('2026-09-01T14:00:00Z', 500),
    ],
    fills: [], warnings: [],
  };
  const r = simulate({ account, parsed, options: { timeZone: 'UTC' } });
  assert.equal(r.status, 'ongoing');
  assert.equal(r.stats.netPnl, 500);
  assert.ok(r.warnings.some((w) => w.includes('Reset')));
});

test('pnlFromFills: Long-Roundtrip in NQ ergibt Punkte × 20 $', () => {
  const fills = [
    { epoch: 1, symbol: 'CME_MINI:NQ1!', side: 'buy', qty: 2, price: 30000 },
    { epoch: 2, symbol: 'CME_MINI:NQ1!', side: 'sell', qty: 2, price: 30010 },
  ];
  const { events } = pnlFromFills(fills);
  assert.equal(events.length, 1);
  assert.equal(events[0].pnl, 2 * 10 * 20); // 2 Kontrakte × 10 Punkte × $20
});

test('pnlFromFills: Short-Roundtrip und Teilschließungen', () => {
  const fills = [
    { epoch: 1, symbol: 'NQ1!', side: 'sell', qty: 3, price: 30000 },
    { epoch: 2, symbol: 'NQ1!', side: 'buy', qty: 1, price: 29990 }, // +10 Punkte × $20
    { epoch: 3, symbol: 'NQ1!', side: 'buy', qty: 2, price: 30005 }, // -5 Punkte × 2 × $20
  ];
  const { events } = pnlFromFills(fills);
  assert.equal(events.length, 2);
  assert.equal(events[0].pnl, 200);
  assert.equal(events[1].pnl, -200);
});

test('contractUsage: Micros zählen als Zehntel-Mini, Peak über Symbole summiert', () => {
  const fills = [
    { epoch: 1, symbol: 'CME_MINI:NQ1!', side: 'buy', qty: 3, price: 30000 },
    { epoch: 2, symbol: 'CME_MICRO:MNQ1!', side: 'buy', qty: 20, price: 30000 },
    { epoch: 3, symbol: 'CME_MINI:NQ1!', side: 'sell', qty: 3, price: 30000 },
  ];
  const u = contractUsage(fills);
  assert.equal(u.maxTotalMinis, 5); // 3 NQ + 20 MNQ (=2 Minis)
});

test('consistencyState: liefert benötigten Gesamtprofit', () => {
  const map = new Map([['a', 3000], ['b', 1000]]);
  const c = consistencyState(map, 4000, { pct: 50, scope: 'eval' });
  assert.equal(c.ok, false);
  assert.equal(c.neededTotal, 6000);
});
