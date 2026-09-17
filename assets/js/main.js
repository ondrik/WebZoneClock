/**
 * Wiring: load data, build the strip and the pins, and keep both in step with
 * the clock. Everything re-renders on the minute; the map's day/night shading
 * is redrawn at the same time.
 */

import { loadCities, getCity, searchCities, cityTimeLabel } from './citydb.js';
import {
  state,
  init as initState,
  onChange,
  update,
  addCity,
  removeCity,
  setHome,
  reorder,
  shareFragment,
} from './state.js';
import { zonedParts, formatTime, offsetLabel, dayDelta, dayState } from './tz.js';
import { WorldMap } from './worldmap.js';
import { PinLayer } from './pins.js';
import { Timeline } from './timeline.js';
import { downloadInvite } from './calendar.js';

// Update this after forking, or drop the link from index.html.
const REPO_URL = 'https://github.com/ondrik/WebZoneClock';

const el = {
  strip: document.getElementById('strip'),
  stripEmpty: document.getElementById('strip-empty'),
  map: document.getElementById('map'),
  pins: document.getElementById('pins'),
  addCity: document.getElementById('add-city'),
  daylight: document.getElementById('toggle-daylight'),
  segmented: document.querySelector('.segmented'),
  share: document.getElementById('share'),
  reveal: document.getElementById('reveal'),
  mapWrap: document.querySelector('.map-wrap'),
  timebar: document.getElementById('timebar'),
  ruler: document.getElementById('ruler'),
  rulerTicks: document.getElementById('ruler-ticks'),
  rulerLine: document.getElementById('ruler-line'),
  rulerHandle: document.getElementById('ruler-handle'),
  handleLabel: document.getElementById('handle-label'),
  handleClear: document.getElementById('handle-clear'),
  addCalendar: document.getElementById('add-calendar'),
  overlay: document.getElementById('search-overlay'),
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),
  searchHint: document.getElementById('search-hint'),
  searchClose: document.getElementById('search-close'),
  repoLink: document.getElementById('repo-link'),
  toast: document.getElementById('toast'),
};

const map = new WorldMap(el.map);
const pins = new PinLayer(el.pins);

let timeline = null;
// Offset from real time, in ms, set by the timeline. Deliberately not
// persisted: a reload should land you back at "now".
let travelMs = 0;
let lastEntries = [];

let lastRenderKey = '';
let searchIndex = 0;
let searchMatches = [];

main();

async function main() {
  try {
    await Promise.all([loadCities(), map.load()]);
  } catch (err) {
    fail(err);
    return;
  }

  initState();
  // A shared link can pin the view to the moment the sender picked.
  if (state.sharedAt) travelMs = state.sharedAt - Date.now();
  onChange(() => renderAll(true));

  timeline = new Timeline(
    {
      bar: el.timebar,
      ruler: el.ruler,
      ticks: el.rulerTicks,
      line: el.rulerLine,
      handle: el.rulerHandle,
      label: el.handleLabel,
      clear: el.handleClear,
    },
    (ms) => {
      travelMs = ms;
      renderAll(true);
    },
  );
  if (travelMs !== 0) timeline.offsetMs = travelMs;

  bindToolbar();
  bindSearch();
  bindStripInteractions();
  bindTimebar();

  const ro = new ResizeObserver(() => {
    map.resize();
    renderAll(true);
  });
  ro.observe(el.map);

  map.resize();
  renderAll(true);

  // One tick a second is cheap and keeps the minute flip prompt; the heavy
  // work is gated behind a render key that only changes when the minute does.
  setInterval(() => renderAll(false), 1000);
  if (document.fonts?.ready) document.fonts.ready.then(() => renderAll(true));
  window.addEventListener('pageshow', () => renderAll(true));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderAll(true);
  });
}

/** Real time now; the clock the timeline offsets from. */
function realNow() {
  return new Date();
}

/** The instant the whole display is showing — now, shifted by the timeline. */
function shownNow() {
  return new Date(Date.now() + travelMs);
}

/** Everything the display depends on, as a string; unchanged means no work. */
function renderKey(now) {
  return [
    Math.floor(now.getTime() / 60000),
    state.ids.join(';'),
    state.homeId,
    state.hour12 ? 12 : 24,
    state.daylight ? 1 : 0,
    map.width,
    map.height,
    travelMs,
  ].join('|');
}

function renderAll(force) {
  const now = shownNow();
  const key = renderKey(now);
  if (!force && key === lastRenderKey) return;
  lastRenderKey = key;

  const entries = buildEntries(now);
  lastEntries = entries;
  renderStrip(entries);
  map.draw(now, state.daylight);
  pins.render(entries, map);

  timeline?.render(realNow(), homeTimezone(), state.hour12);
  el.addCalendar.disabled = travelMs === 0 || !entries.length;
}

