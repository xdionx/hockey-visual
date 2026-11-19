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
  <!-- momentum meter: five bars lined up on the left, each longer than the last -->
  <rect x="56" y="112" width="120" height="40" rx="20" fill="{PINK}" opacity="0.6"/>
  <rect x="56" y="170" width="190" height="40" rx="20" fill="{RED}" opacity="0.8"/>
  <rect x="56" y="228" width="260" height="40" rx="20" fill="{RED}" opacity="0.9"/>
  <rect x="56" y="286" width="330" height="40" rx="20" fill="{RED}" opacity="1"/>
  <rect x="56" y="344" width="400" height="40" rx="20" fill="{RED}" opacity="1"/>
  <!-- puck, 3in wide x 1in thick, rounded edge, in front of the meter -->
  <g transform="translate(290 318) scale(.84) translate(-366 -232)">
    <path d="M244 232 V304 A122 42 0 0 0 488 304 V232 Z" fill="#94a3b8"/>
    <ellipse cx="366" cy="232" rx="122" ry="42" fill="#cbd5e1"/>
    <ellipse cx="366" cy="229" rx="113" ry="37" fill="#f8fafc"/>
  </g>
</g>'''

def svg(kind):
    """kind: any (rounded square), full (full-bleed square), maskable (full-bleed, art inside the safe zone)."""
    if kind == 'any':
        bg = f'<rect width="512" height="512" rx="104" fill="{BG}"/>'
        art = f'<g transform="translate(0 0)">{ART}</g>'
    elif kind == 'full':
        bg = f'<rect width="512" height="512" fill="{BG}"/>'
        art = f'<g transform="translate(0 0)">{ART}</g>'
    else:  # maskable: keep everything inside the central 80% circle
        bg = f'<rect width="512" height="512" fill="{BG}"/>'
        art = f'<g transform="translate(256 256) scale(.7) translate(-256 -240)">{ART}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">{bg}{art}</svg>\n'

# The small favicon drops detail: just the puck and two bold streaks so it reads at 16px.
FAV = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="{BG}"/>
<rect x="7" y="9" width="16" height="6" rx="3" fill="{PINK}" opacity=".7"/><rect x="7" y="18" width="26" height="6" rx="3" fill="{RED}"/><rect x="7" y="27" width="36" height="6" rx="3" fill="{RED}"/><rect x="7" y="36" width="46" height="6" rx="3" fill="{RED}"/><rect x="7" y="45" width="52" height="6" rx="3" fill="{RED}"/>
<path d="M21 36 V43 A17 6 0 0 0 55 43 V36 Z" fill="#94a3b8"/><ellipse cx="38" cy="36" rx="17" ry="6" fill="#cbd5e1"/><ellipse cx="38" cy="35.4" rx="15.6" ry="5.2" fill="#f8fafc"/></svg>
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
