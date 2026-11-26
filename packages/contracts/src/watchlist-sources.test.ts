/** C72.3, C73.3, C76: the watchlist sources page and the sync vocabulary. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readFixture } from './test-support.js';
import {
  GDELT_INSTALL_BUDGET,
  WATCHLIST_ORIGINS,
  WATCHLIST_RESCREEN_STATES,
  WATCHLIST_SOURCE_ERROR_CODES,
  WATCHLIST_SYNC_ACTORS,
  WATCHLIST_SYNC_OUTCOMES,
  WATCHLIST_SYNC_OVERRIDES,
  dashboardWatchlistSourcesSchema,
} from './watchlist-sources.js';

describe('the sync vocabulary (C73.3, C76.2)', () => {
  it('records every sync outcome, actor, origin, override and re-screen state', () => {
    expect(WATCHLIST_SYNC_OUTCOMES).toEqual([
      'applied',
      'unchanged',
      'rekeyed',
      'busy',
      'refused_rollback',
      'refused_future',
      'refused_mass_removal',
      'refused_schema',
      'refused_size',
      'refused_matcher_data',
      'error',
    ]);
    expect(WATCHLIST_SYNC_ACTORS).toEqual(['cli', 'job', 'seed']);
    expect(WATCHLIST_ORIGINS).toEqual(['publisher', 'import']);
    expect(WATCHLIST_SYNC_OVERRIDES).toEqual([
      'allow-mass-removal',
      'accept-older-publication',
      'allow-normalised',
    ]);
    expect(WATCHLIST_RESCREEN_STATES).toEqual(['none', 'pending', 'done']);
    expect(WATCHLIST_SOURCE_ERROR_CODES).toContain('source_not_configured');
  });

  it('shares GDELT out at 17,280 requests a day, warning above 80% (C81.2, V09)', () => {
    expect(GDELT_INSTALL_BUDGET).toEqual({ requestsPerDay: 17280, warnAboveShare: 0.8 });
  });
});

describe('GET /dashboard/watchlist-sources (C72.3)', () => {
  it('dashboard-watchlist-sources.json parses and re-serializes unchanged', () => {
    const raw = readFixture('api/dashboard-watchlist-sources.json');
    const parsed = dashboardWatchlistSourcesSchema.parse(raw);
    expect(parsed).toEqual(raw);
    expect(z.encode(dashboardWatchlistSourcesSchema, parsed)).toEqual(raw);
  });

  it('shows a source that never synced as not configured, with no check or digest', () => {
    const raw = readFixture('api/dashboard-watchlist-sources.json') as {
      sources: Record<string, unknown>[];
    };
    expect(raw.sources.find((source) => source.id === 'eu-fsf')).toMatchObject({
      enabled: true,
      configured: false,
      'last-checked-at': null,
      'last-sha256': null,
      'last-error-code': 'source_not_configured',
    });
    const malformed = structuredClone(raw);
    if (malformed.sources[0] !== undefined) {
      malformed.sources[0]['last-sha256'] = 'not-a-digest';
    }
    expect(dashboardWatchlistSourcesSchema.safeParse(malformed).success).toBe(false);
  });
});

describe('the media, matcher and template-warning members (owner decisions 17 and 18 after 6B)', () => {
  const fixture = () =>
    readFixture('api/dashboard-watchlist-sources.json') as Record<string, unknown> & {
      media: Record<string, unknown>;
      matcher: Record<string, unknown>;
      'template-warnings': Record<string, unknown>[];
    };

  it('serves the asking environment’s own scheduled media runs, the budget, whether the install is above 80% of it and the GDELT citation, never the install’s total (R004)', () => {
    const document: Record<string, unknown> = dashboardWatchlistSourcesSchema.parse(fixture());
    expect(document.media).toEqual({
      'environment-scheduled-runs-per-day': 12.5,
      'install-budget-per-day': GDELT_INSTALL_BUDGET.requestsPerDay,
      'warn-above-share': GDELT_INSTALL_BUDGET.warnAboveShare,
      'install-above-warn-share': false,
      attribution: expect.stringContaining('https://www.gdeltproject.org/') as unknown,
    });
    const withTotal = fixture();
    withTotal.media['scheduled-runs-per-day'] = 13_000;
    expect(dashboardWatchlistSourcesSchema.safeParse(withTotal).success).toBe(false);
    const withoutWarning = fixture();
    delete withoutWarning.media['install-above-warn-share'];
    expect(dashboardWatchlistSourcesSchema.safeParse(withoutWarning).success).toBe(false);
  });

  it('says whether this process holds the matcher data, with its keys version only when it does', () => {
    const document: Record<string, unknown> = dashboardWatchlistSourcesSchema.parse(fixture());
    expect(document.matcher).toEqual({
      loaded: true,
      'keys-version': expect.stringMatching(/^names-\d+;/u) as unknown,
    });
    const missing = fixture();
    missing.matcher = { loaded: false, 'keys-version': null };
    expect(dashboardWatchlistSourcesSchema.safeParse(missing).success).toBe(true);
    for (const matcher of [
      { loaded: false, 'keys-version': 'names-2' },
      { loaded: true, 'keys-version': null },
    ]) {
      const inconsistent = fixture();
      inconsistent.matcher = matcher;
      expect(dashboardWatchlistSourcesSchema.safeParse(inconsistent).success).toBe(false);
    }
  });

  it('names each warned template and its report type', () => {
    const document: Record<string, unknown> = dashboardWatchlistSourcesSchema.parse(fixture());
    expect(document['template-warnings']).toEqual([
      expect.objectContaining({ name: 'Default watchlist', 'report-type': 'watchlist' }),
    ]);
    const unnamed = fixture();
    delete unnamed['template-warnings'][0]?.name;
    expect(dashboardWatchlistSourcesSchema.safeParse(unnamed).success).toBe(false);
  });
});
