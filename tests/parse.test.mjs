import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseNumber, parseTimestamp, parseTradingViewExport, parseAction, mergeParsed, sniffDelimiter } from '../js/parse.js';
import { symbolRoot, symbolSpec } from '../js/symbols.js';

test('parseNumber: internationale Formate', () => {
  assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber('1.234,56'), 1234.56);
  assert.equal(parseNumber('1234.56'), 1234.56);
  assert.equal(parseNumber('-655'), -655);
  assert.equal(parseNumber('−655'), -655);        // Unicode-Minus
  assert.equal(parseNumber('+130.00 USD'), 130);
  assert.equal(parseNumber('(500)'), -500);
  assert.equal(parseNumber('50 655,00'), 50655);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('—'), null);
});

test('parseTimestamp: ISO, deutsch, US, Unix', () => {
  assert.deepEqual(parseTimestamp('2026-09-22 20:39:30'), { y: 2026, mo: 9, d: 22, h: 20, mi: 39, s: 30 });
  assert.deepEqual(parseTimestamp('22.09.2026 20:39'), { y: 2026, mo: 9, d: 22, h: 20, mi: 39, s: 0 });
  assert.equal(parseTimestamp('2026-09-22T20:39:30Z').epochIfExplicit, Date.parse('2026-09-22T20:39:30Z'));
  assert.equal(parseTimestamp('1758573570').epochIfExplicit, 1758573570000);
  const us = parseTimestamp('09/22/2026 8:39:30 PM');
  assert.equal(us.h, 20);
});

test('sniffDelimiter erkennt Semikolon-CSV', () => {
  assert.equal(sniffDelimiter('Zeit;Guthaben vor;Guthaben nach'), ';');
  assert.equal(sniffDelimiter('Time,Balance Before,Balance After'), ',');
});

test('parseCsv: Quotes mit Kommas und escaped Quotes', () => {
  const rows = parseCsv('a,"b,c","d""e"\n1,2,3');
  assert.deepEqual(rows[0], ['a', 'b,c', 'd"e']);
  assert.deepEqual(rows[1], ['1', '2', '3']);
});

test('Guthabenübersicht (englische Header) wird erkannt', () => {
  const csv = [
    'Time,Balance Before,Balance After,Realized P&L,Action',
    '2026-09-22 20:39:30,50785.00,50655.00,-130.00,"Close long position for symbol CME_MINI:NQ1! at price 30967.50 for 1 units. Position AVG Price was 30980.50"',
    '2026-09-22 19:10:00,50000.00,50785.00,785.00,"Close short position for symbol CME_MINI:NQ1! at price 30900.00 for 1 units. Position AVG Price was 30939.25"',
  ].join('\n');
  const p = parseTradingViewExport(csv, 'account.csv');
  assert.equal(p.balanceEvents.length, 2);
  assert.equal(p.balanceEvents[0].pnl, -130);
  assert.equal(p.balanceEvents[0].symbol, 'CME_MINI:NQ1!');
  assert.equal(p.balanceEvents[0].qty, 1);
  assert.ok(p.detected.includes('Balance History'));
});

test('Guthabenübersicht (deutsche Header, Semikolon, Dezimalkomma)', () => {
  const csv = [
    'Zeit;Guthaben vor;Guthaben nach;Realisierter G&V;Handlung',
    '2026-09-22 20:39:30;50.785,00;50.655,00;-130,00;"Close long position for symbol CME_MINI:NQ1! at price 30967.50 for 1 units."',
  ].join('\n');
  const p = parseTradingViewExport(csv, 'konto.csv');
  assert.equal(p.balanceEvents.length, 1);
  assert.equal(p.balanceEvents[0].pnl, -130);
  assert.equal(p.balanceEvents[0].balanceAfter, 50655);
});

test('Handelsverlauf/Fills werden erkannt', () => {
  const csv = [
    'Symbol,Side,Qty,Fill Price,Time',
    'CME_MINI:NQ1!,Buy,2,30950.25,2026-09-22 15:30:00',
    'CME_MINI:NQ1!,Sell,2,30967.50,2026-09-22 16:45:00',
  ].join('\n');
  const p = parseTradingViewExport(csv, 'trades.csv');
  assert.equal(p.fills.length, 2);
  assert.equal(p.fills[0].side, 'buy');
  assert.equal(p.fills[0].root, 'NQ');
});

test('Order-Verlauf: nur Filled-Orders zählen', () => {
  const csv = [
    'Symbol,Side,Type,Qty,Fill Price,Status,Time',
    'CME_MINI:NQ1!,Buy,Market,1,30950.25,Filled,2026-09-22 15:30:00',
    'CME_MINI:NQ1!,Sell,Limit,1,31000.00,Cancelled,2026-09-22 15:35:00',
  ].join('\n');
  const p = parseTradingViewExport(csv, 'orders.csv');
  assert.equal(p.fills.length, 1);
});

test('All-Tabs-Export: mehrere Sektionen in einer Datei', () => {
  const csv = [
    'Guthabenübersicht',
    'Time,Balance Before,Balance After,Realized P&L,Action',
    '2026-09-22 20:39:30,50785.00,50655.00,-130.00,"Close long position for symbol CME_MINI:NQ1! at price 30967.50 for 1 units."',
    '',
    'Handelsverlauf',
    'Symbol,Side,Qty,Fill Price,Time',
    'CME_MINI:NQ1!,Buy,1,30950.25,2026-09-22 15:30:00',
  ].join('\n');
  const p = parseTradingViewExport(csv, 'all.csv');
  assert.equal(p.balanceEvents.length, 1);
  assert.equal(p.fills.length, 1);
});

