/**
 * The city strip, in five layouts.
 *
 * Every builder receives the same entry — city, local parts, formatted time,
 * day state, whether it is home — and returns a node plus an `update`. What
 * differs is the form the information takes: a filled tile, a band of the
 * city's real sunlight, a brass dial, a board row, or a printed number.
 *
 * Nodes are reused and updated in place rather than rebuilt. Scrubbing the
 * timeline re-renders every frame, and rebuilding would both churn the DOM and
 * throw away keyboard focus on whichever city you were operating.
 */

import { daylightProfile, dayFraction, sunEvents, gradientStops, mixRgb } from './daylight.js';

const HOME_ARROW =
  '<svg viewBox="0 0 12 12" aria-hidden="true" class="arrow"><path d="M11 1L1 5.6l3.7 1.1L6 11z"/></svg>';
const REMOVE_ICON =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>';

/** Keyed collection of city items; the strip's only entry point. */
export class StripView {
  constructor(el) {
    this.el = el;
    this.items = new Map();
    this.mode = null;
  }

  render(mode, entries, ctx) {
    // A different layout means different nodes; nothing can be reused.
    if (mode !== this.mode) {
      this.el.textContent = '';
      this.items.clear();
      this.mode = mode;
    }

    const seen = new Set();
    for (const entry of entries) {
      seen.add(entry.city.id);
      let item = this.items.get(entry.city.id);
      if (!item) {
        item = createItem(mode, entry, ctx);
        this.items.set(entry.city.id, item);
      }
      item.update(entry, ctx);
    }

    for (const [id, item] of this.items) {
      if (!seen.has(id)) {
        item.root.remove();
        this.items.delete(id);
      }
    }

    // Put the nodes in the order the entries ask for, moving only what moved.
    let prev = null;
    for (const entry of entries) {
      const node = this.items.get(entry.city.id).root;
      const want = prev ? prev.nextSibling : this.el.firstChild;
      if (node !== want) this.el.insertBefore(node, want);
      prev = node;
    }
  }

  /** The element for a city, so callers can focus or scroll to it. */
  nodeFor(id) {
    return this.items.get(id)?.root ?? null;
  }

  ids() {
    return [...this.items.keys()];
  }
}

function createItem(mode, entry, ctx) {
  const build = BUILDERS[mode] || BUILDERS.tiles;
  const built = build(entry, ctx);
  const { root } = built;

  root.classList.add('city');
  root.dataset.id = entry.city.id;
  root.setAttribute('role', 'listitem');
  root.tabIndex = 0;
  root.draggable = true;

  const remove = document.createElement('button');
  remove.className = 'city-remove';
  remove.type = 'button';
  remove.tabIndex = -1; // reachable through the city's own keyboard shortcuts
  remove.innerHTML = REMOVE_ICON;
  root.appendChild(remove);

  const update = (e, c) => {
    root.dataset.state = e.state;
    root.dataset.offsetBreak = String(Boolean(e.offsetBreak));
    root.classList.toggle('is-home', e.isHome);
    remove.setAttribute('aria-label', `Remove ${e.city.label}`);
    root.setAttribute('aria-label', describe(e));
    root.title = describe(e);
    built.update(e, c);
  };

  update(entry, ctx);
  return { root, update };
}

function describe(e) {
  const when = e.dayDelta > 0 ? ', tomorrow' : e.dayDelta < 0 ? ', yesterday' : '';
  const home = e.isHome ? '. Your home city' : '';
  const time = e.meridiem ? `${e.time} ${e.meridiem}` : e.time;
  return `${e.city.label}, ${e.city.country}. ${time}${when} (${e.offsetLabel})${home}.`;
}

/* --------------------------------------------------------------- pieces */

/** The clock face, including the am/pm marker when it is wanted. */
function clock() {
  const node = document.createElement('span');
  node.className = 'clock';
  const digits = document.createTextNode('');
  node.appendChild(digits);
  let marker = null;

  return {
    node,
    set(e) {
      digits.nodeValue = e.time;
      if (e.meridiem && !marker) {
        marker = document.createElement('span');
        marker.className = 'meridiem';
        node.appendChild(marker);
      } else if (!e.meridiem && marker) {
        marker.remove();
        marker = null;
      }
      if (marker) marker.textContent = e.meridiem;
    },
  };
}

