import { describe, expect, it } from 'vitest';
import {
  EARTH_MEAN_RADIUS_METERS,
  handoffDistanceFacts,
  haversineMeters,
  maxSessionDistance,
  type HandoffSide,
} from './distance.js';
import { seededRandom } from './testing.js';

// Every point is fictional: open ocean, the poles, the antimeridian, a grid (C111.1).
const point = (latitude: number, longitude: number) => ({ latitude, longitude });

describe('haversineMeters (C95.1)', () => {
  it('uses the IUGG mean radius R1', () => {
    expect(EARTH_MEAN_RADIUS_METERS).toBe(6_371_008.8);
  });

  it.each([
    ['one degree on the equator', point(0, 0), point(0, 1), 111_195],
    ['half the equator', point(0, 0), point(0, 180), 20_015_114],
    ['pole to pole', point(90, 0), point(-90, 0), 20_015_114],
    ['two longitudes at a pole', point(90, 0), point(90, 120), 0],
    ['across the antimeridian', point(0, 179.5), point(0, -179.5), 111_195],
    ['a grid step in the South Pacific', point(-40, -120), point(-41, -121), 139_689],
    ['identical points', point(-40, -120), point(-40, -120), 0],
    ['two open-ocean points', point(-45.5, -150.25), point(-30.125, -130.75), 2_407_661],
    ['across the equator', point(10, -140), point(-10, -140), 2_223_902],
  ])('golden: %s', (_label, a, b, meters) => {
    expect(haversineMeters(a, b)).toBe(meters);
  });

  it('is symmetric and in whole meters (property)', () => {
    const random = seededRandom('distance-symmetry');
    for (let index = 0; index < 500; index += 1) {
      const a = point(random() * 180 - 90, random() * 360 - 180);
      const b = point(random() * 180 - 90, random() * 360 - 180);
      const there = haversineMeters(a, b);
      expect(Number.isInteger(there)).toBe(true);
      expect(there).toBe(haversineMeters(b, a));
      expect(there).toBeGreaterThanOrEqual(0);
      expect(there).toBeLessThanOrEqual(20_015_115);
    }
  });

  it('refuses a coordinate outside its range or not finite', () => {
    expect(() => haversineMeters(point(91, 0), point(0, 0))).toThrow(RangeError);
    expect(() => haversineMeters(point(0, 0), point(0, -180.5))).toThrow(RangeError);
    expect(() => haversineMeters(point(Number.NaN, 0), point(0, 0))).toThrow(RangeError);
  });
});

describe('maxSessionDistance (C95.4)', () => {
  it('is null below two points', () => {
    expect(maxSessionDistance([])).toBeNull();
    expect(maxSessionDistance([{ sessionId: 'iqse_a', point: point(0, 0) }])).toBeNull();
  });

  it('finds the two farthest points and names them as endpoints', () => {
    expect(
      maxSessionDistance([
        { sessionId: 'iqse_a', point: point(0, 0) },
        { sessionId: 'iqse_b', point: point(0, 1) },
        { sessionId: 'iqse_c', point: point(10, -140) },
        { sessionId: 'iqse_d', point: point(-12, -141) },
      ]),
    ).toEqual({
      meters: haversineMeters(point(0, 1), point(-12, -141)),
      endpoints: ['iqse_b', 'iqse_d'],
    });
  });

  it('keeps the first pair in input order on a tie', () => {
    expect(
      maxSessionDistance([
        { sessionId: 'iqse_a', point: point(0, 0) },
        { sessionId: 'iqse_b', point: point(0, 1) },
        { sessionId: 'iqse_c', point: point(0, -1) },
      ]),
    ).toEqual({ meters: 222_390, endpoints: ['iqse_b', 'iqse_c'] });
    expect(
      maxSessionDistance([
        { sessionId: 'iqse_a', point: point(0, 0) },
        { sessionId: 'iqse_b', point: point(0, 0) },
      ]),
    ).toEqual({ meters: 0, endpoints: ['iqse_a', 'iqse_b'] });
  });
});

describe('handoffDistanceFacts (C96.7)', () => {
  const side = (overrides: Partial<HandoffSide> = {}): HandoffSide => ({
    countryCode: 'ZZ',
    asn: 64_501,
    latitude: -40,
    longitude: -120,
    ...overrides,
  });

  it('measures IP to IP and compares country and ASN', () => {
    expect(handoffDistanceFacts(side(), side({ latitude: -41, longitude: -121 }))).toEqual({
      distanceMeters: 139_689,
      countryChanged: false,
      asnChanged: false,
    });
    expect(handoffDistanceFacts(side(), side({ countryCode: 'AQ', asn: 64_502 }))).toEqual({
      distanceMeters: 0,
      countryChanged: true,
      asnChanged: true,
    });
  });

  it('answers null for whatever either side does not know', () => {
    expect(
      handoffDistanceFacts(side({ latitude: null, longitude: null }), side({ countryCode: null })),
    ).toEqual({ distanceMeters: null, countryChanged: null, asnChanged: false });
    expect(handoffDistanceFacts(side(), side({ asn: null, longitude: null }))).toEqual({
      distanceMeters: null,
      countryChanged: false,
      asnChanged: null,
    });
    expect(handoffDistanceFacts(null, side())).toEqual({
      distanceMeters: null,
      countryChanged: null,
      asnChanged: null,
    });
  });
});
