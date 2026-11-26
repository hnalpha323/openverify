/**
 * C98.1, C99.2 (Workflow 7B): the coarse boxes of the geolocation lists. A box is a prefilter on the
 * plaintext `list_item_geo.bbox` (GiST `box_ops`): it is rounded outward to 0.01°, so it never cuts
 * a circle and says nothing finer than about a kilometre about an item, whose exact point stays
 * sealed. A haversine over the opened candidates then decides (C95). Longitude is the box's x.
 */
import { EARTH_MEAN_RADIUS_METERS } from '@openverify/checks';

/** C98.1: the box's grid, in degrees. */
const BOX_GRID_DEGREES = 0.01;
const GRID_STEPS_PER_DEGREE = 1 / BOX_GRID_DEGREES;

const degrees = (radians: number) => (radians * 180) / Math.PI;
const radians = (value: number) => (value * Math.PI) / 180;

const floorToGrid = (value: number) =>
  Math.floor(value * GRID_STEPS_PER_DEGREE + 1e-9) / GRID_STEPS_PER_DEGREE;
const ceilToGrid = (value: number) =>
  Math.ceil(value * GRID_STEPS_PER_DEGREE - 1e-9) / GRID_STEPS_PER_DEGREE;

const boxText = (west: number, south: number, east: number, north: number) =>
  `(${String(west)},${String(south)}),(${String(east)},${String(north)})`;

/**
 * The boxes that hold every point within `meters` of a point, as Postgres text, rounded outward to
 * 0.01°: one, or two when the circle crosses ±180°. A circle over a pole takes every longitude.
 */
export function geoBoxes(latitude: number, longitude: number, meters: number): string[] {
  const reach = degrees(meters / EARTH_MEAN_RADIUS_METERS);
  const south = Math.max(-90, floorToGrid(latitude - reach));
  const north = Math.min(90, ceilToGrid(latitude + reach));
  if (Math.abs(latitude) + reach >= 90) {
    return [boxText(-180, south, 180, north)];
  }
  // The widest longitude a circle reaches, at its tangent points (not at the point's latitude).
  const span = degrees(Math.asin(Math.sin(radians(reach)) / Math.cos(radians(latitude))));
  const west = floorToGrid(longitude - span);
  const east = ceilToGrid(longitude + span);
  if (west < -180) {
    return [boxText(-180, south, east, north), boxText(west + 360, south, 180, north)];
  }
  if (east > 180) {
    return [boxText(west, south, 180, north), boxText(-180, south, east - 360, north)];
  }
  return [boxText(west, south, east, north)];
}
