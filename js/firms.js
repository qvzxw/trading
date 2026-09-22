// Regel-Datenbank der Prop-Firm-Evaluations.
// Recherchiert und gegengeprüft im September 2026 (offizielle Seiten + Help-Center,
// quer-gecheckt mit unabhängigen Quellen). Prop Firms ändern Regeln laufend –
// vor einem Kauf immer die offizielle Seite checken.
//
// drawdown.type:       'intraday_trailing' | 'eod_trailing' | 'static'
// drawdown.breachCheck:'realtime' (Berührung intraday = Bruch) | 'eod' (zählt nur zum Tagesschluss)
// drawdown.lockFloorAt: absolute Balance, bei der das Limit aufhört zu steigen (null = trailt ewig)
// dailyLoss.onHit:     'fail' (Eval vorbei) | 'lock' (nur Rest des Tages gesperrt)
// consistency.scope:   'eval' (blockt das Bestehen) | 'payout' (erst im Funded-Konto relevant)

export const RULES_AS_OF = 'September 2026';

export const FIRMS = [
  {
    id: 'apex',
    name: 'Apex',
    note: 'Apex 4.0 (seit März 2026): Einmalzahlung mit 30 Tagen Zugang, keine Mindesttage, kein Overnight (flat bis 16:59 ET). Die alten 250K/300K/Static-Accounts werden nicht mehr verkauft.',
    sources: [
      'https://apextraderfunding.com/help-center/evaluation-accounts-ea/intraday-trailing-drawdown-evaluations/',
      'https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-evaluations/',
      'https://apextraderfunding.com/help-center/additional-helpful-items/daily-loss-limit-explained/',
    ],
    accounts: [
      ...[[25, 1500, 1000, 4, 199], [50, 3000, 2000, 6, 249], [100, 6000, 3000, 8, 399], [150, 9000, 4000, 12, 599]].map(([k, target, dd, contracts, price]) => ({
        id: `apex-${k}k-intraday`, label: `${k}K Intraday`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'intraday_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + 100 },
        dailyLoss: null, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 50, scope: 'payout' }, minDays: 0, priceOnce: price,
        notes: ['Trailing zieht in Echtzeit mit – inkl. unrealisierter Spitzen offener Trades (der TradingView-Export sieht die nicht).'],
      })),
      ...[[25, 1500, 1000, 4, 500, 390], [50, 3000, 2000, 6, 1000, 450], [100, 6000, 3000, 8, 1500, 590], [150, 9000, 4000, 12, 2000, 1090]].map(([k, target, dd, contracts, dll, price]) => ({
        id: `apex-${k}k-eod`, label: `${k}K EOD`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + 100 },
        dailyLoss: { amount: dll, onHit: 'lock' }, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 50, scope: 'payout' }, minDays: 0, priceOnce: price,
        notes: ['Limit steigt nur mit Tagesschluss-Hochs (16:59 ET), wird aber in Echtzeit geprüft.'],
      })),
    ],
  },
  {
    id: 'topstep',
    name: 'Topstep',
    note: 'Trading Combine: MLL trailt nur per Tagesschluss, wird aber in Echtzeit (inkl. unrealisiertem P&L) enforced und lockt bei Breakeven. DLL ist optional (Standardwerte gezeigt) und sperrt nur den Tag. Flat bis 15:10 CT, kein Overnight.',
    sources: [
      'https://help.topstep.com/en/articles/8284197-trading-combine-parameters',
      'https://help.topstep.com/en/articles/8284204-what-is-the-maximum-loss-limit',
      'https://help.topstep.com/en/articles/8284208-consistency-at-topstep',
    ],
    accounts: [[50, 3000, 2000, 1000, 5, 49], [100, 6000, 3000, 2000, 10, 99], [150, 9000, 4500, 3000, 15, 199]].map(([k, target, dd, dll, contracts, price]) => ({
      id: `topstep-${k}k`, label: `${k}K Combine`,
      size: k * 1000, profitTarget: target,
      drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 },
      dailyLoss: { amount: dll, onHit: 'lock' }, maxContracts: contracts, maxMicros: contracts * 10,
      consistency: { pct: 50, scope: 'eval' }, minDays: 0, priceMonthly: price,
      notes: ['Consistency: bester Tag ≤ 50 % vom Profit (Topstep kommuniziert 2026 teils 55 %) – verzögert nur das Bestehen.'],
    })),
  },
  {
    id: 'mffu',
    name: 'MyFundedFutures',
    note: 'Lineup Sept. 2026: Rapid (Intraday-Trailing), Rapid EOD, Pro und Builder – alles Einmalzahlung. Handel 18:00–16:10 ET, flat zum Close. Die Flex-Linie ist offenbar nicht mehr kaufbar und fehlt hier.',
    sources: [
      'https://myfundedfutures.com/plans/rapid',
      'https://help.myfundedfutures.com/en/articles/8348565-end-of-day-eod-drawdown-explained',
      'https://help.myfundedfutures.com/en/articles/12802721-intraday-drawdown-explained',
    ],
    accounts: [
      ...[[25, 1500, 1000, 3, 145], [50, 3000, 2000, 5, 209], [100, 6000, 3000, 8, 356], [150, 9000, 4500, 10, 463]].map(([k, target, dd, contracts, price]) => ({
        id: `mffu-${k}k-rapid`, label: `${k}K Rapid`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'intraday_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + 100 },
        dailyLoss: null, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 50, scope: 'eval' }, minDays: 2, priceOnce: price,
        notes: ['Trailing folgt dem Echtzeit-Hoch inkl. unrealisiertem P&L offener Trades.'],
      })),
      ...[[25, 1500, 1000, 2, null], [50, 3000, 2000, 3, 209]].map(([k, target, dd, contracts, price]) => ({
        id: `mffu-${k}k-rapid-eod`, label: `${k}K Rapid EOD`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + 100 },
        dailyLoss: null, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 30, scope: 'eval' }, minDays: 4, priceOnce: price,
        notes: ['EOD-Drawdown gegen strengere 30 %-Consistency und 4 Mindesttage getauscht.'],
      })),
      ...[[50, 3000, 2000, 5, 265], [100, 6000, 3000, 10, null], [150, 9000, 4500, 15, 557]].map(([k, target, dd, contracts, price]) => ({
        id: `mffu-${k}k-pro`, label: `${k}K Pro`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + 100 },
        dailyLoss: null, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 50, scope: 'eval' }, minDays: 2, priceOnce: price,
        notes: ['Mind. 1 Trade alle 7 Tage (Inaktivitätsregel).'],
      })),
      ...[[25, 1500, 1000, 2, null, 105], [50, 3000, 2000, 4, 1000, 153]].map(([k, target, dd, contracts, dll, price]) => ({
        id: `mffu-${k}k-builder`, label: `${k}K Builder`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + 100 },
        dailyLoss: dll ? { amount: dll, onHit: 'lock' } : null, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 50, scope: 'payout' }, minDays: 1, priceOnce: price,
        notes: ['Keine Consistency in der Eval – Bestehen an einem Tag möglich.'],
      })),
    ],
  },
  {
    id: 'tradeify',
    name: 'Tradeify',
    note: 'Tradeify 3.0: Growth-Eval (mit DLL), Select-Eval (ohne DLL, 40 % Consistency) und Lightning (direkt sim-funded, kein Target). EOD-Trailing wird bei allen in Echtzeit geprüft. Einmalzahlung, kein Abo.',
    sources: [
      'https://help.tradeify.co/en/articles/10495915-growth-evaluation-accounts',
      'https://help.tradeify.co/en/articles/12853921-select-evaluation-accounts',
      'https://help.tradeify.co/en/articles/10495897-rules-trailing-max-drawdowns',
    ],
    accounts: [
      ...[[25, 1500, 1000, 600, 1, 99], [50, 3000, 2000, 1250, 4, 149], [100, 6000, 3500, 2500, 8, 255], [150, 9000, 5000, 3750, 12, 369]].map(([k, target, dd, dll, contracts, price]) => ({
        id: `tradeify-${k}k-growth`, label: `${k}K Growth`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: null },
        dailyLoss: { amount: dll, onHit: 'lock' }, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 35, scope: 'payout' }, minDays: 1, priceOnce: price,
        notes: ['Eval-Drawdown lockt nicht (Lock bei Start+100 $ erst im Funded-Konto).'],
      })),
      ...[[25, 1500, 1000, 1], [50, 3000, 2000, 4, 159], [100, 6000, 3000, 8], [150, 9000, 4500, 12]].map(([k, target, dd, contracts, price]) => ({
        id: `tradeify-${k}k-select`, label: `${k}K Select`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: null },
        dailyLoss: null, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 40, scope: 'eval' }, minDays: 3, priceOnce: price ?? null,
        notes: ['Kein Daily Loss Limit – nur Trailing Drawdown und 40 %-Consistency.'],
      })),
      {
        id: 'tradeify-300k-select', label: '300K Select',
        size: 300000, profitTarget: 14000,
        drawdown: { type: 'eod_trailing', amount: 8000, breachCheck: 'realtime', lockFloorAt: 300100 },
        dailyLoss: null, maxContracts: null, maxMicros: null,
        consistency: { pct: 40, scope: 'eval' }, minDays: 3, priceOnce: null,
        notes: ['Limitierte Auflage, kein Reset möglich; Angaben teils widersprüchlich – vor Kauf genau prüfen.'],
      },
      ...[[25, 1000, null, 1, 345], [50, 2000, 1250, 4, 479], [100, 4000, 2500, 8, 660], [150, 5250, 3000, 12, 796]].map(([k, dd, dll, contracts, price]) => ({
        id: `tradeify-${k}k-lightning`, label: `${k}K Lightning`,
        size: k * 1000, profitTarget: null,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + 100 },
        dailyLoss: dll ? { amount: dll, onHit: 'lock' } : null, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 20, scope: 'payout' }, minDays: null, priceOnce: price,
        notes: ['Direkt sim-funded: kein Profit Target, dafür Payout-Regeln (erster Payout ab 20 %-Consistency).', k >= 100 ? 'Drawdown-Höhe 2026 geändert – vor Kauf verifizieren.' : ''].filter(Boolean),
      })),
    ],
  },
  {
    id: 'lucid',
    name: 'Lucid',
    note: 'Lineup Sept. 2026: LucidFlex, LucidPro und LucidDaily (Drawdown-Typ bei Daily am Checkout wählbar). DLL ist seit Aug. 2026 ein optionaler Toggle (Werte gezeigt) und sperrt nur den Tag. Kein Overnight, Auto-Flat 16:45 ET. Einmalzahlung.',
    sources: [
      'https://support.lucidtrading.com/en/articles/12945790-lucidflex-evaluation-account',
      'https://support.lucidtrading.com/en/articles/12890029-lucidpro-evaluation-account',
      'https://support.lucidtrading.com/en/articles/15996664-luciddaily-evaluation',
    ],
    accounts: [
      ...[[25, 1250, 1000, 600, 2, 89], [50, 3000, 2000, 1200, 4, 146], [100, 6000, 3000, 1800, 6, 307], [150, 9000, 4500, 2700, 10, 407]].map(([k, target, dd, dll, contracts, price]) => ({
        id: `lucid-${k}k-flex`, label: `${k}K Flex`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'eod', lockFloorAt: k * 1000 + 100 },
        dailyLoss: { amount: dll, onHit: 'lock' }, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 50, scope: 'eval' }, minDays: 0, priceOnce: price,
        notes: ['Intraday-Dips unters Limit sind erlaubt – nur der Tagesschluss zählt.'],
      })),
      ...[[25, 1250, 1000, 600, 2, 135], [50, 3000, 2000, 1200, 4, 185], [100, 6000, 3000, 1800, 6, 307], [150, 9000, 4500, 2700, 10, 410]].map(([k, target, dd, dll, contracts, price]) => ({
        id: `lucid-${k}k-pro`, label: `${k}K Pro`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'eod', lockFloorAt: k * 1000 + 100 },
        dailyLoss: { amount: dll, onHit: 'lock' }, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 40, scope: 'payout' }, minDays: 0, priceOnce: price,
        notes: ['Keine Consistency in der Eval – Bestehen an einem Tag möglich.'],
      })),
      ...[[25, 1250, 1000, 600, 2], [50, 3000, 2000, 1200, 4], [100, 6000, 3000, 1800, 6], [150, 9000, 4500, 2700, 10]].map(([k, target, dd, dll, contracts]) => ({
        id: `lucid-${k}k-daily-eod`, label: `${k}K Daily (EOD)`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'eod', lockFloorAt: k * 1000 + 100 },
        dailyLoss: { amount: dll, onHit: 'lock' }, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 50, scope: 'eval' }, minDays: 0, priceOnce: null,
        notes: ['Funded-Konto wechselt auf Intraday-Drawdown mit Daily-Profit-Cap und News-Regel.'],
      })),
      ...[[25, 1250, 1000, 600, 2], [50, 3000, 2000, 1200, 4], [100, 6000, 3000, 1800, 6], [150, 9000, 4500, 2700, 10]].map(([k, target, dd, dll, contracts]) => ({
        id: `lucid-${k}k-daily-intraday`, label: `${k}K Daily (Intraday)`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'intraday_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + 100 },
        dailyLoss: { amount: dll, onHit: 'lock' }, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 50, scope: 'eval' }, minDays: 0, priceOnce: null,
        notes: ['Günstigere Daily-Variante: Trailing zieht in Echtzeit inkl. unrealisiertem P&L.'],
      })),
    ],
  },
];
