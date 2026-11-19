// Cache busting for GitHub Pages, which serves every file with a 10 minute browser cache.
// Adds ?v=<version> to every local script, module import and stylesheet so a deploy is picked
// up as soon as the page itself reloads, and all modules always come from the same deploy.
//
//   node scripts/stamp-assets.js <site dir> <version> [subdir to skip ...]
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const JS_IMPORT = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"?]+\.js)\2/g;
const HTML_REF = /((?:src|href)=")((?![a-z]+:|\/\/|#)[^"?]+\.(?:js|css))"/g;

export function stampJs(src, v) {
  return src.replace(JS_IMPORT, (_, kw, q, path) => `${kw}${q}${path}?v=${v}${q}`);
}
export function stampHtml(src, v) {
  return src.replace(HTML_REF, (_, attr, path) => `${attr}${path}?v=${v}"`);
}

function walk(dir, root, skip, v) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(root, p);
    if (name === 'data' || skip.includes(rel)) continue;
    if (statSync(p).isDirectory()) { walk(p, root, skip, v); continue; }
    if (name.endsWith('.js')) writeFileSync(p, stampJs(readFileSync(p, 'utf8'), v));
    else if (name.endsWith('.html')) writeFileSync(p, stampHtml(readFileSync(p, 'utf8'), v));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir, v, ...skip] = process.argv.slice(2);
  if (!dir || !v) { console.error('usage: stamp-assets.js <dir> <version> [skip...]'); process.exit(1); }
  walk(dir, dir, skip, v);
}
