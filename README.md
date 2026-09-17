# WebZoneClock

A world clock for the browser, modelled on the desktop app **World Clock Pro**:
a strip of city tiles that colour themselves by what people there are probably
doing, over a world map with a live day/night terminator.

Static HTML, CSS and ES modules. No build step, no framework, no runtime
dependencies — it is meant to be served straight off GitHub Pages.

## What it does

- **Five looks**, switched from the picker in the toolbar and remembered
  between visits. They are not recolourings of one layout: each builds the city
  strip and draws the map its own way.

  | Look | The strip | The map |
  | --- | --- | --- |
  | **Daylight** | A row per city showing its whole day as real sunlight | Pale, tinted indigo at night |
  | **Orrery** | A brass 24-hour dial per city, day drawn as an arc | Hairline coastlines over a graticule |
  | **Solari** | A split-flap departure board | Charcoal landmasses |
  | **Two-ink** | Oversized printed numerals, teal and coral | Halftone dots |
  | **Classic** | The original filled tiles | Solid grey landmasses |

- **A three-state reading of each city's hour**: working (09:00–18:00), early
  (06:00–09:00), or evening and night. Each look expresses it differently —
  as a whole colour, an ink, or where the hand sits on a dial.
- **Time travel.** Drag the map itself, or the ruler along its bottom edge,
  and every clock, tile colour and the map's shading move together, so you can
  find an hour that is civil in all of them. The handle reads the offset from
  now (`+1:41`, `-6:44`), blue into the future and red into the past, and its
  `×` snaps back to now — as does double-clicking the map. Arrow keys nudge by
  15 minutes, <kbd>Shift</kbd> by an hour.
- **Add to calendar**, enabled once you are away from now: downloads an `.ics`
  for the selected slot with every city's local time written into the event.
- **A home city**, marked with a locator arrow. Click any tile to move it;
  click again to clear. Hovering a tile swaps its country line for that
  zone's UTC offset.
- **A `TOMORROW` / `YESTERDAY` caption** when a city is not on the same
  calendar day as home — the thing that actually catches people out.
- **A world map** with each city pinned at its real coordinates, labels
  routed around each other, and day/night shading computed from the sun's
  position.
- **Add, remove and reorder**: `+` or the <kbd>n</kbd> key opens search over
  ~2,300 cities, `×` on a tile removes it, and tiles drag to reorder.
- **12/24-hour** toggle, and a daylight toggle for the map shading.
- **Shareable links**: the share button copies a URL with your cities in the
  fragment; if you are time-travelling it carries the chosen moment too, so
  the recipient sees the slot you picked. Otherwise the set is remembered in
  `localStorage`.

Every timezone comes from the browser's own IANA database via `Intl`, so DST
and half-hour and 45-minute offsets are handled without a lookup table of
mine to go stale.

## Running it locally

The page fetches `data/*.json` and loads ES modules, so `file://` will not
work — it needs an HTTP origin:

```sh
python3 -m http.server 8777
# then open http://127.0.0.1:8777/
```

## Deploying

The repository root *is* the site, so GitHub Pages can serve it directly with
no build step. In *Settings → Pages*, set **Source** to **Deploy from a
branch**, branch `main`, folder `/ (root)`. `.nojekyll` is present so Pages
serves the tree verbatim instead of running it through Jekyll.

Every push to `main` republishes.

If you would rather deploy through GitHub Actions — worth it only if you add a
build step later — note that pushing a file under `.github/workflows/` needs a
token with the `workflow` scope (`gh auth refresh -s workflow`).

After forking, update `REPO_URL` at the top of `assets/js/main.js`; it drives
the "Source" link in the toolbar.

## How it works

`assets/js/` is one module per concern:

| Module | Responsibility |
| --- | --- |
| `solar.js` | Subsolar point and solar elevation from a date |
| `tz.js` | Zoned wall-clock fields, UTC offsets, day-difference, tile state |
| `geo.js` | Equirectangular projection sized to its container |
| `worldmap.js` | Canvas: land, day/night shading, city → pixel |
| `pins.js` | Map markers and the label placement solver |
| `citydb.js` | Loading, searching and ranking the city database |
| `themes.js` | The five looks, their tokens and their webfonts |
| `strip.js` | Building the city strip in each look's own layout |
| `daylight.js` | Solar elevation across a city's day; sunrise and sunset |
| `timeline.js` | The time-travel ruler: ticks, day bands, drag and keyboard |
| `calendar.js` | Building the `.ics` invitation |
| `state.js` | The city list, persistence, and share-link encoding |
| `main.js` | Wiring, the strip, and the once-a-minute render |

