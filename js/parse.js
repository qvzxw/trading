// Parser für TradingView-Paper-Trading-CSV-Exporte (deutsche + englische Header).
// Erkennt die Tabs "Guthabenübersicht"/"Account balance", "Handelsverlauf"/"Trading Journal",
// "Order-Verlauf"/"History" und "All Tabs"-Exporte mit mehreren Sektionen in einer Datei.

import { symbolRoot } from './symbols.js';

// ---------- Low-level CSV ----------

// Delimiter über die ersten ~10 nicht-leeren Zeilen sniffen – die erste Zeile kann
// ein Sektionstitel ohne Trennzeichen sein (deutscher All-Tabs-Export).
export function sniffDelimiter(text) {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 10);
  for (const line of lines) {
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && counts[ch] != null) counts[ch]++;
    }
  }
  let best = ',', bestCount = -1;
  for (const d of [',', ';', '\t']) {
    if (counts[d] > bestCount) { bestCount = counts[d]; best = d; }
  }
  return best;
}

// Erkennt den Dezimalstil einer Datei (Punkt- vs. Komma-Dezimal), damit mehrdeutige
// Einzelwerte wie "2,875" oder "50.000" konsistent gelesen werden.
export function detectNumberStyle(text, delimiter) {
  const t = String(text);
  const count = (re) => (t.match(re) || []).length;
  let comma = 3 * count(/\d{1,3}(?:\.\d{3})+,\d{1,2}(?!\d)/g) + count(/(?<![\d.,])\d+,\d{1,2}(?![\d.,])/g);
  let dot = 3 * count(/\d{1,3}(?:,\d{3})+\.\d{1,2}(?!\d)/g) + count(/(?<![\d.,:])\d+\.\d{1,2}(?![\d.,])/g);
  if (delimiter === ';') comma += 2;
  if (comma >= dot + 2) return 'comma';
  if (dot >= comma + 2) return 'dot';
  return null;
}

// RFC-4180-artig: Quotes, escaped Quotes, Delimiter in Quotes, \r\n.
export function parseCsv(text, delimiter) {
  const rows = [];
  let row = [], field = '', inQ = false, sawAny = false;
  const d = delimiter || sniffDelimiter(text);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') {
      inQ = true; sawAny = true;
    } else if (ch === d) {
      row.push(field); field = ''; sawAny = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (sawAny || field !== '') { row.push(field); rows.push(row); }
      row = []; field = ''; sawAny = false;
    } else { field += ch; sawAny = true; }
  }
  if (sawAny || field !== '') { row.push(field); rows.push(row); }
  return rows;
}

