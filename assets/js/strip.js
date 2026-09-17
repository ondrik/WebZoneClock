/**
 * The city strip, in five layouts.
 *
 * Every builder receives the same entry — city, local parts, formatted time,
 * day state, whether it is home — and returns one element. What differs is the
 * form the information takes: a filled tile, a band of the city's real
 * sunlight, a brass dial, a board row, or a printed number.
 */

import { daylightProfile, dayFraction, sunEvents, gradientStops, mixRgb } from './daylight.js';

const HOME_ARROW =
  '<svg viewBox="0 0 12 12" aria-hidden="true" class="arrow"><path d="M11 1L1 5.6l3.7 1.1L6 11z"/></svg>';

const REMOVE_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>';

export function buildStripItem(mode, entry, ctx) {
  const build = BUILDERS[mode] || BUILDERS.tiles;
  const node = build(entry, ctx);

  node.dataset.id = entry.city.id;
  node.dataset.state = entry.state;
  node.classList.add('city');
  if (entry.isHome) node.classList.add('is-home');
  node.setAttribute('role', 'listitem');
  node.draggable = true;
  node.title = entry.isHome
    ? `${entry.city.label} — your home city. Click to unset.`
    : `${entry.city.label}, ${entry.city.country}. Click to make this your home city.`;

  node.appendChild(removeButton(entry));
  return node;
}

/* --------------------------------------------------------------- shared */

function removeButton(entry) {
  const b = document.createElement('button');
  b.className = 'city-remove';
  b.type = 'button';
  b.setAttribute('aria-label', `Remove ${entry.city.label}`);
  b.innerHTML = REMOVE_ICON;
  return b;
}

function clockText(entry) {
  const span = document.createElement('span');
  span.className = 'clock';
  span.append(document.createTextNode(entry.time));
  if (entry.meridiem) {
    const m = document.createElement('span');
    m.className = 'meridiem';
    m.textContent = entry.meridiem;
    span.appendChild(m);
  }
  return span;
}

function nameNode(entry, className = 'city-name') {
  const el = document.createElement('div');
  el.className = className;
  if (entry.isHome) el.insertAdjacentHTML('beforeend', HOME_ARROW);
  el.append(document.createTextNode(entry.city.label));
  return el;
}

function subNode(entry) {
  const sub = document.createElement('div');
  sub.className = 'city-sub';
  const country = document.createElement('span');
  country.className = 'sub-country';
  country.textContent = entry.city.country;
  const offset = document.createElement('span');
  offset.className = 'sub-offset';
  offset.textContent = entry.offsetLabel;
  sub.append(country, offset);
  return sub;
}

function dayCaption(entry) {
  if (!entry.dayDelta) return null;
  const d = document.createElement('div');
  d.className = 'city-dayoff';
  d.textContent = entry.dayDelta > 0 ? 'Tomorrow' : 'Yesterday';
  return d;
}

/**
 * The sunlight band: a gradient built from the city's own solar elevation,
 * with a marker at the moment being shown.
 */
