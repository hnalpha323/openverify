/**
 * C253.2, C253.3, C253.5 (Workflow 11B, `dsar-export`): the manifest assembled from what the
 * collector read, held to the golden `contracts/fixtures/api/account-exports/manifest.json` and to
 * the item limit. Synthetic values only.
 */
import { readFileSync } from 'node:fs';
import {
  ACCOUNT_EXPORT_LIMITS,
  accountExportManifestSchema,
  type AccountExportManifest,
} from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  AccountExportTooLargeError,
  assertWithinItemLimit,
  buildAccountExportManifest,
  exportDeviceRecord,
  manifestItemCount,
  manifestItemIds,
  type CollectedAccountExport,
} from './manifest.js';

const GOLDEN = accountExportManifestSchema.parse(
  JSON.parse(
    readFileSync(
      new URL(
        '../../../../../contracts/fixtures/api/account-exports/manifest.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);

/** What a collector reading the golden's account would have answered. */
function collectedOf(manifest: AccountExportManifest): CollectedAccountExport {
  const { subject } = manifest;
  const review = manifest['operator-review'];
  return {
    account: subject.account,
    inquiries: subject.inquiries,
    inquirySessions: subject['inquiry-sessions'],
    verifications: subject.verifications,
    decisions: subject.decisions,
    reports: subject.reports,
    devices: subject.devices,
    transactions: subject.transactions,
    consentRecords: subject['consent-records'],
    connectShares: subject['connect-shares'],
    faceTemplateCount: subject['face-templates'].count,
    cases: review.cases,
    listMemberships: review['list-memberships'],
    signals: review.signals,
    integrityVerdicts: review['integrity-verdicts'],
    files: manifest.files,
  };
}

const HEADER = {
  exportId: GOLDEN['export-id'],
  environmentId: GOLDEN['environment-id'],
  accountId: GOLDEN['account-id'],
  generatedAt: new Date(GOLDEN['generated-at']),
};

describe('buildAccountExportManifest (C253.2)', () => {
  it('assembles the golden manifest from what the collector read', () => {
    expect(buildAccountExportManifest(collectedOf(GOLDEN), HEADER)).toEqual(GOLDEN);
  });

  it('counts every record, share, file and face template, and the account (C253.5)', () => {
    expect(manifestItemCount(collectedOf(GOLDEN))).toBe(14);
    expect(
      manifestItemCount({
        ...collectedOf(GOLDEN),
        faceTemplateCount: 0,
        files: [],
        signals: [],
        connectShares: [],
      }),
    ).toBe(8);
  });

  it('states the six not-covered kinds of C253.3 in their order, each with its sentence', () => {
    const manifest = buildAccountExportManifest(collectedOf(GOLDEN), HEADER);
    expect(manifest['not-covered'].map(({ kind }) => kind)).toEqual([
      'api-logs',
      'webhook-deliveries',
      'event-payloads',
      'backups',
      'outside-install',
      'face-templates',
    ]);
    expect(manifest['not-covered'].every(({ detail }) => detail.length > 20)).toBe(true);
  });

  it('labels the operator part "review before disclosure" (review P16)', () => {
    const manifest = buildAccountExportManifest(collectedOf(GOLDEN), HEADER);
    expect(manifest['operator-review'].label).toBe('review before disclosure');
  });

  it('lists no face template when the subject has none', () => {
    const manifest = buildAccountExportManifest(
      { ...collectedOf(GOLDEN), faceTemplateCount: 0 },
      HEADER,
    );
    expect(manifest.subject['face-templates']).toEqual({ present: false, count: 0 });
    expect(manifest['item-count']).toBe(12);
  });

  it('refuses an account past the limit with its counts, never truncating (C253.5)', () => {
    const many = Array.from({ length: ACCOUNT_EXPORT_LIMITS.items }, (_, index) => ({
      type: 'inquiry',
      id: `inq_${String(index)}`,
      attributes: {},
    }));
    const build = () =>
      buildAccountExportManifest({ ...collectedOf(GOLDEN), inquiries: many }, HEADER);
    expect(build).toThrow(AccountExportTooLargeError);
    try {
      build();
    } catch (error) {
      expect(error).toMatchObject({ itemCount: 5013, itemLimit: 5000 });
    }
    expect(() => {
      assertWithinItemLimit(5000);
    }).not.toThrow();
    expect(() => {
      assertWithinItemLimit(5001);
    }).toThrow(AccountExportTooLargeError);
  });
});

describe('exportDeviceRecord', () => {
  it('drops the pseudonymous HMACs and keeps the times (ours, as face templates are counted)', () => {
    const device = {
      type: 'device',
      id: 'dev_01M5CN0000000000000011B600',
      attributes: {
        'device-fingerprint': 'a'.repeat(64),
        'browser-fingerprint': 'b'.repeat(64),
        'device-class': 'c'.repeat(64),
        'key-id': 'bik_synthetic',
        platform: 'web',
        'first-seen-at': '2026-10-20T12:00:00.000Z',
        'last-seen-at': '2026-10-21T12:00:00.000Z',
      },
    };
    expect(exportDeviceRecord(device)).toEqual({
      type: 'device',
      id: device.id,
      attributes: {
        platform: 'web',
        'first-seen-at': '2026-10-20T12:00:00.000Z',
        'last-seen-at': '2026-10-21T12:00:00.000Z',
      },
    });
    expect(JSON.stringify(exportDeviceRecord(device))).not.toMatch(/a{64}|b{64}|c{64}/);
  });
});

describe('manifestItemIds (C253.4)', () => {
  it('lists the account and every record, share and file id once, sorted', () => {
    const ids = manifestItemIds(GOLDEN);
    expect(ids).toContain(GOLDEN['account-id']);
    expect(ids).toContain('cnst_01M5CN0000000000000011A200');
    expect(ids).toContain('file_01M5CK17N82ZP0PQ8RZRRTT5V5');
    expect(ids).toContain('ver_01M5CK16P0D13FXHZSS4TCFBVH');
    expect(ids).toEqual([...new Set(ids)].sort());
    // The signal record is keyed by its inquiry, so it adds no id of its own.
    expect(ids).toHaveLength(11);
  });
});
