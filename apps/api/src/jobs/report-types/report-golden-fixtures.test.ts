/**
 * C70.2, C82, C81 (Workflow 6A integration): the golden provider-backed reports
 * (`contracts/fixtures/api/report-{email-address,phone-number,address-lookup,adverse-media,
 * business-adverse-media}.json`) carry what the API serves for their stated synthetic query in a
 * sandbox environment: each job's result over the sandbox providers, served by the framework's own
 * resource builder. The dashboard, `@openverify/node` and Android decode these files, so a changed
 * evaluator or job fails here first (the Phase 5 pattern of P008 and P025). Ids and times are the
 * fixture's own.
 *
 * Regenerate after a deliberate change with
 * `OPENVERIFY_WRITE_REPORT_FIXTURES=1 pnpm --filter @openverify/api exec vitest run
 * src/jobs/report-types/report-golden-fixtures.test.ts`, then
 * `pnpm exec prettier --write contracts/fixtures/api`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { DisposableDomainList } from '@openverify/checks';
import { reportResourceSchema } from '@openverify/contracts';
import type { ReportType } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { createAddressVerificationProvider } from '../../providers/address-verification/index.js';
import { createAdverseMediaProvider } from '../../providers/adverse-media/index.js';
import { createSandboxDomainAgeProvider } from '../../providers/domain-age/sandbox.js';
import { createEmailIntelligenceProvider } from '../../providers/email-intelligence/index.js';
import { createPhoneIntelligenceProvider } from '../../providers/phone-intelligence/index.js';
import type { BoundProviders } from '../../ports.js';
import { fixedClock } from '../../test-support/fakes.js';
import { addressLookupReportJob } from './address-lookup.js';
import { adverseMediaReportJob } from './adverse-media.js';
import { businessAdverseMediaReportJob } from './business-adverse-media.js';
import { createEmailAddressReportJob } from './email-address.js';
import type { ReportTypeJob } from './job.js';
import { phoneNumberReportJob } from './phone-number.js';
import { REPORT_NOW, reportContext, servedReport } from './provider-testing.js';

const WRITE = process.env.OPENVERIFY_WRITE_REPORT_FIXTURES === '1';
const clock = fixedClock(REPORT_NOW);
/** A synthetic disposable list: the golden address's domain is not on it. */
const LIST: DisposableDomainList = {
  domains: new Set(['throwaway-mail.example']),
  source: { id: 'disposable-email-domains@test', sha256: 'a'.repeat(64) },
};

/** What a golden report states that its run decides; the rest (ids, times, links) is its own. */
const DECIDED = [
  'has-match',
  'errors',
  'unavailable-fields',
  'coverage',
  'provider',
  'thresholds',
  'notices',
] as const;
/** The shared attributes a run does not decide (C70.2). */
const NOT_DECIDED = new Set([
  'status',
  'created-at',
  'completed-at',
  'redacted-at',
  'report-template-version-name',
  'is-continuous',
  'is-recurring',
  'tags',
  'query',
  'origin',
  'next-run-at',
  'paused-at',
  'paused-reason',
  'sources',
  'query-sources',
  'matcher-version',
  ...DECIDED,
]);
/** Per-row members that name a row or a run, not what the run found. */
const ROW_IDS = new Set(['id', 'match-id', 'first-run', 'last-run', 'created-at', 'updated-at']);

function withoutIds(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(withoutIds);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, member]) =>
        ROW_IDS.has(key) ? [] : [[key, withoutIds(member)]],
      ),
    );
  }
  return value;
}

/** The members of a report's attributes its run decides, without row ids. */
function decided(attributes: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([key]) => !NOT_DECIDED.has(key) || (DECIDED as readonly string[]).includes(key))
      .map(([key, value]) => [key, withoutIds(value)]),
  );
}

interface Golden {
  path: URL;
  document: { data: { attributes: Record<string, unknown> } & Record<string, unknown> };
}

function golden(type: ReportType): Golden {
  const path = new URL(
    `../../../../../contracts/fixtures/api/report-${type}.json`,
    import.meta.url,
  );
  return { path, document: JSON.parse(readFileSync(path, 'utf8')) as Golden['document'] };
}

interface Case {
  type: ReportType;
  job: ReportTypeJob;
  providers: () => BoundProviders;
}

const CASES: readonly Case[] = [
  {
    type: 'email-address',
    job: createEmailAddressReportJob({ loadList: () => Promise.resolve(LIST) }),
    providers: () => ({
      domainAge: createSandboxDomainAgeProvider(clock),
      emailIntelligence: createEmailIntelligenceProvider('sandbox', { clock }),
    }),
  },
  {
    type: 'phone-number',
    job: phoneNumberReportJob,
    providers: () => ({ phoneIntelligence: createPhoneIntelligenceProvider('sandbox', { clock }) }),
  },
  {
    type: 'address-lookup',
    job: addressLookupReportJob,
    providers: () => ({ addressVerification: createAddressVerificationProvider('sandbox') }),
  },
  {
    type: 'adverse-media',
    job: adverseMediaReportJob,
    providers: () => ({ adverseMedia: createAdverseMediaProvider('sandbox', { clock }) }),
  },
  {
    type: 'business-adverse-media',
    job: businessAdverseMediaReportJob,
    providers: () => ({ adverseMedia: createAdverseMediaProvider('sandbox', { clock }) }),
  },
];

describe('the golden provider-backed reports (C70.2, C81, C82)', () => {
  for (const { type, job, providers } of CASES) {
    it(`report-${type}.json is what the API serves for its query in a sandbox environment`, async () => {
      const { path, document } = golden(type);
      const ctx = reportContext({
        type,
        query: document.data.attributes.query as Record<string, unknown>,
        providers: providers(),
      });
      const outcome = await job.run(ctx);
      if (outcome.kind !== 'completed') {
        throw new Error(`the ${type} run did not complete`);
      }
      const served = servedReport(ctx, outcome.result);

      if (WRITE) {
        const attributes: Record<string, unknown> = {
          ...document.data.attributes,
          ...(served.attributes as Record<string, unknown>),
        };
        for (const key of NOT_DECIDED) {
          if (!(DECIDED as readonly string[]).includes(key) && key in document.data.attributes) {
            attributes[key] = document.data.attributes[key];
          }
        }
        attributes.status = served.attributes.status;
        const written = { ...document, data: { ...document.data, attributes } };
        reportResourceSchema.parse(written.data);
        writeFileSync(path, `${JSON.stringify(written, null, 2)}\n`);
        return;
      }
      expect(document.data.attributes.status).toBe(served.attributes.status);
      expect(decided(document.data.attributes)).toEqual(
        decided(served.attributes as Record<string, unknown>),
      );
    });
  }
});