function cityName(className = 'city-name') {
  const node = document.createElement('div');
  node.className = className;
  const arrow = document.createElement('span');
  arrow.className = 'name-arrow';
  arrow.innerHTML = HOME_ARROW;
  const text = document.createTextNode('');
  node.append(arrow, text);

  return {
    node,
    set(e) {
      arrow.hidden = !e.isHome;
      text.nodeValue = e.city.label;
    },
  };
}

function citySub() {
  const node = document.createElement('div');
  node.className = 'city-sub';
  const country = document.createElement('span');
  country.className = 'sub-country';
  const offset = document.createElement('span');
  offset.className = 'sub-offset';
  node.append(country, offset);

  return {
    node,
    set(e) {
      country.textContent = e.city.country;
      offset.textContent = e.offsetLabel;
    },
  };
}

/**
 * "Tomorrow" / "Yesterday", shown when a city is not on the same date as home.
 *
 * The line is always in the layout, even when there is nothing to say. A city
 * crosses midnight while you watch, and if the caption appeared and vanished
 * the strip would change height, resize the map underneath it and force a
 * full redraw — a visible jolt, once a minute, for no reason.
 */
function dayCaption() {
  const node = document.createElement('div');
  node.className = 'city-dayoff';

  return {
    node,
    set(e) {
      const empty = e.dayDelta === 0;
      // A non-breaking space keeps the line box; visibility keeps the space.
      node.textContent = empty ? '\u00a0' : e.dayDelta > 0 ? 'Tomorrow' : 'Yesterday';
      node.classList.toggle('is-empty', empty);
      node.setAttribute('aria-hidden', String(empty));
    },
  };
}

/**
 * A band of the city's own sunlight, with a marker at the moment being shown.
 * The gradient only changes when the local date does, so it is rebuilt on that
 * boundary rather than on every frame.
 */
function sunBand({ withTicks = false } = {}) {
  const node = document.createElement('div');
  node.className = 'band';
  const marker = document.createElement('span');
  marker.className = 'band-now';
  const rise = document.createElement('span');
  rise.className = 'band-sun band-sun-rise';
  const set = document.createElement('span');
  set.className = 'band-sun band-sun-set';
  if (withTicks) node.append(rise, set);
  node.appendChild(marker);

  let key = null;

  return {
    node,
    set(e, ctx) {
      const stamp = `${e.parts.year}-${e.parts.month}-${e.parts.day}|${ctx.bandKey}`;
      if (stamp !== key) {
        key = stamp;
        const profile = daylightProfile(e.city, ctx.now);
        const { night, day } = ctx.bandColors;
        node.style.background = `linear-gradient(to right, ${gradientStops(profile, (l) =>
          mixRgb(night, day, l),
        )})`;

        const events = sunEvents(profile);
        node.dataset.polar = events.polarDay ? 'day' : events.polarNight ? 'night' : '';
        if (withTicks) {
          place(rise, events.sunrise);
          place(set, events.sunset);
        }
      }
      marker.style.left = `${dayFraction(ctx.now, e.city.tz) * 100}%`;
    },
  };
}

function place(el, frac) {
  el.hidden = frac === null || frac === undefined;
  if (!el.hidden) el.style.left = `${frac * 100}%`;
}

/* ------------------------------------------------------------- builders */

