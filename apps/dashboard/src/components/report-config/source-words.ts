/**
 * The watchlist sources page's vocabulary in words (C72.3, C73.3, C76, C81.2): how a sync ended,
 * a source's last error, the audited overrides, who ran a sync, where the data came from, and a
 * source's state as a report selecting it meets it (C69.4).
 *
 * The test (`source-words.test.ts`) reads every key from the contracts' own lists, so a code added
 * there without words here fails it.
 */
import type {
  DashboardWatchlistSources,
  WATCHLIST_ORIGINS,
  WATCHLIST_SOURCE_ERROR_CODES,
  WATCHLIST_SYNC_ACTORS,
  WATCHLIST_SYNC_OUTCOMES,
  WATCHLIST_SYNC_OVERRIDES,
} from '@openverify/contracts';
import type { BadgeTone } from '../status-badge';

export type WatchlistSyncOutcome = (typeof WATCHLIST_SYNC_OUTCOMES)[number];
export type WatchlistSourceErrorCode = (typeof WATCHLIST_SOURCE_ERROR_CODES)[number];
export type WatchlistSyncOverride = (typeof WATCHLIST_SYNC_OVERRIDES)[number];
export type WatchlistSyncActor = (typeof WATCHLIST_SYNC_ACTORS)[number];
export type WatchlistOrigin = (typeof WATCHLIST_ORIGINS)[number];
export type WatchlistSourceStatus = DashboardWatchlistSources['sources'][number];

export interface Words {
  readonly label: string;
  readonly tone: BadgeTone;
  readonly meaning: string;
}

const KEPT = 'The previous data is kept.';

/** C73.3: how a sync, an import or a re-key ended. */
export const SYNC_OUTCOME_WORDS: Readonly<Record<WatchlistSyncOutcome, Words>> = Object.freeze({
  applied: { label: 'Applied', tone: 'success', meaning: 'The publication was applied.' },
  unchanged: {
    label: 'Unchanged',
    tone: 'neutral',
    meaning: 'The same file as the last applied one; it counts as a successful check.',
  },
  rekeyed: {
    label: 'Re-keyed',
    tone: 'progress',
    meaning: 'The stored keys were rebuilt for this matcher version.',
  },
  busy: {
    label: 'Busy',
    tone: 'neutral',
    meaning: 'Another sync held the source’s lock, so nothing was done.',
  },
  refused_rollback: {
    label: 'Refused: rollback',
    tone: 'danger',
    meaning: `Older than the publication already applied. ${KEPT}`,
  },
  refused_future: {
    label: 'Refused: future publication',
    tone: 'danger',
    meaning: `Dated more than 24 hours ahead. ${KEPT}`,
  },
  refused_mass_removal: {
    label: 'Refused: mass removal',
    tone: 'danger',
    meaning: `It would have removed more than 10% of the entries. ${KEPT}`,
  },
  refused_schema: {
    label: 'Refused: schema',
    tone: 'danger',
    meaning: `A record did not fit the normalised schema. ${KEPT}`,
  },
  refused_size: {
    label: 'Refused: too large',
    tone: 'danger',
    meaning: `The file was larger than the source’s byte cap. ${KEPT}`,
  },
  refused_matcher_data: {
    label: 'Refused: matcher data',
    tone: 'danger',
    meaning: `The variant groups are missing or not the shipped file. ${KEPT}`,
  },
  error: {
    label: 'Failed',
    tone: 'danger',
    meaning: 'The sync failed; the source’s last error says why. The previous data is kept.',
  },
});

