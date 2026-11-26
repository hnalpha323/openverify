/**
 * C251.4 (Phase 11, Workflow 11B Stage 2, `quotas`): the warn line for an environment that sits at a
 * queue's cap for more than five minutes.
 *
 * The quota sweep reads each environment's in-flight count and cap on every tick and hands the reading
 * here. A pair (environment, queue) that reaches its cap starts a clock; once it has stayed there for
 * more than {@link QUEUE_AT_CAP_WARN_AFTER_MS}, one warning comes back, and no other until the pair
 * drops below its cap and reaches it again. The state lives in the sweeping process only (a restart
 * starts every clock afresh, which can only delay a warning), and times come from the injected
 * clock, never the wall clock.
 */
import type { Clock } from '../../ports.js';
import type { AdmittedQueue } from './caps.js';

/**
 * C251.4: how long an environment may sit at a cap before the warn line (ours, provisional: the plan's
 * five minutes, long enough that a burst a slot frees within does not warn).
 */
export const QUEUE_AT_CAP_WARN_AFTER_MS = 5 * 60_000;

/** One reading of an environment's queue. */
export interface AtCapObservation {
  readonly environmentId: string;
  readonly queue: AdmittedQueue;
  readonly inFlight: number;
  readonly cap: number;
}

/** The warn line's facts: ids, counts and times only. */
export interface AtCapWarning extends AtCapObservation {
  readonly atCapSince: Date;
  readonly atCapMs: number;
}

/** The watch over every reading the sweep takes. */
export interface AtCapWatch {
  observe(observation: AtCapObservation): AtCapWarning | null;
  /** How many environment and queue pairs are at their cap now. */
  size(): number;
  /** Forgets every pair of `queue` whose environment is not in `environmentIds`. */
  retain(queue: AdmittedQueue, environmentIds: ReadonlySet<string>): void;
}

interface Episode {
  readonly since: Date;
  warned: boolean;
}

/** A watch over `clock`. */
export function createAtCapWatch(clock: Clock): AtCapWatch {
  const episodes = new Map<string, Episode>();
  return {
    observe(observation) {
      const key = `${observation.environmentId}\u0000${observation.queue}`;
      if (observation.inFlight < observation.cap) {
        episodes.delete(key);
        return null;
      }
      const now = clock.now();
      const episode = episodes.get(key);
      if (episode === undefined) {
        episodes.set(key, { since: now, warned: false });
        return null;
      }
      const atCapMs = now.getTime() - episode.since.getTime();
      if (episode.warned || atCapMs <= QUEUE_AT_CAP_WARN_AFTER_MS) {
        return null;
      }
      episode.warned = true;
      return { ...observation, atCapSince: new Date(episode.since), atCapMs };
    },
    size: () => episodes.size,
    retain(queue, environmentIds) {
      for (const key of [...episodes.keys()]) {
        const [environmentId, name] = key.split('\u0000');
        if (name === queue && !environmentIds.has(environmentId ?? '')) {
          episodes.delete(key);
        }
      }
    },
  };
}
