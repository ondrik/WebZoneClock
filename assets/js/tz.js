/**
 * Timezone-aware clock arithmetic built on Intl, with the formatters cached
 * because constructing an Intl.DateTimeFormat is comparatively expensive and
 * we re-render every minute.
 */

const partsFormatters = new Map();

function partsFormatter(tz) {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

/** Wall-clock fields for `date` as seen in `tz`. */
export function zonedParts(date, tz) {
  const out = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(date)) {
    if (type !== 'literal') out[type] = value;
  }
  return {
    year: +out.year,
    month: +out.month,
    day: +out.day,
    hour: +out.hour % 24,
    minute: +out.minute,
    second: +out.second,
    weekday: out.weekday,
  };
}

/** Zone's offset from UTC in minutes at `date` (DST included). */
export function offsetMinutes(date, tz) {
  const p = zonedParts(date, tz);
  const asIfUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asIfUTC - (date.getTime() - date.getMilliseconds())) / 60000;
}

/** "GMT+2", "GMT-3:30", "GMT" — how the app labels your home zone. */
export function offsetLabel(date, tz) {
  const mins = offsetMinutes(date, tz);
  if (mins === 0) return 'GMT';
  const sign = mins < 0 ? '-' : '+';
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `GMT${sign}${h}` : `GMT${sign}${h}:${String(m).padStart(2, '0')}`;
}

/** Clock face text, split so the am/pm marker can be styled separately. */
export function formatTime(parts, hour12) {
  const mm = String(parts.minute).padStart(2, '0');
  if (!hour12) return { time: `${String(parts.hour).padStart(2, '0')}:${mm}`, meridiem: '' };
  const h = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return { time: `${h}:${mm}`, meridiem: parts.hour < 12 ? 'AM' : 'PM' };
}

/**
 * Whole days between two zoned dates — how the app shows that a city is
 * already on tomorrow, or still on yesterday.
 */
export function dayDelta(parts, refParts) {
  const a = Date.UTC(parts.year, parts.month - 1, parts.day);
  const b = Date.UTC(refParts.year, refParts.month - 1, refParts.day);
  return Math.round((a - b) / 86400000);
}

/**
 * Which of the three tile colours a local hour falls into.
 *
 * Boundaries read off the original app while scrubbing its timeline: 17:59 is
 * still green and 18:00 is not, 8:59 is white and 9:00 is green. Evening is
 * grouped with the night rather than with the early morning.
 */
export function dayState(hour) {
  if (hour >= 9 && hour < 18) return 'work';
  if (hour >= 6 && hour < 9) return 'early';
  return 'asleep';
}
