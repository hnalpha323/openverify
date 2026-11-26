/**
 * C253.2, C253.3, C253.5 (Workflow 11B, `dsar-export`): the access export's manifest,
 * `openverify.account-export.v1`, assembled from what the collector read (`collect.ts`). Pure: no
 * database, no clock, no storage.
 *
 * - `subject` holds the records about the person; `operator-review` the records labelled "review
 *   before disclosure" (cases, list memberships, signals, integrity verdicts; review P16); `files`
 *   one entry per live file; `not-covered` the fixed sentences of C253.3.
 * - The item count (C253.5) is every record of both parts, every Connect share, every file and every
 *   face template counted as present (the golden `contracts/fixtures/api/account-exports/manifest.json`
 *   counts so: 9 subject records and shares, 2 face templates, 1 signal and 2 files are 14). Past
 *   `ACCOUNT_EXPORT_LIMITS.items` the export is refused, never truncated.
 * - A device is listed as present with its times: its fingerprints and class are pseudonymous HMACs
 *   under the install's blind-index key, useless to the person and never exported (ours; as face
 *   templates are listed by count, C253.3).
 */
import {
  ACCOUNT_EXPORT_LIMITS,
  ACCOUNT_EXPORT_NOT_COVERED,
  ACCOUNT_EXPORT_SCHEMA_VERSION,
  accountExportManifestSchema,
  type AccountExportManifest,
} from '@openverify/contracts';
import type { z } from 'zod';
import type { accountExportShareSchema } from '@openverify/contracts';

/** One record as the API serves it with `pii:view`: a JSON:API resource object. */
export interface ExportRecord {
  type: string;
  id: string;
  attributes: Readonly<Record<string, unknown>>;
  relationships?: unknown;
}

export type AccountExportShare = z.infer<typeof accountExportShareSchema>;
export type AccountExportFile = AccountExportManifest['files'][number];

/** What the collector read for one account, in the order the manifest lists it. */
export interface CollectedAccountExport {
  account: ExportRecord;
  inquiries: readonly ExportRecord[];
  inquirySessions: readonly ExportRecord[];
  verifications: readonly ExportRecord[];
  decisions: readonly ExportRecord[];
  reports: readonly ExportRecord[];
  devices: readonly ExportRecord[];
  transactions: readonly ExportRecord[];
  consentRecords: readonly ExportRecord[];
  connectShares: readonly AccountExportShare[];
  /** C253.3: face templates of the subject, counted, never exported. */
  faceTemplateCount: number;
  cases: readonly ExportRecord[];
  listMemberships: readonly ExportRecord[];
  signals: readonly ExportRecord[];
  integrityVerdicts: readonly ExportRecord[];
  files: readonly AccountExportFile[];
}

/** The export's own ids and the time the manifest was cut. */
export interface ManifestHeader {
  exportId: string;
  environmentId: string;
  accountId: string;
  generatedAt: Date;
}

/** C253.3: what the manifest does not hold, each with its fixed sentence. */
export const ACCOUNT_EXPORT_NOT_COVERED_DETAILS: Readonly<
  Record<(typeof ACCOUNT_EXPORT_NOT_COVERED)[number], string>
> = Object.freeze({
  'api-logs': 'API logs are kept for a short time and are not indexed by account.',
  'webhook-deliveries':
    'Webhook deliveries are kept for a short time and are not indexed by account.',
  'event-payloads':
    'Event payloads are not included; after a redaction they hold no personal data.',
  backups: 'Backups keep data until they expire and are not searched.',
  'outside-install':
    "Data held outside this installation, by the organization or by a share's recipient, is not included.",
  'face-templates':
    'Face templates are derived numbers, listed as present with their count and not exported.',
});

/** The device members that are pseudonymous HMACs (C91.2), never exported. */
const DEVICE_HMAC_ATTRIBUTES = [
  'device-fingerprint',
  'browser-fingerprint',
  'device-class',
  'key-id',
] as const;

/** A device resource without its HMACs: present, with its times and the facts the person gave. */
export function exportDeviceRecord(device: ExportRecord): ExportRecord {
  const hidden = new Set<string>(DEVICE_HMAC_ATTRIBUTES);
  const attributes = Object.fromEntries(
    Object.entries(device.attributes).filter(([name]) => !hidden.has(name)),
  );
  return { type: device.type, id: device.id, attributes };
}

