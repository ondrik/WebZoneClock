/**
 * App state: which cities are on the strip, which one is home, and the two
 * display toggles. Persisted to localStorage, and shareable through the URL
 * hash (a hash on load wins, so a shared link always shows what was shared).
 */

import { getCity, cityForTimezone } from './citydb.js';
import { DEFAULT_THEME, getTheme } from './themes.js';
import { DEFAULT_HOURS, normalizeHours } from './tz.js';

const STORAGE_KEY = 'webzoneclock.v1';

// Shown on a first visit, alongside whatever city matches the browser's zone.
const STARTER_CITIES = [
  'San Francisco, CA@America/Los_Angeles',
  'New York, NY@America/New_York',
  'London@Europe/London',
  'Tokyo@Asia/Tokyo',
  'Sydney@Australia/Sydney',
];

export const state = {
  ids: [],
  homeId: null,
  hour12: false,
  daylight: true,
  theme: DEFAULT_THEME,
  hours: DEFAULT_HOURS,
  weekends: true,
  // 'manual' keeps the order you dragged them into; 'offset' sorts west to east.
  sort: 'manual',
  // Set when a shared link carried a specific moment; consumed once by main.
  sharedAt: null,
};

const listeners = new Set();

export function onChange(fn) {
  listeners.add(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

/** Mutate state and persist in one step. */
export function update(patch) {
  Object.assign(state, patch);
  save();
  emit();
}

export function addCity(id) {
  if (state.ids.includes(id)) return false;
  update({ ids: [...state.ids, id] });
  return true;
}

export function removeCity(id) {
  const ids = state.ids.filter((x) => x !== id);
  const homeId = state.homeId === id ? null : state.homeId;
  update({ ids, homeId });
}

export function setHome(id) {
  update({ homeId: state.homeId === id ? null : id });
}

/** Move `id` so it sits at `index` in the strip. */
export function reorder(id, index) {
  const ids = state.ids.filter((x) => x !== id);
  ids.splice(Math.max(0, Math.min(ids.length, index)), 0, id);
  update({ ids });
}

export function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function init() {
  const fromHash = readHash();
  const stored = fromHash || readStorage();

  const home = cityForTimezone(localTimezone());
  let ids = (stored?.ids || []).filter((id) => getCity(id));

  if (!ids.length) {
    ids = STARTER_CITIES.filter((id) => getCity(id));
    if (home && !ids.includes(home.id)) ids.unshift(home.id);
  }

  state.ids = ids;
  state.hour12 = Boolean(stored?.hour12);
  state.daylight = stored?.daylight !== false;
  state.theme = getTheme(stored?.theme).id;
  state.hours = normalizeHours(stored?.hours);
  state.weekends = stored?.weekends !== false;
  state.sort = stored?.sort === 'offset' ? 'offset' : 'manual';
  // Only a link carries a moment; a value in storage would be stale.
  state.sharedAt = fromHash ? (fromHash.sharedAt ?? null) : null;
  state.homeId =
    stored?.homeId && ids.includes(stored.homeId)
      ? stored.homeId
      : home && ids.includes(home.id)
        ? home.id
        : null;

  // A shared link is consumed once, then the address bar is tidied up.
  if (fromHash) {
    save();
    history.replaceState(null, '', location.pathname + location.search);
  }
}

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ids: state.ids,
        homeId: state.homeId,
        hour12: state.hour12,
        daylight: state.daylight,
        theme: state.theme,
        hours: state.hours,
        weekends: state.weekends,
        sort: state.sort,
      }),
    );
  } catch {
    /* private mode, blocked storage — the app still works for this session */
  }
}

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Build the `#c=…` fragment that encodes the current strip. When the timeline
 * is away from now, the selected moment travels with the link as an absolute
 * instant — the recipient should see the time you picked, not their own.
 */
export function shareFragment(shownAt = null, travelMs = 0) {
  const parts = [`c=${encodeURIComponent(state.ids.join(';'))}`];
  if (state.homeId) parts.push(`h=${encodeURIComponent(state.homeId)}`);
  if (state.hour12) parts.push('f=12');
  if (!state.daylight) parts.push('d=0');
  if (state.theme !== DEFAULT_THEME) parts.push(`k=${encodeURIComponent(state.theme)}`);
  if (shownAt && travelMs !== 0) parts.push(`t=${Math.round(shownAt.getTime() / 1000)}`);
  return `#${parts.join('&')}`;
}

function readHash() {
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const raw = params.get('c');
  if (!raw) return null;

  const ids = raw.split(';').filter(Boolean);
  if (!ids.length) return null;

  const t = Number(params.get('t'));

  return {
    ids,
    homeId: params.get('h') || null,
    hour12: params.get('f') === '12',
    daylight: params.get('d') !== '0',
    theme: params.get('k') || null,
    sharedAt: Number.isFinite(t) && t > 0 ? t * 1000 : null,
  };
}
