/**
 * `@openverify/signals/browser` (plan C94.3, C94.4): the browser collector, with no runtime
 * dependency, no network call, no storage (no cookie, `localStorage`, `sessionStorage` or
 * IndexedDB), no iframe, no worker and no remote code, at most 4,096 B gzipped (bundled and
 * measured inside its size test, F19). Nothing runs before the session may collect (P14).
 *
 * The flow calls {@link startCollector} after consent with the session's tiers, tells it each
 * screen with `screen(stepId)`, and posts each body it hands to `send`.
 */
export const SIGNALS_BROWSER_AREA = 'browser';

export { startCollector, type Collector, type CollectorOptions } from './collector.js';
export { COLLECTOR_VERSION } from './constants.js';
export type {
  BehaviourSignals,
  BrowserWindow,
  ClientHints,
  CollectorTiers,
  IntegritySignals,
  RecognitionSignals,
  WebSignalsBody,
} from './types.js';
