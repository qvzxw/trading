// Baut dist/prop-replay.html: eine einzelne, selbst-enthaltene HTML-Datei
// (CSS + alle JS-Module inline, ES-Module-Syntax entfernt), die direkt per
// Doppelklick als file:// läuft.  Aufruf: node tools/build-single.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// Reihenfolge = Abhängigkeitsreihenfolge
const MODULES = [
  'js/symbols.js', 'js/parse.js', 'js/engine.js', 'js/firms.js',
  'js/chart.js', 'js/calendar.js', 'js/demo.js',
  'js/charts/data.js', 'js/charts/compute.js', 'js/charts/paint.js', 'js/charts/app.js',
  'js/main.js',
];

// Jedes Modul kommt in eine eigene IIFE (keine Namenskollisionen zwischen
// Modul-Scopes); Exporte landen im Namespace __PR, Imports lesen daraus.
function wrapModule(name, src) {
  const exported = new Set();
  const out = src
    .replace(/^import\s*\{([^}]*)\}\s*from\s*[^;]*;\s*$/gm, (_, names) => `const {${names}} = __PR;`)
    .replace(/^export\s*\{([^}]*)\};\s*$/gm, (_, names) => {
      names.split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => exported.add(n));
      return '';
    })
    .replace(/^export\s+((?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*))/gm, (_, decl, id) => {
      exported.add(id);
      return decl;
    });
  const leftover = out.match(/^\s*(import|export)\b.*$/m);
  if (leftover) throw new Error(`${name}: unbehandelte Modul-Syntax: ${leftover[0].trim()}`);
  return `// ===== ${name} =====\nObject.assign(__PR, (() => {\n${out}\nreturn { ${[...exported].join(', ')} };\n})());`;
}

const js = 'const __PR = {};\n' + MODULES.map((m) => wrapModule(m, read(m))).join('\n');
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
