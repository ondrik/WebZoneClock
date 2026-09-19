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
import {
  zonedParts, formatTime, offsetLabel, offsetMinutes, dayDelta, dayState, isWeekend,
  normalizeHours,
} from './tz.js';
import { WorldMap } from './worldmap.js';
import { PinLayer } from './pins.js';
import { Timeline } from './timeline.js';
import { downloadInvite } from './calendar.js';
import { THEMES, applyTheme, getTheme, themeFontsReady } from './themes.js';
import { StripView } from './strip.js';

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
  themeBtn: document.getElementById('theme-btn'),
  themeMenu: document.getElementById('theme-menu'),
  themeName: document.getElementById('theme-name'),
  themeSwatch: document.getElementById('theme-swatch'),
  hoursBtn: document.getElementById('hours-btn'),
  hoursMenu: document.getElementById('hours-menu'),
  dayStart: document.getElementById('hours-day-start'),
  workStart: document.getElementById('hours-work-start'),
  workEnd: document.getElementById('hours-work-end'),
  weekends: document.getElementById('hours-weekends'),
  sortMode: document.getElementById('sort-mode'),
  toast: document.getElementById('toast'),
  live: document.getElementById('live'),
};

const map = new WorldMap(el.map);
const pins = new PinLayer(el.pins);
const strip = new StripView(el.strip);

let timeline = null;
let theme = null;
// Active map-drag gesture, or null. See bindMapDrag.
let mapDrag = null;
// Offset from real time, in ms, set by the timeline. Deliberately not
// persisted: a reload should land you back at "now".
let travelMs = 0;
let lastEntries = [];

let lastRenderKey = '';
let framePending = false;
let frameForce = false;
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
  theme = applyTheme(state.theme);
  // A shared link can pin the view to the moment the sender picked.
  if (state.sharedAt) travelMs = state.sharedAt - Date.now();
  onChange(() => requestRender(true));

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
      requestRender(true);
    },
  );
  if (travelMs !== 0) timeline.offsetMs = travelMs;

  bindToolbar();
  bindSearch();
  bindStripInteractions();
  bindTimebar();
  bindMapDrag();
  buildThemeMenu();

  const ro = new ResizeObserver(() => {
    map.resize();
    requestRender(true);
  });
  ro.observe(el.map);

  map.resize();
  renderAll(true);

  // One tick a second is cheap and keeps the minute flip prompt; the heavy
  // work is gated behind a render key that only changes when the minute does.
  setInterval(() => requestRender(false), 1000);
  themeFontsReady(theme).then(() => requestRender(true));
  window.addEventListener('pageshow', () => requestRender(true));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) requestRender(true);
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

/**
 * Coalesce renders to one per frame. Scrubbing fires a pointer event far
 * faster than the map can be redrawn, and without this every one of them
 * rebuilt the strip and repainted the canvas.
 */
function requestRender(force = false) {
  frameForce = frameForce || force;
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(() => {
    framePending = false;
    const f = frameForce;
    frameForce = false;
    renderAll(f);
  });
}

function renderAll(force) {
  const now = shownNow();
  const key = renderKey(now);
  if (!force && key === lastRenderKey) return;
  lastRenderKey = key;

  const entries = buildEntries(now);
  lastEntries = entries;
  renderStrip(entries);
  map.draw(now, state.daylight, theme.map);
  syncPinInset(false);
  pins.render(entries, map);

  timeline?.render(realNow(), homeTimezone(), state.hour12);
  el.addCalendar.disabled = travelMs === 0 || !entries.length;
}

/** One record per city on the strip, holding everything both views need. */
function buildEntries(now) {
  const homeTz = homeTimezone();
  const refParts = zonedParts(now, homeTz);

  const entries = [];
  for (const id of orderedIds()) {
    const city = getCity(id);
    if (!city) continue;

    const parts = zonedParts(now, city.tz);
    const { time, meridiem } = formatTime(parts, state.hour12);

    entries.push({
      city,
      parts,
      time,
      meridiem,
      state: dayState(parts.hour, state.hours, state.weekends && isWeekend(parts)),
      isHome: id === state.homeId,
      offsetLabel: offsetLabel(now, city.tz),
      dayDelta: dayDelta(parts, refParts),
    });
  }
  return entries;
}

/**
 * The city order to display. Sorting west to east is a view over the list, not
 * a rewrite of it, so switching back restores whatever you arranged by hand.
 */