/** C76.2, C76.4: a source's last error. */
export const SOURCE_ERROR_WORDS: Readonly<Record<WatchlistSourceErrorCode, string>> = Object.freeze(
  {
    source_not_configured: 'Not configured: its token or User-Agent is not set',
    download_failed: 'The download failed',
    download_too_large: 'The download was larger than its byte cap',
    content_type_refused: 'The answer’s content type is not one the source allows',
    redirect_refused: 'A redirect went somewhere other than the one host allowed',
    timeout: 'The download passed its deadline',
    parse_failed: 'The file could not be read',
    refused_rollback: 'Refused as older than the publication already applied',
    refused_future: 'Refused as dated more than 24 hours ahead',
    refused_mass_removal: 'Refused for removing more than 10% of the entries',
    refused_schema: 'Refused: a record did not fit the normalised schema',
    refused_size: 'Refused as larger than its byte cap',
    refused_matcher_data: 'Refused: the variant groups are missing or not the shipped file',
  },
);

/** C76.2: the audited overrides, with the CLI flag that made each. */
export const SYNC_OVERRIDE_WORDS: Readonly<Record<WatchlistSyncOverride, string>> = Object.freeze({
  'allow-mass-removal': 'Mass removal allowed (--allow-mass-removal)',
  'accept-older-publication': 'Older publication accepted (--accept-older-publication)',
  'allow-normalised': 'Normalised file allowed (--allow-normalised)',
});

/** C73.3: who ran a sync. */
export const SYNC_ACTOR_LABELS: Readonly<Record<WatchlistSyncActor, string>> = Object.freeze({
  cli: 'Command line',
  job: 'Refresh job',
  seed: 'seed:dev',
});

/** C76.2 (P08): where the data came from. */
export const SOURCE_ORIGIN_WORDS: Readonly<
  Record<WatchlistOrigin, { readonly label: string; readonly meaning: string }>
> = Object.freeze({
  publisher: { label: 'Publisher', meaning: 'Downloaded from the publisher' },
  import: {
    label: 'Import',
    meaning: 'A file an operator loaded; never cited as the publisher’s',
  },
});

/** C76.1: the kinds of source. */
export const SOURCE_KIND_LABELS: Readonly<Record<WatchlistSourceStatus['kind'], string>> =
  Object.freeze({ sanctions: 'Sanctions', pep: 'Politically exposed persons' });

export type SourceStateKey =
  | 'disabled'
  | 'not_configured'
  | 'never_checked'
  | 'needs_rekey'
  | 'keys_unknown'
  | 'sandbox'
  | 'stale'
  | 'fresh'
  | 'rescreen_pending';

/** What the API says about its own matcher data (owner decision 17). */
export interface SourceStateOptions {
  /** Whether the API process holds the variant groups (`matcher.loaded`); true by default. */
  readonly matcherLoaded?: boolean;
}

export interface SourceState {
  readonly key: SourceStateKey;
  readonly label: string;
  readonly tone: BadgeTone;
  readonly detail: string;
}

const UNAVAILABLE = 'reports selecting it error list_unavailable';

/**
 * Owner decision 17: the API process holds no variant groups (`matcher.loaded: false`), so it
 * answers `keys-current: false` for every source and cannot tell whether a source's stored keys
 * are this matcher version's. That is not a re-key.
 */
const KEYS_UNKNOWN: SourceState = Object.freeze({
  key: 'keys_unknown',
  label: 'The API has no variant groups',
  tone: 'attention',
  detail:
    'The API holds no variant-group file (or not the shipped one), so it cannot tell whether this source’s stored keys are this matcher version’s: that is not a re-key. Build the file where the API runs (python3 scripts/fetch_data.py, then pnpm --filter @openverify/watchlist build:variant-groups). The worker checks its own when a report runs: without the file, person-name reports error matcher_data_unavailable.',
});

/**
 * A source's state as a report selecting it meets it (C69.4, C76.3, C76.4, C78.3), in the order
 * the run framework decides: unavailable (disabled, not configured, never checked), then keyed by
 * another matcher version, then stale. A sandbox list is never stale (V03), and in a production
 * environment it is never screened (P13); a pending re-screen is added whatever the state. When
 * the API holds no variant groups, the keys are unknown rather than old (owner decision 17), and
 * freshness, which needs no matcher data, is still said.
 */
