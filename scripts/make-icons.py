#!/usr/bin/env python3
"""Draws the site icon (a puck with momentum streaks) and renders every size.

  python3 scripts/make-icons.py        (needs Playwright for Node and Pillow)

Writes public/icons/*. The SVGs are the source; the PNGs and favicon.ico are rendered from them."""
import json, subprocess, sys, os
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'public' / 'icons'
OUT.mkdir(parents=True, exist_ok=True)
BG, RED, PINK = '#0a0e17', '#e11d48', '#fb7185'

ART = f'''
<g>
  <!-- momentum streaks: three skewed bars, longest on top, fading as they trail the puck -->
  <path d="M62 150 H238 L212 208 H36 Z" fill="{RED}"/>
  <path d="M100 228 H252 L228 282 H76 Z" fill="{RED}" opacity=".85"/>
  <path d="M150 302 H262 L242 346 H130 Z" fill="{PINK}" opacity=".7"/>
  <!-- puck: side wall, then top face -->
  <path d="M244 214 V312 A118 54 0 0 0 480 312 V214 Z" fill="#94a3b8"/>
  <ellipse cx="362" cy="214" rx="118" ry="54" fill="#f8fafc"/>
  <ellipse cx="362" cy="214" rx="82" ry="34" fill="none" stroke="#cbd5e1" stroke-width="6"/>
</g>'''

def svg(kind):
    """kind: any (rounded square), full (full-bleed square), maskable (full-bleed, art inside the safe zone)."""
    if kind == 'any':
        bg = f'<rect width="512" height="512" rx="104" fill="{BG}"/>'
        art = f'<g transform="translate(-6 0)">{ART}</g>'
    elif kind == 'full':
        bg = f'<rect width="512" height="512" fill="{BG}"/>'
        art = f'<g transform="translate(-6 0)">{ART}</g>'
    else:  # maskable: keep everything inside the central 80% circle
        bg = f'<rect width="512" height="512" fill="{BG}"/>'
        art = f'<g transform="translate(256 256) scale(.66) translate(-256 -262)">{ART}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">{bg}{art}</svg>\n'

# The small favicon drops detail: just the puck and two bold streaks so it reads at 16px.
FAV = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="{BG}"/>
<path d="M5 17 H29 L26 26 H2 Z" fill="{RED}"/><path d="M10 31 H31 L28 40 H7 Z" fill="{RED}" opacity=".85"/>
<path d="M26 28 V42 A17 9 0 0 0 60 42 V28 Z" fill="#94a3b8"/><ellipse cx="43" cy="28" rx="17" ry="9" fill="#f8fafc"/></svg>
'''

files = {'icon.svg': svg('any'), 'icon-full.svg': svg('full'), 'icon-maskable.svg': svg('maskable'), 'favicon.svg': FAV}
for name, text in files.items():
    (OUT / name).write_text(text)

# (output file, source svg, pixel size)
PNGS = [
    ('apple-touch-icon.png', 'icon-full.svg', 180),     # iOS home screen (iOS rounds the corners itself)
    ('icon-192.png', 'icon.svg', 192),                   # Android / PWA
    ('icon-512.png', 'icon.svg', 512),
    ('icon-maskable-192.png', 'icon-maskable.svg', 192), # Android adaptive icon
    ('icon-maskable-512.png', 'icon-maskable.svg', 512),
    ('favicon-16.png', 'favicon.svg', 16),
    ('favicon-32.png', 'favicon.svg', 32),
    ('favicon-48.png', 'favicon.svg', 48),
    ('icon-1024.png', 'icon-full.svg', 1024),            # store / marketing size
]
js = '''
const { chromium } = require('playwright');
(async () => {
  const jobs = JSON.parse(process.argv[2]);
  const b = await chromium.launch();
  for (const [out, src, size] of jobs) {
    const p = await b.newPage({ viewport: { width: size, height: size } });
    const svg = require('fs').readFileSync(src, 'utf8');
    await p.setContent(`<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" style="width:${size}px;height:${size}px;display:block"></body></html>`);
    await p.screenshot({ path: out, omitBackground: true });
    await p.close();
  }
  await b.close();
})();
'''
tmp = OUT / '_render.cjs'
tmp.write_text(js)
jobs = [[str(OUT / o), str(OUT / s), n] for o, s, n in PNGS]
subprocess.run(['node', str(tmp), json.dumps(jobs)], check=True, env={**os.environ, 'NODE_PATH': ':'.join(filter(None, [os.environ.get('NODE_PATH'), subprocess.run(['npm', 'root', '-g'], capture_output=True, text=True).stdout.strip(), '/opt/node-tools/node_modules']))})
tmp.unlink()

from PIL import Image
imgs = [Image.open(OUT / f'favicon-{n}.png').convert('RGBA') for n in (16, 32, 48)]
imgs[-1].save(OUT / 'favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)], append_images=imgs[:-1])
print('wrote', sorted(p.name for p in OUT.iterdir()))
