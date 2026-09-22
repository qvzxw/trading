# Prop Replay

TradingView-Paper-Trading gegen echte Prop-Firm-Regeln laufen lassen.

TradingView-Papierhandel kennt keine Prop-Firm-Regeln. Diese App nimmt deinen
CSV-Export aus dem TradingView-Trading-Panel und simuliert, wie derselbe
Trading-Verlauf in einer Evaluation von **Apex, Topstep, MyFundedFutures,
Tradeify oder Lucid** gelaufen wäre: Trailing Drawdown (Intraday/EOD/statisch),
Daily Loss Limit, Profit Target, Consistency-Regel, Mindesttage und
Kontrakt-Limits.

## Benutzen

Statische Web-App ohne Build-Schritt — einfach `index.html` über einen
beliebigen Webserver öffnen:

```bash
npx serve .        # oder: python3 -m http.server
```

(Direktes Öffnen als `file://` funktioniert nicht, weil ES-Module geladen werden.)

1. **Prop Firm und Account wählen** — die Regeln des Accounts werden angezeigt.
2. **TradingView-Export laden** — im Trading-Panel unten rechts auf das
   Download-Symbol → „Daten herunterladen" → am besten **„Alle Tabs"**.
   Die App erkennt Guthabenübersicht (Kontobewegungen), Handelsverlauf und
   Order-Verlauf, mit deutschen oder englischen Headern.
3. **Ergebnis lesen** — bestanden / geplatzt / läuft noch, Equity-Kurve gegen
   das Drawdown-Limit, Regel-Checkliste und Tagestabelle.

Der **Quick-Check** unten rechnet ohne CSV: aktueller Kontostand + bisheriges
Hoch → wo dein Drawdown-Limit gerade steht und wie viel Luft du hast.

## Wie gerechnet wird

- Die Simulation mappt dein Paper-Konto auf die Kontogröße des gewählten
  Accounts: `Equity = Kontogröße + kumulierter Paper-P&L` (Startpunkt ist der
  Anfang des Exports bzw. der letzte Paper-Reset).
- **EOD-Trailing**: Das Limit steigt nur mit neuen Tagesschluss-Hochs
  (CME-Handelstag, Schluss 17:00 New York). Je nach Firm wird der Bruch in
  Echtzeit (Topstep, Tradeify) oder nur zum Tagesschluss geprüft.
- **Intraday-Trailing** (Apex Intraday, MFFU Rapid …): Das Limit zieht mit
  jedem neuen Equity-Hoch nach — bei manchen Firms inklusive unrealisierter
  Spitzen offener Trades. Der TradingView-Export enthält nur realisierte
  Trades, deshalb ist diese Rechnung eine Untergrenze: das echte Limit kann
  strenger sein. Die App sagt das auch dazu.
- **Consistency**: Bei den meisten Firms eine Soft-Regel — sie lässt den
  Account nicht platzen, sondern verzögert das Bestehen, bis der beste Tag
  unter der Grenze liegt. Die App rechnet aus, wie viel Gesamtprofit dafür
  nötig wäre.
- Kontrakt-Limits werden aus dem Handelsverlauf geprüft (10 Micros = 1 Mini).

## Regelstand

Die Regeln in `js/firms.js` wurden im **September 2026** gegen die offiziellen
Seiten und Help-Center der Firms recherchiert und gegengeprüft (Quellen stehen
in der Datei). Prop Firms ändern ihre Regeln laufend — vor einem Kauf immer
die offizielle Seite checken. Keine Anlageberatung; das Projekt steht in
keiner Verbindung zu den genannten Firmen oder TradingView.

## Entwicklung

```bash
node --test tests/engine.test.mjs tests/parse.test.mjs
```

| Datei | Inhalt |
| --- | --- |
| `js/engine.js` | Simulations-Engine (Drawdown, DLL, Target, Consistency, Handelstage) |
| `js/parse.js` | CSV-Parser für TradingView-Exporte (DE/EN, All-Tabs-Dateien) |
| `js/firms.js` | Regel-Datenbank der Prop Firms |
| `js/symbols.js` | Kontraktspezifikationen (Multiplikatoren, Micro↔Mini) |
| `js/chart.js` | SVG-Equity-Chart mit Crosshair-Tooltip |
| `js/main.js` | UI-Logik |
| `js/demo.js` | Deterministische Beispieldaten |
