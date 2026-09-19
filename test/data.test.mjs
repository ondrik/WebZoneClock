import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unwrapPolygon, parseRgbTriplet } from '../assets/js/worldmap.js';

const load = async (name) =>
  JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));

test('every city row is well formed', async () => {
  const d = await load('cities.json');
  assert.ok(Array.isArray(d.tz) && Array.isArray(d.countries) && Array.isArray(d.cities));
  for (const [label, ci, ti, lat, lon, pop, alias] of d.cities) {
    assert.ok(label && typeof label === 'string', `bad label ${label}`);
    assert.ok(d.countries[ci], `country index ${ci} for ${label}`);
    assert.ok(d.tz[ti], `tz index ${ti} for ${label}`);
    assert.ok(lat >= -90 && lat <= 90, `${label} latitude ${lat}`);
    assert.ok(lon >= -180 && lon <= 180, `${label} longitude ${lon}`);
    assert.ok(Number.isInteger(pop) && pop >= 0, `${label} population ${pop}`);
    if (alias !== undefined) assert.equal(typeof alias, 'string', `${label} alias`);
  }
});

test('every timezone is one the runtime knows', async () => {
  const d = await load('cities.json');
  for (const tz of d.tz) {
    assert.doesNotThrow(
      () => new Intl.DateTimeFormat('en-US', { timeZone: tz }),
      `unknown zone ${tz}`,
    );
  }
});

test('city identifiers are unique', async () => {
  const d = await load('cities.json');
  const seen = new Set();
  for (const [label, , ti] of d.cities) {
    const id = `${label}@${d.tz[ti]}`;
    assert.ok(!seen.has(id), `duplicate ${id}`);
    seen.add(id);
  }
});

test('land rings are closed pairs within the globe', async () => {
  const d = await load('land.json');
  assert.ok(d.polygons.length > 50, 'suspiciously few polygons');
  for (const poly of d.polygons) {
    for (const ring of poly) {
      assert.equal(ring.length % 2, 0, 'odd coordinate count');
      assert.ok(ring.length >= 8, 'ring too short to enclose area');
      for (let i = 0; i < ring.length; i += 2) {
        assert.ok(ring[i] >= -180 && ring[i] <= 180, `lon ${ring[i]}`);
        assert.ok(ring[i + 1] >= -90 && ring[i + 1] <= 90, `lat ${ring[i + 1]}`);
      }
    }
  }
});

/**
 * Chukotka and Fiji straddle the antimeridian. Before unwrapping they smeared a
 * straight line across the whole map, so this guards the fix and the data that
 * exercises it.
 */
test('the data still contains rings that cross the antimeridian', async () => {
  const d = await load('land.json');
  let crossing = 0;
  for (const poly of d.polygons) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 2; i += 2) {
        if (Math.abs(ring[i + 2] - ring[i]) > 180) { crossing++; break; }
      }
    }
  }
  assert.ok(crossing >= 3, `expected seam-crossing rings, found ${crossing}`);
});

test('unwrapping makes a seam-crossing ring continuous', () => {
  // A square straddling the antimeridian, written the way the data stores it.
  const ring = [170, 10, 180, 10, -180, 10, -170, 10, -170, -10, 170, -10];
  const { rings, shifts } = unwrapPolygon([ring]);
  const lons = [...rings[0]].filter((_, i) => i % 2 === 0);

  for (let i = 1; i < lons.length; i++) {
    assert.ok(Math.abs(lons[i] - lons[i - 1]) <= 180, `jump at ${i}: ${lons[i - 1]} -> ${lons[i]}`);
  }
  assert.ok(Math.max(...lons) > 180, 'expected the ring to run past +180');
  assert.ok(shifts.includes(0) && shifts.includes(-360), `shifts ${shifts}`);
});

test('an ordinary ring is left alone and drawn once', () => {
  const ring = [0, 0, 10, 0, 10, 10, 0, 10];
  const { rings, shifts } = unwrapPolygon([ring]);
  assert.deepEqual([...rings[0]], ring);
  assert.deepEqual(shifts, [0]);
});

test('theme night colours parse, and bad input falls back to black', () => {
  assert.deepEqual(parseRgbTriplet('27 42 74'), [27, 42, 74]);
  assert.deepEqual(parseRgbTriplet('  13 92 87  '), [13, 92, 87]);
  assert.deepEqual(parseRgbTriplet('nonsense'), [0, 0, 0]);
  assert.deepEqual(parseRgbTriplet(''), [0, 0, 0]);
});