function orderedIds() {
  if (state.sort !== 'offset') return state.ids;
  const now = shownNow();
  return [...state.ids].sort((a, b) => {
    const ca = getCity(a);
    const cb = getCity(b);
    if (!ca || !cb) return 0;
    const diff = offsetMinutes(now, ca.tz) - offsetMinutes(now, cb.tz);
    return diff || ca.label.localeCompare(cb.label);
  });
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
  el.strip.dataset.hour12 = String(state.hour12);
  el.stripEmpty.hidden = entries.length > 0;

  // Colours for the sunlight bands, read from the theme's own tokens. The key
  // lets a band know its gradient is stale when the theme changes under it.
  const css = getComputedStyle(document.documentElement);
  const night = rgbTriplet(css.getPropertyValue('--band-night'), [20, 20, 24]);
  const day = rgbTriplet(css.getPropertyValue('--band-day'), [240, 220, 170]);

  // Only meaningful once the list is in offset order, where neighbours sharing
  // an offset genuinely belong together.
  el.strip.dataset.sort = state.sort;
  let previousOffset = null;
  for (const e of entries) {
    e.offsetBreak =
      state.sort === 'offset' && previousOffset !== null && e.offsetLabel !== previousOffset;
    previousOffset = e.offsetLabel;
  }

  strip.render(theme.strip, entries, {
    now: shownNow(),
    bandColors: { night, day },
    bandKey: `${theme.id}|${night}|${day}`,
  });
}

function rgbTriplet(value, fallback) {
  const nums = String(value).match(/\d+/g);
  return nums && nums.length >= 3 ? nums.slice(0, 3).map(Number) : fallback;
}

