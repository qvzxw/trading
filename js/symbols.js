// Kontrakt-Spezifikationen für gängige Futures (CME/CBOT/COMEX/NYMEX).
// multiplier = USD pro vollem Indexpunkt/Preispunkt und Kontrakt.
// miniEquiv = wie viele dieser Kontrakte einem Mini entsprechen (Micro = 0.1).

const SPECS = {
  // Equity Index
  ES:  { name: 'E-mini S&P 500',        multiplier: 50,     miniEquiv: 1 },
  MES: { name: 'Micro E-mini S&P 500',  multiplier: 5,      miniEquiv: 0.1, micro: true },
  NQ:  { name: 'E-mini Nasdaq-100',     multiplier: 20,     miniEquiv: 1 },
  MNQ: { name: 'Micro E-mini Nasdaq',   multiplier: 2,      miniEquiv: 0.1, micro: true },
  YM:  { name: 'E-mini Dow',            multiplier: 5,      miniEquiv: 1 },
  MYM: { name: 'Micro E-mini Dow',      multiplier: 0.5,    miniEquiv: 0.1, micro: true },
  RTY: { name: 'E-mini Russell 2000',   multiplier: 50,     miniEquiv: 1 },
  M2K: { name: 'Micro E-mini Russell',  multiplier: 5,      miniEquiv: 0.1, micro: true },
  NKD: { name: 'Nikkei 225 (USD)',      multiplier: 5,      miniEquiv: 1 },
  // Energie
  CL:  { name: 'Crude Oil',             multiplier: 1000,   miniEquiv: 1 },
  MCL: { name: 'Micro Crude Oil',       multiplier: 100,    miniEquiv: 0.1, micro: true },
  QM:  { name: 'E-mini Crude Oil',      multiplier: 500,    miniEquiv: 0.5 },
  NG:  { name: 'Henry Hub Natural Gas', multiplier: 10000,  miniEquiv: 1 },
  MNG: { name: 'Micro Natural Gas',     multiplier: 1000,   miniEquiv: 0.1, micro: true },
  QG:  { name: 'E-mini Natural Gas',    multiplier: 2500,   miniEquiv: 0.25 },
  RB:  { name: 'RBOB Gasoline',         multiplier: 42000,  miniEquiv: 1 },
  HO:  { name: 'Heating Oil',           multiplier: 42000,  miniEquiv: 1 },
  // Metalle
  GC:  { name: 'Gold',                  multiplier: 100,    miniEquiv: 1 },
  MGC: { name: 'Micro Gold',            multiplier: 10,     miniEquiv: 0.1, micro: true },
  SI:  { name: 'Silver',                multiplier: 5000,   miniEquiv: 1 },
  SIL: { name: 'Micro Silver',          multiplier: 1000,   miniEquiv: 0.2, micro: true },
  HG:  { name: 'Copper',                multiplier: 25000,  miniEquiv: 1 },
  MHG: { name: 'Micro Copper',          multiplier: 2500,   miniEquiv: 0.1, micro: true },
  PL:  { name: 'Platinum',                multiplier: 50,     miniEquiv: 1 },
  // Zinsen
  ZB:  { name: '30Y T-Bond',            multiplier: 1000,   miniEquiv: 1 },
  ZN:  { name: '10Y T-Note',            multiplier: 1000,   miniEquiv: 1 },
  ZF:  { name: '5Y T-Note',             multiplier: 1000,   miniEquiv: 1 },
  ZT:  { name: '2Y T-Note',             multiplier: 2000,   miniEquiv: 1 },
  UB:  { name: 'Ultra T-Bond',          multiplier: 1000,   miniEquiv: 1 },
  TN:  { name: 'Ultra 10Y T-Note',      multiplier: 1000,   miniEquiv: 1 },
  // FX
  '6E': { name: 'Euro FX',              multiplier: 125000, miniEquiv: 1 },
  M6E: { name: 'Micro Euro FX',         multiplier: 12500,  miniEquiv: 0.1, micro: true },
  '6B': { name: 'British Pound',        multiplier: 62500,  miniEquiv: 1 },
  M6B: { name: 'Micro British Pound',   multiplier: 6250,   miniEquiv: 0.1, micro: true },
  '6J': { name: 'Japanese Yen',         multiplier: 12500000, miniEquiv: 1 },
  '6A': { name: 'Australian Dollar',    multiplier: 100000, miniEquiv: 1 },
  M6A: { name: 'Micro AUD',             multiplier: 10000,  miniEquiv: 0.1, micro: true },
  '6C': { name: 'Canadian Dollar',      multiplier: 100000, miniEquiv: 1 },
  // Agrar
  ZC:  { name: 'Corn',                  multiplier: 50,     miniEquiv: 1 },
  ZW:  { name: 'Wheat',                multiplier: 50,     miniEquiv: 1 },
  ZS:  { name: 'Soybeans',            multiplier: 50,     miniEquiv: 1 },
  ZL:  { name: 'Soybean Oil',                multiplier: 600,    miniEquiv: 1 },
  ZM:  { name: 'Soybean Meal',              multiplier: 100,    miniEquiv: 1 },
  LE:  { name: 'Live Cattle',           multiplier: 400,    miniEquiv: 1 },
  HE:  { name: 'Lean Hogs',             multiplier: 400,    miniEquiv: 1 },
  // Krypto (CME)
  BTC: { name: 'Bitcoin',               multiplier: 5,      miniEquiv: 1 },
  MBT: { name: 'Micro Bitcoin',         multiplier: 0.1,    miniEquiv: 0.02, micro: true },
  ETH: { name: 'Ether',                 multiplier: 50,     miniEquiv: 1 },
  MET: { name: 'Micro Ether',           multiplier: 0.1,    miniEquiv: 0.002, micro: true },
};

const MONTH_CODES = 'FGHJKMNQUVXZ';

// "CME_MINI:NQ1!", "CME_MINI:NQZ2026", "COMEX:GC1!", "NQ1!", "MNQH2026" -> Root wie "NQ"
export function symbolRoot(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toUpperCase();
  const colon = s.lastIndexOf(':');
  if (colon >= 0) s = s.slice(colon + 1);
  s = s.replace(/[0-9]*!$/, '');                    // Continuous: NQ1! -> NQ
  const m = s.match(/^(.*?)([FGHJKMNQUVXZ])(\d{4}|\d{1,2})$/); // Kontraktmonat: NQZ2026 -> NQ
  if (m && m[1] && SPECS[m[1]] && MONTH_CODES.includes(m[2])) s = m[1];
  return s || null;
}

export function symbolSpec(raw) {
  const root = symbolRoot(raw);
  return root && SPECS[root] ? { root, ...SPECS[root] } : (root ? { root, name: root, multiplier: null, miniEquiv: 1 } : null);
}

export { SPECS };
