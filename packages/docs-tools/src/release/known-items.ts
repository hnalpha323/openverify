/**
 * KP11-50: the known items of Workflow 11E's launch (`docs/plans/phase-11.plan.md`, "Orchestrator
 * decisions before Workflow 11E", item 25) that the checklist names by id, each with the owner and
 * the Workflow its detail names. docs-release records them; it fixes none, and their final
 * placement is records-11g's (11G).
 */

export interface RequiredKnownItem {
  /** The checklist line's id (`KP10-35.2` stands for "KP10-35 part 2"). */
  readonly id: string;
  /** Who moves it: the owner (and the release gate), 11F, 11G, the android job's first measured run, or nobody (open by design). */
  readonly owner: 'owner' | '11F' | '11G' | 'android-job' | 'by-design';
}

const ids = (owner: RequiredKnownItem['owner'], list: readonly string[]): RequiredKnownItem[] =>
  list.map((id) => ({ id, owner }));

/** The release gate's, the owner's (the Phase 10 close's list, then 11C's and 11D's). */
const OWNER = [
  'KP10-16',
  'KP10-17',
  'KP10-58',
  'KP10-59',
  'KP10-60',
  'KP10-61',
  'E002',
  'KP11-9',
  'KP11-23',
  'KP11-31',
  'KP11-39',
  'KP11-40',
  'KP11-41',
  'KP11-63',
  'KP11-64',
  'KP11-65',
] as const;

/** Deferred to 11F (11E decisions item 25), KP11-52 to KP11-62 and KP11-66 to KP11-68 included. */
const ELEVEN_F = [
  'KP11-5',
  'KP11-6',
  'KP11-8',
  'KP11-10',
  'KP11-19',
  'KP11-20',
  'KP11-21',
  'KP11-24',
  'KP11-25',
  'KP11-26',
  'KP11-27',
  'KP11-28',
  'KP11-29',
  'KP11-30',
  'KP11-33',
  'KP11-34',
  'KP11-38',
  'KP11-44',
  'KP10-15',
  'KP10-19',
  'KP10-24',
  'KP10-26',
  'KP10-28',
  'KP10-30',
  'KP10-35.2',
  'KP10-53',
  'KP10-55',
  'KP10-56',
  'KP10-57',
  'KP11-52',
  'KP11-53',
  'KP11-54',
  'KP11-55',
  'KP11-56',
  'KP11-57',
  'KP11-58',
  'KP11-59',
  'KP11-60',
  'KP11-61',
  'KP11-62',
  'KP11-66',
  'KP11-67',
  'KP11-68',
] as const;

export const REQUIRED_KNOWN_ITEMS: readonly RequiredKnownItem[] = Object.freeze([
  ...ids('owner', OWNER),
  ...ids('11F', ELEVEN_F),
  ...ids('11G', ['KP11-42']),
  ...ids('android-job', ['KP10-51', 'KP11-4']),
  ...ids('by-design', ['KP10-31']),
]);
