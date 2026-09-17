"""Pre-decode world-atlas TopoJSON into flat lon/lat rings the browser can draw directly."""
import json

SRC = '/tmp/claude-1000/-home-ondra-WebZoneClock/929c71fc-3ec4-421f-9e19-834aeef18a68/scratchpad/land-110m.json'
OUT = '/home/ondra/WebZoneClock/data/land.json'
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


def main():
    topo = json.load(open(SRC))
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

    out = {'polygons': polygons}
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))

    npts = sum(len(r) // 2 for p in polygons for r in p)
    print(f'polygons={len(polygons)} rings={sum(len(p) for p in polygons)} points={npts}')


main()