// "1.234,56" | "1,234.56" | "1234.56" | "-2 000,5" | "−655" | "(655)" | "655 USD" -> Number
// style ('dot' | 'comma') macht mehrdeutige Werte eindeutig; ohne Stil greift eine Heuristik.
export function parseNumber(raw, style) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  s = s.replace(/[−–—]/g, '-').replace(/[$€£\s ']/g, '').replace(/(USD|EUR|GBP|USDT)$/i, '');
  if (s.startsWith('-')) { negative = true; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (!/\d/.test(s)) return null; // "–", "USD", leer -> kein Wert (nicht 0)
  if (style === 'comma') {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (style === 'dot') {
    s = s.replace(/,/g, '');
  } else {
    const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.'); // 1.234,56
      else s = s.replace(/,/g, '');                                        // 1,234.56
    } else if (lastComma >= 0) {
      const parts = s.split(',');
      if (parts[0] === '0') s = parts.join('.');                                            // "0,5" ist immer dezimal
      else if (parts.length > 2) s = parts.join('');                                        // "1,234,567"
      else if (parts[1] && parts[1].length === 3 && parts[0].length <= 3) s = parts.join(''); // "1,234" -> eher Tausender
      else s = parts.join('.');
    } else if (lastDot >= 0) {
      const parts = s.split('.');
      if (parts.length > 2 && parts.slice(1).every((p) => p.length === 3)) s = parts.join(''); // "1.234.567"
      // Einzelner Punkt bleibt dezimal – TradingView exportiert Punkt-Dezimal ohne Tausendertrenner.
    }
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// Zeitstempel -> { y, mo, d, h, mi, s, epochIfExplicit } (naiv, TZ entscheidet der Aufrufer)
export function parseTimestamp(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Unix-Sekunden/Millisekunden
  if (/^\d{10}$/.test(s)) return { epochIfExplicit: Number(s) * 1000 };
  if (/^\d{13}$/.test(s)) return { epochIfExplicit: Number(s) };
  // ISO mit Offset/Z -> eindeutig
  if (/[tT ]\d{2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s.replace(' ', 'T'));
    if (Number.isFinite(t)) return { epochIfExplicit: t };
  }
  // "2026-09-22 20:39:30" / "2026-09-22T20:39" / "2026-09-22"
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return checkParts({ y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) });
  // "22.09.2026 20:39:30" (deutsch) / "22.09.2026"
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return checkParts({ y: +m[3], mo: +m[2], d: +m[1], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) });
  // "09/22/2026 8:39:30 PM" (US) – Tag/Monat werden getauscht, wenn nur dd/mm plausibel ist
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (m) {
    let h = +(m[4] || 0);
    const ap = (m[7] || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    let mo = +m[1], d = +m[2];
    if (mo > 12 && d <= 12) { const t = mo; mo = d; d = t; } // "22/09/2026" ist dd/mm
    return checkParts({ y: +m[3], mo, d, h, mi: +(m[5] || 0), s: +(m[6] || 0) });
  }
  const t = Date.parse(s);
  if (Number.isFinite(t)) return { epochIfExplicit: t };
  return null;
}

function checkParts(p) {
  return p.mo >= 1 && p.mo <= 12 && p.d >= 1 && p.d <= 31 && p.h < 24 && p.mi < 60 && p.s < 60 ? p : null;
}

// ---------- Header-Erkennung ----------

function norm(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/ /g, ' ')
    .replace(/[äöüß]/g, (c) => ({ ä: 'a', ö: 'o', ü: 'u', ß: 'ss' }[c]))
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

const COLS = {
  time:          ['time', 'zeit', 'datum', 'date', 'closing time', 'placing time', 'schlusszeit', 'orderzeit', 'zeitpunkt', 'fill time', 'ausfuhrungszeit'],
  balanceBefore: ['balance before', 'guthaben vor', 'kontostand vor', 'saldo vor'],
  balanceAfter:  ['balance after', 'guthaben nach', 'kontostand nach', 'saldo nach'],
  realizedPnl:   ['realized p l', 'realized pnl', 'realisierter g v', 'realisierter gewinn verlust', 'realized profit loss', 'profit', 'p l', 'g v', 'gewinn verlust', 'pnl'],
  action:        ['action', 'handlung', 'aktion', 'description', 'beschreibung', 'message', 'nachricht', 'text'],
  symbol:        ['symbol', 'instrument', 'ticker'],
  side:          ['side', 'seite', 'richtung', 'buy sell', 'kauf verkauf'],
  qty:           ['qty', 'quantity', 'menge', 'anzahl', 'stuck', 'contracts', 'kontrakte', 'units', 'einheiten', 'filled qty', 'ausgefuhrte menge'],
  price:         ['fill price', 'ausfuhrungspreis', 'price', 'preis', 'avg fill price', 'durchschnittlicher ausfuhrungspreis', 'ausgefuhrter preis'],
  status:        ['status'],
  type:          ['type', 'typ', 'order type', 'ordertyp'],
  commission:    ['commission', 'kommission', 'gebuhr', 'fees', 'gebuhren'],
};

function mapHeaders(headerRow) {
  const map = {};
  // Prioritäten: "Closing time" schlägt "Placing time" (Ausführungszeitpunkt),
  // "Filled Qty" schlägt die Order-Menge (Teilausführungen).
  headerRow.forEach((h, i) => {
    const n = norm(h);
    if (map.time == null && (n === 'closing time' || n === 'schlusszeit')) map.time = i;
    if (map.qty == null && (n === 'filled qty' || n === 'ausgefuhrte menge')) map.qty = i;
  });
  headerRow.forEach((h, i) => {
    const n = norm(h);
    if (!n) return;
    for (const [key, aliases] of Object.entries(COLS)) {
      if (map[key] != null) continue;
      if (aliases.includes(n)) { map[key] = i; return; }
    }
  });
  // Zweiter Durchgang: Wortgrenzen-Matches (z. B. "realized pnl value") –
  // "unrealized p l" darf dabei NICHT auf "realized p l" matchen.
  headerRow.forEach((h, i) => {
    const n = norm(h);
    if (!n) return;
    const padded = ' ' + n + ' ';
    for (const [key, aliases] of Object.entries(COLS)) {
      if (map[key] != null) continue;
      if (aliases.some((a) => a.length > 2 && padded.includes(' ' + a + ' '))) { map[key] = i; return; }
    }
  });
  return map;
}

function classify(map, headerRow) {
  // Positions-Tab (Take Profit/Stop Loss/Unrealized-Spalten, kein Status) ist kein Handelsverlauf
  const posMarker = headerRow && headerRow.some((h) => {
    const n = norm(h);
    return /unrealized|nicht realisiert/.test(n) || n === 'take profit' || n === 'stop loss';
  });
  if (posMarker && map.status == null) return 'positions';
  if (map.balanceBefore != null || map.balanceAfter != null) return 'balance';
  if (map.symbol != null && map.side != null && map.price != null) {
    return map.status != null ? 'orders' : 'fills';
  }
  if (map.symbol != null && map.qty != null && map.price != null) return 'fills';
  return 'unknown';
}

function looksLikeHeader(row) {
  if (!row || row.length < 2) return false;
  const m = mapHeaders(row);
  return Object.keys(m).length >= 2 && classify(m, row) !== 'unknown';
}

// Aus "Close long position for symbol CME_MINI:NQ1! at price 30967.50 for 1 units. Position AVG Price was 30836.50"
export function parseAction(text) {
  if (!text) return {};
  const s = String(text);
  const out = {};
  let m = s.match(/symbol\s+([A-Za-z0-9_.:!]+)/i);
  if (m) out.symbol = m[1];
  // Zahl muss mit Ziffer enden, sonst wird Satz-Interpunktion mitgecaptured ("price 30967.50.")
  m = s.match(/at price\s+([0-9]+(?:[.,][0-9]+)*)/i);
  if (m) out.price = parseNumber(m[1], 'dot'); // Action-Text ist immer englisch/punkt-dezimal
  m = s.match(/for\s+([0-9]+(?:[.,][0-9]+)*)\s+units?/i);
  if (m) out.qty = parseNumber(m[1], 'dot');
  m = s.match(/\b(close|open|reverse)\b/i);
  if (m) out.verb = m[1].toLowerCase();
  m = s.match(/\b(long|short)\b/i);
  if (m) out.direction = m[1].toLowerCase();
  if (/reset|zuruckgesetzt|zurückgesetzt/i.test(s)) out.reset = true;
  if (/deposit|withdraw|einzahlung|auszahlung|adjust/i.test(s)) out.adjustment = true;
  return out;
}

// ---------- Haupteinstieg ----------

// Zerlegt eine Datei (auch "Alle Tabs"-Export) in Tabellen-Sektionen.
export function splitSections(text) {
  const clean = text.replace(/^﻿/, '');
  const rows = parseCsv(clean);
  const sections = [];
  let current = null;
  for (const row of rows) {
    const nonEmpty = row.filter((c) => String(c).trim() !== '');
    if (nonEmpty.length === 0) { current = null; continue; }
    if (looksLikeHeader(row)) {
      current = { header: row, map: mapHeaders(row), rows: [] };
      current.kind = classify(current.map, row);
      sections.push(current);
      continue;
    }
    if (nonEmpty.length === 1 && row.length <= 2) {
      // Sektionstitel wie "Handelsverlauf" -> neue Sektion beginnt
      current = null;
      continue;
    }
    if (current) current.rows.push(row);
  }
  return sections.filter((s) => s.rows.length > 0);
}

function cell(row, idx) {
  return idx != null && idx < row.length ? row[idx] : null;
}

// Ergebnis: { balanceEvents:[], fills:[], warnings:[], detected:[] }
export function parseTradingViewExport(text, fileName) {
  const out = { balanceEvents: [], fills: [], warnings: [], detected: [] };
  const clean = String(text || '').replace(/^﻿/, '');
  // Dezimalstil einmal pro Datei bestimmen, damit "2,875" vs. "50.000" konsistent gelesen werden
  const style = detectNumberStyle(clean, sniffDelimiter(clean));
  const num = (v) => parseNumber(v, style);
  const sections = splitSections(clean);
  if (sections.length === 0) {
    out.warnings.push(`${fileName || 'Datei'}: keine bekannte Tabelle erkannt (weder Guthabenübersicht noch Handelsverlauf).`);
    return out;
  }
  for (const sec of sections) {
    if (sec.kind === 'balance') {
      out.detected.push('Guthabenübersicht');
      for (const row of sec.rows) {
        const time = parseTimestamp(cell(row, sec.map.time));
        const before = num(cell(row, sec.map.balanceBefore));
        const after = num(cell(row, sec.map.balanceAfter));
        const pnlRaw = num(cell(row, sec.map.realizedPnl));
        const actionText = cell(row, sec.map.action);
        if (!time || (after == null && pnlRaw == null)) continue;
        const action = parseAction(actionText);
        const pnl = pnlRaw != null ? pnlRaw : (after != null && before != null ? after - before : null);
        out.balanceEvents.push({
          time, balanceBefore: before, balanceAfter: after,
          pnl: pnl != null ? pnl : 0,
          actionText: actionText || '', ...action,
        });
      }
    } else if (sec.kind === 'fills' || sec.kind === 'orders') {
      out.detected.push(sec.kind === 'orders' ? 'Order-Verlauf' : 'Handelsverlauf');
      for (const row of sec.rows) {
        const status = norm(cell(row, sec.map.status) || '');
        // Exakter Match: "Partially Filled"/"Teilweise ausgeführt" zählen nicht als Fill
        if (sec.kind === 'orders' && status && !/^(filled|ausgefuhrt|executed)$/.test(status)) continue;
        const time = parseTimestamp(cell(row, sec.map.time));
        const qty = num(cell(row, sec.map.qty));
        const price = num(cell(row, sec.map.price));
        const symbol = cell(row, sec.map.symbol);
        const sideRaw = norm(cell(row, sec.map.side) || '');
        if (!time || !symbol || qty == null || price == null || qty === 0) continue;
        const side = /sell|verkauf|short/.test(sideRaw) ? 'sell' : /buy|kauf|long/.test(sideRaw) ? 'buy' : null;
        if (!side) continue;
        out.fills.push({ time, symbol, root: symbolRoot(symbol), side, qty: Math.abs(qty), price });
      }
    }
  }
  if (out.balanceEvents.length === 0 && out.fills.length === 0) {
    out.warnings.push(`${fileName || 'Datei'}: Tabellen erkannt (${out.detected.join(', ') || '–'}), aber keine verwertbaren Zeilen gefunden.`);
  }
  return out;
}

// Mehrere Dateien/Texte zusammenführen (z. B. Guthabenübersicht + Handelsverlauf separat exportiert)
export function mergeParsed(list) {
  const out = { balanceEvents: [], fills: [], warnings: [], detected: [] };
  for (const p of list) {
    out.balanceEvents.push(...p.balanceEvents);
    out.fills.push(...p.fills);
    out.warnings.push(...p.warnings);
    out.detected.push(...p.detected);
  }
  // Duplikate (gleiche Datei zweimal hochgeladen) grob entfernen
  const seenB = new Set();
  out.balanceEvents = out.balanceEvents.filter((e) => {
    const k = JSON.stringify([e.time, e.balanceBefore, e.balanceAfter, e.pnl, e.actionText]);
    if (seenB.has(k)) return false;
    seenB.add(k); return true;
  });
  const seenF = new Set();
  out.fills = out.fills.filter((f) => {
    const k = JSON.stringify([f.time, f.symbol, f.side, f.qty, f.price]);
    if (seenF.has(k)) return false;
    seenF.add(k); return true;
  });
  out.detected = [...new Set(out.detected)];
  return out;
}
