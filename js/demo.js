// Deterministische Beispieldaten im TradingView-Exportformat („Alle Tabs“-Stil):
// Guthabenübersicht + Handelsverlauf, konsistent zueinander. ~3 Wochen NQ/MNQ.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDemo() {
  const rnd = mulberry32(20260922);
  const balanceRows = [];
  const fillRows = [];
  let balance = 50000;
  let price = 30480;

  // Handelstage: 1.–18. September 2026, Mo–Fr
  const days = [];
  for (let d = 1; d <= 18; d++) {
    const date = new Date(Date.UTC(2026, 8, d));
    const wd = date.getUTCDay();
    if (wd >= 1 && wd <= 5) days.push(d);
  }

  // Tagescharakter: Anlauf, ein böser Tag, Erholung Richtung Target
  const bias = { 1: 0.68, 2: 0.55, 3: 0.62, 4: 0.3, 7: 0.66, 8: 0.15, 9: 0.6, 10: 0.7, 11: 0.55, 14: 0.72, 15: 0.5, 16: 0.68, 17: 0.62, 18: 0.66 };

  const pad = (n) => String(n).padStart(2, '0');
  const f2 = (n) => n.toFixed(2);

  for (const d of days) {
    const nTrades = 2 + Math.floor(rnd() * 3);
    let minute = 13 * 60 + 35 + Math.floor(rnd() * 30);
    for (let i = 0; i < nTrades; i++) {
      const win = rnd() < (bias[d] ?? 0.55);
      const qty = rnd() < 0.7 ? 1 : 2;
      const micro = rnd() < 0.25;
      const symbol = micro ? 'CME_MICRO:MNQ1!' : 'CME_MINI:NQ1!';
      const mult = micro ? 2 : 20;
      const useQty = micro ? qty * 10 : qty;
      const long = rnd() < 0.55;
      const points = win ? 8 + rnd() * 30 : -(7 + rnd() * 26);
      const entry = Math.round((price + (rnd() - 0.5) * 40) * 4) / 4;
      const exit = Math.round((entry + (long ? points : -points)) * 4) / 4;
      const pnl = Math.round((long ? exit - entry : entry - exit) * useQty * mult * 100) / 100;
      price = exit;

      const tEntry = `2026-09-${pad(d)} ${pad(Math.floor(minute / 60))}:${pad(minute % 60)}:${pad(Math.floor(rnd() * 60))}`;
      minute += 12 + Math.floor(rnd() * 55);
      const tExit = `2026-09-${pad(d)} ${pad(Math.floor(minute / 60))}:${pad(minute % 60)}:${pad(Math.floor(rnd() * 60))}`;
      minute += 6 + Math.floor(rnd() * 25);

      fillRows.push(`${symbol},${long ? 'Buy' : 'Sell'},${useQty},${f2(entry)},${tEntry}`);
      fillRows.push(`${symbol},${long ? 'Sell' : 'Buy'},${useQty},${f2(exit)},${tExit}`);

      const before = balance;
      balance = Math.round((balance + pnl) * 100) / 100;
      const action = `Close ${long ? 'long' : 'short'} position for symbol ${symbol} at price ${f2(exit)} for ${useQty} units. Position AVG Price was ${f2(entry)}`;
      balanceRows.push(`${tExit},${f2(before)},${f2(balance)},${f2(pnl)},"${action}"`);
    }
  }

  return [
    'Guthabenübersicht',
    'Time,Balance Before,Balance After,Realized P&L,Action',
    ...balanceRows,
    '',
    'Handelsverlauf',
    'Symbol,Side,Qty,Fill Price,Time',
    ...fillRows,
  ].join('\n');
}

export const DEMO_CSV = buildDemo();
