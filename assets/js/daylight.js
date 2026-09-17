/**
 * Each city's day, as actual sunlight rather than as three office-hours
 * buckets: solar elevation sampled across its local midnight-to-midnight.
 *
 * This is what lets a theme draw a city's whole day as a continuous band, and
 * it stays honest at high latitudes, where a polar summer simply never crosses
 * zero and the band never goes dark.
 */

import { subsolarPoint, solarElevation } from './solar.js';
import { zonedParts, offsetMinutes } from './tz.js';

const DAY_MS = 86400000;

// Elevations bounding the ramp from full night to full daylight. Civil
// twilight ends near -6; the wider floor keeps dusk from cutting off abruptly.
const FULL_DAY = 6;
const FULL_NIGHT = -12;

/** UTC instant of the midnight that begins the city's current local day. */
export function localMidnight(date, tz) {
  const p = zonedParts(date, tz);
  const wall = Date.UTC(p.year, p.month - 1, p.day);
  // Offset can differ between now and midnight across a DST change, so take
  // the offset at the first guess and solve again from there.
  const first = wall - offsetMinutes(date, tz) * 60000;
  return wall - offsetMinutes(new Date(first), tz) * 60000;
}

/** How far through its local day a city is, as 0..1. */
export function dayFraction(date, tz) {
  const p = zonedParts(date, tz);
  return (p.hour * 3600 + p.minute * 60 + p.second) / 86400;
}

/**
 * Solar elevation across the city's local day, sampled `steps` times.
 * Returns elevations plus the same values mapped to 0 (night) .. 1 (day).
 */
export function daylightProfile(city, date, steps = 48) {
  const start = localMidnight(date, city.tz);
  const elevations = new Float64Array(steps + 1);
  const light = new Float64Array(steps + 1);

  for (let i = 0; i <= steps; i++) {
    const t = start + (i / steps) * DAY_MS;
    const elev = solarElevation(city.lat, city.lon, subsolarPoint(new Date(t)));
    elevations[i] = elev;
    light[i] = lightness(elev);
  }

  return { start, steps, elevations, light };
}

/** Solar elevation mapped to 0 (full night) .. 1 (full daylight). */
export function lightness(elev) {
  const t = (elev - FULL_NIGHT) / (FULL_DAY - FULL_NIGHT);
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c); // smoothstep
}

/**
 * Sunrise and sunset as fractions of the local day, or null where the sun
 * does not cross the horizon at all — a polar day or a polar night.
 */
export function sunEvents(profile) {
  const { elevations, steps } = profile;
  let sunrise = null;
  let sunset = null;

  for (let i = 1; i <= steps; i++) {
    const a = elevations[i - 1];
    const b = elevations[i];
    if (a < 0 && b >= 0 && sunrise === null) sunrise = crossing(i, a, b, steps);
    if (a >= 0 && b < 0) sunset = crossing(i, a, b, steps);
  }

  const polarDay = sunrise === null && sunset === null && elevations[0] >= 0;
  const polarNight = sunrise === null && sunset === null && elevations[0] < 0;
  return { sunrise, sunset, polarDay, polarNight };
}

function crossing(i, a, b, steps) {
  const frac = a === b ? 0 : a / (a - b);
  return (i - 1 + frac) / steps;
}

/**
 * CSS gradient stops for a city's day. `colorAt(light)` turns a 0..1 lightness
 * into a colour, so each theme can supply its own night and daylight.
 */
export function gradientStops(profile, colorAt) {
  const { steps, light } = profile;
  const parts = [];
  for (let i = 0; i <= steps; i++) {
    parts.push(`${colorAt(light[i])} ${((i / steps) * 100).toFixed(2)}%`);
  }
  return parts.join(', ');
}

/** Interpolate between two `[r,g,b]` colours. */
export function mixRgb(a, b, t) {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * c)} ${Math.round(
    a[1] + (b[1] - a[1]) * c,
  )} ${Math.round(a[2] + (b[2] - a[2]) * c)})`;
}
