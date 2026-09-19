import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProjection } from '../assets/js/geo.js';

const close = (a, b, tol, what) =>
  assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test('longitude always spans the full width', () => {
  const p = makeProjection(1600, 600);
  close(p.x(-180), p.rect.x, 0.01, 'left edge');
  close(p.x(180), p.rect.x + p.rect.w, 0.01, 'right edge');
  close(p.x(0), p.rect.x + p.rect.w / 2, 0.01, 'centre');
});

test('a wide box fills without letterboxing or distortion', () => {
  const p = makeProjection(1600, 600); // aspect 2.67, wider than the 2:1 floor
  assert.equal(p.rect.h, 600, 'no letterbox');
  assert.equal(p.rect.y, 0);
  const pxPerLon = p.rect.w / 360;
  const pxPerLat = p.rect.h / (p.latTop - p.latBottom);
  close(pxPerLon, pxPerLat, 0.001, 'degrees get equal pixels');
});

test('a tall box letterboxes rather than stretching', () => {
  const p = makeProjection(800, 900); // portrait
  assert.equal(p.rect.h, 400, 'height capped at width/2');
  assert.equal(p.rect.y, 250, 'centred vertically');
  assert.equal(p.latTop, 90);
  assert.equal(p.latBottom, -90);
});

test('the latitude window stays inside the globe', () => {
  for (const [w, h] of [[1600, 600], [800, 900], [3000, 400], [400, 400], [1, 1]]) {
    const p = makeProjection(w, h);
    assert.ok(p.latTop <= 90.001, `latTop ${p.latTop} for ${w}x${h}`);
    assert.ok(p.latBottom >= -90.001, `latBottom ${p.latBottom} for ${w}x${h}`);
    assert.ok(p.latTop > p.latBottom, `inverted for ${w}x${h}`);
  }
});

test('populated latitudes stay visible at a desktop aspect', () => {
  const p = makeProjection(1600, 610);
  // Svalbard in the north, Tierra del Fuego in the south.
  assert.ok(p.covers(78.2), 'Longyearbyen off the top');
  assert.ok(p.covers(-54.8), 'Ushuaia off the bottom');
});

test('projection inverts cleanly', () => {
  const p = makeProjection(1440, 700);
  for (const lon of [-180, -73.5, 0, 16.6, 180]) {
    close(p.lonAt(p.x(lon)), lon, 1e-9, `lon ${lon}`);
  }
  for (const lat of [p.latTop, 0, 51.5, p.latBottom]) {
    close(p.latAt(p.y(lat)), lat, 1e-9, `lat ${lat}`);
  }
});

test('degenerate sizes do not produce NaN', () => {
  for (const [w, h] of [[0, 0], [-5, 10], [10, 0]]) {
    const p = makeProjection(w, h);
    assert.ok(Number.isFinite(p.x(0)) && Number.isFinite(p.y(0)), `${w}x${h}`);
  }
});
