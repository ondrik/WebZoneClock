import test from 'node:test';
import assert from 'node:assert/strict';
import { subsolarPoint, solarElevation } from '../assets/js/solar.js';

const close = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} not within ${tol} of ${b}`);

test('declination is ~0 at the equinoxes', () => {
  for (const iso of ['2026-03-20T12:00:00Z', '2026-09-22T12:00:00Z']) {
    close(subsolarPoint(new Date(iso)).lat, 0, 0.5, iso);
  }
});

test('declination reaches the tropics at the solstices', () => {
  close(subsolarPoint(new Date('2026-06-21T12:00:00Z')).lat, 23.44, 0.1, 'june');
  close(subsolarPoint(new Date('2026-12-21T12:00:00Z')).lat, -23.44, 0.1, 'december');
});

test('the subsolar point travels 15 degrees west per hour', () => {
  const base = subsolarPoint(new Date(Date.UTC(2026, 8, 17, 12))).lon;
  for (const h of [1, 3, 6]) {
    const later = subsolarPoint(new Date(Date.UTC(2026, 8, 17, 12 + h))).lon;
    close(later, base - 15 * h, 0.3, `+${h}h`);
  }
});

test('the sun is overhead at the subsolar point', () => {
  const now = new Date('2026-05-04T09:17:00Z');
  const sub = subsolarPoint(now);
  close(solarElevation(sub.lat, sub.lon, sub), 90, 0.01, 'overhead');
  close(solarElevation(-sub.lat, sub.lon + 180, sub), -90, 0.01, 'antipode');
});

test('elevation stays within the horizon bounds everywhere', () => {
  const sub = subsolarPoint(new Date('2026-01-11T03:00:00Z'));
  for (let lat = -90; lat <= 90; lat += 15) {
    for (let lon = -180; lon <= 180; lon += 15) {
      const e = solarElevation(lat, lon, sub);
      assert.ok(e >= -90.001 && e <= 90.001, `elevation ${e} at ${lat},${lon}`);
      assert.ok(Number.isFinite(e), `non-finite at ${lat},${lon}`);
    }
  }
});

test('the poles sit near the horizon at an equinox', () => {
  const sub = subsolarPoint(new Date('2026-03-20T12:00:00Z'));
  close(solarElevation(90, 0, sub), 0, 1, 'north pole');
  close(solarElevation(-90, 0, sub), 0, 1, 'south pole');
});
