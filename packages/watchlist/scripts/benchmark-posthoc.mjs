// @ts-check
/**
 * Owner decision 7 after Workflow 6B: the post-hoc analyses of `docs/calibration/watchlist-phase6.md`
 * become committed steps, so a report reproduces every number it prints. Pure functions over the
 * benchmarks' own observations; they read nothing and print nothing.
 *
 * - **The typo-kind breakdown.** The 6B cases say only `typo`. The kind of each (one letter
 *   substituted, inserted or deleted, or two adjacent letters transposed) is read back from the
 *   listed and the typed token, and recall is counted by kind, subject, token length and preset.
 * - **Alerts on unlisted subjects** drawn from the performance tables' own law: the first measure
 *   round's unlisted subjects with at least one kept match.
 *
 * The third, the compacted-table round, is a step of `benchmark-performance.mjs`.
 *
 * Owner decision 3 after Workflow 6B, review finding C003: **the re-screen's no-miss check**
 * (`docs/calibration/watchlist-phase6c.md`, decision rule 3), which the calibration ran as a script
 * outside git, is the `rescreen-check` step of `benchmark-performance.mjs`; its counts are here.
 */

import { wilsonInterval } from './benchmark-metrics.mjs';

/** @typedef {import('./benchmark-metrics.mjs').Interval} Interval */
/** @typedef {import('./benchmark-metrics.mjs').TimedScreening} TimedScreening */
/** @typedef {'substitute' | 'insert' | 'delete' | 'transpose'} TypoKind */

/** The kinds of typo, in the order they are reported. */
export const TYPO_EDIT_KINDS = Object.freeze(
  /** @type {const} */ (['substitute', 'insert', 'delete', 'transpose']),
);

/**
 * The token length from which the default preset allows one typo (plan C79.1: `tolerant`, one typo
 * per token of at least 5 characters). The breakdown splits each kind at it.
 */
export const TYPO_BUDGET_LENGTH = 5;

/**
 * @typedef {object} TypoObservation
 * @property {string} subject The set the case belongs to (`persons/names`, `companies`, …).
 * @property {TypoKind | null} kind The edit, or `null` when the typed token is no single edit.
 * @property {number} length The listed token's length.
 * @property {Readonly<Record<string, boolean>>} found Per preset: whether the expected entry was kept.
 */

/**
 * @typedef {object} TypoCount
 * @property {number} found
 * @property {number} of
 * @property {number | null} share
 * @property {Interval | null} wilson
 */

/**
 * @typedef {object} TypoRow
 * @property {string} subject
 * @property {TypoKind | 'unclassified'} kind
 * @property {'all' | 'short' | 'long'} length `short` below {@link TYPO_BUDGET_LENGTH}, `long` from it.
 * @property {Record<string, TypoCount>} presets
 */

/**
 * @typedef {object} UnlistedAlerts
 * @property {number} round The round counted (the first).
 * @property {number} alerted Unlisted subjects with at least one kept match.
 * @property {number} of Unlisted subjects.
 * @property {number} share
 * @property {Interval | null} interval The 95% Wilson interval.
 * @property {number} matches The kept matches of those subjects.
 */

/**
 * The one edit that turns `listed` into `typed`, or `null` when there is none or more than one.
 * @param {string} listed
 * @param {string} typed
 * @returns {{ kind: TypoKind, at: number } | null}
 */
export function typoEdit(listed, typed) {
  let at = 0;
  while (at < listed.length && at < typed.length && listed.charAt(at) === typed.charAt(at)) {
    at += 1;
  }
  if (typed.length === listed.length) {
    if (at === listed.length) {
      return null;
    }
    if (listed.slice(at + 1) === typed.slice(at + 1)) {
      return { kind: 'substitute', at };
    }
    const swapped =
      listed.charAt(at) === typed.charAt(at + 1) &&
      listed.charAt(at + 1) === typed.charAt(at) &&
      listed.slice(at + 2) === typed.slice(at + 2);
    return swapped ? { kind: 'transpose', at } : null;
  }
  if (typed.length === listed.length + 1) {
    return typed.slice(at + 1) === listed.slice(at) ? { kind: 'insert', at } : null;
  }
  if (typed.length + 1 === listed.length) {
    return listed.slice(at + 1) === typed.slice(at) ? { kind: 'delete', at } : null;
  }
  return null;
}

/**
 * Recall by subject, kind and token length, at each preset, with Wilson intervals.
 * @param {readonly TypoObservation[]} items
 * @param {readonly string[]} presets
 * @returns {TypoRow[]}
 */
export function typoKindBreakdown(items, presets) {
  const subjects = [...new Set(items.map((item) => item.subject))];
  /** @type {readonly (TypoKind | 'unclassified')[]} */
  const kinds = [...TYPO_EDIT_KINDS, 'unclassified'];
  /** @type {readonly ('all' | 'short' | 'long')[]} */
  const lengths = ['all', 'short', 'long'];
  /** @type {TypoRow[]} */
  const rows = [];
  for (const subject of subjects) {
    for (const kind of kinds) {
      for (const length of lengths) {
        const own = items.filter(
          (item) =>
            item.subject === subject &&
            (item.kind ?? 'unclassified') === kind &&
            (length === 'all' || item.length >= TYPO_BUDGET_LENGTH === (length === 'long')),
        );
        if (own.length === 0) {
          continue;
        }
        rows.push({
          subject,
          kind,
          length,
          presets: Object.fromEntries(
            presets.map((preset) => {
              const found = own.filter((item) => item.found[preset] === true).length;
              return [
                preset,
                {
                  found,
                  of: own.length,
                  share: found / own.length,
                  wilson: wilsonInterval(found, own.length),
                },
              ];
            }),
          ),
        });
      }
    }
  }
  return rows;
}

