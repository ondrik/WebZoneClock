"""Pre-decode world-atlas TopoJSON into flat lon/lat rings the browser can draw.

Usage:
    python3 tools/build_land.py [SRC] [OUT]

SRC defaults to tools/cache/land-110m.json and is downloaded if missing.
"""

import argparse
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'tools' / 'cache'
UPSTREAM = 'https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json'

PREC = 2  # ~1 km at the equator; far finer than one screen pixel on a world map


def decode_arcs(topo):
    sx, sy = topo['transform']['scale']
    tx, ty = topo['transform']['translate']
    arcs = []
    for arc in topo['arcs']:
        x = y = 0
        pts = []
        for dx, dy in arc:
            x += dx
            y += dy
            pts.append((x * sx + tx, y * sy + ty))
        arcs.append(pts)
    return arcs


def ring_coords(arcs, indices):
    out = []
    for i in indices:
        pts = arcs[~i][::-1] if i < 0 else arcs[i]
        # Consecutive arcs share an endpoint; drop the duplicate.
        out.extend(pts[1:] if out else pts)
    return out


def fetch(src: Path) -> None:
    if src.exists():
        return
    src.parent.mkdir(parents=True, exist_ok=True)
    print(f'downloading {UPSTREAM}')
    urllib.request.urlretrieve(UPSTREAM, src)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('src', nargs='?', type=Path, default=CACHE / 'land-110m.json')
    ap.add_argument('out', nargs='?', type=Path, default=ROOT / 'data' / 'land.json')
    args = ap.parse_args()

    fetch(args.src)
    topo = json.loads(args.src.read_text(encoding='utf-8'))
    arcs = decode_arcs(topo)
    geom = topo['objects']['land']['geometries'][0]
    assert geom['type'] == 'MultiPolygon', geom['type']

    polygons = []
    for poly in geom['arcs']:
        rings = []
        for ring in poly:
            coords = ring_coords(arcs, ring)
            flat = []
            last = None
            for lon, lat in coords:
                p = (round(lon, PREC), round(lat, PREC))
                if p != last:          # drop points that collapse at this precision
                    flat.extend(p)
                    last = p
            if len(flat) >= 8:         # need 4+ distinct points to enclose area
                rings.append(flat)
        if rings:
            polygons.append(rings)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({'polygons': polygons}, separators=(',', ':')))

    npts = sum(len(r) // 2 for p in polygons for r in p)
    print(
        f'{args.out}: polygons={len(polygons)} '
        f'rings={sum(len(p) for p in polygons)} points={npts}'
    )


if __name__ == '__main__':
    main()
