/**
 * Bundles the whole game — Three.js, every module and the stylesheet — into a
 * single self-contained HTML file that runs by double-clicking it, with no
 * server, no npm and no network access.
 *
 *   node scripts/build-single.mjs        →  kecioren-surus.html
 */
import { build } from 'esbuild';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'kecioren-surus.html');

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

const template = await readFile(resolve(root, 'index.html'), 'utf8');

// `</script>` inside a string literal would close the tag we are writing into.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

// Replacer *functions*, never replacement strings: minified code is full of
// `$&`, `$1` and friends, which String.replace would expand and corrupt.
const html = template
  .replace('</head>', () => `  <style>\n${css}\n  </style>\n</head>`)
  .replace(/\n\s*<script type="module" src="\/src\/main\.js"><\/script>/, () => '')
  .replace('</body>', () => `  <script>\n${safeJs}\n  </script>\n</body>`);

if (html.includes('src="/src/main.js"')) {
  throw new Error('the module script tag in index.html was not replaced');
}

await writeFile(OUT, html, 'utf8');
const { size } = await stat(OUT);
console.log(`kecioren-surus.html — ${(size / 1024 / 1024).toFixed(2)} MB (tek dosya, harici bağımlılık yok)`);
