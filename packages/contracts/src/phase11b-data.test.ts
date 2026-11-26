/**
 * Phase 11, Workflow 11B Stage 1a, checkpoint (D) (C253, C254): the access export's resource, routes
 * and manifest (`openverify.account-export.v1`, with its JSON Schema committed beside the contracts),
 * the validation attributes of the watchlist sources page, and the frozen shape of the UN list's
 * opt-in. Read through the package root, so a name that does not exist yet fails here at run time.
 *
 * The JSON Schema file is an exported fixture (rule 28): this test is assert-only, compares the
 * committed file with what the schema produces, and writes it only under
 * `UPDATE_CONTRACT_FIXTURES=1`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contracts from './index.js';
import { FIXTURES_DIR, listFixtures, readFixture } from './test-support.js';

const pick = (name: string): unknown => (contracts as Readonly<Record<string, unknown>>)[name];
const schema = (name: string): z.ZodType => {
  const found = pick(name);
  if (!(found instanceof z.ZodType)) {
    throw new TypeError(`${name} is not exported as a schema`);
  }
  return found;
};
const roundTrip = (name: string, raw: unknown) => {
  const parsed = schema(name).parse(raw);
  expect(parsed).toEqual(raw);
  expect(z.encode(schema(name), parsed)).toEqual(raw);
};

const STATUSES = ['pending', 'ready', 'failed', 'expired'] as const;

describe('the account-export resource (C253.1)', () => {
  it('holds one golden per status and the manifest, in a folder Android does not read', () => {
    expect(listFixtures('api/account-exports')).toEqual(
      [...STATUSES.map((status) => `account-export-${status}.json`), 'manifest.json'].sort(),
    );
    expect(pick('ACCOUNT_EXPORT_STATUSES')).toEqual(STATUSES);
  });

  it.each(STATUSES)(
    'serves a %s export with its times and counts, and no personal data',
    (status) => {
      const raw = readFixture(`api/account-exports/account-export-${status}.json`) as {
        data: { attributes: Record<string, unknown>; relationships: unknown };
      };
      roundTrip('accountExportDocumentSchema', raw);
      expect(raw.data.attributes.status).toBe(status);
      expect(Object.keys(raw.data.attributes).sort()).toEqual(
        [
          'status',
          'schema-version',
          'created-at',
          'ready-at',
          'expires-at',
          'item-count',
          'byte-count',
          'error-code',
        ].sort(),
      );
      expect(raw.data.relationships).toEqual({
        account: { data: { type: 'account', id: 'acc_01M5CJXJF84MR3PHJHBHKQ4ZC8' } },
      });
    },
  );

  it('keeps each status to the members it can have', () => {
    const raw = readFixture('api/account-exports/account-export-ready.json') as {
      data: { attributes: Record<string, unknown> };
    };
    const withAttributes = (changes: Record<string, unknown>) => ({
      data: { ...raw.data, attributes: { ...raw.data.attributes, ...changes } },
    });
    const document = schema('accountExportDocumentSchema');
    expect(document.safeParse(withAttributes({ 'ready-at': null })).success).toBe(false);
    expect(
      document.safeParse(withAttributes({ 'error-code': 'account_export_pending' })).success,
    ).toBe(false);
    expect(document.safeParse(withAttributes({ status: 'pending' })).success).toBe(false);
    expect(document.safeParse(withAttributes({ 'item-count': 5001 })).success).toBe(false);
  });

  it('takes an empty create body and the export and file params', () => {
    expect(schema('createAccountExportBodySchema').safeParse({}).success).toBe(true);
    expect(schema('createAccountExportBodySchema').safeParse({ files: true }).success).toBe(false);
    expect(
      schema('accountExportParamsSchema').safeParse({ id: 'aexp_01M5CN0000000000000011B100' })
        .success,
    ).toBe(true);
    const file = schema('accountExportFileParamsSchema');
    for (const fileId of ['file_01M5CK17N82ZP0PQ8RZRRTT5V5', 'txnf_01M5CN0000000000000011B300']) {
      expect(file.safeParse({ id: 'aexp_01M5CN0000000000000011B100', fileId }).success).toBe(true);
    }
    expect(
      file.safeParse({
        id: 'aexp_01M5CN0000000000000011B100',
        fileId: 'catt_01M5CN0000000000000011B300',
      }).success,
    ).toBe(false);
  });
});

describe('the manifest openverify.account-export.v1 (C253.2, C253.3)', () => {
  const manifest = () =>
    readFixture('api/account-exports/manifest.json') as Record<string, unknown>;

  it('parses the golden manifest, kebab-case, with its two parts', () => {
    roundTrip('accountExportManifestSchema', manifest());
    expect(pick('ACCOUNT_EXPORT_SCHEMA_VERSION')).toBe('openverify.account-export.v1');
    expect(Object.keys(manifest()).sort()).toEqual(
      [
        'schema',
        'export-id',
        'environment-id',
        'account-id',
        'generated-at',
        'item-count',
        'subject',
        'operator-review',
        'files',
        'not-covered',
      ].sort(),
    );
  });

  it('labels the operator-review part "review before disclosure"', () => {
    const review = manifest()['operator-review'] as Record<string, unknown>;
    expect(review.label).toBe('review before disclosure');
    expect(Object.keys(review).sort()).toEqual(
      ['label', 'cases', 'list-memberships', 'signals', 'integrity-verdicts'].sort(),
    );
  });

  it('lists face templates as present with their count, never their numbers', () => {
    const subject = manifest().subject as Record<string, unknown>;
    expect(subject['face-templates']).toEqual({ present: true, count: 2 });
    expect(
      schema('accountExportManifestSchema').safeParse({
        ...manifest(),
        subject: { ...subject, 'face-templates': { present: true, count: 2, vectors: [[0.1]] } },
      }).success,
    ).toBe(false);
  });

  it('names each recipient of a share as the subject was shown it, and no counterparty user', () => {
    const shares = (manifest().subject as { 'connect-shares': Record<string, unknown>[] })[
      'connect-shares'
    ];
    expect(shares[0]).toMatchObject({
      direction: 'outbound',
      recipient: {
        'organization-id': expect.stringMatching(/^org_/) as unknown,
        'organization-name': 'Example Partner',
      },
    });
    const withUser = { ...shares[0], 'redeemed-by': 'usr_01M5CJXHG03PHEQZPRWAH2RXM5' };
    expect(schema('accountExportShareSchema').safeParse(withUser).success).toBe(false);
  });

  it('describes each file by kind, size and SHA-256, and states what is not covered', () => {
    const files = manifest().files as Record<string, unknown>[];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(Object.keys(file).sort()).toEqual(
        ['id', 'kind', 'media-type', 'size', 'sha256', 'belongs-to'].sort(),
      );
    }
    expect(pick('ACCOUNT_EXPORT_NOT_COVERED')).toEqual([
      'api-logs',
      'webhook-deliveries',
      'event-payloads',
      'backups',
      'outside-install',
      'face-templates',
    ]);
    expect((manifest()['not-covered'] as { kind: string }[]).map(({ kind }) => kind)).toEqual(
      pick('ACCOUNT_EXPORT_NOT_COVERED'),
    );
  });

  it('commits the JSON Schema the zod schema produces (assert-only; rule 28)', () => {
    const file = path.join(FIXTURES_DIR, '../schemas/openverify.account-export.v1.schema.json');
    const produced = {
      $id: 'https://openverify.dev/schemas/openverify.account-export.v1.schema.json',
      ...z.toJSONSchema(schema('accountExportManifestSchema'), { io: 'output' }),
    };
    if (process.env.UPDATE_CONTRACT_FIXTURES === '1') {
      // Prettier formats the written file afterwards; the comparison below is by value.
      writeFileSync(file, `${JSON.stringify(produced, null, 2)}\n`);
    }
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(produced);
  });
});

describe('the watchlist sources page and conditional requests (C254.2)', () => {
  it('serves the last validation, how it was made and the last full check per source', () => {
    const source = schema('watchlistSourceStatusSchema');
    const base = (
      readFixture('api/dashboard-watchlist-sources.json') as { sources: Record<string, unknown>[] }
    ).sources[0];
    expect(source.safeParse(base).success).toBe(true);
    const conditional = {
      ...base,
      conditional: true,
      'last-validated-at': '2026-11-13T12:00:00.000Z',
      'validated-by': 'http-304',
      'last-full-check-at': '2026-11-13T06:00:00.000Z',
    };
    expect(source.safeParse(conditional).success).toBe(true);
    expect(source.safeParse({ ...conditional, 'validated-by': 'etag' }).success).toBe(false);
    expect(pick('WATCHLIST_VALIDATED_BY')).toEqual(['http-304', 'sha256']);
  });
});

describe('the UN list opt-in (C254.1; Q10 granted 2026-11-21)', () => {
  it('names the one source an environment may opt in to, and the switch that must allow it', () => {
    expect(pick('WATCHLIST_OPT_IN_SOURCES')).toEqual(['un-sc']);
    expect(pick('WATCHLIST_UN_OPT_IN_SWITCH')).toEqual({
      variable: 'OPENVERIFY_WATCHLIST_UN_OPT_IN_ALLOWED',
      default: true,
    });
  });

  it('takes an acknowledgement naming the terms link from the sources document', () => {
    const body = schema('watchlistOptInBodySchema');
    const ok = {
      acknowledgement: {
        'terms-url': 'https://www.un.org/en/about-us/terms-of-use',
        accepted: true,
      },
    };
    expect(body.safeParse(ok).success).toBe(true);
    expect(
      body.safeParse({ acknowledgement: { ...ok.acknowledgement, accepted: false } }).success,
    ).toBe(false);
    expect(body.safeParse({}).success).toBe(false);
    expect(schema('watchlistOptInParamsSchema').safeParse({ sourceId: 'un-sc' }).success).toBe(
      true,
    );
    expect(schema('watchlistOptInParamsSchema').safeParse({ sourceId: 'eu-fsf' }).success).toBe(
      false,
    );
  });

  it('records who accepted which terms, when, and audits both ways', () => {
    roundTrip('watchlistOptInSchema', {
      'source-id': 'un-sc',
      'terms-url': 'https://www.un.org/en/about-us/terms-of-use',
      'accepted-at': '2026-11-13T12:00:00.000Z',
      'accepted-by': 'usr_01M5CJXHG03PHEQZPRWAH2RXM5',
    });
    expect(pick('WATCHLIST_OPT_IN_AUDIT_ACTIONS')).toEqual({
      accepted: 'watchlist-source.opt-in-accepted',
      withdrawn: 'watchlist-source.opt-in-withdrawn',
    });
  });
});
