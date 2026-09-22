import { FIRMS, RULES_AS_OF } from './firms.js';
import { parseTradingViewExport, mergeParsed } from './parse.js';
import { simulate, ddLabel, toEpoch } from './engine.js';
import { renderEquityChart } from './chart.js';
import { renderCalendar } from './calendar.js';
import { DEMO_CSV } from './demo.js';

const $ = (id) => document.getElementById(id);

const state = {
  firmId: null,
  acctId: null,
  sources: [],       // { name, parsed }
  isDemo: false,
  result: null,
  view: 'setup',
};

// ---------- Persistence (convenience only) ----------
const store = {
  get(k) { try { return localStorage.getItem('propreplay.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('propreplay.' + k, v); } catch { /* fine */ } },
};

// ---------- Formatting ----------
const usd = (n, digits = 0) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const usdSigned = (n, digits = 0) => (n > 0 ? '+' : n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtDay = (iso) => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y.slice(2)}`; };

function currentFirm() { return FIRMS.find((f) => f.id === state.firmId) || FIRMS[0]; }
function currentAccount() {
  const firm = currentFirm();
  return firm.accounts.find((a) => a.id === state.acctId) || firm.accounts[0];
}

// ---------- Views ----------

function showView(view) {
  state.view = view;
  $('view-setup').hidden = view !== 'setup';
  $('view-results').hidden = view !== 'results';
  const hash = view === 'results' ? '#results' : '';
  if (location.hash !== hash) {
    try { history.pushState(null, '', location.pathname + location.search + hash); } catch { /* fine */ }
  }
  window.scrollTo(0, 0);
}

function goToResults() {
  if (!state.result || state.result.status === 'empty') return;
  renderResults();
  showView('results');
}

window.addEventListener('hashchange', () => {
  if (location.hash === '#results' && state.result && state.result.status !== 'empty') {
    renderResults();
    showView('results');
  } else {
    showView('setup');
  }
});
window.addEventListener('popstate', () => {
  if (location.hash !== '#results') showView('setup');
});

// ---------- Step 1: firm + account ----------

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
    meta.textContent = `${shortDd(a)}${a.profitTarget != null ? ` · target ${usd(a.profitTarget)}` : ' · no target (funded)'}`;
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
  const kind = t === 'static' ? 'static' : t === 'intraday_trailing' ? 'intraday trailing' : 'EOD trailing';
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
  kv('Account size', usd(a.size));
  kv('Profit target', a.profitTarget != null ? usd(a.profitTarget) : 'none', a.profitTarget == null ? 'funded account' : '');
  kv(ddLabel(a.drawdown), usd(a.drawdown.amount), a.drawdown.lockFloorAt != null ? `locks at ${usd(a.drawdown.lockFloorAt)}` : 'trails indefinitely');
  kv('Daily loss limit', a.dailyLoss ? usd(a.dailyLoss.amount) : 'none', a.dailyLoss ? (a.dailyLoss.onHit === 'fail' ? 'hit = eval failed' : 'locks the day only') : '');
  kv('Max contracts', a.maxContracts != null ? `${a.maxContracts} minis` : '–', a.maxMicros != null ? `/ ${a.maxMicros} micros` : '');
  kv('Min. trading days', a.minDays != null ? String(a.minDays) : '–');
  kv('Consistency', a.consistency ? `${a.consistency.pct}%` : 'none', a.consistency ? (a.consistency.scope === 'eval' ? 'applies during the eval' : 'payout stage only') : '');
  if (a.priceMonthly != null) kv('Price', `${usd(a.priceMonthly)}/month`, 'list price');
  else if (a.priceOnce != null) kv('Price', `${usd(a.priceOnce)} one-time`, 'list price, often discounted');
  if (firm.note || (a.notes && a.notes.length)) {
    const note = document.createElement('div');
    note.className = 'firm-note';
    note.textContent = [firm.note, ...(a.notes || [])].filter(Boolean).join(' · ');
    host.appendChild(note);
  }
  updateQuickCheckLabels();
}

// ---------- Exchange-style ticker ----------

function renderTicker() {
  const host = $('ticker');
  if (!host) return;
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

// ---------- Step 2: data import ----------

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
    addSource('Pasted text', text);
    $('paste-area').value = '';
  });
  $('demo-btn').addEventListener('click', () => { loadDemo(); goToResults(); });
  $('clear-btn').addEventListener('click', () => {
    state.sources = []; state.isDemo = false;
    recompute();
  });
  $('run-btn').addEventListener('click', goToResults);
  $('back-btn').addEventListener('click', () => showView('setup'));

  for (const id of ['tz-select', 'day-select', 'range-start', 'range-end']) {
    $(id).addEventListener('change', () => {
      store.set(id, $(id).value);
      recompute();
    });
  }
  const tz = store.get('tz-select'); if (tz) $('tz-select').value = tz;
  const dm = store.get('day-select'); if (dm) $('day-select').value = dm;

  $('ctx-select').addEventListener('change', () => {
    const [firmId, acctId] = $('ctx-select').value.split('|');
    if (!FIRMS.some((f) => f.id === firmId && f.accounts.some((a) => a.id === acctId))) return;
    state.firmId = firmId;
    state.acctId = acctId;
    store.set('firm', firmId); store.set('acct', acctId);
    renderFirms();
    recompute();
  });
}

async function readFiles(files) {
  let added = false;
  for (const f of files) {
    const text = await f.text();
    addSource(f.name, text, { deferNav: true });
    added = true;
  }
  if (added) goToResults();
}

function addSource(name, text, opts = {}) {
  if (state.isDemo) { state.sources = []; state.isDemo = false; }
  const parsed = parseTradingViewExport(text, name);
  state.sources.push({ name, parsed });
  recompute();
  if (!opts.deferNav) goToResults();
}

function loadDemo() {
  state.sources = [{ name: 'Sample data', parsed: parseTradingViewExport(DEMO_CSV, 'demo.csv') }];
  state.isDemo = true;
  recompute();
}

function renderImportStatus() {
  const host = $('import-status');
  host.textContent = '';
  $('clear-btn').hidden = state.sources.length === 0;
  if (!state.sources.length) return;
  for (const s of state.sources) {
    const line = document.createElement('div');
    const ok = s.parsed.balanceEvents.length + s.parsed.fills.length > 0;
    line.className = ok ? 'ok' : '';
    line.textContent = `${ok ? '✓' : '✕'} ${s.name}: ${s.parsed.balanceEvents.length} balance events, ${s.parsed.fills.length} fills` +
      (s.parsed.detected.length ? ` (${s.parsed.detected.join(', ')})` : '');
    host.appendChild(line);
  }
  if (state.isDemo) {
    const note = document.createElement('div');
    note.textContent = 'This is sample data to play with – load your own export to see your numbers.';
    host.appendChild(note);
  }
}

// ---------- Simulation + rendering ----------

function currentOptions() {
  const opts = {
    timeZone: $('tz-select').value,
    dayMode: $('day-select').value,
  };
  // Range bounds are interpreted in the chosen CSV timezone, not as UTC midnight
  const parseDayInput = (v) => { const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
  const rs = parseDayInput($('range-start').value || '');
  const re = parseDayInput($('range-end').value || '');
  if (rs) opts.rangeStart = toEpoch({ ...rs, h: 0, mi: 0, s: 0 }, opts.timeZone);
  if (re) opts.rangeEnd = toEpoch({ ...re, h: 23, mi: 59, s: 59 }, opts.timeZone);
  return opts;
}

function updateRunCta() {
  const btn = $('run-btn');
  const hint = $('run-hint');
  const ready = !!state.result && state.result.status !== 'empty';
  btn.disabled = !ready;
  btn.textContent = state.isDemo ? 'View sample results →' : 'Run the replay →';
  hint.textContent = ready
    ? `${currentFirm().name} ${currentAccount().label} · ${state.result.days.length} trading days loaded`
    : 'Load a CSV export (or the sample data) first.';
}

function recompute() {
  renderRulesSummary();
  const merged = mergeParsed(state.sources.map((s) => s.parsed));
  renderImportStatus();
  if (!state.sources.length) {
    state.result = null;
    renderWarnings([]);
    updateRunCta();
    if (state.view === 'results') showView('setup');
    return;
  }
  const account = currentAccount();
  try {
    const result = simulate({ account, parsed: merged, options: currentOptions() });
    state.result = result;
    if (result.status === 'empty') {
      renderWarnings(result.warnings);
      updateRunCta();
      if (state.view === 'results') showView('setup');
      return;
    }
    renderWarnings(result.warnings);
    updateRunCta();
    if (state.view === 'results') renderResults();
  } catch (err) {
    state.result = null;
    renderWarnings([`Evaluation failed: ${err && err.message ? err.message : err}. Check the file or report this as a bug.`]);
    updateRunCta();
    if (state.view === 'results') showView('setup');
  }
}

function renderResults() {
  const result = state.result;
  if (!result || result.status === 'empty') return;
  const account = currentAccount();
  renderContextSelect();
  renderHero(result, account);
  renderTiles(result, account);
  renderEquityChart($('chart-host'), result, account);
  renderCalendar($('calendar-host'), result);
  renderRuleCheck(result, account);
  renderDaysTable(result, account);
}

function renderContextSelect() {
  const sel = $('ctx-select');
  sel.textContent = '';
  for (const f of FIRMS.filter((x) => x.accounts.length > 0)) {
    const og = document.createElement('optgroup');
    og.label = f.name;
    for (const a of f.accounts) {
      const o = document.createElement('option');
      o.value = `${f.id}|${a.id}`;
      o.textContent = `${f.name} · ${a.label}`;
      if (f.id === state.firmId && a.id === currentAccount().id) o.selected = true;
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
}

function renderHero(result, account) {
  const hero = $('result-hero');
  hero.classList.remove('passed', 'failed', 'ongoing');
  const v = $('verdict'), why = $('verdict-why');
  if (result.status === 'failed') {
    hero.classList.add('failed');
    v.textContent = 'Account blown';
    why.textContent = `${result.failed.detail} — on ${fmtDay(result.failed.day)}. With these trades, the ${currentFirm().name} eval would have ended right here.`;
  } else if (result.status === 'passed') {
    hero.classList.add('passed');
    v.textContent = 'Eval passed ✓';
    const afterDays = result.days.filter((d) => d.afterPass).length;
    why.textContent = `Profit target ${usd(account.profitTarget)} reached, every rule respected — passed on ${fmtDay(result.passed.day)}.` +
      (afterDays ? ` The ${afterDays} trading day(s) after that no longer count for the eval.` : '');
  } else {
    hero.classList.add('ongoing');
    v.textContent = account.profitTarget != null ? 'Still running' : 'Account still alive';
    const bits = [];
    if (result.stats.distToTarget != null && result.stats.distToTarget > 0) bits.push(`${usd(result.stats.distToTarget)} to go to the target`);
    else if (result.targetReachedAt) bits.push('target reached');
    if (!result.stats.consistency.ok && account.consistency && account.consistency.scope === 'eval') bits.push('consistency not met yet');
    if ((account.minDays || 0) > result.stats.tradingDays) bits.push(`${account.minDays - result.stats.tradingDays} more trading day(s) needed`);
    bits.push(`${usd(result.stats.roomToFloor)} of room to the drawdown limit`);
    why.textContent = 'No rule broken so far — ' + bits.join(', ') + '.';
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
    tile('Net P&L', usdSigned(st.netPnl), st.netPnl >= 0 ? 'pos' : 'neg', `ending balance ${usd(st.endEquity)}`),
    tile('Room to limit', usd(st.roomToFloor), st.roomToFloor < account.drawdown.amount * 0.25 ? 'neg' : '', `limit now ${usd(st.floorEnd)}`),
    tile('To target', st.distToTarget != null ? usd(st.distToTarget) : '–', '',
      result.targetReachedAt ? `reached on ${fmtDay(result.targetReachedAt.day)}` :
      account.profitTarget != null ? `target ${usd(account.size + account.profitTarget)}` : 'funded account, no target'),
    tile('Closest call', usd(st.minRoom), st.minRoom < account.drawdown.amount * 0.15 ? 'neg' : '', 'minimum room to the limit'),
    tile('Trading days', `${st.tradingDays}`, '', `${st.winDays} green / ${st.lossDays} red · min ${account.minDays ?? 0}`),
  );
  if (st.bestDay) host.append(tile('Best day', usdSigned(st.bestDay.pnl), 'pos', fmtDay(st.bestDay.day)));
  if (st.worstDay) host.append(tile('Worst day', usdSigned(st.worstDay.pnl), 'neg', fmtDay(st.worstDay.day)));
  if (st.usage) host.append(tile('Max contracts', `${Math.round(st.usage.maxTotalMinis * 10) / 10}`, '', `in minis · allowed ${account.maxContracts ?? '–'}`));
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
    ddViol ? ddViol.detail.replace(`${ddLabel(account.drawdown)} breached: `, 'breached: ') : `respected – closest call: ${usd(st.minRoom)} of room`,
  ));

  if (account.dailyLoss) {
    const dl = result.violations.filter((v) => v.type === 'daily_loss');
    host.append(ruleItem(
      dl.some((v) => v.hard) ? 'bad' : dl.length ? 'warn' : 'ok',
      `Daily loss limit ${usd(account.dailyLoss.amount)}`,
      dl.length ? `hit ${dl.length}× (${dl.map((v) => fmtDay(v.day)).join(', ')})` : `respected – worst day ${st.worstDay ? usdSigned(st.worstDay.pnl) : '–'}`,
    ));
  } else {
    host.append(ruleItem('na', 'Daily loss limit', 'this account has none'));
  }

  if (account.profitTarget != null) {
    host.append(ruleItem(
      result.targetReachedAt ? 'ok' : 'na',
      `Profit target ${usd(account.profitTarget)}`,
      result.targetReachedAt ? `reached on ${fmtDay(result.targetReachedAt.day)}` : `${usd(Math.max(0, st.netPnl))} of ${usd(account.profitTarget)} (${Math.max(0, Math.round((st.netPnl / account.profitTarget) * 100))}%)`,
    ));
  } else {
    host.append(ruleItem('na', 'Profit target', 'funded account – payout rules apply instead of a target'));
  }

  if (account.minDays) {
    const minOk = st.tradingDays >= account.minDays;
    host.append(ruleItem(
      minOk ? 'ok' : 'na',
      `At least ${account.minDays} trading days`,
      minOk ? `${st.tradingDays} days traded` : `only ${st.tradingDays} of ${account.minDays}`,
    ));
  } else {
    host.append(ruleItem('na', 'Minimum days', `none required – ${st.tradingDays} days traded`));
  }

  if (account.consistency) {
    const c = st.consistency;
    let detail;
    if (c.sharePct == null) detail = 'no profit to assess yet';
    else if (c.ok) detail = `best day = ${Math.round(c.sharePct)}% of total profit (max ${account.consistency.pct}%)`;
    else detail = `best day = ${Math.round(c.sharePct)}% of profit – you need ${usd(c.neededTotal)} total profit for it to fit`;
    host.append(ruleItem(c.ok ? 'ok' : 'warn', `Consistency ${account.consistency.pct}%`, detail +
      (account.consistency.scope === 'payout' ? ' (payout stage only, not in the eval)' : '')));
  } else {
    host.append(ruleItem('na', 'Consistency rule', 'this account has none'));
  }

  if (st.usage && account.maxContracts != null) {
    const over = result.violations.find((v) => v.type === 'contracts');
    host.append(ruleItem(
      over ? 'warn' : 'ok',
      `Max ${account.maxContracts} contracts`,
      over ? over.detail : `peak: ${Math.round(st.usage.maxTotalMinis * 10) / 10} minis at once`,
    ));
  } else if (account.maxContracts != null) {
    host.append(ruleItem('na', `Max ${account.maxContracts} contracts`, 'only checkable when the order history (fills) is part of the export'));
  }
}

function renderDaysTable(result, account) {
  const table = $('days-table');
  table.textContent = '';
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const h of ['Day', 'Trades', 'P&L', 'EOD balance', 'Limit', 'Room']) {
    const th = document.createElement('th'); th.textContent = h; hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  const intraday = account.drawdown.type === 'intraday_trailing';
  for (const d of result.days) {
    const tr = document.createElement('tr');
    if (d.afterFail || d.afterPass) tr.className = 'after-fail';
    // With intraday trailing, the trailed floor applies at day end, not the day-open one
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
  for (const id of ['warnings', 'result-warnings']) {
    const host = $(id);
    if (!host) continue;
    host.textContent = '';
    for (const w of [...new Set(warnings || [])]) {
      const div = document.createElement('div');
      div.className = 'warn-item';
      div.textContent = w;
      host.appendChild(div);
    }
  }
}

// ---------- Quick check ----------

function updateQuickCheckLabels() {
  const a = currentAccount();
  $('qc-hwm-label').textContent = a.drawdown.type === 'intraday_trailing'
    ? '(highest equity incl. open trades)'
    : a.drawdown.type === 'static' ? '(irrelevant with static DD)' : '(highest EOD close)';
  $('qc-start').placeholder = String(a.size.toFixed(2));
}

function bindQuickCheck() {
  $('qc-btn').addEventListener('click', () => {
    const a = currentAccount();
    const bal = parseFloat($('qc-balance').value);
    const start = parseFloat($('qc-start').value) || a.size;
    let hwm = parseFloat($('qc-hwm').value);
    if (!Number.isFinite(bal)) return;
    // Intraday trailing: the watermark can never sit below current equity.
    // EOD trailing: the EOD high may sit below today's balance (intraday gain).
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
    kv('Your balance (mapped)', usd(equity, 2));
    kv('Drawdown limit', usd(floor, 2));
    kv('Room', usd(room, 2), room <= 0 ? 'neg' : '');
    if (target != null) kv('To target', usd(Math.max(0, target - equity), 2));
    if (room <= 0) kv('Status', 'Limit breached ✕', 'neg');
  });
}

// ---------- Footer ----------

function renderFooter() {
  const el = $('footer-note');
  el.textContent = '';
  const p1 = document.createElement('span');
  p1.textContent = `Rules as of ${RULES_AS_OF}. No guarantees – prop firms change their rules all the time, always check the official site before buying. `;
  const p2 = document.createElement('span');
  p2.textContent = 'The simulation runs on realized trades (fill granularity): unrealized highs/lows of open positions are invisible to the TradingView export. With intraday trailing drawdowns (e.g. Apex, MFFU Rapid) the real limit can therefore be stricter than it looks here. Export timestamps follow your chart timezone – set it correctly above, or trades land on the wrong trading day. Not financial advice; not affiliated with any of these firms or TradingView.';
  el.append(p1, document.createElement('br'), p2);
}

// ---------- Chart resize ----------

function bindChartResize() {
  const host = $('chart-host');
  let lastWidth = host.clientWidth;
  if (typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver(() => {
    const w = host.clientWidth;
    if (Math.abs(w - lastWidth) > 1 && state.result && state.result.status !== 'empty' && state.view === 'results') {
      lastWidth = w;
      renderEquityChart(host, state.result, currentAccount());
    }
  });
  ro.observe(host);
}

// ---------- Init ----------

function init() {
  state.firmId = store.get('firm') || FIRMS[0].id;
  if (!FIRMS.some((f) => f.id === state.firmId && f.accounts.length)) state.firmId = FIRMS[0].id;
  const savedAcct = store.get('acct');
  state.acctId = currentFirm().accounts.some((a) => a.id === savedAcct) ? savedAcct : currentFirm().accounts[0].id;
  renderFirms();
  renderTicker();
  bindImport();
  bindQuickCheck();
  bindChartResize();
  renderFooter();
  loadDemo(); // the page opens with sample data preloaded, clearly labeled
  if (location.hash === '#results') {
    // deep link straight to the sample results
    goToResults();
  }
}

init();
