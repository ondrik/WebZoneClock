/**
 * App state: which cities are on the strip, which one is home, and the two
 * display toggles. Persisted to localStorage, and shareable through the URL
 * hash (a hash on load wins, so a shared link always shows what was shared).
 */

import { getCity, cityForTimezone } from './citydb.js';

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

/** Build the `#c=…` fragment that encodes the current strip. */
export function shareFragment() {
  const parts = [`c=${encodeURIComponent(state.ids.join(';'))}`];
  if (state.homeId) parts.push(`h=${encodeURIComponent(state.homeId)}`);
  if (state.hour12) parts.push('f=12');
  if (!state.daylight) parts.push('d=0');
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

  return {
    ids,
    homeId: params.get('h') || null,
    hour12: params.get('f') === '12',
    daylight: params.get('d') !== '0',
  };
}
