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
    note: 'Apex 4.0 (since March 2026): one-time fee with 30 days of access, no minimum days, no overnight (flat by 4:59 PM ET), mandatory bracket orders (every order needs SL+TP). The old 250K/300K/static accounts are gone; every size also exists as a “No Activation Fee” variant (pricier, but $0 activation).',
    sources: [
      'https://apextraderfunding.com/help-center/evaluation-accounts-ea/intraday-trailing-drawdown-evaluations/',
      'https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-evaluations/',
      'https://apextraderfunding.com/help-center/additional-helpful-items/daily-loss-limit-explained/',
    ],
    accounts: [
      ...[[25, 1500, 1000, 4, 167], [50, 3000, 2000, 6, 249], [100, 6000, 3000, 8, 399], [150, 9000, 4000, 12, 599]].map(([k, target, dd, contracts, price]) => ({
        id: `apex-${k}k-intraday`, label: `${k}K Intraday`,
        size: k * 1000, profitTarget: target,
        // Eval-Lock (Rithmic/WealthCharts): Threshold stoppt an der Profit-Target-Balance.
        // Auf Tradovate trailt er in der Eval endlos. Start+100 gilt erst im PA (funded).
        drawdown: { type: 'intraday_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + target },
        dailyLoss: null, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 50, scope: 'payout' }, minDays: 0, priceOnce: price,
        notes: [
          'The trailing threshold moves in real time – including unrealized peaks of open trades (which the TradingView export cannot see).',
          'The lock at the target balance applies on Rithmic/WealthCharts; on Tradovate the eval trails forever.',
        ],
      })),
      ...[[25, 1500, 1000, 4, 500, 390], [50, 3000, 2000, 6, 1000, 490], [100, 6000, 3000, 8, 1500, 790], [150, 9000, 4000, 12, 2000, 1490]].map(([k, target, dd, contracts, dll, price]) => ({
        id: `apex-${k}k-eod`, label: `${k}K EOD`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + 100 },
        dailyLoss: { amount: dll, onHit: 'lock' }, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 50, scope: 'payout' }, minDays: 0, priceOnce: price,
        notes: ['The limit only rises with end-of-day closing highs (4:59 PM ET) but is enforced in real time.'],
      })),
    ],
  },
  {
    id: 'topstep',
    name: 'Topstep',
    note: 'Trading Combine: the MLL trails end-of-day only, but is enforced in real time (incl. unrealized P&L) and locks at breakeven. The DLL is optional (defaults shown) and only locks the day. Flat by 3:10 PM CT, no overnight.',
    sources: [
      'https://help.topstep.com/en/articles/8284197-trading-combine-parameters',
      'https://help.topstep.com/en/articles/8284204-what-is-the-maximum-loss-limit',
      'https://help.topstep.com/en/articles/8284208-consistency-at-topstep',
    ],
    accounts: [
      ...[[50, 3000, 2000, 1000, 5, 49], [100, 6000, 3000, 2000, 10, 99], [150, 9000, 4500, 3000, 15, 199]].map(([k, target, dd, dll, contracts, price]) => ({
        id: `topstep-${k}k`, label: `${k}K Combine`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 },
        dailyLoss: { amount: dll, onHit: 'lock' }, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 55, scope: 'eval' }, minDays: 0, priceMonthly: price,
        notes: ['Consistency: best day ≤ 55% of profit (official 2026 value; many sources still say 50%) – only delays passing.'],
      })),
      {
        id: 'topstep-25k-static', label: '25K Static (Labs)',
        size: 25000, profitTarget: 2000,
        drawdown: { type: 'static', amount: 1000, breachCheck: 'realtime', lockFloorAt: null },
        dailyLoss: null, maxContracts: null, maxMicros: null,
        consistency: { pct: 50, scope: 'eval' }, minDays: 0, priceOnce: 75,
        notes: ['Topstep Labs drop: static MLL fixed at $24,000, valid for 90 days, $4,000 payout cap – limited availability.'],
      },
      {
        id: 'topstep-250k-freedom', label: '250K Freedom (Labs)',
        size: 250000, profitTarget: 15000,
        drawdown: { type: 'eod_trailing', amount: 10000, breachCheck: 'realtime', lockFloorAt: 250000 },
        dailyLoss: null, maxContracts: null, maxMicros: null,
        consistency: null, minDays: 0, priceOnce: 499,
        notes: ['Limited Labs drop, valid for 90 days, $25,000 payout cap. Drawdown type/details not officially confirmed – verify before buying.'],
      },
    ],
  },
  {
    id: 'mffu',
    name: 'MyFundedFutures',
    note: 'Lineup as of Sept 2026: Rapid (intraday trailing), Rapid EOD, Pro and Builder – all one-time purchases. Trading 6:00 PM–4:10 PM ET, flat at close. The Flex line is apparently no longer for sale and is not listed here.',
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
        notes: ['The trailing threshold follows the real-time high including unrealized P&L of open trades.'],
      })),
      ...[[25, 1500, 1000, 2, null], [50, 3000, 2000, 3, 209]].map(([k, target, dd, contracts, price]) => ({
        id: `mffu-${k}k-rapid-eod`, label: `${k}K Rapid EOD`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + 100 },
        dailyLoss: null, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 30, scope: 'eval' }, minDays: 4, priceOnce: price,
        notes: ['EOD drawdown traded against a stricter 30% consistency rule and 4 minimum days.'],
      })),
      ...[[50, 3000, 2000, 5, 265], [100, 6000, 3000, 10, null], [150, 9000, 4500, 15, 557]].map(([k, target, dd, contracts, price]) => ({
        id: `mffu-${k}k-pro`, label: `${k}K Pro`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + 100 },
        dailyLoss: null, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 50, scope: 'eval' }, minDays: 2, priceOnce: price,
        notes: ['At least one trade every 7 days (inactivity rule).'],
      })),
      ...[[25, 1500, 1000, 2, null, 105], [50, 3000, 2000, 4, 1000, 153]].map(([k, target, dd, contracts, dll, price]) => ({
        id: `mffu-${k}k-builder`, label: `${k}K Builder`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + 100 },
        dailyLoss: dll ? { amount: dll, onHit: 'lock' } : null, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 50, scope: 'payout' }, minDays: 1, priceOnce: price,
        notes: ['No consistency rule during the eval – a one-day pass is possible.'],
      })),
    ],
  },
  {
    id: 'tradeify',
    name: 'Tradeify',
    note: 'Tradeify 3.0: Growth eval (with DLL), Select eval (no DLL, 40% consistency) and Lightning (straight to sim-funded, no target). EOD trailing is enforced in real time on all of them. One-time purchase, no subscription.',
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
        notes: ['The eval drawdown never locks (the start+$100 lock applies only once funded).'],
      })),
      ...[[25, 1500, 1000, 1], [50, 3000, 2000, 4, 159], [100, 6000, 3000, 8], [150, 9000, 4500, 12]].map(([k, target, dd, contracts, price]) => ({
        id: `tradeify-${k}k-select`, label: `${k}K Select`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: null },
        dailyLoss: null, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 40, scope: 'eval' }, minDays: 3, priceOnce: price ?? null,
        notes: ['No daily loss limit – only the trailing drawdown and the 40% consistency rule.'],
      })),
      {
        id: 'tradeify-300k-select', label: '300K Select',
        size: 300000, profitTarget: 14000,
        drawdown: { type: 'eod_trailing', amount: 8000, breachCheck: 'realtime', lockFloorAt: 300100 },
        dailyLoss: { amount: 4000, onHit: 'lock' }, maxContracts: 16, maxMicros: 160,
        consistency: { pct: 40, scope: 'eval' }, minDays: 3, priceOnce: null,
        notes: ['V2 (currently sold): $8,000 DD + $4,000 DLL, 16 minis. Limited release, no resets – double-check before buying.'],
      },
      ...[[25, 1000, null, 1, 345], [50, 2000, 1250, 4, 479], [100, 4000, 2500, 8, 660], [150, 5250, 3000, 12, 796]].map(([k, dd, dll, contracts, price]) => ({
        id: `tradeify-${k}k-lightning`, label: `${k}K Lightning`,
        size: k * 1000, profitTarget: null,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + 100 },
        dailyLoss: dll ? { amount: dll, onHit: 'lock' } : null, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 20, scope: 'payout' }, minDays: null, priceOnce: price,
        notes: ['Straight to sim-funded: no profit target, payout rules instead (first payout at 20% consistency).', k >= 100 ? 'Drawdown amount changed during 2026 – verify before buying.' : ''].filter(Boolean),
      })),
    ],
  },
  {
    id: 'lucid',
    name: 'Lucid',
    note: 'Lineup as of Sept 2026: LucidFlex, LucidPro and LucidDaily (drawdown type picked at checkout on Daily; the toggle applies to eval AND funded). The DLL is optional since Aug 2026 (values shown) and only locks the day. No overnight, auto-flat at session close. One-time purchase. LucidDirect (instant funding) is not covered here.',
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
        notes: ['Intraday dips below the limit are allowed – only the daily close counts.'],
      })),
      ...[[25, 1250, 1000, 600, 2, 135], [50, 3000, 2000, 1200, 4, 185], [100, 6000, 3000, 1800, 6, 307], [150, 9000, 4500, 2700, 10, 410]].map(([k, target, dd, dll, contracts, price]) => ({
        id: `lucid-${k}k-pro`, label: `${k}K Pro`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'eod', lockFloorAt: k * 1000 + 100 },
        dailyLoss: { amount: dll, onHit: 'lock' }, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 40, scope: 'payout' }, minDays: 0, priceOnce: price,
        notes: ['No consistency rule during the eval – a one-day pass is possible.'],
      })),
      ...[[25, 1250, 1000, 600, 2], [50, 3000, 2000, 1200, 4], [100, 6000, 3000, 1800, 6], [150, 9000, 4500, 2700, 10]].map(([k, target, dd, dll, contracts]) => ({
        id: `lucid-${k}k-daily-eod`, label: `${k}K Daily (EOD)`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'eod_trailing', amount: dd, breachCheck: 'eod', lockFloorAt: k * 1000 + 100 },
        dailyLoss: { amount: dll, onHit: 'lock' }, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 50, scope: 'eval' }, minDays: 0, priceOnce: null,
        notes: ['The funded account switches to an intraday drawdown with a daily profit cap and a news rule.'],
      })),
      ...[[25, 1250, 1000, 600, 2], [50, 3000, 2000, 1200, 4], [100, 6000, 3000, 1800, 6], [150, 9000, 4500, 2700, 10]].map(([k, target, dd, dll, contracts]) => ({
        id: `lucid-${k}k-daily-intraday`, label: `${k}K Daily (Intraday)`,
        size: k * 1000, profitTarget: target,
        drawdown: { type: 'intraday_trailing', amount: dd, breachCheck: 'realtime', lockFloorAt: k * 1000 + 100 },
        dailyLoss: { amount: dll, onHit: 'lock' }, maxContracts: contracts, maxMicros: contracts * 10,
        consistency: { pct: 50, scope: 'eval' }, minDays: 0, priceOnce: null,
        notes: ['The cheaper Daily variant: trailing moves in real time incl. unrealized P&L.'],
      })),
    ],
  },
];
