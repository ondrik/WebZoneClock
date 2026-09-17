/**
 * The city database: ~2,300 places with coordinates and IANA timezones,
 * shipped as a column-compressed JSON blob (see tools/build_cities.py).
 */

import { zonedParts, formatTime } from './tz.js';

let cities = [];
let byId = new Map();

/** Stable, human-readable identity — survives a rebuild of the data file. */
export function cityId(city) {
  return `${city.label}@${city.tz}`;
}

export async function loadCities() {
  const res = await fetch('data/cities.json');
  if (!res.ok) throw new Error(`cities.json: HTTP ${res.status}`);
  const raw = await res.json();

  cities = raw.cities.map(([label, countryIdx, tzIdx, lat, lng, pop, alias]) => {
    const city = {
      label,
      country: raw.countries[countryIdx],
      tz: raw.tz[tzIdx],
      lat,
      lon: lng,
      pop,
    };
    city.id = cityId(city);
    // Names and aliases (endonyms, former names) are searched together and
    // rank alike; the country is a weaker, separate match.
    city.names = fold(alias ? `${label} ${alias}` : label);
    city.countryKey = fold(city.country);
    return city;
  });

  byId = new Map(cities.map((c) => [c.id, c]));
  return cities;
}

export function getCity(id) {
  return byId.get(id);
}

export function allCities() {
  return cities;
}

/** Strip case and diacritics so "brno", "Brno" and "Brünn"-style input match. */
function fold(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Ranked search. A hit on the name or one of its aliases beats a hit on the
 * country; within each, a prefix beats a word start beats a bare substring,
 * and population breaks ties — so "roma" gives Rome before La Romana, and
 * "san" gives San Francisco before San Rafael.
 */
export function searchCities(query, limit = 40) {
  const q = fold(query.trim());
  if (!q) return [];

  const scored = [];
  for (const city of cities) {
    let rank = positionRank(city.names, q);
    if (rank === null) {
      const countryRank = positionRank(city.countryKey, q);
      if (countryRank === null) continue;
      rank = countryRank + 3;
    }
    scored.push({ city, rank });
  }

  scored.sort((a, b) => a.rank - b.rank || b.city.pop - a.city.pop);
  return scored.slice(0, limit).map((s) => s.city);
}

/** 0 = starts with, 1 = starts a word, 2 = somewhere inside, null = absent. */
function positionRank(haystack, q) {
  const at = haystack.indexOf(q);
  if (at === -1) return null;
  if (at === 0) return 0;
  return haystack[at - 1] === ' ' ? 1 : 2;
}

/** The label a search row shows on the right: that city's current time. */
export function cityTimeLabel(city, now, hour12) {
  const parts = zonedParts(now, city.tz);
  const { time, meridiem } = formatTime(parts, hour12);
  return meridiem ? `${time} ${meridiem}` : time;
}

/** Best-guess home city for a browser timezone: the biggest city in that zone. */
export function cityForTimezone(tz) {
  let best = null;
  for (const city of cities) {
    if (city.tz === tz && (!best || city.pop > best.pop)) best = city;
  }
  return best;
}