function bindStripInteractions() {
  bindStripKeys();

  el.strip.addEventListener('click', (e) => {
    const city = e.target.closest('.city');
    if (!city) return;

    if (e.target.closest('.city-remove')) {
      removeCity(city.dataset.id);
      return;
    }
    setHome(city.dataset.id);
  });

  el.strip.addEventListener('mouseover', (e) => {
    const city = e.target.closest('.city');
    if (city) pins.highlight(city.dataset.id);
  });
  el.strip.addEventListener('mouseleave', () => pins.highlight(null));

  // Drag to reorder.
  let draggingId = null;

  el.strip.addEventListener('dragstart', (e) => {
    const city = e.target.closest('.city');
    if (!city) return;
    draggingId = city.dataset.id;
    city.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggingId);
  });

  el.strip.addEventListener('dragover', (e) => {
    if (!draggingId) return;
    e.preventDefault();
    const city = e.target.closest('.city');
    for (const t of el.strip.children) t.classList?.remove('drop-target');
    if (city) city.classList.add('drop-target');
  });

  el.strip.addEventListener('drop', (e) => {
    if (!draggingId) return;
    e.preventDefault();
    const city = e.target.closest('.city');
    if (city && city.dataset.id !== draggingId) {
      const target = [...el.strip.children].indexOf(city);
      if (state.sort !== 'manual') update({ sort: 'manual' });
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

/**
 * Everything the mouse can do to a city, from the keyboard: move between them
 * with the arrows, set home with Enter, remove with Delete, and reorder with
 * Alt held down. Focus is restored afterwards because reordering moves the
 * node, and removing takes it away entirely.
 */
function bindStripKeys() {
  el.strip.addEventListener('keydown', (e) => {
    const city = e.target.closest('.city');
    if (!city) return;
    const id = city.dataset.id;
    const order = state.ids;
    const at = order.indexOf(id);

    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;

    if (step && e.altKey) {
      e.preventDefault();
      const to = at + step;
      if (to < 0 || to >= order.length) return;
      if (state.sort !== 'manual') update({ sort: 'manual' });
      reorder(id, to);
      focusCity(id);
      announce(`${cityLabel(id)} moved to position ${to + 1} of ${order.length}`);
    } else if (step) {
      e.preventDefault();
      const next = order[(at + step + order.length) % order.length];
      focusCity(next);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setHome(id);
      focusCity(id);
      announce(
        state.homeId === id ? `${cityLabel(id)} is now your home city` : 'Home city cleared',
      );
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      const label = cityLabel(id);
      const fallback = order[at + 1] ?? order[at - 1] ?? null;
      removeCity(id);
      announce(`${label} removed`);
      if (fallback) focusCity(fallback);
      else el.addCity.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusCity(order[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusCity(order.at(-1));
    }
  });
}

function cityLabel(id) {
  return getCity(id)?.label ?? id;
}

/** Focus a city after the render that follows a state change. */
function focusCity(id) {
  requestAnimationFrame(() => {
    const node = strip.nodeFor(id);
    if (node) {
      node.focus();
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });
}

/** Say something once, for screen readers only. */
function announce(message) {
  el.live.textContent = '';
  // A fresh text node in the next frame is what makes the region speak again.
  requestAnimationFrame(() => {
    el.live.textContent = message;
  });
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
    hourControlsNeedRefill(); // the hour menu spells out am/pm too
  });
  syncSegmented();

  bindSettings();
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
    if (e.pointerType !== 'mouse' || mapDrag) return;
    const rect = el.mapWrap.getBoundingClientRect();
    setRevealed(e.clientY > rect.bottom - REVEAL_ZONE);
  });

  el.mapWrap.addEventListener('pointerleave', () => {
    if (timeline?.dragging || mapDrag) return;
    setRevealed(false);
  });

  el.reveal.addEventListener('click', () => {
    setRevealed(!el.mapWrap.classList.contains('reveal'));
  });

  // Re-tick the ruler labels when the box changes width.
  new ResizeObserver(() => timeline?.render(realNow(), homeTimezone(), state.hour12)).observe(
    el.ruler,
  );
}

function setRevealed(on) {
  el.mapWrap.classList.toggle('reveal', on);
  el.reveal.setAttribute('aria-expanded', String(on));
  syncPinInset();
}

/**
 * Keep pin labels out from under the time bar.
 *
 * Whether the bar is up is taken from state rather than from its opacity,
 * which is mid-transition exactly when this runs. Whether it *overlays* the
 * map is measured, because on narrow viewports it sits below the map instead
 * and there is nothing to avoid.
 */
function syncPinInset(relayout = true) {
  const shown = el.mapWrap.classList.contains('reveal') || travelMs !== 0;
  const overlays = getComputedStyle(el.timebar).position === 'absolute';

  let overlap = 0;
  if (shown && overlays) {
    const mapRect = el.mapWrap.getBoundingClientRect();
    const barRect = el.timebar.getBoundingClientRect();
    overlap = Math.max(0, mapRect.bottom - barRect.top);
  }

  const changed = pins.setBottomInset(overlap);
  if (changed && relayout && lastEntries.length) pins.layout(lastEntries, map);
}

/**
 * Dragging the map scrubs time.
 *
 * The gain is one map width per 24 hours — that is, 15 degrees of longitude
 * per hour, the rate the sun actually travels. Because time running forward
 * carries the subsolar point west, dragging right winds the clock back, and
 * the day/night terminator follows the pointer exactly one-to-one: you are
 * dragging the daylight itself, which is what the grab cursor promises.
 */
function bindMapDrag() {
  const THRESHOLD = 3; // px of travel before this counts as a drag, not a click

  el.mapWrap.addEventListener('pointerdown', (e) => {
    // Leave the time bar's own controls alone.
    if (e.target.closest('.timebar, .share-btn')) return;
    if (e.button !== undefined && e.button !== 0) return;

    mapDrag = {
      id: e.pointerId,
      startX: e.clientX,
      startOffset: travelMs,
      width: map.proj.rect.w || el.mapWrap.clientWidth,
      moved: false,
    };
    el.mapWrap.setPointerCapture(e.pointerId);
  });

  el.mapWrap.addEventListener('pointermove', (e) => {
    if (!mapDrag || e.pointerId !== mapDrag.id) return;

    const dx = e.clientX - mapDrag.startX;
    if (!mapDrag.moved) {
      if (Math.abs(dx) < THRESHOLD) return;
      mapDrag.moved = true;
      el.mapWrap.classList.add('scrubbing');
      setRevealed(true); // so the offset is visible while dragging
    }

    const deltaMs = -(dx / mapDrag.width) * 86400000;
    timeline.set(Math.round((mapDrag.startOffset + deltaMs) / 60000) * 60000);
    e.preventDefault();
  });

  const finish = (e) => {
    if (!mapDrag || (e.pointerId !== undefined && e.pointerId !== mapDrag.id)) return;
    if (el.mapWrap.hasPointerCapture?.(mapDrag.id)) {
      el.mapWrap.releasePointerCapture(mapDrag.id);
    }
    mapDrag = null;
    el.mapWrap.classList.remove('scrubbing');
  };
  el.mapWrap.addEventListener('pointerup', finish);
  el.mapWrap.addEventListener('pointercancel', finish);

  // Double-click the map to come back to now.
  el.mapWrap.addEventListener('dblclick', (e) => {
    if (e.target.closest('.timebar, .share-btn')) return;
    timeline.set(0);
  });
}

/** The look picker: a swatch per theme, applied instantly. */
function buildThemeMenu() {
  for (const t of THEMES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitemradio');
    b.dataset.theme = t.id;

    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.innerHTML = t.swatch.map((c) => `<i style="background:${c}"></i>`).join('');

    const label = document.createElement('span');
    label.innerHTML = `<span class="picker-name">${t.name}</span><span class="picker-blurb">${t.blurb}</span>`;

    b.append(sw, label);
    el.themeMenu.appendChild(b);
  }

  el.themeBtn.addEventListener('click', () => toggleThemeMenu(el.themeMenu.hidden));

  el.themeMenu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-theme]');
    if (!b) return;
    setTheme(b.dataset.theme);
    toggleThemeMenu(false);
  });

  document.addEventListener('click', (e) => {
    if (!el.themeMenu.hidden && !e.target.closest('.picker')) toggleThemeMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.themeMenu.hidden) toggleThemeMenu(false);
  });

  syncThemeUi();
}

