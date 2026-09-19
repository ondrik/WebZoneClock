import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daylightProfile, sunEvents, lightness, localMidnight, dayFraction, mixRgb,
} from '../assets/js/daylight.js';
import { zonedParts } from '../assets/js/tz.js';

const BRNO = { lat: 49.2, lon: 16.61, tz: 'Europe/Prague' };
const SVALBARD = { lat: 78.22, lon: 15.63, tz: 'Arctic/Longyearbyen' };
const SINGAPORE = { lat: 1.35, lon: 103.82, tz: 'Asia/Singapore' };

test('local midnight really is midnight there', () => {
  for (const tz of ['Europe/Prague', 'Asia/Kathmandu', 'Pacific/Chatham', 'UTC']) {
    const p = zonedParts(new Date(localMidnight(new Date('2026-06-15T09:00:00Z'), tz)), tz);
    assert.equal(p.hour, 0, `${tz} hour`);
    assert.equal(p.minute, 0, `${tz} minute`);
  }
});

test('a profile covers the day at the requested resolution', () => {
  const p = daylightProfile(BRNO, new Date('2026-06-15T09:00:00Z'), 48);
  assert.equal(p.elevations.length, 49);
  assert.equal(p.light.length, 49);
  for (const l of p.light) assert.ok(l >= 0 && l <= 1, `lightness ${l} out of range`);
});

test('a mid-latitude summer day rises before it sets', () => {
  const p = daylightProfile(BRNO, new Date('2026-06-15T09:00:00Z'), 96);
  const e = sunEvents(p);
  assert.ok(e.sunrise !== null && e.sunset !== null, 'expected both events');
  assert.ok(e.sunrise < e.sunset, 'sunrise after sunset');
  // Brno in midsummer: roughly 05:00 and 21:00 local.
  assert.ok(e.sunrise > 0.15 && e.sunrise < 0.27, `sunrise at ${e.sunrise}`);
  assert.ok(e.sunset > 0.83 && e.sunset < 0.93, `sunset at ${e.sunset}`);
  assert.equal(e.polarDay, false);
  assert.equal(e.polarNight, false);
});

test('the poles report polar day and night instead of inventing a sunrise', () => {
  const summer = sunEvents(daylightProfile(SVALBARD, new Date('2026-06-21T12:00:00Z'), 96));
  assert.equal(summer.polarDay, true, 'expected midnight sun');
  assert.equal(summer.sunrise, null);
  assert.equal(summer.sunset, null);

  const winter = sunEvents(daylightProfile(SVALBARD, new Date('2026-12-21T12:00:00Z'), 96));
  assert.equal(winter.polarNight, true, 'expected polar night');
  assert.equal(winter.sunrise, null);
});

test('the equator gets about twelve hours of light year round', () => {
  for (const iso of ['2026-03-20T00:00:00Z', '2026-06-21T00:00:00Z', '2026-12-21T00:00:00Z']) {
    const e = sunEvents(daylightProfile(SINGAPORE, new Date(iso), 96));
    const hours = (e.sunset - e.sunrise) * 24;
    assert.ok(Math.abs(hours - 12) < 0.5, `${iso}: ${hours.toFixed(2)}h of daylight`);
  }
});

test('lightness is clamped and rises with the sun', () => {
  assert.equal(lightness(-90), 0);
  assert.equal(lightness(90), 1);
  let prev = -1;
  for (let e = -30; e <= 30; e += 2) {
    const l = lightness(e);
    assert.ok(l >= prev, `not monotonic at ${e}`);
    prev = l;
  }
});

test('day fraction tracks the local clock', () => {
  const t = new Date('2026-09-17T13:08:00Z'); // 15:08 in Prague
  const f = dayFraction(t, 'Europe/Prague');
  assert.ok(Math.abs(f - (15 * 60 + 8) / 1440) < 1e-4, `fraction ${f}`);
});

test('colour mixing clamps at both ends', () => {
  assert.equal(mixRgb([0, 0, 0], [255, 255, 255], 0), 'rgb(0 0 0)');
  assert.equal(mixRgb([0, 0, 0], [255, 255, 255], 1), 'rgb(255 255 255)');
  assert.equal(mixRgb([0, 0, 0], [255, 255, 255], 2), 'rgb(255 255 255)');
  assert.equal(mixRgb([0, 0, 0], [100, 100, 100], 0.5), 'rgb(50 50 50)');
});
