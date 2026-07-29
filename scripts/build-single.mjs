/**
 * Bundles the whole game — Three.js, every module and the stylesheet — into a
 * single self-contained HTML file.
 *
 * The output is the repository root's `index.html`, which means the same file
 * both runs by double-clicking it (file://) and is what GitHub Pages serves at
 * the site root. `src/index.html` is only the development template.
 *
 *   node scripts/build-single.mjs        →  index.html
 */
import { build } from 'esbuild';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = resolve(root, 'src/index.html');
const OUT = resolve(root, 'index.html');

// IIFE rather than an ES module: inline module scripts are blocked on some
// file:// setups, a plain script is not.
const result = await build({
  entryPoints: [resolve(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  write: false,
  outdir: resolve(root, '.singlefile'),
  loader: { '.css': 'css' },
  logLevel: 'warning'
});

let js = '';
let css = '';
for (const file of result.outputFiles) {
  if (file.path.endsWith('.js')) js = file.text;
  else if (file.path.endsWith('.css')) css = file.text;
}
if (!js) throw new Error('esbuild produced no JavaScript output');

const template = await readFile(TEMPLATE, 'utf8');

// `</script>` inside a string literal would close the tag we are writing into.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

// Replacer *functions*, never replacement strings: minified code is full of
// `$&`, `$1` and friends, which String.replace would expand and corrupt.
const html = template
  .replace('</head>', () => `  <style>\n${css}\n  </style>\n</head>`)
  .replace(/\n\s*<script type="module" src="\/main\.js"><\/script>/, () => '')
  .replace('</body>', () => `  <script>\n${safeJs}\n  </script>\n</body>`);

if (html.includes('src="/main.js"')) {
  throw new Error('the module script tag in src/index.html was not replaced');
}
if (html.includes('</body>&') || html.includes('</head>&')) {
  throw new Error('a closing tag leaked into the bundle — check the replacers');
}

await writeFile(OUT, html, 'utf8');
const { size } = await stat(OUT);
console.log(`index.html — ${(size / 1024 / 1024).toFixed(2)} MB (tek dosya, harici bağımlılık yok)`);