function toggleThemeMenu(open) {
  toggleMenu(el.themeMenu, el.themeBtn, open);
}

function setTheme(id) {
  theme = applyTheme(id);
  update({ theme: theme.id });
  syncThemeUi();
  // The strip layout and map style both changed; redraw everything.
  requestRender(true);
  // Webfont metrics decide label widths, so place them again once they land.
  themeFontsReady(theme).then(() => requestRender(true));
}

function syncThemeUi() {
  const active = getTheme(state.theme);
  el.themeName.textContent = active.name;
  el.themeSwatch.innerHTML = active.swatch.map((c) => `<i style="background:${c}"></i>`).join('');
  for (const b of el.themeMenu.querySelectorAll('button[data-theme]')) {
    b.setAttribute('aria-checked', String(b.dataset.theme === active.id));
  }
}

/** Working hours, weekend awareness and the city order. */
function bindSettings() {
  const label = (h) =>
    state.hour12
      ? `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 || h === 24 ? 'am' : 'pm'}`
      : `${String(h).padStart(2, '0')}:00`;

  const fill = (select, from, to) => {
    select.textContent = '';
    for (let h = from; h <= to; h++) {
      const o = document.createElement('option');
      o.value = String(h);
      o.textContent = label(h);
      select.appendChild(o);
    }
  };

  const refill = () => {
    fill(el.dayStart, 0, 22);
    fill(el.workStart, 0, 23);
    fill(el.workEnd, 1, 24);
    el.dayStart.value = String(state.hours.dayStart);
    el.workStart.value = String(state.hours.workStart);
    el.workEnd.value = String(state.hours.workEnd);
    el.weekends.checked = state.weekends;
    el.sortMode.value = state.sort;
  };
  refill();
  hourControlsNeedRefill = refill;

  const commit = () => {
    update({
      hours: normalizeHours({
        dayStart: el.dayStart.value,
        workStart: el.workStart.value,
        workEnd: el.workEnd.value,
      }),
      weekends: el.weekends.checked,
      sort: el.sortMode.value === 'offset' ? 'offset' : 'manual',
    });
    refill(); // normalising may have moved a boundary
  };

  for (const control of [el.dayStart, el.workStart, el.workEnd, el.weekends, el.sortMode]) {
    control.addEventListener('change', commit);
  }

  el.hoursBtn.addEventListener('click', () => toggleMenu(el.hoursMenu, el.hoursBtn, el.hoursMenu.hidden));
  document.addEventListener('click', (e) => {
    if (!el.hoursMenu.hidden && !e.target.closest('.picker')) {
      toggleMenu(el.hoursMenu, el.hoursBtn, false);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.hoursMenu.hidden) {
      toggleMenu(el.hoursMenu, el.hoursBtn, false);
      el.hoursBtn.focus();
    }
  });
}

let hourControlsNeedRefill = () => {};

function toggleMenu(menu, button, open) {
  menu.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
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
