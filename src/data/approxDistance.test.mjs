// src/data/approxDistance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KM_PER_DEG_LAT,
  approxDistanceDegSq,
  approxDistanceKm,
  approxDistanceM,
  approxOffsetsDeg,
  wrapLongitudeDeltaDeg,
} from './approxDistance.js';

test('wrapLongitudeDeltaDeg folds a delta onto the short way round', () => {
  assert.equal(wrapLongitudeDeltaDeg(2), 2);
  assert.equal(wrapLongitudeDeltaDeg(-2), -2);
  // 179E -> 179W is +2, not -358.
  assert.equal(wrapLongitudeDeltaDeg(-358), 2);
  assert.equal(wrapLongitudeDeltaDeg(358), -2);
  assert.equal(wrapLongitudeDeltaDeg(0), 0);
  // The single boundary: +-180 are the same span, reported as -180.
  assert.equal(Math.abs(wrapLongitudeDeltaDeg(180)), 180);
  assert.equal(Math.abs(wrapLongitudeDeltaDeg(-180)), 180);
  // Multiple wraps still land in range.
  assert.equal(wrapLongitudeDeltaDeg(720 + 5), 5);
  assert.equal(wrapLongitudeDeltaDeg(-720 - 5), -5);
});

test('wrapLongitudeDeltaDeg rejects non-finite input', () => {
  assert.ok(Number.isNaN(wrapLongitudeDeltaDeg(Number.NaN)));
  assert.ok(Number.isNaN(wrapLongitudeDeltaDeg(Infinity)));
  assert.ok(Number.isNaN(wrapLongitudeDeltaDeg(undefined)));
});

test('the antimeridian is the short way round, not 39,000 km', () => {
  // The regression this module exists for: a raw (lon2 - lon1) delta made
  // these two points read as most of the way around the planet, so every
  // proximity gate downstream silently refused to fire near +-180.
  const km = approxDistanceKm(0, 179, 0, -179);
  assert.ok(Math.abs(km - 2 * KM_PER_DEG_LAT) < 1, `expected ~222 km, got ${km}`);
  assert.ok(km < 250, 'must not measure the long way round');
});

test('distance is symmetric across the antimeridian', () => {
  const forward = approxDistanceKm(64, 179.5, 64.2, -179.5);
  const back = approxDistanceKm(64.2, -179.5, 64, 179.5);
  assert.ok(Math.abs(forward - back) < 1e-9);
  assert.ok(forward < 100, `expected a short hop, got ${forward} km`);
});

test('ordinary spans are unchanged by the wrap', () => {
  // One degree of latitude anywhere.
  assert.ok(Math.abs(approxDistanceKm(0, 0, 1, 0) - KM_PER_DEG_LAT) < 1e-9);
  // One degree of longitude at the equator.
  assert.ok(Math.abs(approxDistanceKm(0, 0, 0, 1) - KM_PER_DEG_LAT) < 1e-9);
  // Longitude converges toward the poles: 1 deg at 60N is about half as wide.
  const atSixty = approxDistanceKm(60, 0, 60, 1);
  assert.ok(Math.abs(atSixty - KM_PER_DEG_LAT / 2) < 0.2, `got ${atSixty}`);
});

test('metres and kilometres agree', () => {
  const m = approxDistanceM(37.77, -122.42, 37.8, -122.4);
  const km = approxDistanceKm(37.77, -122.42, 37.8, -122.4);
  assert.ok(Math.abs(m / 1000 - km) < 1e-9);
});

test('approxDistanceDegSq ranks candidates and wraps too', () => {
  const near = approxDistanceDegSq(0, 179.9, 0, -179.9);   // 0.2 deg apart
  const far = approxDistanceDegSq(0, 179.9, 0, 175);        // 4.9 deg apart
  assert.ok(near < far, 'the antimeridian neighbour must rank nearer');
  // It really is the square of the degree distance.
  assert.ok(Math.abs(Math.sqrt(near) - 0.2) < 1e-9);
});

test('approxOffsetsDeg reports signed north/east offsets', () => {
  const { dLatDeg, dLonDeg } = approxOffsetsDeg(10, 20, 11, 21);
  assert.ok(dLatDeg > 0 && dLonDeg > 0, 'north-east is positive in both axes');
  const south = approxOffsetsDeg(11, 21, 10, 20);
  assert.ok(south.dLatDeg < 0 && south.dLonDeg < 0);
});

test('a zero-length span measures zero', () => {
  assert.equal(approxDistanceKm(51.5, -0.12, 51.5, -0.12), 0);
  assert.equal(approxDistanceDegSq(51.5, -0.12, 51.5, -0.12), 0);
});