test('parseAction: Reset und Einzahlung werden markiert', () => {
  assert.equal(parseAction('Reset paper trading account').reset, true);
  assert.equal(parseAction('Deposit 10000 to account').adjustment, true);
  const a = parseAction('Close long position for symbol CME_MINI:NQ1! at price 30967.50 for 1 units.');
  assert.equal(a.verb, 'close');
  assert.equal(a.direction, 'long');
  assert.equal(a.price, 30967.5);
});

test('mergeParsed entfernt Duplikate', () => {
  const csv = 'Time,Balance Before,Balance After,Realized P&L,Action\n2026-09-22 20:39:30,50785.00,50655.00,-130.00,x';
  const a = parseTradingViewExport(csv, 'a.csv');
  const b = parseTradingViewExport(csv, 'b.csv');
  const m = mergeParsed([a, b]);
  assert.equal(m.balanceEvents.length, 1);
});

test('parseNumber: Platzhalter und Stil-Hints', () => {
  assert.equal(parseNumber('USD'), null);
  assert.equal(parseNumber('–'), null);          // En-Dash
  assert.equal(parseNumber('1.234.567'), 1234567);
  assert.equal(parseNumber('0,5'), 0.5);
  assert.equal(parseNumber('2,875', 'comma'), 2.875);
  assert.equal(parseNumber('50.000', 'comma'), 50000);
  assert.equal(parseNumber('1,234.56', 'dot'), 1234.56);
});

test('parseTimestamp: dd/mm-Erkennung und Bereichs-Validierung', () => {
  const dm = parseTimestamp('22/09/2026 14:30');
  assert.equal(dm.d, 22);
  assert.equal(dm.mo, 9);
  assert.equal(parseTimestamp('45.13.2026'), null);
  assert.equal(parseTimestamp('2026-13-01 10:00:00'), null);
});

test('Deutsche Datei: Dezimalstil wird pro Datei erkannt (mehrdeutiges "2,875")', () => {
  const csv = [
    'Zeit;Guthaben vor;Guthaben nach;Realisierter G&V;Handlung',
    '2026-09-22 20:39:30;50.785,00;50.787,88;2,875;"Close long position for symbol CME_MINI:MNQ1! at price 24967.50 for 1 units."',
  ].join('\n');
  const p = parseTradingViewExport(csv, 'de.csv');
  assert.equal(p.balanceEvents[0].pnl, 2.875);
  assert.equal(p.balanceEvents[0].balanceAfter, 50787.88);
});

test('All-Tabs mit Titelzeile zuerst: Delimiter wird über mehrere Zeilen erkannt', () => {
  const csv = [
    'Guthabenübersicht',
    'Zeit;Guthaben vor;Guthaben nach;Realisierter G&V;Handlung',
    '2026-09-22 20:39:30;50.785,00;50.655,00;-130,00;"Close long position for symbol CME_MINI:NQ1! at price 30967.50 for 1 units."',
  ].join('\n');
  const p = parseTradingViewExport(csv, 'alltabs-de.csv');
  assert.equal(p.balanceEvents.length, 1);
  assert.equal(p.balanceEvents[0].pnl, -130);
});

test('Partially Filled zählt nicht als Fill', () => {
  const csv = [
    'Symbol,Side,Type,Qty,Fill Price,Status,Time',
    'CME_MINI:NQ1!,Buy,Limit,3,30950.25,Partially Filled,2026-09-22 15:30:00',
    'CME_MINI:NQ1!,Buy,Limit,2,30950.25,Filled,2026-09-22 15:31:00',
  ].join('\n');
  const p = parseTradingViewExport(csv, 'orders.csv');
  assert.equal(p.fills.length, 1);
  assert.equal(p.fills[0].qty, 2);
});

test('Positions-Tab wird ignoriert (keine Phantom-Fills)', () => {
  const csv = [
    'Symbol,Side,Qty,Avg Fill Price,Take Profit,Stop Loss',
    'CME_MINI:NQ1!,Buy,2,30950.25,31200,30800',
  ].join('\n');
  const p = parseTradingViewExport(csv, 'positions.csv');
  assert.equal(p.fills.length, 0);
  assert.equal(p.balanceEvents.length, 0);
});

test('parseAction: Satzzeichen hinter der Zahl wird nicht mitgelesen', () => {
  const a = parseAction('Close long position for symbol CME_MINI:NQ1! at price 30967.50, currency: USD');
  assert.equal(a.price, 30967.5);
  const b = parseAction('Close long position for symbol X at price 30967.50.');
  assert.equal(b.price, 30967.5);
});

test('symbolRoot: Exchange-Prefix, Continuous, Kontraktmonate', () => {
  assert.equal(symbolRoot('CME_MINI:NQ1!'), 'NQ');
  assert.equal(symbolRoot('CME_MICRO:MNQ1!'), 'MNQ');
  assert.equal(symbolRoot('NQZ2026'), 'NQ');
  assert.equal(symbolRoot('COMEX:GC1!'), 'GC');
  assert.equal(symbolSpec('CME_MINI:ES1!').multiplier, 50);
  assert.equal(symbolSpec('MNQ1!').miniEquiv, 0.1);
});
