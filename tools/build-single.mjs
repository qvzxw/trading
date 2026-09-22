// Baut dist/prop-replay.html: eine einzelne, selbst-enthaltene HTML-Datei
// (CSS + alle JS-Module inline, ES-Module-Syntax entfernt), die direkt per
// Doppelklick als file:// läuft.  Aufruf: node tools/build-single.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Reihenfolge = Abhängigkeitsreihenfolge
const MODULES = ['js/symbols.js', 'js/parse.js', 'js/engine.js', 'js/firms.js', 'js/chart.js', 'js/demo.js', 'js/main.js'];

function stripModuleSyntax(src) {
  return src
    .replace(/^import\s[^;]*;\s*$/gm, '')      // import-Zeilen raus
    .replace(/^export\s+\{[^}]*\};\s*$/gm, '') // reine Re-Export-Zeilen raus
    .replace(/^export\s+(?=(const|function|let|class)\b)/gm, ''); // export-Keyword strippen
}

const js = MODULES.map((m) => `// ===== ${m} =====\n${stripModuleSyntax(read(m))}`).join('\n');
const css = read('css/app.css');
const html = read('index.html');

const icon192 = readFileSync(join(root, 'icons/icon-192.png')).toString('base64');

let out = html
  // Manifest/SW-Zeug raus – als Einzeldatei gibt es keine Nebenressourcen
  .replace(/<link rel="manifest"[^>]*>\s*/g, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>\s*/g, '')
  .replace(/<link rel="icon"[^>]*>\s*/g, `<link rel="icon" href="data:image/png;base64,${icon192}">\n`)
  .replace(/<link rel="stylesheet" href="css\/app.css">/, () => `<style>\n${css}\n</style>`)
  .replace(/<script type="module" src="js\/main.js"><\/script>/, () => `<script>\n${js}\n</script>`)
  .replace(/<script>\s*\/\/ PWA:[\s\S]*?<\/script>/, '');

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/prop-replay.html'), out);
console.log('dist/prop-replay.html:', out.length, 'bytes');