/**
 * The first round's unlisted subjects with at least one kept match.
 * @param {readonly TimedScreening[]} timings
 * @returns {UnlistedAlerts}
 */
export function unlistedAlerts(timings) {
  const unlisted = timings.filter((item) => item.subject === 'unlisted');
  if (unlisted.length === 0) {
    throw new RangeError('no unlisted subject');
  }
  const round = Math.min(...unlisted.map((item) => item.round));
  const first = unlisted.filter((item) => item.round === round);
  const alerted = first.filter((item) => item.kept > 0).length;
  return {
    round,
    alerted,
    of: first.length,
    share: alerted / first.length,
    interval: wilsonInterval(alerted, first.length),
    matches: first.reduce((sum, item) => sum + item.kept, 0),
  };
}

/**
 * @typedef {object} RescreenSubject One recurring report of decision 3's no-miss check, as its own
 *   full screening kept matches (counts and error codes only, never a name).
 * @property {string} reportId
 * @property {number} changed Kept matches on an entry the sync added or changed.
 * @property {number} kept Kept matches in all.
 * @property {string[]} errors The screening's error codes.
 */

/**
 * @typedef {object} RescreenCheck Decision 3's no-miss check of one re-screen.
 * @property {number} changedEntries The live entries the sync added or changed.
 * @property {number} listUpdateRuns The `list_update` runs the re-screen inserted for the sync.
 * @property {number} subjectsScreened
 * @property {number} erroredSubjects Screenings with an error (`result_truncated`, …).
 * @property {string[]} errorCodes
 * @property {number} fullScreeningMatchesChanged Subjects whose full screening keeps a match on a
 *   changed entry.
 * @property {number} ofThemWithRun Of them, those the re-screen gave a run.
 * @property {number} missed Of them, those without a run.
 * @property {Interval | null} missedWilson The 95% Wilson interval of `missed` over them.
 * @property {number} runsWithoutFullScreeningMatch Runs whose report's full screening keeps no
 *   match on a changed entry (they cost a screening and miss nothing).
 * @property {number} matchesOnChangedEntries
 */

/**
 * One subject's line of the no-miss check: its kept entries counted against the changed ones.
 * @param {string} reportId
 * @param {readonly string[]} keptEntryIds The publisher ids of the entries its screening kept.
 * @param {ReadonlySet<string>} changedEntryIds
 * @param {readonly string[]} errors
 * @returns {RescreenSubject}
 */
export function rescreenSubject(reportId, keptEntryIds, changedEntryIds, errors) {
  return {
    reportId,
    changed: keptEntryIds.filter((id) => changedEntryIds.has(id)).length,
    kept: keptEntryIds.length,
    errors: [...errors],
  };
}

/**
 * The lines of one worker's file of the no-miss check, `\n`-terminated JSON. Every line is
 * appended whole with its newline, so a last line without one is another worker's write in
 * progress, read on a later call.
 * @param {string} text
 * @returns {RescreenSubject[]}
 */
export function rescreenSubjectLines(text) {
  const lines = text.split('\n');
  // The piece after the last newline: empty for a whole file, else a write still in progress.
  lines.pop();
  return lines
    .filter((line) => line !== '')
    .map((line) => /** @type {RescreenSubject} */ (JSON.parse(line)));
}

/**
 * Decision 3's no-miss check: the subjects whose full screening keeps a match on a changed entry,
 * against the reports the re-screen gave a `list_update` run. A subject screened twice (a resumed
 * call) counts once, by its last line.
 * @param {{ changedEntries: number, runs: readonly string[], subjects: readonly RescreenSubject[] }} input
 * @returns {RescreenCheck}
 */
export function rescreenCheck(input) {
  /** @type {Map<string, RescreenSubject>} */
  const byReport = new Map(input.subjects.map((subject) => [subject.reportId, subject]));
  const subjects = [...byReport.values()];
  const runs = new Set(input.runs);
  const matched = subjects.filter((subject) => subject.changed > 0);
  const missed = matched.filter((subject) => !runs.has(subject.reportId)).length;
  return {
    changedEntries: input.changedEntries,
    listUpdateRuns: runs.size,
    subjectsScreened: subjects.length,
    erroredSubjects: subjects.filter((subject) => subject.errors.length > 0).length,
    errorCodes: [...new Set(subjects.flatMap((subject) => subject.errors))].sort(),
    fullScreeningMatchesChanged: matched.length,
    ofThemWithRun: matched.length - missed,
    missed,
    missedWilson: wilsonInterval(missed, matched.length),
    runsWithoutFullScreeningMatch: [...runs].filter(
      (reportId) => (byReport.get(reportId)?.changed ?? 0) === 0,
    ).length,
    matchesOnChangedEntries: matched.reduce((sum, subject) => sum + subject.changed, 0),
  };
}
