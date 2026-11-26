// @vitest-environment node
/**
 * C72.3, C76, C86: the sources page's vocabulary in words. The keys are read from the contracts'
 * own lists first, so an outcome, an error code, an override, an actor or an origin added there
 * without words here fails this test.
 */
import {
  GDELT_INSTALL_BUDGET,
  WATCHLIST_ORIGINS,
  WATCHLIST_SOURCE_ERROR_CODES,
  WATCHLIST_SYNC_ACTORS,
  WATCHLIST_SYNC_OUTCOMES,
  WATCHLIST_SYNC_OVERRIDES,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { SOURCE_STATES, watchlistSources } from '../../testing/report-config-fixtures';
import {
  SOURCE_ERROR_WORDS,
  SOURCE_KIND_LABELS,
  SOURCE_ORIGIN_WORDS,
  SYNC_ACTOR_LABELS,
  SYNC_OUTCOME_WORDS,
  SYNC_OVERRIDE_WORDS,
  formatShare,
  mediaBudget,
  sourceStates,
} from './source-words';

const keysOf = (words: object) => Object.keys(words);

describe('the sources vocabulary in words (C73.3, C76)', () => {
  it('words every sync outcome, with a tone and what it means, refusals as refusals', () => {
    expect(keysOf(SYNC_OUTCOME_WORDS)).toEqual([...WATCHLIST_SYNC_OUTCOMES]);
    for (const outcome of WATCHLIST_SYNC_OUTCOMES) {
      expect(SYNC_OUTCOME_WORDS[outcome].label.length).toBeGreaterThan(0);
      expect(SYNC_OUTCOME_WORDS[outcome].meaning.length).toBeGreaterThan(0);
    }
    expect(SYNC_OUTCOME_WORDS.applied.tone).toBe('success');
    for (const refusal of WATCHLIST_SYNC_OUTCOMES.filter((o) => o.startsWith('refused_'))) {
      expect(SYNC_OUTCOME_WORDS[refusal].label).toMatch(/^Refused/);
      expect(SYNC_OUTCOME_WORDS[refusal].tone).toBe('danger');
      expect(SYNC_OUTCOME_WORDS[refusal].meaning).toMatch(/previous data/);
    }
    expect(SYNC_OUTCOME_WORDS.unchanged.meaning).toMatch(/counts as a successful check/);
  });

  it('words every source error code and never shows a code alone', () => {
    expect(keysOf(SOURCE_ERROR_WORDS)).toEqual([...WATCHLIST_SOURCE_ERROR_CODES]);
    for (const code of WATCHLIST_SOURCE_ERROR_CODES) {
      expect(SOURCE_ERROR_WORDS[code]).not.toContain(code);
    }
    expect(SOURCE_ERROR_WORDS.source_not_configured).toMatch(/token or User-Agent/);
    expect(SOURCE_ERROR_WORDS.refused_mass_removal).toMatch(/10%/);
  });

  it('words every audited override with the flag that made it', () => {
    expect(keysOf(SYNC_OVERRIDE_WORDS)).toEqual([...WATCHLIST_SYNC_OVERRIDES]);
    for (const override of WATCHLIST_SYNC_OVERRIDES) {
      expect(SYNC_OVERRIDE_WORDS[override]).toContain(`--${override}`);
    }
  });

  it('words every actor, origin and kind; an import is never cited as the publisher’s (P08)', () => {
    expect(keysOf(SYNC_ACTOR_LABELS)).toEqual([...WATCHLIST_SYNC_ACTORS]);
    expect(keysOf(SOURCE_ORIGIN_WORDS)).toEqual([...WATCHLIST_ORIGINS]);
    expect(SOURCE_ORIGIN_WORDS.import.meaning).toMatch(/never cited as the publisher/);
    expect(keysOf(SOURCE_KIND_LABELS)).toEqual(['sanctions', 'pep']);
  });
});

describe('sourceStates (C69.4, C76.3, C76.4, C78.3)', () => {
  const keys = (source: Parameters<typeof sourceStates>[0]) =>
    sourceStates(source).map((state) => state.key);

  it('reads a source checked within its limit and keyed by this version as fresh', () => {
    expect(keys(SOURCE_STATES.fresh)).toEqual(['fresh']);
    const [state] = sourceStates(SOURCE_STATES.fresh);
    expect(state).toMatchObject({ label: 'Fresh', tone: 'success' });
    expect(state?.detail).toContain('48 h');
  });

  it('reads a stale source as stale, with the error its reports get', () => {
    expect(keys(SOURCE_STATES.stale)).toEqual(['stale']);
    expect(sourceStates(SOURCE_STATES.stale)[0]?.detail).toMatch(/list_stale/);
  });

  it('reads a source without its token as not configured, which errors list_unavailable', () => {
    expect(keys(SOURCE_STATES.notConfigured)).toEqual(['not_configured']);
    expect(sourceStates(SOURCE_STATES.notConfigured)[0]?.detail).toMatch(/list_unavailable/);
  });

  it('reads a source keyed by another version as needing a re-key, and a pending re-screen', () => {
    expect(keys(SOURCE_STATES.needsRekey)).toEqual(['needs_rekey', 'rescreen_pending']);
    expect(sourceStates(SOURCE_STATES.needsRekey)[0]?.detail).toMatch(
      /matcher_data_unavailable.*watchlists:rekey/,
    );
  });

  it('reads a disabled source as disabled only', () => {
    expect(keys(SOURCE_STATES.disabled)).toEqual(['disabled']);
    expect(sourceStates(SOURCE_STATES.disabled)[0]?.detail).toMatch(/list_unavailable/);
  });

  it('reads an enabled source never checked as never checked, never as fresh', () => {
    expect(keys(SOURCE_STATES.neverChecked)).toEqual(['never_checked']);
  });

  it('labels a sandbox list and never calls it stale (V03), whatever the flag says', () => {
    expect(keys(SOURCE_STATES.sandbox)).toEqual(['sandbox']);
    expect(keys({ ...SOURCE_STATES.sandbox, stale: true })).toEqual(['sandbox']);
    expect(sourceStates(SOURCE_STATES.sandbox)[0]?.label).toBe('Sandbox list, never stale');
  });

  it('says a sandbox list is never screened in a production environment (P13, C76.6)', () => {
    const [state] = sourceStates(SOURCE_STATES.sandbox, 'production');

    expect(state).toMatchObject({ key: 'sandbox', label: 'Sandbox list, not screened here' });
    expect(state?.detail).toMatch(/sandbox environments only/);
    expect(sourceStates(SOURCE_STATES.fresh, 'production').map((s) => s.key)).toEqual(['fresh']);
  });

  it('gives every state words and a tone, so nothing is conveyed by colour alone', () => {
    for (const source of watchlistSources().sources) {
      for (const state of [
        ...sourceStates(source),
        ...sourceStates(source, 'sandbox', { matcherLoaded: false }),
      ]) {
        expect(state.label.length).toBeGreaterThan(0);
        expect(state.detail.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('sourceStates when the API holds no variant groups (owner decision 17)', () => {
  const unloaded = (source: Parameters<typeof sourceStates>[0]) =>
    sourceStates(source, 'sandbox', { matcherLoaded: false });
  const keys = (source: Parameters<typeof sourceStates>[0]) =>
    unloaded(source).map((state) => state.key);

  it('says the API has no variant groups instead of asking for a re-key', () => {
    expect(keys(SOURCE_STATES.needsRekey)).toEqual(['keys_unknown', 'fresh', 'rescreen_pending']);
    const [state] = unloaded(SOURCE_STATES.needsRekey);
    expect(state).toMatchObject({ label: 'The API has no variant groups', tone: 'attention' });
    expect(state?.detail).toMatch(/not a re-key/);
    expect(state?.detail).toMatch(/build:variant-groups/);
    expect(unloaded(SOURCE_STATES.needsRekey).map((each) => each.label)).not.toContain(
      'Needs re-key',
    );
  });

  it('still says whether a checked source is fresh or stale, which needs no matcher data', () => {
    expect(keys(SOURCE_STATES.fresh)).toEqual(['keys_unknown', 'fresh']);
    expect(keys(SOURCE_STATES.stale)).toEqual(['keys_unknown', 'stale']);
    expect(keys(SOURCE_STATES.sandbox)).toEqual(['keys_unknown', 'sandbox']);
  });

  it('adds nothing to a source that is disabled, not configured or never checked', () => {
    expect(keys(SOURCE_STATES.disabled)).toEqual(['disabled']);
    expect(keys(SOURCE_STATES.notConfigured)).toEqual(['not_configured']);
    expect(keys(SOURCE_STATES.neverChecked)).toEqual(['never_checked']);
  });
});

describe('mediaBudget (C81.2, V09)', () => {
  const media = (runs: number) => watchlistSources({ scheduledRunsPerDay: runs }).media;

  it('states the share of the install budget the scheduled media runs take', () => {
    expect(mediaBudget(media(12.5))).toEqual({
      runsPerDay: 12.5,
      budgetPerDay: GDELT_INSTALL_BUDGET.requestsPerDay,
      share: 12.5 / 17280,
      warn: false,
    });
  });

  it('warns above 80% only', () => {
    expect(mediaBudget(media(13824)).warn).toBe(false);
    expect(mediaBudget(media(13825)).warn).toBe(true);
  });

  it('takes the share from this environment’s own runs and the warning from the install’s flag, never the other tenants’ total (owner decision 18, R004)', () => {
    const own = (runs: number, installAbove: boolean) =>
      ({
        'environment-scheduled-runs-per-day': runs,
        'install-budget-per-day': GDELT_INSTALL_BUDGET.requestsPerDay,
        'warn-above-share': GDELT_INSTALL_BUDGET.warnAboveShare,
        'install-above-warn-share': installAbove,
        attribution: 'Articles found through the GDELT Project (https://www.gdeltproject.org/).',
      }) as unknown as Parameters<typeof mediaBudget>[0];
    expect(mediaBudget(own(12.5, false))).toEqual({
      runsPerDay: 12.5,
      budgetPerDay: GDELT_INSTALL_BUDGET.requestsPerDay,
      share: 12.5 / 17280,
      warn: false,
    });
    expect(mediaBudget(own(12.5, true))).toEqual({
      runsPerDay: 12.5,
      budgetPerDay: GDELT_INSTALL_BUDGET.requestsPerDay,
      share: 12.5 / 17280,
      warn: true,
    });
  });

  it('builds the fixture document with the environment’s runs and the install flag it derives', () => {
    const media: Record<string, unknown> = watchlistSources({ scheduledRunsPerDay: 15000 }).media;
    expect(media).toMatchObject({
      'environment-scheduled-runs-per-day': 15000,
      'install-above-warn-share': true,
    });
    expect(media).not.toHaveProperty('scheduled-runs-per-day');
  });

  it('formats a share as a percentage, keeping a small one visible', () => {
    expect(formatShare(12.5 / 17280)).toBe('0.07%');
    expect(formatShare(0.81)).toBe('81%');
    expect(formatShare(0)).toBe('0%');
  });

  it('has no attribution line of its own: the page shows the API’s media.attribution (owner decision 17)', async () => {
    expect(Object.keys(await import('./source-words'))).not.toContain('GDELT_ATTRIBUTION');
  });
});
