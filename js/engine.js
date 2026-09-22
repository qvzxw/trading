// Simulations-Engine: rechnet TradingView-Paper-Trading-Daten gegen Prop-Firm-Regeln.
//
// Account-Konfiguration (aus js/firms.js):
// {
//   size, profitTarget,
//   drawdown: { type: 'eod_trailing'|'intraday_trailing'|'static', amount,
//               breachCheck: 'realtime'|'eod',    // wann der Bruch zählt
//               lockFloorAt: number|null },       // absolute Obergrenze für den Floor (z. B. size), null = trailt ewig
//   dailyLoss: { amount, onHit: 'fail'|'lock' } | null,
//   maxContracts, maxMicros,
//   consistency: { pct, scope: 'eval'|'payout' } | null,
//   minDays,
// }

import { symbolSpec } from './symbols.js';

// ---------- Zeit ----------

function tzOffsetMs(epoch, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(epoch))) p[part.type] = part.value;
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - epoch;
}

// Naive Zeit (wie im CSV) + Zeitzone des Exports -> Epoch ms
export function toEpoch(ts, timeZone) {
  if (!ts) return null;
  if (ts.epochIfExplicit != null) return ts.epochIfExplicit;
  const { y, mo, d, h = 0, mi = 0, s = 0 } = ts;
  if (y == null) return null;
  if (timeZone === 'local') return new Date(y, mo - 1, d, h, mi, s).getTime();
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  let epoch = asUtc - tzOffsetMs(asUtc, timeZone);
  epoch = asUtc - tzOffsetMs(epoch, timeZone); // zweiter Durchlauf für DST-Kanten
  return epoch;
}

function wallClock(epoch, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(epoch))) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: +p.hour % 24 };
}

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// CME-Handelstag: Session öffnet 18:00 New York und gehört zum NÄCHSTEN Kalendertag,
// Schluss 17:00 New York. dayMode 'calendar' = Kalendertag in der Anzeige-Zeitzone.
export function tradingDay(epoch, dayMode = 'exchange', displayTz = 'America/New_York') {
  if (dayMode === 'calendar') return wallClock(epoch, displayTz).date;
  const { date, hour } = wallClock(epoch, 'America/New_York');
  return hour >= 18 ? shiftDate(date, 1) : date;
}

// ---------- P&L aus Fills rekonstruieren (Fallback ohne Guthabenübersicht) ----------

export function pnlFromFills(fills) {
  const events = [];
  const warnings = [];
  const pos = new Map(); // root -> { qty (signed), avg, mult }
  const skipped = new Set();
  const sorted = [...fills].sort((a, b) => a.epoch - b.epoch);
  for (const f of sorted) {
    const spec = symbolSpec(f.symbol);
    if (!spec || spec.multiplier == null) {
      if (spec && !skipped.has(spec.root)) { skipped.add(spec.root); }
      continue;
    }
    const st = pos.get(spec.root) || { qty: 0, avg: 0 };
    let remaining = f.qty;
    const dir = f.side === 'buy' ? 1 : -1;
    let pnl = 0;
    if (st.qty !== 0 && Math.sign(st.qty) !== dir) {
      const closeQty = Math.min(remaining, Math.abs(st.qty));
      // Long schließen: (Preis - Avg) * Menge; Short schließen: (Avg - Preis) * Menge
      pnl += (st.qty > 0 ? (f.price - st.avg) : (st.avg - f.price)) * closeQty * spec.multiplier;
      st.qty += dir * closeQty;
      remaining -= closeQty;
      if (st.qty === 0) st.avg = 0;
    }
    if (remaining > 0) {
      const newQty = st.qty + dir * remaining;
      st.avg = st.qty === 0 ? f.price : (st.avg * Math.abs(st.qty) + f.price * remaining) / Math.abs(newQty);
      st.qty = newQty;
    }
    pos.set(spec.root, st);
    if (pnl !== 0) {
      events.push({ epoch: f.epoch, pnl, symbol: f.symbol, actionText: `${f.side === 'buy' ? 'Buy' : 'Sell'} ${f.qty} ${spec.root} @ ${f.price}`, fromFills: true });
    }
  }
  for (const root of skipped) warnings.push(`Symbol ${root}: unbekannter Multiplikator – P&L dieses Symbols wurde übersprungen.`);
  const open = [...pos.entries()].filter(([, s]) => s.qty !== 0);
  if (open.length) warnings.push(`Offene Position(en) am Datenende (${open.map(([r, s]) => `${s.qty > 0 ? '+' : ''}${s.qty} ${r}`).join(', ')}) – unrealisierter P&L ist nicht enthalten.`);
  return { events, warnings };
}

