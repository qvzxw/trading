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
  for (const root of skipped) warnings.push(`Symbol ${root}: unknown multiplier – this symbol's P&L was skipped.`);
  const open = [...pos.entries()].filter(([, s]) => s.qty !== 0);
  if (open.length) warnings.push(`Open position(s) at end of data (${open.map(([r, s]) => `${s.qty > 0 ? '+' : ''}${s.qty} ${r}`).join(', ')}) – unrealized P&L not included.`);
  return { events, warnings };
}

// ---------- Kontrakt-Limits aus Fills ----------

export function contractUsage(fills) {
  const pos = new Map(); // root -> signed qty
  let maxTotalMinis = 0;
  let maxSingle = { root: null, qty: 0 };
  const skipped = new Set();
  const sorted = [...fills].sort((a, b) => a.epoch - b.epoch);
  for (const f of sorted) {
    const spec = symbolSpec(f.symbol);
    // Unbekannte Symbole (Aktien, Krypto-Spot …) nicht als Futures-Kontrakte zählen
    if (!spec || spec.multiplier == null) {
      if (spec) skipped.add(spec.root);
      continue;
    }
    const dir = f.side === 'buy' ? 1 : -1;
    pos.set(spec.root, (pos.get(spec.root) || 0) + dir * f.qty);
    let total = 0;
    for (const [root, q] of pos) {
      const s = symbolSpec(root);
      // Firms zählen 10 Micros = 1 Mini, unabhängig vom Notional
      total += Math.abs(q) * (s && s.micro ? 0.1 : 1);
      if (Math.abs(q) > maxSingle.qty) maxSingle = { root, qty: Math.abs(q) };
    }
    maxTotalMinis = Math.max(maxTotalMinis, total);
  }
  return { maxTotalMinis, maxSingle, skippedRoots: [...skipped] };
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
    warnings.push('No balance history found – P&L reconstructed from the order history (fees not included).', ...rec.warnings);
  } else {
    return { status: 'empty', warnings: [...warnings, 'No usable data found.'] };
  }
  events.sort((a, b) => a.epoch - b.epoch);

  // 2. Resets/Anpassungen behandeln: Simulation startet nach dem letzten Reset
  const resetIdx = events.reduce((acc, e, i) => (e.reset ? i : acc), -1);
  if (resetIdx >= 0 && options.ignoreResets !== true) {
    const dropped = resetIdx + 1;
    const resetEpoch = events[resetIdx].epoch;
    events = events.slice(dropped);
    fills = fills.filter((f) => f.epoch > resetEpoch); // Kontrakt-Check nicht mit Vor-Reset-Trades füttern
    warnings.push(`Paper account reset detected in the export – the ${dropped} entries before it were ignored. The simulation starts after the reset.`);
  }
  const adjustments = events.filter((e) => e.adjustment && !e.reset);
  if (adjustments.length) warnings.push(`${adjustments.length} deposit(s)/withdrawal(s) detected in the export – they don't count as trading P&L.`);
  events = events.filter((e) => !e.reset && !e.adjustment);

  // 3. Zeitraum-Filter
  if (options.rangeStart) events = events.filter((e) => e.epoch >= options.rangeStart);
  if (options.rangeEnd) events = events.filter((e) => e.epoch <= options.rangeEnd);
  if (options.rangeStart) fills = fills.filter((f) => f.epoch >= options.rangeStart);
  if (options.rangeEnd) fills = fills.filter((f) => f.epoch <= options.rangeEnd);
  if (events.length === 0) return { status: 'empty', warnings: [...warnings, 'No trades in the selected date range.'] };

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

  // Events nach Handelstag gruppieren ('local' = echte Systemzeitzone, nicht der NY-Default)
  const displayTz = tz === 'local' ? Intl.DateTimeFormat().resolvedOptions().timeZone : tz;
  const byDay = new Map();
  for (const e of events) {
    const day = tradingDay(e.epoch, dayMode, displayTz);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e);
  }
  const dayKeys = [...byDay.keys()].sort();

  points.push({ epoch: events[0].epoch - 1, equity, floor: floorNow() });

  const consistencyDayPnl = new Map();
  const evalCons = account.consistency && account.consistency.scope === 'eval' ? account.consistency : null;
  // Eval-Consistency zum aktuellen Moment: bester Tag (inkl. laufendem Tag) vs. Gesamtprofit.
  // Payout-Consistency (scope 'payout', z. B. Apex) blockt das Bestehen nicht.
  const evalConsOkNow = (dayPnlNow, totalPnl) => {
    if (!evalCons) return true;
    let bestD = Math.max(0, dayPnlNow);
    for (const v of consistencyDayPnl.values()) bestD = Math.max(bestD, v);
    if (totalPnl <= 0 || bestD <= 0) return true;
    return (bestD / totalPnl) * 100 <= evalCons.pct + 1e-9;
  };

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
      if (account.dailyLoss && dayPnl <= -account.dailyLoss.amount && !dayLocked && !failed && !passed) {
        dayLocked = true;
        const hard = account.dailyLoss.onHit === 'fail';
        addViolation({
          type: 'daily_loss', epoch: e.epoch, day, equityAt: equity,
          detail: `Daily loss limit (${fmtUsd(account.dailyLoss.amount)}) hit: day P&L ${fmtUsd(dayPnl)}`,
        }, hard);
      }

      // Drawdown-Bruch. Nach einem DLL-Lock wäre der Rest des Tages auf dem Firm-Konto
      // gar nicht mehr gehandelt worden – diese Trades zählen nicht als Bruch.
      if (!failed && !passed && !dayLocked) {
        const breachRealtime = dd.type === 'intraday_trailing' || dd.type === 'static' || dd.breachCheck === 'realtime';
        if (breachRealtime && equity <= floor) {
          addViolation({
            type: 'drawdown', epoch: e.epoch, day, equityAt: equity,
            detail: `${ddLabel(dd)} breached: equity ${fmtUsd(equity)} ≤ limit ${fmtUsd(floor)}`,
          }, true);
        }
      }

      // Trailing-Watermark NACH dem Bruch-Check anheben
      if (dd.type === 'intraday_trailing') watermark = Math.max(watermark, equity);

      // Profit Target (Anzeige: erster Touch)
      if (target != null && targetReachedAt == null && equity >= target && !failed) {
        targetReachedAt = { epoch: e.epoch, day };
      }

      // Bestanden? Firms werten in Echtzeit: In dem Moment, in dem Equity über der
      // Target-Balance liegt UND Mindesttage UND Eval-Consistency (inkl. laufendem Tag)
      // gleichzeitig erfüllt sind, ist die Eval durch. Ein früherer Target-Touch allein
      // reicht nicht – fällt die Equity zurück, muss sie erneut über das Target.
      if (!failed && !passed && !dayLocked && target != null && equity >= target) {
        const daysSoFar = days.length + 1; // der laufende Tag zählt mit
        if (daysSoFar >= (account.minDays || 0) && evalConsOkNow(dayPnl, equity - size)) {
          passed = { epoch: e.epoch, day, equityAt: equity };
        }
      }
    }

    // Tagesabschluss
    const eodBalance = equity;
    const dayPnl = eodBalance - dayStartEquity;
    consistencyDayPnl.set(day, dayPnl);

    if (dd.type === 'eod_trailing' && dd.breachCheck === 'eod' && !failed && !passed && eodBalance <= dayFloor) {
      addViolation({
        type: 'drawdown', epoch: dayEvents[dayEvents.length - 1].epoch, day, equityAt: eodBalance,
        detail: `${ddLabel(dd)} breached: EOD close ${fmtUsd(eodBalance)} ≤ limit ${fmtUsd(dayFloor)}`,
      }, true);
    }

    if (dd.type === 'eod_trailing') eodHigh = Math.max(eodHigh, eodBalance);

    days.push({
      day, pnl: dayPnl, eodBalance, floor: dayFloor, floorNext: floorNow(),
      min: dayMin, max: dayMax, trades: dayEvents.length, locked: dayLocked,
      afterFail: !!failed && failed.day !== day && dayKeys.indexOf(day) > dayKeys.indexOf(failed.day),
      afterPass: !!passed && passed.day !== day,
    });

  }

  // 5. Statistiken – nur über die Tage, die für die Eval zählen (bis Fail bzw. Pass)
  const dayList = days.filter((d) => !d.afterFail && !d.afterPass);
  const netPnl = equity - size;
  const best = dayList.reduce((a, d) => (d.pnl > a.pnl ? d : a), { pnl: -Infinity });
  const worst = dayList.reduce((a, d) => (d.pnl < a.pnl ? d : a), { pnl: Infinity });

  // Knappster Moment: nur bis zum Fail; bei reinem EOD-Check zählt der Tagesschluss,
  // Intraday-Dips unters Limit sind dort erlaubt und wären irreführend.
  let minRoom = Infinity;
  if (dd.type === 'eod_trailing' && dd.breachCheck === 'eod') {
    for (const d of dayList) minRoom = Math.min(minRoom, d.eodBalance - d.floor);
  } else {
    const failEpoch = failed && failed.epoch != null ? failed.epoch : Infinity;
    for (const p of points) if (p.epoch <= failEpoch) minRoom = Math.min(minRoom, p.equity - p.floor);
  }
  if (!Number.isFinite(minRoom)) minRoom = equity - floorNow();

  const evalDayPnl = new Map(dayList.map((d) => [d.day, d.pnl]));
  const consistency = consistencyState(evalDayPnl, netPnl, account.consistency);
  const usage = fills.length ? contractUsage(fills) : null;

  if (usage) {
    for (const root of usage.skippedRoots || []) {
      warnings.push(`Symbol ${root}: not a known futures contract – doesn't count toward the contract limit.`);
    }
    if (account.maxContracts != null && usage.maxTotalMinis > account.maxContracts + 1e-9) {
      addViolation({
        type: 'contracts', epoch: null, day: null,
        detail: `Contract limit exceeded: max ${round1(usage.maxTotalMinis)} minis at once (allowed: ${account.maxContracts})`,
      }, false);
    }
  }

  const status = failed ? 'failed' : passed ? 'passed' : 'ongoing';

  return {
    status, failed, passed, targetReachedAt,
    violations, days, points, warnings,
    stats: {
      netPnl, endEquity: equity, floorEnd: floorNow(),
      tradingDays: dayList.length,
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
  if (dd.type === 'static') return 'Max drawdown (static)';
  if (dd.type === 'intraday_trailing') return 'Trailing drawdown (intraday)';
  return 'Trailing drawdown (end of day)';
}

function fmtUsd(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function round1(n) { return Math.round(n * 10) / 10; }

export { fmtUsd, ddLabel };
