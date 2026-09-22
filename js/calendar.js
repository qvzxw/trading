// P&L-Kalender im Trader-Style: Monatsraster Mo–Fr mit grün/rot eingefärbten
// Handelstagen (Intensität nach P&L-Größe), Wochensummen und Blown/Passed-Markern.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const el = (tag, cls, parent) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (parent) parent.appendChild(n);
  return n;
};

const money = (n) => {
  const a = Math.abs(n);
  const s = n > 0 ? '+' : n < 0 ? '-' : '';
  if (a >= 10000) return `${s}$${(a / 1000).toFixed(1)}K`;
  return `${s}$${Math.round(a).toLocaleString('en-US')}`;
};

function parseDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d, date: new Date(Date.UTC(y, m - 1, d)) };
}

// result: Ausgabe von simulate()
export function renderCalendar(container, result) {
  container.textContent = '';
  if (!result.days || result.days.length === 0) return;

  const byDay = new Map(result.days.map((d) => [d.day, d]));
  const failDay = result.failed ? result.failed.day : null;
  const passDay = result.passed ? result.passed.day : null;
  const maxAbs = Math.max(1, ...result.days.map((d) => Math.abs(d.pnl)));

  const first = parseDay(result.days[0].day);
  const last = parseDay(result.days[result.days.length - 1].day);

  for (let y = first.y, m = first.m; y < last.y || (y === last.y && m <= last.m); m === 12 ? (m = 1, y++) : m++) {
    const monthDays = result.days.filter((d) => d.day.startsWith(`${y}-${String(m).padStart(2, '0')}`));
    if (monthDays.length === 0) continue;

    const month = el('div', 'cal-month', container);
    const head = el('div', 'cal-month-head', month);
    el('h4', '', head).textContent = `${MONTHS[m - 1]} ${y}`;
    const monthTotal = monthDays.filter((d) => !d.afterFail && !d.afterPass).reduce((a, d) => a + d.pnl, 0);
    const totalEl = el('span', 'cal-month-total ' + (monthTotal > 0 ? 'pos' : monthTotal < 0 ? 'neg' : ''), head);
    totalEl.textContent = money(monthTotal);

    const grid = el('div', 'cal-grid', month);
    for (const dow of DOW) { el('div', 'cal-dow', grid).textContent = dow; }
    el('div', 'cal-dow', grid).textContent = 'Week';

    // Erster Montag der Rasterdarstellung (Mo=0 … So=6)
    const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
    const lastOfMonth = new Date(Date.UTC(y, m, 0));
    const start = new Date(firstOfMonth);
    start.setUTCDate(start.getUTCDate() - ((firstOfMonth.getUTCDay() + 6) % 7));

    for (let wk = new Date(start); wk <= lastOfMonth; wk.setUTCDate(wk.getUTCDate() + 7)) {
      let weekPnl = 0, weekHas = false;
      let allPnl = 0, anyData = false; // inkl. Post-Fail/Post-Pass-Tage (gedimmt angezeigt)
      for (let i = 0; i < 5; i++) {
        const day = new Date(wk);
        day.setUTCDate(day.getUTCDate() + i);
        const iso = day.toISOString().slice(0, 10);
        const inMonth = day.getUTCMonth() === m - 1;
        const data = byDay.get(iso);

        if (!inMonth) { el('div', 'cal-cell out', grid); continue; }

        if (!data) {
          const cell = el('div', 'cal-cell empty', grid);
          el('span', 'd', cell).textContent = day.getUTCDate();
          continue;
        }

        const off = data.afterFail || data.afterPass;
        const cls = ['cal-cell', data.pnl > 0 ? 'pos' : data.pnl < 0 ? 'neg' : 'flat'];
        if (off) cls.push('off');
        if (iso === failDay) cls.push('blown');
        if (iso === passDay) cls.push('passday');
        const cell = el('div', cls.join(' '), grid);
        // Farbintensität nach relativer P&L-Größe (8–55 %)
        const heat = 8 + Math.round(47 * Math.min(1, Math.abs(data.pnl) / maxAbs));
        cell.style.setProperty('--heatpc', heat + '%');
        el('span', 'd', cell).textContent = day.getUTCDate();
        el('span', 'p', cell).textContent = money(data.pnl);
        const sub = el('span', 't', cell);
        sub.textContent = `${data.trades} trade${data.trades === 1 ? '' : 's'}${data.locked ? ' · DLL' : ''}`;
        if (iso === failDay) el('span', 'flagchip bad', cell).textContent = 'BLOWN';
        else if (iso === passDay) el('span', 'flagchip good', cell).textContent = 'PASSED';
        allPnl += data.pnl; anyData = true;
        if (!off) { weekPnl += data.pnl; weekHas = true; }
      }
      // Wochen, die nur noch aus Post-Fail-/Post-Pass-Tagen bestehen, zeigen die Summe gedimmt
      const sum = weekHas ? weekPnl : allPnl;
      const cls = anyData ? (sum > 0 ? 'pos' : sum < 0 ? 'neg' : '') + (weekHas ? '' : ' off') : 'none';
      const wt = el('div', 'cal-wtotal ' + cls, grid);
      wt.textContent = anyData ? money(sum) : '—';
    }
  }
}
