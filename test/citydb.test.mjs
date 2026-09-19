import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCities, searchCities, getCity, cityForTimezone, allCities } from '../assets/js/citydb.js';

// citydb fetches its data; in Node, serve it straight off disk.
before(async () => {
  globalThis.fetch = async (path) => ({
    ok: true,
    json: async () => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8')),
  });
  await loadCities();
});

const first = (q) => searchCities(q, 1)[0];

test('the database loads', () => {
  assert.ok(allCities().length > 2000, `only ${allCities().length} cities`);
});

test('an exact name wins over a longer one containing it', () => {
  assert.equal(first('brno').label, 'Brno');
  assert.equal(first('tokyo').label, 'Tokyo');
  assert.equal(first('new york').label, 'New York, NY');
});

/**
 * "roma" used to return La Romana and Kostroma ahead of Rome, because an alias
 * hit was scored like a country hit. Names and aliases now rank together.
 */
test('an alias ranks with the name, not with the country', () => {
  assert.equal(first('roma').label, 'Rome');
  assert.equal(first('praha').label, 'Prague');
  assert.equal(first('wien').label, 'Vienna');
  assert.equal(first('peking').label, 'Beijing');
  assert.equal(first('leningrad').label, 'St. Petersburg');
  assert.equal(first('bombay').label, 'Mumbai');
  assert.equal(first('saigon').label, 'Ho Chi Minh City');
});

test('accents are optional in either direction', () => {
  assert.equal(first('zurich').label, 'Zürich');
  assert.equal(first('plzen').label, 'Plzeň');
  assert.equal(first('plzeň').label, 'Plzeň');
  assert.equal(first('reykjavik').label, 'Reykjavík');
});

test('a country name finds its cities', () => {
  const czech = searchCities('czechia', 5).map((c) => c.label);
  assert.ok(czech.includes('Prague') && czech.includes('Brno'), czech.join(','));
});

test('bigger cities come first on an ambiguous prefix', () => {
  const san = searchCities('san ', 6);
  const pops = san.map((c) => c.pop);
  assert.deepEqual(pops, [...pops].sort((a, b) => b - a), 'not ordered by population');
});

test('a miss returns nothing rather than everything', () => {
  assert.deepEqual(searchCities('xyzzy'), []);
  assert.deepEqual(searchCities('   '), []);
  assert.deepEqual(searchCities(''), []);
});

test('identifiers round-trip and reject nonsense', () => {
  for (const c of [first('brno'), first('tokyo'), first('san francisco')]) {
    assert.equal(getCity(c.id).label, c.label);
  }
  assert.equal(getCity('Nowhere@Bad/Zone'), undefined);
});

test('a timezone resolves to its largest city', () => {
  assert.equal(cityForTimezone('Europe/Prague').label, 'Prague');
  assert.equal(cityForTimezone('Asia/Tokyo').label, 'Tokyo');
  assert.equal(cityForTimezone('Bogus/Zone'), null);
});

test('the search limit is honoured', () => {
  assert.equal(searchCities('a', 7).length, 7);
});