The time offset is held *relative* to now rather than as a fixed instant, so
the clocks keep ticking while you are away from now and the handle keeps
reading `+1:41`. Every part of the display reads the clock through one
function, which is what makes time travel apply uniformly.

**Dragging the map** scrubs at one map width per 24 hours — 15° of longitude
per hour, the rate the sun actually travels. Because time running forward
carries the subsolar point west, dragging right winds the clock *back*, and
the day/night terminator then follows the pointer exactly one-to-one: you are
dragging the daylight itself, which is what the grab cursor promises. The
original is about 1.4× more sensitive than this (measured off a screen
recording at 34 hours per window width, R² = 0.99); the round number was
preferred here for the terminator-tracking property.

Three other parts are worth knowing about:

**The projection.** Longitude always spans the full 360°; the latitude window
is then derived from the container's aspect ratio so that a degree of latitude
and a degree of longitude get the same number of pixels. The map is therefore
never stretched. On a container too tall to hold the globe at that scale — a
phone in portrait — the map is letterboxed into a band instead of distorted to
fill it, and the tiles wrap into a grid to use the space the map cannot.

**The terminator.** Solar declination and the subsolar longitude come from the
low-precision almanac formulae, accurate to a fraction of a degree, which is
far better than one pixel on a world map. Alpha is computed on a 480×240 grid
and scaled up with smoothing: solar elevation varies smoothly over the globe,
so interpolating is indistinguishable from solving per pixel and much cheaper.
Land is drawn lit and then darkened, with a soft twilight ramp between +4° and
−8° of elevation.

**The sunlight bands** are not the three office-hours buckets stretched out.
`daylight.js` samples the sun's real elevation across a city's local
midnight-to-midnight and hands back both a gradient and the sunrise and sunset
crossings, so a band shows the day that city actually gets. It stays honest at
high latitudes: a polar summer never crosses the horizon, so the band never
goes dark, and `sunEvents` reports that rather than inventing a sunrise.

**Label placement.** A pin is anchored at its city's exact coordinates and
never moves; only its label does. Each label tries a series of offsets — beside
the dot, then progressively above or below on either side — and takes the first
that clears every label and every dot already placed. Cities are placed in
descending population order, so when something has to give, it is the smaller
town that moves. If nothing fits, the label takes its preferred spot and
overlaps rather than disappearing.

Adding a look means one entry in `THEMES` and one block of tokens in
`assets/css/themes.css`; it only needs new code if it wants a strip layout or
a map style that does not exist yet. Webfonts are fetched per theme rather than
all at once, so carrying five faces costs one stylesheet at a time.

`data/` is generated and checked in; see [`tools/README.md`](tools/README.md)
to regenerate it.

## License

The code is released into the public domain under [The
Unlicense](LICENSE) — use it for anything, with no conditions.

That dedication covers this project's own code but cannot reach the generated
files in `data/`, which carry their upstream terms. `data/land.json` comes from
public-domain data and is unencumbered; **`data/cities.json` is CC BY 4.0 and
requires attribution** if you redistribute it or a work built from it. Keep the
section below, or regenerate `data/cities.json` from a source whose terms suit
you better.

## Attribution

Please check these terms yourself before publishing — they are the upstream
sources, summarised in good faith and not legal advice.

- **Coastlines**: [world-atlas](https://github.com/topojson/world-atlas),
  derived from [Natural Earth](https://www.naturalearthdata.com/), which is in
  the public domain.
- **Cities and timezones**:
  [city-timezones](https://github.com/kevinroberts/city-timezones) (MIT),
  whose data derives from SimpleMaps' World Cities Basic database, released
  under CC BY 4.0 — attribution required.
- **Typeface**: [Inter](https://rsms.me/inter/), SIL Open Font License, loaded
  from Google Fonts.

WebZoneClock is an independent reimplementation. It is not affiliated with,
endorsed by, or derived from the code of World Clock Pro or its publisher.

## Known limitations

- City names come from the upstream dataset. Known transcription errors are
  corrected in `tools/build_cities.py`, but all 2,300 have not been audited,
  so some names are missing their diacritics.
- The population cut-off is 150,000, with capitals and timezone-distinctive
  places added by hand. A smaller town will not be in the list; add it to
  `MANUAL` in `tools/build_cities.py`.
- Working hours are hardcoded to 09:00–18:00 local for every city, and are not
  weekend-aware. The three colour bands were read off the original app by
  scrubbing its timeline and checking where each tile changed.
- The timeline spans one day either side of now, and map dragging is clamped
  to the same range. The original slides its ruler indefinitely; this one has
  fixed ends, which keeps dragging predictable at the cost of a longer reach.
- Calendar events are a fixed 30 minutes, and are downloaded as a file rather
  than written into a calendar account.