export function sourceStates(
  source: WatchlistSourceStatus,
  environmentKind: 'sandbox' | 'production' = 'sandbox',
  { matcherLoaded = true }: SourceStateOptions = {},
): SourceState[] {
  const states: SourceState[] = [];
  const limit = source['stale-after-hours'];
  if (!source.enabled) {
    states.push({
      key: 'disabled',
      label: 'Disabled',
      tone: 'neutral',
      detail: `Disabled install-wide: ${UNAVAILABLE} until it is enabled again.`,
    });
  } else if (!source.configured) {
    states.push({
      key: 'not_configured',
      label: 'Not configured',
      tone: 'attention',
      detail: `Its token or User-Agent is not set, so it is never synced: ${UNAVAILABLE}.`,
    });
  } else if (source['last-checked-at'] === null) {
    states.push({
      key: 'never_checked',
      label: 'Never checked',
      tone: 'attention',
      detail: source['sandbox-only']
        ? `Never imported (seed:dev imports it): ${UNAVAILABLE}.`
        : `Never synced or checked: ${UNAVAILABLE}.`,
    });
  } else {
    if (!matcherLoaded) {
      states.push(KEYS_UNKNOWN);
    } else if (!source['keys-current']) {
      states.push({
        key: 'needs_rekey',
        label: 'Needs re-key',
        tone: 'attention',
        detail:
          'Its stored keys are not this matcher version’s: reports selecting it error matcher_data_unavailable until watchlists:rekey (or its next sync) re-keys it.',
      });
    }
    if (source['sandbox-only']) {
      states.push(
        environmentKind === 'sandbox'
          ? {
              key: 'sandbox',
              label: 'Sandbox list, never stale',
              tone: 'neutral',
              detail:
                'Synthetic and static: never refreshed and never stale, and screened in sandbox environments only.',
            }
          : {
              key: 'sandbox',
              label: 'Sandbox list, not screened here',
              tone: 'neutral',
              detail:
                'Synthetic: screened in sandbox environments only. A production template cannot select it.',
            },
      );
    } else if (source.stale) {
      states.push({
        key: 'stale',
        label: 'Stale',
        tone: 'danger',
        detail: `No successful check within ${limit === null ? 'its limit' : `${String(limit)} h`}: reports selecting it error list_stale. Turn on the refresh job or run watchlists:sync.`,
      });
    } else if (source['keys-current'] || !matcherLoaded) {
      states.push({
        key: 'fresh',
        label: 'Fresh',
        tone: 'success',
        detail: `Checked successfully within its stale limit${limit === null ? '' : ` of ${String(limit)} h`}; a template’s max-list-age-hours may ask for less.`,
      });
    }
  }
  if (source['rescreen-pending']) {
    states.push({
      key: 'rescreen_pending',
      label: 'Re-screen pending',
      tone: 'progress',
      detail:
        'A sync added or changed entries, and the re-screen of recurring reports has not finished.',
    });
  }
  return states;
}

export interface MediaBudget {
  readonly runsPerDay: number;
  readonly budgetPerDay: number;
  readonly share: number;
  readonly warn: boolean;
}

/**
 * C81.2 (V09), owner decision 18 after 6B (R004): this environment's own scheduled media runs per
 * day against the install's GDELT budget, and the install's flag above 80% of it. The API serves
 * no other tenant's total, so the share is this environment's.
 */
export function mediaBudget(media: DashboardWatchlistSources['media']): MediaBudget {
  const runsPerDay = media['environment-scheduled-runs-per-day'];
  return {
    runsPerDay,
    budgetPerDay: media['install-budget-per-day'],
    share: runsPerDay / media['install-budget-per-day'],
    warn: media['install-above-warn-share'],
  };
}

const PERCENT = new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 2 });

/** A share as a percentage; a share too small to round to 0.01% still reads as one. */
export function formatShare(share: number): string {
  if (share > 0 && share < 0.0001) {
    return 'under 0.01%';
  }
  return PERCENT.format(share);
}