/** C253.5: the items the manifest lists (see the header for the rule). */
export function manifestItemCount(collected: CollectedAccountExport): number {
  const lists: readonly (readonly unknown[])[] = [
    collected.inquiries,
    collected.inquirySessions,
    collected.verifications,
    collected.decisions,
    collected.reports,
    collected.devices,
    collected.transactions,
    collected.consentRecords,
    collected.connectShares,
    collected.cases,
    collected.listMemberships,
    collected.signals,
    collected.integrityVerdicts,
    collected.files,
  ];
  return 1 + collected.faceTemplateCount + lists.reduce((sum, list) => sum + list.length, 0);
}

/** C253.5: an account past the item limit; its counts, nothing else. */
export class AccountExportTooLargeError extends Error {
  override name = 'AccountExportTooLargeError';
  readonly itemCount: number;
  readonly itemLimit = ACCOUNT_EXPORT_LIMITS.items;

  constructor(itemCount: number) {
    super(`The account holds ${String(itemCount)} items; one export lists at most 5,000.`);
    this.itemCount = itemCount;
  }
}

/** @throws {AccountExportTooLargeError} past `ACCOUNT_EXPORT_LIMITS.items`. */
export function assertWithinItemLimit(itemCount: number): void {
  if (itemCount > ACCOUNT_EXPORT_LIMITS.items) {
    throw new AccountExportTooLargeError(itemCount);
  }
}

const records = (list: readonly ExportRecord[]) =>
  list.map((record) => ({ ...record, attributes: { ...record.attributes } }));

/**
 * The manifest of one account, checked against `accountExportManifestSchema`.
 * @throws {AccountExportTooLargeError} past the item limit.
 */
export function buildAccountExportManifest(
  collected: CollectedAccountExport,
  header: ManifestHeader,
): AccountExportManifest {
  const itemCount = manifestItemCount(collected);
  assertWithinItemLimit(itemCount);
  return accountExportManifestSchema.parse({
    schema: ACCOUNT_EXPORT_SCHEMA_VERSION,
    'export-id': header.exportId,
    'environment-id': header.environmentId,
    'account-id': header.accountId,
    'generated-at': header.generatedAt.toISOString(),
    'item-count': itemCount,
    subject: {
      account: { ...collected.account, attributes: { ...collected.account.attributes } },
      inquiries: records(collected.inquiries),
      'inquiry-sessions': records(collected.inquirySessions),
      verifications: records(collected.verifications),
      decisions: records(collected.decisions),
      reports: records(collected.reports),
      devices: records(collected.devices.map(exportDeviceRecord)),
      transactions: records(collected.transactions),
      'consent-records': records(collected.consentRecords),
      'connect-shares': collected.connectShares.map((share) => ({ ...share })),
      'face-templates': {
        present: collected.faceTemplateCount > 0,
        count: collected.faceTemplateCount,
      },
    },
    'operator-review': {
      label: 'review before disclosure',
      cases: records(collected.cases),
      'list-memberships': records(collected.listMemberships),
      signals: records(collected.signals),
      'integrity-verdicts': records(collected.integrityVerdicts),
    },
    files: collected.files.map((file) => ({ ...file })),
    'not-covered': ACCOUNT_EXPORT_NOT_COVERED.map((kind) => ({
      kind,
      detail: ACCOUNT_EXPORT_NOT_COVERED_DETAILS[kind],
    })),
  });
}

/** The ids the manifest lists: what a redaction or retention deletion is matched against (C253.4). */
export function manifestItemIds(manifest: AccountExportManifest): string[] {
  const { subject } = manifest;
  const review = manifest['operator-review'];
  const ids = new Set<string>([manifest['account-id']]);
  for (const list of [
    subject.inquiries,
    subject['inquiry-sessions'],
    subject.verifications,
    subject.decisions,
    subject.reports,
    subject.devices,
    subject.transactions,
    subject['consent-records'],
    review.cases,
    review['list-memberships'],
    review.signals,
    review['integrity-verdicts'],
  ]) {
    for (const record of list) {
      ids.add(record.id);
    }
  }
  for (const share of subject['connect-shares']) {
    ids.add(share['share-token-id']);
  }
  for (const file of manifest.files) {
    ids.add(file.id);
  }
  return [...ids].sort();
}
