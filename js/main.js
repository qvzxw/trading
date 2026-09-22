import { FIRMS, RULES_AS_OF } from './firms.js';
import { parseTradingViewExport, mergeParsed } from './parse.js';
import { simulate, ddLabel, toEpoch } from './engine.js';
import { renderEquityChart } from './chart.js';
import { DEMO_CSV } from './demo.js';

const $ = (id) => document.getElementById(id);

const state = {
  firmId: null,
  acctId: null,
  sources: [],       // { name, parsed }
  isDemo: false,
  result: null,
};

// ---------- Persistenz (nur Komfort) ----------
const store = {
  get(k) { try { return localStorage.getItem('propreplay.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('propreplay.' + k, v); } catch { /* egal */ } },
};

// ---------- Format-Helfer ----------
const usd = (n, digits = 0) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const usdSigned = (n, digits = 0) => (n > 0 ? '+' : n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtDay = (iso) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y.slice(2)}`; };

function currentFirm() { return FIRMS.find((f) => f.id === state.firmId) || FIRMS[0]; }
function currentAccount() {
  const firm = currentFirm();
  return firm.accounts.find((a) => a.id === state.acctId) || firm.accounts[0];
}

// ---------- Schritt 1: Firma + Account ----------

function renderFirms() {
  const row = $('firm-row');
  row.textContent = '';
  for (const firm of FIRMS.filter((f) => f.accounts.length > 0)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = firm.name;
    b.setAttribute('aria-pressed', String(firm.id === state.firmId));
    b.addEventListener('click', () => {
      state.firmId = firm.id;
      state.acctId = firm.accounts[0]?.id || null;
      store.set('firm', firm.id); store.set('acct', state.acctId || '');
      renderFirms(); recompute();
    });
    row.appendChild(b);
  }
  renderAccounts();
}

function renderAccounts() {
  const firm = currentFirm();
  const row = $('acct-row');
  row.textContent = '';
  for (const a of firm.accounts) {
    const b = document.createElement('button');
    b.className = 'acct-card';
    b.type = 'button';
    b.setAttribute('aria-pressed', String(a.id === (state.acctId || firm.accounts[0].id)));
    const name = document.createElement('span');
    name.className = 'acct-name';
    name.textContent = a.label;
    const meta = document.createElement('span');
    meta.className = 'acct-meta';
    meta.textContent = `${shortDd(a)}${a.profitTarget != null ? ` · Target ${usd(a.profitTarget)}` : ' · kein Target (funded)'}`;
    b.append(name, meta);
    b.addEventListener('click', () => {
      state.acctId = a.id;
      store.set('acct', a.id);
      renderAccounts(); recompute();
    });
    row.appendChild(b);
  }
  renderRulesSummary();
}

function shortDd(a) {
  const t = a.drawdown.type;
  const kind = t === 'static' ? 'statisch' : t === 'intraday_trailing' ? 'Intraday-Trailing' : 'EOD-Trailing';
  return `${usd(a.drawdown.amount)} ${kind}`;
}

function renderRulesSummary() {
  const firm = currentFirm();
  const a = currentAccount();
  const host = $('rules-summary');
  host.textContent = '';
  const kv = (k, v, sub) => {
    const div = document.createElement('div');
    div.className = 'rule-kv';
    const kEl = document.createElement('div'); kEl.className = 'k'; kEl.textContent = k;
    const vEl = document.createElement('div'); vEl.className = 'v'; vEl.textContent = v;
    if (sub) { const s = document.createElement('small'); s.textContent = ' ' + sub; vEl.appendChild(s); }
    div.append(kEl, vEl);
    host.appendChild(div);
  };
  kv('Kontogröße', usd(a.size));
  kv('Profit Target', a.profitTarget != null ? usd(a.profitTarget) : 'keins', a.profitTarget == null ? 'Funded-Account' : '');
  kv(ddLabel(a.drawdown), usd(a.drawdown.amount), a.drawdown.lockFloorAt != null ? `lockt bei ${usd(a.drawdown.lockFloorAt)}` : 'trailt durchgehend');
  kv('Daily Loss Limit', a.dailyLoss ? usd(a.dailyLoss.amount) : 'keins', a.dailyLoss ? (a.dailyLoss.onHit === 'fail' ? 'Bruch = durchgefallen' : 'Konto für den Tag gesperrt') : '');
  kv('Kontrakte max.', a.maxContracts != null ? `${a.maxContracts} Minis` : '–', a.maxMicros != null ? `/ ${a.maxMicros} Micros` : '');
  kv('Mindesttage', a.minDays != null ? String(a.minDays) : '–');
  kv('Consistency', a.consistency ? `${a.consistency.pct}%` : 'keine', a.consistency ? (a.consistency.scope === 'eval' ? 'gilt in der Eval' : 'erst bei Payout') : '');
  if (a.priceMonthly != null) kv('Preis', `${usd(a.priceMonthly)}/Monat`, 'Listenpreis');
  else if (a.priceOnce != null) kv('Preis', `${usd(a.priceOnce)} einmalig`, 'Listenpreis, oft rabattiert');
  if (firm.note || (a.notes && a.notes.length)) {
    const note = document.createElement('div');
    note.className = 'firm-note';
    note.textContent = [firm.note, ...(a.notes || [])].filter(Boolean).join(' · ');
    host.appendChild(note);
  }
  updateQuickCheckLabels();
}

// ---------- Schritt 2: Datenimport ----------

function bindImport() {
  const dz = $('dropzone');
  const fi = $('file-input');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { fi.click(); e.preventDefault(); } });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', async (e) => {
    e.preventDefault(); dz.classList.remove('dragover');
    await readFiles([...(e.dataTransfer?.files || [])]);
  });
  fi.addEventListener('change', async () => { await readFiles([...fi.files]); fi.value = ''; });

  $('paste-btn').addEventListener('click', () => {
    const text = $('paste-area').value.trim();
    if (!text) return;
    addSource('Eingefügter Text', text);
    $('paste-area').value = '';
  });
  $('demo-btn').addEventListener('click', loadDemo);
  $('clear-btn').addEventListener('click', () => {
    state.sources = []; state.isDemo = false;
    recompute();
  });

  for (const id of ['tz-select', 'day-select', 'range-start', 'range-end']) {
    $(id).addEventListener('change', () => {
      store.set(id, $(id).value);
      recompute();
    });
  }
  const tz = store.get('tz-select'); if (tz) $('tz-select').value = tz;
  const dm = store.get('day-select'); if (dm) $('day-select').value = dm;
}

async function readFiles(files) {
  for (const f of files) {
    const text = await f.text();
    addSource(f.name, text);
  }
}

function addSource(name, text) {
  if (state.isDemo) { state.sources = []; state.isDemo = false; }
  const parsed = parseTradingViewExport(text, name);
  state.sources.push({ name, parsed });
  recompute();
}

function loadDemo() {
  state.sources = [{ name: 'Beispieldaten', parsed: parseTradingViewExport(DEMO_CSV, 'demo.csv') }];
  state.isDemo = true;
  recompute();
}

function renderImportStatus(merged) {
  const host = $('import-status');
  host.textContent = '';
  $('clear-btn').hidden = state.sources.length === 0;
  if (!state.sources.length) return;
  for (const s of state.sources) {
    const line = document.createElement('div');
    const ok = s.parsed.balanceEvents.length + s.parsed.fills.length > 0;
    line.className = ok ? 'ok' : '';
    line.textContent = `${ok ? '✓' : '✕'} ${s.name}: ${s.parsed.balanceEvents.length} Kontobewegungen, ${s.parsed.fills.length} Fills` +
      (s.parsed.detected.length ? ` (${s.parsed.detected.join(', ')})` : '');
    host.appendChild(line);
  }
  if (state.isDemo) {
    const note = document.createElement('div');
    note.textContent = 'Das sind Beispieldaten zum Ausprobieren – lade deinen eigenen Export, um deine Zahlen zu sehen.';
    host.appendChild(note);
  }
  void merged;
}

// ---------- Simulation + Rendering ----------

function currentOptions() {
  const opts = {
    timeZone: $('tz-select').value,
    dayMode: $('day-select').value,
  };
  // Zeitraum-Grenzen in der gewählten CSV-Zeitzone interpretieren, nicht als UTC-Mitternacht
  const parseDay = (v) => { const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
  const rs = parseDay($('range-start').value || '');
  const re = parseDay($('range-end').value || '');
  if (rs) opts.rangeStart = toEpoch({ ...rs, h: 0, mi: 0, s: 0 }, opts.timeZone);
  if (re) opts.rangeEnd = toEpoch({ ...re, h: 23, mi: 59, s: 59 }, opts.timeZone);
  return opts;
}

function recompute() {
  renderRulesSummary();
  const merged = mergeParsed(state.sources.map((s) => s.parsed));
  renderImportStatus(merged);
  const root = $('result-root');
  if (!state.sources.length) { root.hidden = true; state.result = null; renderWarnings([]); return; }
  const account = currentAccount();
  try {
    const result = simulate({ account, parsed: merged, options: currentOptions() });
    state.result = result;
    if (result.status === 'empty') {
      root.hidden = true;
      renderWarnings(result.warnings);
      return;
    }
    root.hidden = false;
    renderHero(result, account);
    renderTiles(result, account);
    renderEquityChart($('chart-host'), result, account);
    renderRuleCheck(result, account);
    renderDaysTable(result, account);
    renderWarnings(result.warnings);
  } catch (err) {
    root.hidden = true;
    state.result = null;
    renderWarnings([`Auswertung fehlgeschlagen: ${err && err.message ? err.message : err}. Prüfe die Datei oder melde das als Bug.`]);
  }
}

function renderHero(result, account) {
  const hero = $('result-hero');
  hero.classList.remove('passed', 'failed', 'ongoing');
  const v = $('verdict'), why = $('verdict-why');
  if (result.status === 'failed') {
    hero.classList.add('failed');
    v.textContent = 'Account geplatzt';
    why.textContent = `${result.failed.detail} — am ${fmtDay(result.failed.day)}. Mit diesen Trades wäre die ${currentFirm().name}-Eval hier vorbei gewesen.`;
  } else if (result.status === 'passed') {
    hero.classList.add('passed');
    v.textContent = 'Eval bestanden ✓';
    const afterDays = result.days.filter((d) => d.afterPass).length;
    why.textContent = `Profit Target ${usd(account.profitTarget)} erreicht, alle Regeln eingehalten — bestanden am ${fmtDay(result.passed.day)}.` +
      (afterDays ? ` Die ${afterDays} Handelstage danach zählen für die Eval nicht mehr.` : '');
  } else {
    hero.classList.add('ongoing');
    v.textContent = account.profitTarget != null ? 'Läuft noch' : 'Account lebt noch';
    const bits = [];
    if (result.stats.distToTarget != null && result.stats.distToTarget > 0) bits.push(`noch ${usd(result.stats.distToTarget)} bis zum Target`);
    else if (result.targetReachedAt) bits.push('Target erreicht');
    if (!result.stats.consistency.ok && account.consistency && account.consistency.scope === 'eval') bits.push('Consistency noch nicht erfüllt');
    if ((account.minDays || 0) > result.stats.tradingDays) bits.push(`noch ${account.minDays - result.stats.tradingDays} Handelstag(e) nötig`);
    bits.push(`${usd(result.stats.roomToFloor)} Luft bis zum Drawdown-Limit`);
    why.textContent = 'Kein Regelbruch bisher — ' + bits.join(', ') + '.';
  }
}

function tile(label, value, cls = '', sub = '') {
  const t = document.createElement('div');
  t.className = 'tile';
  const l = document.createElement('div'); l.className = 'label'; l.textContent = label;
  const v = document.createElement('div'); v.className = 'value ' + cls; v.textContent = value;
  t.append(l, v);
  if (sub) { const s = document.createElement('div'); s.className = 'sub'; s.textContent = sub; t.appendChild(s); }
  return t;
}

function renderTiles(result, account) {
  const host = $('tiles');
  host.textContent = '';
  const st = result.stats;
  host.append(
    tile('Netto-P&L', usdSigned(st.netPnl), st.netPnl >= 0 ? 'pos' : 'neg', `Endstand ${usd(st.endEquity)}`),
    tile('Luft bis Limit', usd(st.roomToFloor), st.roomToFloor < account.drawdown.amount * 0.25 ? 'neg' : '', `Limit aktuell ${usd(st.floorEnd)}`),
    tile('Bis zum Target', st.distToTarget != null ? usd(st.distToTarget) : '–', '',
      result.targetReachedAt ? `erreicht am ${fmtDay(result.targetReachedAt.day)}` :
      account.profitTarget != null ? `Target ${usd(account.size + account.profitTarget)}` : 'Funded-Account ohne Target'),
    tile('Knappster Moment', usd(st.minRoom), st.minRoom < account.drawdown.amount * 0.15 ? 'neg' : '', 'minimale Luft zum Limit'),
    tile('Handelstage', `${st.tradingDays}`, '', `${st.winDays} grün / ${st.lossDays} rot · min. ${account.minDays ?? 0}`),
  );
  if (st.bestDay) host.append(tile('Bester Tag', usdSigned(st.bestDay.pnl), 'pos', fmtDay(st.bestDay.day)));
  if (st.worstDay) host.append(tile('Schlechtester Tag', usdSigned(st.worstDay.pnl), 'neg', fmtDay(st.worstDay.day)));
  if (st.usage) host.append(tile('Max. Kontrakte', `${Math.round(st.usage.maxTotalMinis * 10) / 10}`, '', `in Minis · erlaubt ${account.maxContracts ?? '–'}`));
}

function ruleItem(cls, name, detail) {
  const item = document.createElement('div');
  item.className = 'rule-item ' + cls;
  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.textContent = cls === 'ok' ? '✓' : cls === 'bad' ? '✕' : cls === 'warn' ? '!' : '·';
  const text = document.createElement('div');
  const n = document.createElement('span'); n.className = 'rule-name'; n.textContent = name + ' ';
  const d = document.createElement('span'); d.className = 'rule-detail'; d.textContent = detail;
  text.append(n, d);
  item.append(dot, text);
  return item;
}

function renderRuleCheck(result, account) {
  const host = $('rule-check');
  host.textContent = '';
  const st = result.stats;
  const ddViol = result.violations.find((v) => v.type === 'drawdown' && v.hard);
  host.append(ruleItem(
    ddViol ? 'bad' : 'ok',
    ddLabel(account.drawdown),
    ddViol ? ddViol.detail.replace(`${ddLabel(account.drawdown)} verletzt: `, 'verletzt: ') : `eingehalten – knappster Moment: ${usd(st.minRoom)} Luft`,
  ));

  if (account.dailyLoss) {
    const dl = result.violations.filter((v) => v.type === 'daily_loss');
    host.append(ruleItem(
      dl.some((v) => v.hard) ? 'bad' : dl.length ? 'warn' : 'ok',
      `Daily Loss Limit ${usd(account.dailyLoss.amount)}`,
      dl.length ? `${dl.length}× erreicht (${dl.map((v) => fmtDay(v.day)).join(', ')})` : `eingehalten – schlechtester Tag ${st.worstDay ? usdSigned(st.worstDay.pnl) : '–'}`,
    ));
  } else {
    host.append(ruleItem('na', 'Daily Loss Limit', 'dieser Account hat keins'));
  }

  if (account.profitTarget != null) {
    host.append(ruleItem(
      result.targetReachedAt ? 'ok' : 'na',
      `Profit Target ${usd(account.profitTarget)}`,
      result.targetReachedAt ? `erreicht am ${fmtDay(result.targetReachedAt.day)}` : `${usd(Math.max(0, st.netPnl))} von ${usd(account.profitTarget)} (${Math.max(0, Math.round((st.netPnl / account.profitTarget) * 100))}%)`,
    ));
  } else {
    host.append(ruleItem('na', 'Profit Target', 'Funded-Account – hier zählen Payout-Regeln statt Target'));
  }

  if (account.minDays) {
    const minOk = st.tradingDays >= account.minDays;
    host.append(ruleItem(
      minOk ? 'ok' : 'na',
      `Mindestens ${account.minDays} Handelstage`,
      minOk ? `${st.tradingDays} Tage gehandelt` : `erst ${st.tradingDays} von ${account.minDays}`,
    ));
  } else {
    host.append(ruleItem('na', 'Mindesttage', `keine vorgeschrieben – ${st.tradingDays} Tage gehandelt`));
  }

  if (account.consistency) {
    const c = st.consistency;
    let detail;
    if (c.sharePct == null) detail = 'noch kein Profit zu bewerten';
    else if (c.ok) detail = `bester Tag = ${Math.round(c.sharePct)}% vom Gesamtprofit (max. ${account.consistency.pct}%)`;
    else detail = `bester Tag = ${Math.round(c.sharePct)}% vom Profit – du brauchst insgesamt ${usd(c.neededTotal)} Profit, damit es passt`;
    host.append(ruleItem(c.ok ? 'ok' : 'warn', `Consistency ${account.consistency.pct}%`, detail +
      (account.consistency.scope === 'payout' ? ' (gilt erst bei Payout, nicht in der Eval)' : '')));
  } else {
    host.append(ruleItem('na', 'Consistency-Regel', 'dieser Account hat keine'));
  }

  if (st.usage && account.maxContracts != null) {
    const over = result.violations.find((v) => v.type === 'contracts');
    host.append(ruleItem(
      over ? 'warn' : 'ok',
      `Max. ${account.maxContracts} Kontrakte`,
      over ? over.detail : `Spitze: ${Math.round(st.usage.maxTotalMinis * 10) / 10} Minis gleichzeitig`,
    ));
  } else if (account.maxContracts != null) {
    host.append(ruleItem('na', `Max. ${account.maxContracts} Kontrakte`, 'nur prüfbar, wenn der Handelsverlauf (Fills) mit im Export ist'));
  }
}

function renderDaysTable(result, account) {
  const table = $('days-table');
  table.textContent = '';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const h of ['Tag', 'Trades', 'P&L', 'EOD-Stand', 'Limit', 'Luft']) {
    const th = document.createElement('th'); th.textContent = h; hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  const intraday = account.drawdown.type === 'intraday_trailing';
  for (const d of result.days) {
    const tr = document.createElement('tr');
    if (d.afterFail || d.afterPass) tr.className = 'after-fail';
    // Beim Intraday-Trailing gilt zum Tagesschluss der nachgezogene Floor, nicht der vom Tagesanfang
    const floor = intraday ? d.floorNext : d.floor;
    const cells = [
      { t: fmtDay(d.day) },
      { t: String(d.trades) },
      { t: usdSigned(d.pnl), cls: d.pnl > 0 ? 'pos' : d.pnl < 0 ? 'neg' : '' },
      { t: usd(d.eodBalance) },
      { t: usd(floor) },
      { t: usd(d.eodBalance - floor) },
    ];
    cells.forEach((c, i) => {
      const td = document.createElement('td');
      td.textContent = c.t;
      if (c.cls) td.className = c.cls;
      if (i === 2 && d.locked) {
        const flag = document.createElement('span');
        flag.className = 'flag lock';
        flag.textContent = 'DLL';
        td.appendChild(flag);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
}

function renderWarnings(warnings) {
  const host = $('warnings');
  host.textContent = '';
  for (const w of [...new Set(warnings || [])]) {
    const div = document.createElement('div');
    div.className = 'warn-item';
    div.textContent = w;
    host.appendChild(div);
  }
}

// ---------- Quick-Check ----------

function updateQuickCheckLabels() {
  const a = currentAccount();
  $('qc-hwm-label').textContent = a.drawdown.type === 'intraday_trailing'
    ? '(höchste Equity, inkl. offener Trades)'
    : a.drawdown.type === 'static' ? '(egal bei statischem DD)' : '(höchster Tagesschluss)';
  $('qc-start').placeholder = String(a.size.toFixed(2));
}

function bindQuickCheck() {
  $('qc-btn').addEventListener('click', () => {
    const a = currentAccount();
    const bal = parseFloat($('qc-balance').value);
    const start = parseFloat($('qc-start').value) || a.size;
    let hwm = parseFloat($('qc-hwm').value);
    if (!Number.isFinite(bal)) return;
    // Intraday-Trailing: Watermark kann nie unter der aktuellen Equity liegen.
    // EOD-Trailing: das EOD-Hoch darf unter dem aktuellen Stand liegen (Intraday-Gewinn heute).
    if (!Number.isFinite(hwm)) hwm = Math.max(bal, start);
    if (a.drawdown.type === 'intraday_trailing') hwm = Math.max(hwm, bal, start);
    else hwm = Math.max(hwm, start);
    const equity = a.size + (bal - start);
    const propHwm = a.size + (hwm - start);
    let floor;
    if (a.drawdown.type === 'static') floor = a.size - a.drawdown.amount;
    else floor = Math.min(propHwm - a.drawdown.amount, a.drawdown.lockFloorAt != null ? a.drawdown.lockFloorAt : Infinity);
    const room = equity - floor;
    const target = a.profitTarget != null ? a.size + a.profitTarget : null;
    const host = $('qc-out');
    host.textContent = '';
    const kv = (k, v, cls = '') => {
      const div = document.createElement('div');
      div.className = 'rule-kv';
      const kEl = document.createElement('div'); kEl.className = 'k'; kEl.textContent = k;
      const vEl = document.createElement('div'); vEl.className = 'v ' + cls; vEl.textContent = v;
      div.append(kEl, vEl);
      host.appendChild(div);
    };
    kv('Dein Stand (umgerechnet)', usd(equity, 2));
    kv('Drawdown-Limit', usd(floor, 2));
    kv('Luft', usd(room, 2), room <= 0 ? 'neg' : '');
    if (target != null) kv('Bis zum Target', usd(Math.max(0, target - equity), 2));
    if (room <= 0) kv('Status', 'Limit verletzt ✕', 'neg');
  });
}

// ---------- Footer ----------

function renderFooter() {
  const el = $('footer-note');
  el.textContent = '';
  const p1 = document.createElement('span');
  p1.textContent = `Regelstand: ${RULES_AS_OF}. Alle Angaben ohne Gewähr – Prop Firms ändern ihre Regeln ständig, check vor dem Kauf immer die offizielle Seite. `;
  const p2 = document.createElement('span');
  p2.textContent = 'Die Simulation rechnet auf Basis realisierter Trades (Fill-Granularität): unrealisierte Zwischenhochs/-tiefs offener Positionen sieht der TradingView-Export nicht. Beim Intraday-Trailing-Drawdown (z. B. Apex, MFFU Rapid) kann das echte Limit deshalb strenger sein, als es hier aussieht. Die Zeitstempel im Export folgen deiner Chart-Zeitzone – stell sie oben passend ein, sonst rutschen Trades in den falschen Handelstag. Keine Anlageberatung, keine Verbindung zu den genannten Firmen oder TradingView.';
  el.append(p1, document.createElement('br'), p2);
}

// ---------- Init ----------

// Börsenticker im Header: Auswahl der Accounts als laufendes Band
function renderTicker() {
  const host = $('ticker');
  if (!host) return;
  // Firms abwechseln, damit das Band nicht mit einer Firm anfängt und aufhört
  const perFirm = FIRMS.map((f) =>
    f.accounts.filter((a) => a.profitTarget != null).slice(0, 4)
      .map((a) => `${f.name.toUpperCase()} ${a.label.toUpperCase()} — TARGET ${usd(a.profitTarget)} · DD ${usd(a.drawdown.amount)}`)
  );
  const sel = [];
  for (let i = 0; i < 4; i++) for (const list of perFirm) if (list[i]) sel.push(list[i]);
  host.textContent = '';
  const track = document.createElement('div');
  track.className = 'ticker-track';
  for (let rep = 0; rep < 2; rep++) {
    const group = document.createElement('div');
    group.className = 'ticker-group';
    sel.forEach((t, i) => {
      const s = document.createElement('span');
      s.className = 'ticker-item ' + (i % 3 === 0 ? 'up' : i % 3 === 1 ? 'down' : '');
      s.textContent = t;
      group.appendChild(s);
    });
    track.appendChild(group);
  }
  host.appendChild(track);
}

function bindChartResize() {
  const host = $('chart-host');
  let lastWidth = host.clientWidth;
  if (typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver(() => {
    const w = host.clientWidth;
    if (Math.abs(w - lastWidth) > 1 && state.result && state.result.status !== 'empty' && !$('result-root').hidden) {
      lastWidth = w;
      renderEquityChart(host, state.result, currentAccount());
    }
  });
  ro.observe(host);
}

function init() {
  state.firmId = store.get('firm') || FIRMS[0].id;
  if (!FIRMS.some((f) => f.id === state.firmId)) state.firmId = FIRMS[0].id;
  const savedAcct = store.get('acct');
  state.acctId = currentFirm().accounts.some((a) => a.id === savedAcct) ? savedAcct : currentFirm().accounts[0].id;
  renderFirms();
  renderTicker();
  bindImport();
  bindQuickCheck();
  bindChartResize();
  renderFooter();
  loadDemo(); // Seite öffnet mit Beispieldaten, klar als solche markiert
}

init();
