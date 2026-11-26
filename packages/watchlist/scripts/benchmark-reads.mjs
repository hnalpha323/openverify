// @ts-check
/**
 * Wrappers over the watchlist reads the screening kit uses (evaluation-6, Workflow 6C): the time
 * each read takes, by phase, and one query's answers reused across the presets. Both wrap every
 * member of the reads they are given, not a fixed list, so a member the repository adds never
 * breaks a benchmark step (Workflow 6C freezes `WatchlistReads` at three methods; anything added
 * is wrapped all the same). `benchmark-postgres.mjs` gives them the repository's reads.
 */

/**
 * The phase each known read's time is reported under; any other member is reported by name.
 * @type {Readonly<Record<string, string>>}
 */
export const READ_PHASES = Object.freeze({
  getWatchlistSourceStates: 'state',
  retrieveCandidates: 'retrieve',
  loadEntries: 'load',
});

/**
 * @typedef {{ state: number, retrieve: number, load: number } & Record<string, number>} ReadPhases
 */

/**
 * @typedef {object} Retrieval
 * @property {number} candidates
 * @property {boolean} truncated The search was cut short: at the cap, or out of reach.
 * @property {boolean} capReached The cap cut the result. A tree before Workflow 6C answers without
 *   the member, and there `truncated` means exactly this.
 * @property {boolean} unreachable A pair of the subject's tokens was out of reach (Workflow 6C).
 */

/**
 * The reads, each call's duration added to its phase and each retrieval recorded.
 * @template {object} Reads
 * @param {Reads} reads
 * @returns {{ reads: Reads, take: () => { phases: ReadPhases, retrievals: Retrieval[] } }}
 */
export function timeReads(reads) {
  const entries = Object.entries(reads);
  /** @param {string} name */
  const phaseOf = (name) => READ_PHASES[name] ?? name;
  const zero = () =>
    /** @type {ReadPhases} */ ({
      state: 0,
      retrieve: 0,
      load: 0,
      ...Object.fromEntries(
        entries
          .filter(([name, read]) => typeof read === 'function' && !Object.hasOwn(READ_PHASES, name))
          .map(([name]) => [name, 0]),
      ),
    });
  let phases = zero();
  /** @type {Retrieval[]} */
  let retrievals = [];
  const wrapped = Object.fromEntries(
    entries.map(([name, read]) => {
      if (typeof read !== 'function') {
        return [name, read];
      }
      const phase = phaseOf(name);
      return [
        name,
        async (/** @type {unknown[]} */ ...args) => {
          const started = performance.now();
          const answer = await read.apply(reads, args);
          phases[phase] = (phases[phase] ?? 0) + performance.now() - started;
          if (name === 'retrieveCandidates') {
            retrievals.push({
              candidates: answer.candidates.length,
              truncated: answer.truncated,
              capReached: answer.capReached ?? answer.truncated,
              unreachable: answer.unreachable ?? false,
            });
          }
          return answer;
        },
      ];
    }),
  );
  return {
    reads: /** @type {Reads} */ (/** @type {unknown} */ (wrapped)),
    take() {
      const taken = { phases, retrievals };
      phases = zero();
      retrievals = [];
      return taken;
    },
  };
}

/**
 * The reads, each answer kept by its arguments after the database handle: one query's reads serve
 * the three presets (retrieval does not depend on the preset), and `clear()` frees them.
 * @template {object} Reads
 * @param {Reads} reads
 * @returns {{ reads: Reads, clear: () => void }}
 */
export function reuseReads(reads) {
  /** @type {Map<string, Promise<unknown>>} */
  const answers = new Map();
  const wrapped = Object.fromEntries(
    Object.entries(reads).map(([name, read]) => {
      if (typeof read !== 'function') {
        return [name, read];
      }
      return [
        name,
        (/** @type {unknown} */ db, /** @type {unknown[]} */ ...rest) => {
          const key = JSON.stringify([name, rest]);
          let answer = answers.get(key);
          if (answer === undefined) {
            answer = /** @type {Promise<unknown>} */ (read.call(reads, db, ...rest));
            answers.set(key, answer);
          }
          return answer;
        },
      ];
    }),
  );
  return {
    reads: /** @type {Reads} */ (/** @type {unknown} */ (wrapped)),
    clear: () => {
      answers.clear();
    },
  };
}
