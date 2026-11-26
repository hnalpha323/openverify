/**
 * The collector's own cut-offs (plan C94.3, C90.1, H24), tied to {@link COLLECTOR_VERSION}. They
 * are registered with their basis in `@openverify/core` (`COLLECTOR_CONSTANTS`, with
 * `COLLECTOR_VERSION`); the browser keeps literal copies, because the core registry (and zod) would
 * not fit the 4,096 B budget. `constants.test.ts` pins each copy to the registry, so a change here
 * without the registry's change, and its version bump, fails.
 *
 * A change of any value below changes what the collector sends, so it bumps `COLLECTOR_VERSION`
 * (in core and here together).
 */

/** C94.2: the `collector-version` of every body; equal to core's `COLLECTOR_VERSION`. */
export const COLLECTOR_VERSION = 1;

/** C94.3: the registered cut-offs (core `COLLECTOR_CONSTANTS`). */
export const COLLECTOR_CUTOFFS = Object.freeze({
  /** `typing-cadence-min-intervals`: fewer keydown intervals read `insufficient`. */
  minIntervals: 8,
  /** `typing-cadence-uniform-cv`: a coefficient of variation below this reads `uniform`. */
  uniformCv: 0.1,
  /** `first-input-fast-seconds`, `first-input-quick-seconds`, `first-input-slow-seconds`. */
  firstInputEdges: Object.freeze([0.25, 1, 5] as const),
  /** `dwell-seconds-cap`: dwell and hidden time are capped per screen. */
  dwellCapSeconds: 3600,
});

/**
 * C94.4: how the recognition components are bucketed before they leave the browser (data
 * minimisation, and a device class that survives small reporting differences). Not thresholds:
 * they are not served in `signal-details`, but a change alters the fingerprints, so it bumps
 * `COLLECTOR_VERSION` too (pinned in `constants.test.ts`).
 */
export const RECOGNITION_BUCKETS = Object.freeze({
  /** Screen width and height are rounded to a multiple of this many CSS pixels. */
  screenPixels: 16,
  /** The device pixel ratio is rounded to a multiple of this. */
  pixelRatio: 0.25,
});

/** The bound of every count a body carries (contracts `FLOW_SIGNALS_MAX_COUNT`). */
export const MAX_COUNT = 10_000;
