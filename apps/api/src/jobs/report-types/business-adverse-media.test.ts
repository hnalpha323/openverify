/**
 * C81.3 (H13): the `business-adverse-media` report job. The legal form is stripped before the
 * search (articles rarely carry it), a name that is one generic word once stripped is refused
 * (`insufficient_input` in a run; 422 at creation), and an article matches only with the whole
 * distinctive phrase plus the country or a second distinctive word. Every name is synthetic.
 */
import { businessAdverseMediaReportResourceSchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { createAdverseMediaProvider } from '../../providers/adverse-media/index.js';
import type { AdverseMediaSearch } from '../../ports.js';
import { fixedClock } from '../../test-support/fakes.js';
import { businessAdverseMediaReportJob } from './business-adverse-media.js';
import { mediaQueryProblem } from './media-screening.js';
import type { ReportRunResult, RunOutcome } from './job.js';
import { REPORT_NOW, reportContext, servedReport } from './provider-testing.js';

function completed(outcome: RunOutcome): ReportRunResult {
  if (outcome.kind !== 'completed') {
    throw new Error('the run did not complete');
  }
  return outcome.result;
}

function context(query: Record<string, unknown>) {
  const requests: AdverseMediaSearch[] = [];
  const sandbox = createAdverseMediaProvider('sandbox', { clock: fixedClock(REPORT_NOW) });
  const ctx = reportContext({
    type: 'business-adverse-media',
    query,
    providers: {
      adverseMedia: {
        ...sandbox,
        search: (request: AdverseMediaSearch) => {
          requests.push(request);
          return sandbox.search(request);
        },
      },
    },
  });
  return { ctx, requests };
}

describe('the business-adverse-media report (C81.3, H13)', () => {
  it('searches the name without its legal form, and matches the sandbox’s articles', async () => {
    const { ctx, requests } = context({
      term: 'Sandbox-Media Quarrystone Holdings Ltd',
      'country-code': 'GB',
    });
    const result = completed(await businessAdverseMediaReportJob.run(ctx));

    expect(requests[0]?.nameTokens).toEqual(['sandbox', 'media', 'quarrystone', 'holdings']);
    expect(result.errors).toEqual([]);
    expect(result.matches).toHaveLength(2);
    expect(
      businessAdverseMediaReportResourceSchema.safeParse(servedReport(ctx, result)).success,
    ).toBe(true);
  });

  it('applies the business rule to the sandbox too: one distinctive word needs the country', async () => {
    // "media" and "holdings" are generic: only "sandbox" is distinctive, and the sandbox's
    // articles name no country, so neither is confirmed (no fixture is special-cased).
    const { ctx } = context({ term: 'Sandbox-Media Holdings Ltd', 'country-code': 'GB' });
    const result = completed(await businessAdverseMediaReportJob.run(ctx));

    expect(result.errors).toEqual([]);
    expect(result.matches).toEqual([]);
  });

  it('refuses a name that is one generic word once its legal form is stripped', async () => {
    const { ctx, requests } = context({ term: 'Holdings Ltd' });
    const result = completed(await businessAdverseMediaReportJob.run(ctx));

    expect(result.errors).toEqual([{ code: 'insufficient_input' }]);
    expect(requests).toEqual([]);
  });
});

describe('a media query report creation refuses (C81.2, C81.3)', () => {
  it('names a query that is not the type’s, or has no word left, or one generic word', () => {
    expect(mediaQueryProblem('business', {})).toBe('invalid');
    expect(mediaQueryProblem('business', { term: 'Holdings Ltd' })).toBe('generic');
    expect(mediaQueryProblem('business', { term: 'Ltd' })).toBe('empty');
    expect(mediaQueryProblem('person', { 'email-address': 'kim@old.example' })).toBe('invalid');
    // A person's name must hold a letter (the query schema), so `empty` is a backstop there.
  });

  it('accepts what a run screens', () => {
    expect(mediaQueryProblem('business', { term: 'Quarrystone Holdings Ltd' })).toBeNull();
    expect(mediaQueryProblem('person', { 'name-first': 'Avery', 'name-last': 'Quill' })).toBeNull();
    expect(mediaQueryProblem('person', { term: 'Avery Quill' })).toBeNull();
  });
});