/** One record per city on the strip, holding everything both views need. */
function buildEntries(now) {
  const homeTz = homeTimezone();
  const refParts = zonedParts(now, homeTz);

  const entries = [];
  for (const id of state.ids) {
    const city = getCity(id);
    if (!city) continue;

    const parts = zonedParts(now, city.tz);
    const { time, meridiem } = formatTime(parts, state.hour12);

    entries.push({
      city,
      parts,
      time,
      meridiem,
      state: dayState(parts.hour),
      isHome: id === state.homeId,
      offsetLabel: offsetLabel(now, city.tz),
      dayDelta: dayDelta(parts, refParts),
    });
  }
  return entries;
}

function homeTimezone() {
  const home = state.homeId && getCity(state.homeId);
  if (home) return home.tz;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/* ------------------------------------------------------------------ strip */

function renderStrip(entries) {
  el.strip.textContent = '';
  el.strip.dataset.hour12 = String(state.hour12);
  el.stripEmpty.hidden = entries.length > 0;

  for (const entry of entries) {
    el.strip.appendChild(buildTile(entry));
  }
}

function buildTile(entry) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.state = entry.state;
  tile.dataset.id = entry.city.id;
  tile.setAttribute('role', 'listitem');
  tile.draggable = true;
  tile.title = entry.isHome
    ? `${entry.city.label} — your home city. Click to unset.`
    : `${entry.city.label}, ${entry.city.country}. Click to make this your home city.`;

  const remove = document.createElement('button');
  remove.className = 'tile-remove';
  remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${entry.city.label}`);
  remove.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/></svg>';
  tile.appendChild(remove);

  const time = document.createElement('div');
  time.className = 'tile-time';
  const clock = document.createElement('span');
  clock.className = 'tile-clock';
  clock.append(document.createTextNode(entry.time));
  if (entry.meridiem) {
    const mer = document.createElement('span');
    mer.className = 'meridiem';
    mer.textContent = entry.meridiem;
    clock.appendChild(mer);
  }
  time.appendChild(clock);
  tile.appendChild(time);

  if (entry.dayDelta !== 0) {
    const off = document.createElement('div');
    off.className = 'tile-dayoff';
    off.textContent = entry.dayDelta > 0 ? 'tomorrow' : 'yesterday';
    tile.appendChild(off);
  }

  const name = document.createElement('div');
  name.className = 'tile-name';
  if (entry.isHome) {
    const arrow = document.createElement('span');
    arrow.innerHTML =
      '<svg viewBox="0 0 12 12" aria-hidden="true" style="fill:currentColor;stroke:none"><path d="M11 1L1 5.6l3.7 1.1L6 11z"/></svg>';
    name.appendChild(arrow.firstChild);
  }
  name.append(document.createTextNode(entry.city.label));
  tile.appendChild(name);

  const sub = document.createElement('div');
  sub.className = 'tile-sub';
  const country = document.createElement('span');
  country.className = 'sub-country';
  country.textContent = entry.city.country;
  const offset = document.createElement('span');
  offset.className = 'sub-offset';
  offset.textContent = entry.offsetLabel;
  sub.append(country, offset);
  tile.appendChild(sub);

  return tile;
}

function bindStripInteractions() {
  el.strip.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;

    if (e.target.closest('.tile-remove')) {
      removeCity(tile.dataset.id);
      return;
    }
    setHome(tile.dataset.id);
  });

  el.strip.addEventListener('mouseover', (e) => {
    const tile = e.target.closest('.tile');
    if (tile) pins.highlight(tile.dataset.id);
  });
  el.strip.addEventListener('mouseleave', () => pins.highlight(null));

  // Drag to reorder.
  let draggingId = null;

  el.strip.addEventListener('dragstart', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    draggingId = tile.dataset.id;
    tile.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggingId);
  });

  el.strip.addEventListener('dragover', (e) => {
    if (!draggingId) return;
    e.preventDefault();
    const tile = e.target.closest('.tile');
    for (const t of el.strip.children) t.classList?.remove('drop-target');
    if (tile) tile.classList.add('drop-target');
  });

  el.strip.addEventListener('drop', (e) => {
    if (!draggingId) return;
    e.preventDefault();
    const tile = e.target.closest('.tile');
    if (tile && tile.dataset.id !== draggingId) {
      const target = [...el.strip.children].indexOf(tile);
      reorder(draggingId, target);
    }
    cleanupDrag();
  });

  el.strip.addEventListener('dragend', cleanupDrag);

  function cleanupDrag() {
    draggingId = null;
    for (const t of el.strip.children) {
      t.classList?.remove('dragging');
      t.classList?.remove('drop-target');
    }
  }
}

/* ---------------------------------------------------------------- toolbar */

function bindToolbar() {
  el.repoLink.href = REPO_URL;
  el.addCity.addEventListener('click', openSearch);

  el.daylight.addEventListener('click', () => {
    update({ daylight: !state.daylight });
    el.daylight.setAttribute('aria-pressed', String(state.daylight));
  });
  el.daylight.setAttribute('aria-pressed', String(state.daylight));

  el.segmented.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-hour12]');
    if (!btn) return;
    update({ hour12: btn.dataset.hour12 === '1' });
    syncSegmented();
  });
  syncSegmented();

  el.share.addEventListener('click', share);
  el.addCalendar.addEventListener('click', () => {
    downloadInvite(shownNow(), lastEntries);
  });

  document.addEventListener('keydown', (e) => {
    if (el.overlay.hidden && (e.key === 'n' || e.key === '+') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      openSearch();
    }
  });
}

/**
 * The time bar appears when the pointer nears the bottom of the map, and the
 * collapsed button both hints at it and works as a tap target where there is
 * no pointer to hover with.
 */
function bindTimebar() {
  const REVEAL_ZONE = 130; // px from the bottom edge

  el.mapWrap.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const rect = el.mapWrap.getBoundingClientRect();
    const near = e.clientY > rect.bottom - REVEAL_ZONE;
    el.mapWrap.classList.toggle('reveal', near);
    el.reveal.setAttribute('aria-expanded', String(near));
  });

  el.mapWrap.addEventListener('pointerleave', () => {
    if (timeline?.dragging) return;
    el.mapWrap.classList.remove('reveal');
    el.reveal.setAttribute('aria-expanded', 'false');
  });

  el.reveal.addEventListener('click', () => {
    const on = !el.mapWrap.classList.contains('reveal');
    el.mapWrap.classList.toggle('reveal', on);
    el.reveal.setAttribute('aria-expanded', String(on));
  });

  // Re-tick the ruler labels when the box changes width.
  new ResizeObserver(() => timeline?.render(realNow(), homeTimezone(), state.hour12)).observe(
    el.ruler,
  );
}

function syncSegmented() {
  for (const btn of el.segmented.querySelectorAll('button')) {
    const on = (btn.dataset.hour12 === '1') === state.hour12;
    btn.setAttribute('aria-pressed', String(on));
  }
}

async function share() {
  const url =
    location.origin + location.pathname + location.search + shareFragment(shownNow(), travelMs);
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied to the clipboard');
  } catch {
    // Clipboard blocked (no permission, or an insecure origin): leave the
    // link in the address bar so it can still be copied by hand.
    history.replaceState(null, '', shareFragment());
    toast('Link is in the address bar');
  }
}

let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 2400);
}

/* ----------------------------------------------------------------- search */

function bindSearch() {
  el.searchClose.addEventListener('click', closeSearch);

  el.overlay.addEventListener('mousedown', (e) => {
    if (e.target === el.overlay) closeSearch();
  });

  el.searchInput.addEventListener('input', runSearch);

  el.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSearch();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(searchMatches[searchIndex]);
    }
  });

  el.searchResults.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) pick(getCity(li.dataset.id));
  });

  el.searchResults.addEventListener('mousemove', (e) => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const idx = [...el.searchResults.children].indexOf(li);
    if (idx !== -1 && idx !== searchIndex) {
      searchIndex = idx;
      syncSelection();
    }
  });
}

function openSearch() {
  el.overlay.hidden = false;
  el.searchInput.value = '';
  el.searchResults.textContent = '';
  searchMatches = [];
  searchIndex = 0;
  el.searchHint.hidden = false;
  el.searchHint.textContent = 'Type to search 2,300 cities.';
  el.searchInput.focus();
}

function closeSearch() {
  el.overlay.hidden = true;
  el.searchInput.blur();
}

function runSearch() {
  const q = el.searchInput.value;
  searchMatches = searchCities(q, 40);
  searchIndex = 0;

  el.searchResults.textContent = '';
  const now = new Date();

  for (const city of searchMatches) {
    const li = document.createElement('li');
    li.dataset.id = city.id;
    li.setAttribute('role', 'option');

    const name = document.createElement('span');
    name.className = 'res-name';
    name.textContent = city.label;

    const country = document.createElement('span');
    country.className = 'res-country';
    country.textContent = city.country;

    const time = document.createElement('span');
    if (state.ids.includes(city.id)) {
      time.className = 'res-added';
      time.textContent = 'on the strip';
    } else {
      time.className = 'res-time';
      time.textContent = cityTimeLabel(city, now, state.hour12);
    }

    li.append(name, country, time);
    el.searchResults.appendChild(li);
  }

  if (!q.trim()) {
    el.searchHint.hidden = false;
    el.searchHint.textContent = 'Type to search 2,300 cities.';
  } else if (!searchMatches.length) {
    el.searchHint.hidden = false;
    el.searchHint.textContent = `Nothing matches “${q.trim()}”.`;
  } else {
    el.searchHint.hidden = true;
  }

  syncSelection();
}

function moveSelection(delta) {
  if (!searchMatches.length) return;
  searchIndex = (searchIndex + delta + searchMatches.length) % searchMatches.length;
  syncSelection();
}

function syncSelection() {
  const items = [...el.searchResults.children];
  items.forEach((li, i) => li.setAttribute('aria-selected', String(i === searchIndex)));
  items[searchIndex]?.scrollIntoView({ block: 'nearest' });
}

function pick(city) {
  if (!city) return;
  const added = addCity(city.id);
  closeSearch();
  if (!added) toast(`${city.label} is already on the strip`);
}

/* ------------------------------------------------------------------ error */

function fail(err) {
  console.error(err);
  el.stripEmpty.hidden = false;
  el.stripEmpty.textContent =
    'Could not load the city data. If you opened this file directly, serve the folder over HTTP instead.';
}