const BUILDERS = {
  /** A solid block of colour per city. */
  tiles() {
    const root = document.createElement('div');
    root.className = 'tile';
    const cap = dayCaption();
    const c = clock();
    const time = document.createElement('div');
    time.className = 'tile-time';
    time.appendChild(c.node);
    const name = cityName('city-name tile-name');
    const sub = citySub();
    root.append(cap.node, time, name.node, sub.node);

    return {
      root,
      update(e) {
        cap.set(e);
        c.set(e);
        name.set(e);
        sub.set(e);
      },
    };
  },

  /** A row per city: the whole local day as light, with now marked on it. */
  bands() {
    const root = document.createElement('div');
    root.className = 'band-row';

    const head = document.createElement('div');
    head.className = 'band-head';
    const name = cityName();
    const sub = citySub();
    head.append(name.node, sub.node);

    const mid = document.createElement('div');
    mid.className = 'band-mid';
    const band = sunBand({ withTicks: true });
    mid.appendChild(band.node);

    const tail = document.createElement('div');
    tail.className = 'band-tail';
    const c = clock();
    const time = document.createElement('div');
    time.className = 'band-time';
    time.appendChild(c.node);
    const cap = dayCaption();
    tail.append(time, cap.node);

    root.append(head, mid, tail);

    return {
      root,
      update(e, ctx) {
        name.set(e);
        sub.set(e);
        band.set(e, ctx);
        c.set(e);
        cap.set(e);
      },
    };
  },

  /** A dial per city, the sun's position read off a 24-hour face. */
  dials() {
    const root = document.createElement('div');
    root.className = 'dial-card';
    root.insertAdjacentHTML('beforeend', dialShell());

    const svg = root.querySelector('.dial');
    const arc = svg.querySelector('.dial-day');
    const full = svg.querySelector('.dial-day-full');
    const hand = svg.querySelector('.dial-hand');

    const c = clock();
    const time = document.createElement('div');
    time.className = 'dial-time';
    time.appendChild(c.node);
    const name = cityName();
    const sub = citySub();
    const cap = dayCaption();
    root.append(time, name.node, sub.node, cap.node);

    return {
      root,
      update(e, ctx) {
        const profile = daylightProfile(e.city, ctx.now, 96);
        const events = sunEvents(profile);

        full.style.display = events.polarDay ? '' : 'none';
        const drawArc = !events.polarDay && !events.polarNight
          && events.sunrise !== null && events.sunset !== null;
        arc.style.display = drawArc ? '' : 'none';
        if (drawArc) arc.setAttribute('d', arcPath(events.sunrise, events.sunset));

        const [hx, hy] = onCircle(dayFraction(ctx.now, e.city.tz), R - 7);
        hand.setAttribute('x2', hx);
        hand.setAttribute('y2', hy);

        c.set(e);
        name.set(e);
        sub.set(e);
        cap.set(e);
      },
    };
  },

  /** A board row, split-flap cells across it. */
  board() {
    const root = document.createElement('div');
    root.className = 'board-row';

    const c = clock();
    const time = document.createElement('div');
    time.className = 'board-cell board-time';
    time.appendChild(c.node);

    const nameCell = document.createElement('div');
    nameCell.className = 'board-cell board-name';
    const name = cityName();
    const cap = dayCaption();
    nameCell.append(name.node, cap.node);

    const country = document.createElement('div');
    country.className = 'board-cell board-country';
    const zone = document.createElement('div');
    zone.className = 'board-cell board-zone';

    const barCell = document.createElement('div');
    barCell.className = 'board-cell board-bar';
    const band = sunBand();
    barCell.appendChild(band.node);

    root.append(time, nameCell, country, zone, barCell);

    return {
      root,
      update(e, ctx) {
        c.set(e);
        name.set(e);
        cap.set(e);
        country.textContent = e.city.country;
        zone.textContent = e.offsetLabel;
        band.set(e, ctx);
      },
    };
  },

  /** Oversized printed numerals, one ink per state. */
  poster() {
    const root = document.createElement('div');
    root.className = 'poster-block';
    const cap = dayCaption();
    const c = clock();
    const time = document.createElement('div');
    time.className = 'poster-time';
    time.appendChild(c.node);
    const foot = document.createElement('div');
    foot.className = 'poster-foot';
    const name = cityName();
    const sub = citySub();
    foot.append(name.node, sub.node);
    root.append(cap.node, time, foot);

    return {
      root,
      update(e) {
        cap.set(e);
        c.set(e);
        name.set(e);
        sub.set(e);
      },
    };
  },
};

/* ----------------------------------------------------------------- dial */

const R = 34;
const CX = 40;
const CY = 40;

function dialShell() {
  const ticks = [0, 0.25, 0.5, 0.75]
    .map((q) => {
      const [x1, y1] = onCircle(q, R - 4);
      const [x2, y2] = onCircle(q, R);
      return `<line class="dial-tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    })
    .join('');

  return (
    `<svg class="dial" viewBox="0 0 80 80" aria-hidden="true">` +
    `<circle class="dial-rim" cx="${CX}" cy="${CY}" r="${R}"/>` +
    `<circle class="dial-day-full" cx="${CX}" cy="${CY}" r="${R}" style="display:none"/>` +
    `<path class="dial-day" d="" style="display:none"/>` +
    ticks +
    `<line class="dial-hand" x1="${CX}" y1="${CY}" x2="${CX}" y2="${CY}"/>` +
    `<circle class="dial-hub" cx="${CX}" cy="${CY}" r="2.2"/>` +
    `</svg>`
  );
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
