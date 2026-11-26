/**
 * C95: distances. Haversine on the IUGG mean radius R1 = 6,371,008.8 m, rounded to whole meters;
 * its error against Vincenty on WGS 84 is at most 0.56%, far inside the inputs' uncertainty. In
 * Phase 7 the only point is a session's IP location from DB-IP City Lite; a country is not a point
 * (`location_too_coarse`). Every distance is approximate, with its endpoints named, and the
 * provisional `ip-city-uncertainty-meters` (50,000; unmeasured) is served beside it.
 */

/** C95.1: the IUGG mean Earth radius R1. */
export const EARTH_MEAN_RADIUS_METERS = 6_371_008.8;

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

const RADIANS = Math.PI / 180;

function checked(point: GeoPoint): GeoPoint {
  const { latitude, longitude } = point;
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new RangeError('a point needs a latitude in [-90, 90] and a longitude in [-180, 180]');
  }
  return point;
}

/** C95.1: the great-circle distance between `a` and `b`, in whole meters. */
export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const from = checked(a);
  const to = checked(b);
  const latitudeA = from.latitude * RADIANS;
  const latitudeB = to.latitude * RADIANS;
  const halfLatitude = Math.sin((latitudeB - latitudeA) / 2);
  const halfLongitude = Math.sin(((to.longitude - from.longitude) * RADIANS) / 2);
  const chord =
    halfLatitude * halfLatitude +
    Math.cos(latitudeA) * Math.cos(latitudeB) * halfLongitude * halfLongitude;
  return Math.round(2 * EARTH_MEAN_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(chord))));
}

/** A session's point, named so the distance can name its endpoints (C95.3). */
export interface SessionPoint {
  readonly sessionId: string;
  readonly point: GeoPoint;
}

/** C95.4: the two farthest session points and their distance. */
export interface MaxSessionDistance {
  readonly meters: number;
  /** The session ids of the two endpoints (`session-ip`), in input order. */
  readonly endpoints: readonly [string, string];
}

/** C95.4: the largest distance over every pair of points; `null` below two points. */
export function maxSessionDistance(points: readonly SessionPoint[]): MaxSessionDistance | null {
  let farthest: MaxSessionDistance | null = null;
  points.forEach((first, index) => {
    for (const second of points.slice(index + 1)) {
      const meters = haversineMeters(first.point, second.point);
      if (farthest === null || meters > farthest.meters) {
        farthest = { meters, endpoints: [first.sessionId, second.sessionId] };
      }
    }
  });
  return farthest;
}

/** One side of a handoff (C96.7): the session's network facts. */
export interface HandoffSide {
  readonly countryCode: string | null;
  readonly asn: number | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

/** C96.7: the R-tier distance facts of a redeemed session against its issuing session. */
export interface HandoffDistanceFacts {
  /** IP to IP in whole meters; `null` without a point on either side. */
  readonly distanceMeters: number | null;
  /** `null` when either side's country is unknown. */
  readonly countryChanged: boolean | null;
  /** `null` when either side's ASN is unknown. */
  readonly asnChanged: boolean | null;
}

function pointOf(side: HandoffSide): GeoPoint | null {
  return side.latitude === null || side.longitude === null
    ? null
    : { latitude: side.latitude, longitude: side.longitude };
}

function changed<Value>(a: Value | null, b: Value | null): boolean | null {
  return a === null || b === null ? null : a !== b;
}

/** C96.7: the handoff facts; `null` facts wherever either side is unknown. */
export function handoffDistanceFacts(
  issuing: HandoffSide | null,
  redeemed: HandoffSide | null,
): HandoffDistanceFacts {
  if (issuing === null || redeemed === null) {
    return { distanceMeters: null, countryChanged: null, asnChanged: null };
  }
  const from = pointOf(issuing);
  const to = pointOf(redeemed);
  return {
    distanceMeters: from === null || to === null ? null : haversineMeters(from, to),
    countryChanged: changed(issuing.countryCode, redeemed.countryCode),
    asnChanged: changed(issuing.asn, redeemed.asn),
  };
}
