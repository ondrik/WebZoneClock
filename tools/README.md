# Data generation

Both files in `data/` are generated and checked in, so the site has no build
step and no runtime dependencies. Regenerate them only when you want to change
what they contain.

## `data/cities.json`

~2,300 cities with coordinates and IANA timezones, column-compressed (shared
country and timezone strings are interned into lookup tables).

```sh
curl -sSL -o /tmp/cityMap.json \
  https://raw.githubusercontent.com/kevinroberts/city-timezones/master/data/cityMap.json
python3 tools/build_cities.py            # edit SRC at the top if you cache elsewhere
```

The script keeps every city over 150,000 people, plus a hand-maintained
`EXTRAS` list of capitals and a `MANUAL` list of places that carry a timezone
no populous city does (Kiritimati for UTC+14, the Chatham Islands for
UTC+12:45, and so on). `NAME_FIX` repairs transcription errors in the upstream
data, and `ALIASES` adds searchable endonyms and former names — "Praha" finds
Prague, "Peking" finds Beijing. The script warns about alias entries that
match no city, which is how you catch a spelling drifting out of sync.

## `data/land.json`

World coastlines, as flat rings of `lon, lat` pairs at two decimal places
(about 1 km, far finer than one screen pixel on a world map).

```sh
curl -sSL -o /tmp/land-110m.json https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json
python3 tools/build_land.py
```

This decodes the TopoJSON — delta-decoding the arcs, stitching them into
rings, reversing the ones referenced negatively — so the browser does not need
a TopoJSON library. The renderer then rewrites each ring's longitudes to be
continuous and draws it shifted by a whole turn either way, which is what
stops Chukotka and Fiji from smearing across the map at the antimeridian.