function sunBand(entry, ctx, { withTicks = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'band';

  const profile = daylightProfile(entry.city, ctx.now);
  const { night, day } = ctx.bandColors;
  wrap.style.background = `linear-gradient(to right, ${gradientStops(profile, (l) =>
    mixRgb(night, day, l),
  )})`;

  const events = sunEvents(profile);
  if (events.polarDay) wrap.dataset.polar = 'day';
  else if (events.polarNight) wrap.dataset.polar = 'night';

  if (withTicks) {
    for (const [frac, kind] of [
      [events.sunrise, 'rise'],
      [events.sunset, 'set'],
    ]) {
      if (frac === null || frac === undefined) continue;
      const tick = document.createElement('span');
      tick.className = `band-sun band-sun-${kind}`;
      tick.style.left = `${frac * 100}%`;
      wrap.appendChild(tick);
    }
  }

  const marker = document.createElement('span');
  marker.className = 'band-now';
  marker.style.left = `${dayFraction(ctx.now, entry.city.tz) * 100}%`;
  wrap.appendChild(marker);

  return wrap;
}

/* ------------------------------------------------------------- builders */

const BUILDERS = {
  /** The original: a solid block of colour per city. */
  tiles(entry) {
    const t = document.createElement('div');
    t.className = 'tile';
    const caption = dayCaption(entry);
    if (caption) t.appendChild(caption);

    const time = document.createElement('div');
    time.className = 'tile-time';
    time.appendChild(clockText(entry));
    t.append(time, nameNode(entry, 'city-name tile-name'), subNode(entry));
    return t;
  },

  /** A row per city: the whole local day as light, with now marked on it. */
  bands(entry, ctx) {
    const row = document.createElement('div');
    row.className = 'band-row';

    const head = document.createElement('div');
    head.className = 'band-head';
    head.append(nameNode(entry), subNode(entry));

    const mid = document.createElement('div');
    mid.className = 'band-mid';
    mid.appendChild(sunBand(entry, ctx, { withTicks: true }));

    const tail = document.createElement('div');
    tail.className = 'band-tail';
    const time = document.createElement('div');
    time.className = 'band-time';
    time.appendChild(clockText(entry));
    tail.appendChild(time);
    const caption = dayCaption(entry);
    if (caption) tail.appendChild(caption);

    row.append(head, mid, tail);
    return row;
  },

  /** A dial per city, the sun's position read off a 24-hour face. */
  dials(entry, ctx) {
    const card = document.createElement('div');
    card.className = 'dial-card';

    const profile = daylightProfile(entry.city, ctx.now, 96);
    const events = sunEvents(profile);
    const frac = dayFraction(ctx.now, entry.city.tz);

    card.insertAdjacentHTML('beforeend', dialSvg(events, frac));

    const time = document.createElement('div');
    time.className = 'dial-time';
    time.appendChild(clockText(entry));
    card.append(time, nameNode(entry), subNode(entry));

    const caption = dayCaption(entry);
    if (caption) card.appendChild(caption);
    return card;
  },

  /** A board row, split-flap cells across it. */
  board(entry, ctx) {
    const row = document.createElement('div');
    row.className = 'board-row';

    const time = document.createElement('div');
    time.className = 'board-cell board-time';
    time.appendChild(clockText(entry));

    const name = document.createElement('div');
    name.className = 'board-cell board-name';
    name.appendChild(nameNode(entry));
    const caption = dayCaption(entry);
    if (caption) name.appendChild(caption);

    const zone = document.createElement('div');
    zone.className = 'board-cell board-zone';
    zone.textContent = entry.offsetLabel;

    const country = document.createElement('div');
    country.className = 'board-cell board-country';
    country.textContent = entry.city.country;

    const bar = document.createElement('div');
    bar.className = 'board-cell board-bar';
    bar.appendChild(sunBand(entry, ctx));

    row.append(time, name, country, zone, bar);
    return row;
  },

  /** Oversized printed numerals, one ink per state. */
  poster(entry) {
    const block = document.createElement('div');
    block.className = 'poster-block';

    const time = document.createElement('div');
    time.className = 'poster-time';
    time.appendChild(clockText(entry));

    const foot = document.createElement('div');
    foot.className = 'poster-foot';
    foot.append(nameNode(entry), subNode(entry));

    const caption = dayCaption(entry);
    if (caption) block.appendChild(caption);
    block.append(time, foot);
    return block;
  },
};

/* ----------------------------------------------------------------- dial */

const R = 34;
const CX = 40;
const CY = 40;

/**
 * A 24-hour face: midnight at the bottom, noon at the top, the lit part of
 * the day drawn as an arc and the current time as a hand.
 */
function dialSvg(events, frac) {
  const parts = [
    `<svg class="dial" viewBox="0 0 80 80" aria-hidden="true">`,
    `<circle class="dial-rim" cx="${CX}" cy="${CY}" r="${R}"/>`,
  ];

  if (events.polarDay) {
    parts.push(`<circle class="dial-day-full" cx="${CX}" cy="${CY}" r="${R}"/>`);
  } else if (!events.polarNight && events.sunrise !== null && events.sunset !== null) {
    parts.push(`<path class="dial-day" d="${arcPath(events.sunrise, events.sunset)}"/>`);
  }

  // Hour ticks at the quarters.
  for (const q of [0, 0.25, 0.5, 0.75]) {
    const [x1, y1] = onCircle(q, R - 4);
    const [x2, y2] = onCircle(q, R);
    parts.push(`<line class="dial-tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`);
  }

  const [hx, hy] = onCircle(frac, R - 7);
  parts.push(`<line class="dial-hand" x1="${CX}" y1="${CY}" x2="${hx}" y2="${hy}"/>`);
  parts.push(`<circle class="dial-hub" cx="${CX}" cy="${CY}" r="2.2"/>`);
  parts.push('</svg>');
  return parts.join('');
}

/**
 * Fraction of the local day to a point on the dial. Midnight sits at the
 * bottom and noon at the top, and the day runs clockwise from there.
 */
function onCircle(frac, r) {
  const a = (frac - 0.5) * 2 * Math.PI;
  return [(CX + r * Math.sin(a)).toFixed(2), (CY - r * Math.cos(a)).toFixed(2)];
}

function arcPath(from, to) {
  const [x1, y1] = onCircle(from, R);
  const [x2, y2] = onCircle(to, R);
  const large = to - from > 0.5 ? 1 : 0;
  return `M ${CX} ${CY} L ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} Z`;
}