// ---------- Kontrakt-Limits aus Fills ----------

export function contractUsage(fills) {
  const pos = new Map(); // root -> signed qty
  let maxTotalMinis = 0;
  let maxSingle = { root: null, qty: 0 };
  const sorted = [...fills].sort((a, b) => a.epoch - b.epoch);
  for (const f of sorted) {
    const spec = symbolSpec(f.symbol) || { root: f.symbol, miniEquiv: 1 };
    const dir = f.side === 'buy' ? 1 : -1;
    pos.set(spec.root, (pos.get(spec.root) || 0) + dir * f.qty);
    let total = 0;
    for (const [root, q] of pos) {
      const s = symbolSpec(root) || { miniEquiv: 1 };
      total += Math.abs(q) * (s.miniEquiv ?? 1);
      if (Math.abs(q) > maxSingle.qty) maxSingle = { root, qty: Math.abs(q) };
    }
    maxTotalMinis = Math.max(maxTotalMinis, total);
  }
  return { maxTotalMinis, maxSingle };
}

// ---------- Kernsimulation ----------

export function simulate({ account, parsed, options = {} }) {
  const tz = options.timeZone || 'UTC';
  const dayMode = options.dayMode || 'exchange';
  const dd = account.drawdown;
  const warnings = [...(parsed.warnings || [])];

  // 1. Events vorbereiten
  let fills = (parsed.fills || []).map((f) => ({ ...f, epoch: toEpoch(f.time, tz) })).filter((f) => f.epoch != null);
  let events;
  if ((parsed.balanceEvents || []).length > 0) {
    events = parsed.balanceEvents
      .map((e) => ({ ...e, epoch: toEpoch(e.time, tz) }))
      .filter((e) => e.epoch != null);
  } else if (fills.length > 0) {
    const rec = pnlFromFills(fills);
    events = rec.events;
    warnings.push('Keine Guthabenübersicht gefunden – P&L wurde aus dem Handelsverlauf rekonstruiert (ohne Gebühren).', ...rec.warnings);
  } else {
    return { status: 'empty', warnings: [...warnings, 'Keine verwertbaren Daten gefunden.'] };
  }
  events.sort((a, b) => a.epoch - b.epoch);

  // 2. Resets/Anpassungen behandeln: Simulation startet nach dem letzten Reset
  const resetIdx = events.reduce((acc, e, i) => (e.reset ? i : acc), -1);
  if (resetIdx >= 0 && options.ignoreResets !== true) {
    const dropped = resetIdx + 1;
    events = events.slice(dropped);
    warnings.push(`Paper-Konto-Reset im Export erkannt – die ${dropped} Einträge davor wurden ignoriert. Simulation startet nach dem Reset.`);
  }
  const adjustments = events.filter((e) => e.adjustment && !e.reset);
  if (adjustments.length) warnings.push(`${adjustments.length} Ein-/Auszahlung(en) im Export erkannt – sie zählen nicht als Trading-P&L.`);
  events = events.filter((e) => !e.reset && !e.adjustment);

  // 3. Zeitraum-Filter
  if (options.rangeStart) events = events.filter((e) => e.epoch >= options.rangeStart);
  if (options.rangeEnd) events = events.filter((e) => e.epoch <= options.rangeEnd);
  if (options.rangeStart) fills = fills.filter((f) => f.epoch >= options.rangeStart);
  if (options.rangeEnd) fills = fills.filter((f) => f.epoch <= options.rangeEnd);
  if (events.length === 0) return { status: 'empty', warnings: [...warnings, 'Im gewählten Zeitraum liegen keine Trades.'] };

  // 4. Simulation: Equity = Kontogröße + kumulierter Paper-P&L
  const size = account.size;
  const target = account.profitTarget != null ? size + account.profitTarget : null;
  const floorCap = dd.lockFloorAt != null ? dd.lockFloorAt : Infinity;

  let equity = size;
  let watermark = size;      // Höchste gesehene Equity (Event-Granularität) für intraday_trailing
  let eodHigh = size;        // Höchster Tagesschlussstand für eod_trailing
  let failed = null;         // { type, epoch, day, detail }
  let targetReachedAt = null;
  let passed = null;         // { epoch, day }
  const violations = [];
  const days = [];
  const points = [];         // { epoch, equity, floor } für den Chart

  const floorNow = () => {
    if (dd.type === 'static') return size - dd.amount;
    if (dd.type === 'intraday_trailing') return Math.min(watermark - dd.amount, floorCap);
    return Math.min(eodHigh - dd.amount, floorCap); // eod_trailing: Basis = höchster EOD-Stand
  };

  const addViolation = (v, hard) => {
    violations.push({ ...v, hard });
    if (hard && !failed) failed = v;
  };

  // Events nach Handelstag gruppieren
  const byDay = new Map();
  for (const e of events) {
    const day = tradingDay(e.epoch, dayMode, tz === 'local' ? undefined : tz);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e);
  }
  const dayKeys = [...byDay.keys()].sort();

  points.push({ epoch: events[0].epoch - 1, equity, floor: floorNow() });

  const consistencyDayPnl = new Map();

  for (const day of dayKeys) {
    const dayEvents = byDay.get(day);
    const dayStartEquity = equity;
    const dayFloor = floorNow(); // EOD-Trailing: Floor steht für den ganzen Tag fest
    let dayLocked = false;
    let dayMin = equity, dayMax = equity;

    for (const e of dayEvents) {
      equity += e.pnl;
      dayMin = Math.min(dayMin, equity);
      dayMax = Math.max(dayMax, equity);
      const floor = dd.type === 'intraday_trailing' ? floorNow() : dayFloor;
      points.push({ epoch: e.epoch, equity, floor });

      // Daily Loss Limit
      const dayPnl = equity - dayStartEquity;
      if (account.dailyLoss && dayPnl <= -account.dailyLoss.amount && !dayLocked && !failed) {
        dayLocked = true;
        const hard = account.dailyLoss.onHit === 'fail';
        addViolation({
          type: 'daily_loss', epoch: e.epoch, day,
          detail: `Daily Loss Limit (${fmtUsd(account.dailyLoss.amount)}) erreicht: Tages-P&L ${fmtUsd(dayPnl)}`,
        }, hard);
      }

      // Drawdown-Bruch
      if (!failed) {
        const breachRealtime = dd.type === 'intraday_trailing' || dd.type === 'static' || dd.breachCheck === 'realtime';
        if (breachRealtime && equity <= floor) {
          addViolation({
            type: 'drawdown', epoch: e.epoch, day,
            detail: `${ddLabel(dd)} verletzt: Equity ${fmtUsd(equity)} ≤ Limit ${fmtUsd(floor)}`,
          }, true);
        }
      }

      // Trailing-Watermark NACH dem Bruch-Check anheben
      if (dd.type === 'intraday_trailing') watermark = Math.max(watermark, equity);

      // Profit Target
      if (target != null && targetReachedAt == null && equity >= target && !failed) {
        targetReachedAt = { epoch: e.epoch, day };
      }
    }

    // Tagesabschluss
    const eodBalance = equity;
    const dayPnl = eodBalance - dayStartEquity;
    consistencyDayPnl.set(day, dayPnl);

    if (dd.type === 'eod_trailing' && dd.breachCheck === 'eod' && !failed && eodBalance <= dayFloor) {
      addViolation({
        type: 'drawdown', epoch: dayEvents[dayEvents.length - 1].epoch, day,
        detail: `${ddLabel(dd)} verletzt: Tagesschluss ${fmtUsd(eodBalance)} ≤ Limit ${fmtUsd(dayFloor)}`,
      }, true);
    }

    if (dd.type === 'eod_trailing') eodHigh = Math.max(eodHigh, eodBalance);

    days.push({
      day, pnl: dayPnl, eodBalance, floor: dayFloor, floorNext: floorNow(),
      min: dayMin, max: dayMax, trades: dayEvents.length, locked: dayLocked,
      afterFail: !!failed && failed.day !== day && dayKeys.indexOf(day) > dayKeys.indexOf(failed.day),
    });

    // Bestanden? (Target + Mindesttage + ggf. Consistency, ohne vorherigen Fail)
    // Consistency blockt das Bestehen nur, wenn sie in der Eval gilt (scope 'eval') –
    // Payout-Consistency (z. B. Apex) ist für die Eval egal.
    if (!failed && !passed && targetReachedAt) {
      const tradingDaysSoFar = days.length;
      const minDaysOk = tradingDaysSoFar >= (account.minDays || 0);
      const evalCons = account.consistency && account.consistency.scope === 'eval' ? account.consistency : null;
      const cons = consistencyState(consistencyDayPnl, equity - size, evalCons);
      if (minDaysOk && cons.ok) passed = { epoch: dayEvents[dayEvents.length - 1].epoch, day };
    }
  }

  // 5. Statistiken
  const dayList = days.filter((d) => !d.afterFail);
  const netPnl = equity - size;
  const best = days.reduce((a, d) => (d.pnl > a.pnl ? d : a), { pnl: -Infinity });
  const worst = days.reduce((a, d) => (d.pnl < a.pnl ? d : a), { pnl: Infinity });
  const minRoom = Math.min(...points.map((p) => p.equity - p.floor));
  const consistency = consistencyState(consistencyDayPnl, netPnl, account.consistency);
  const usage = fills.length ? contractUsage(fills) : null;

  if (usage && account.maxContracts != null && usage.maxTotalMinis > account.maxContracts + 1e-9) {
    addViolation({
      type: 'contracts', epoch: null, day: null,
      detail: `Kontrakt-Limit überschritten: max. ${round1(usage.maxTotalMinis)} Minis gleichzeitig (erlaubt: ${account.maxContracts})`,
    }, false);
  }

  const status = failed ? 'failed' : passed ? 'passed' : 'ongoing';

  return {
    status, failed, passed, targetReachedAt,
    violations, days, points, warnings,
    stats: {
      netPnl, endEquity: equity, floorEnd: floorNow(),
      tradingDays: days.length,
      bestDay: best.pnl === -Infinity ? null : best,
      worstDay: worst.pnl === Infinity ? null : worst,
      minRoom,
      roomToFloor: equity - floorNow(),
      distToTarget: target != null ? Math.max(0, target - equity) : null,
      winDays: dayList.filter((d) => d.pnl > 0).length,
      lossDays: dayList.filter((d) => d.pnl < 0).length,
      consistency,
      usage,
      firstEpoch: events[0].epoch,
      lastEpoch: events[events.length - 1].epoch,
    },
  };
}

// Consistency: bester Tag darf max. pct% des Gesamtprofits ausmachen.
export function consistencyState(dayPnlMap, totalPnl, rule) {
  if (!rule) return { ok: true, applicable: false };
  const bestDay = Math.max(0, ...dayPnlMap.values());
  if (totalPnl <= 0 || bestDay <= 0) return { ok: true, applicable: true, bestDay, sharePct: null, rule };
  const sharePct = (bestDay / totalPnl) * 100;
  const ok = sharePct <= rule.pct + 1e-9;
  // Wie viel Gesamtprofit wäre nötig, damit der beste Tag unter die Grenze fällt?
  const neededTotal = (bestDay / rule.pct) * 100;
  return { ok, applicable: true, bestDay, sharePct, neededTotal, rule };
}

function ddLabel(dd) {
  if (dd.type === 'static') return 'Max Drawdown (statisch)';
  if (dd.type === 'intraday_trailing') return 'Trailing Drawdown (Intraday)';
  return 'Trailing Drawdown (End of Day)';
}

function fmtUsd(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function round1(n) { return Math.round(n * 10) / 10; }

export { fmtUsd, ddLabel };
