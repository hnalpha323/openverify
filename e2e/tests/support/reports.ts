/**
 * Phase 6 spec helpers (C69-C89): the seeded report templates (C71.3), reports read through
 * `@openverify/node` with the seeded sandbox key, waits on a report's runs, and the synthetic
 * sandbox values of `@openverify/watchlist/testing` (C82.4, C89.1), read back from the committed
 * fixtures so a spec never names a value the lists do not hold. Every value is fictional.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReportType } from '@openverify/contracts';
import type { OpenVerifyClient } from '@openverify/node';
import { expect } from '@playwright/test';
import { REPO_ROOT } from '../../src/paths.js';

type Reports = OpenVerifyClient['reports'];
export type ReportData = Awaited<ReturnType<Reports['retrieve']>>['data'];
export type ReportAttributes = ReportData['attributes'] & Record<string, unknown>;

/** The committed synthetic lists (`packages/watchlist/fixtures/`, plan C77.5). */
export const WATCHLIST_FIXTURES = path.join(REPO_ROOT, 'packages', 'watchlist', 'fixtures');

/** A committed fixture file's path. */
export function watchlistFixture(name: string): string {
  return path.join(WATCHLIST_FIXTURES, name);
}

/**
 * The sandbox magic of `SANDBOX_WATCHLIST_MAGIC` and `SANDBOX_PEP_MAGIC`
 * (`packages/watchlist/src/testing/sandbox.ts`) a spec screens, each with the public query that
 * finds it. {@link assertInFixture} reads each back from the committed list.
 */
export const SANDBOX_LISTS = {
  listedPerson: {
    entryId: 'SBX-1001',
    query: {
      'name-first': 'Avery',
      'name-middle': 'Sandbox',
      'name-last': 'Quillfeather',
      birthdate: '1980-04-12',
    },
  },
  monitoredPerson: {
    entryId: 'SBX-1002',
    // No birth date: version 3 changes it, and the run must still find the entry (C89.2).
    query: { 'name-first': 'Rowan', 'name-last': 'Fixturedale' },
  },
  business: {
    entryId: 'SBX-2001',
    query: { term: 'Sandbox Sanctioned Holdings Ltd', lei: '5299000SANDBOXLEI047' },
  },
  otherListsEntity: {
    // K19: listed only on the Sectoral Sanctions Identifications List, a list other than the SDN List.
    entryId: 'SBX-2003',
    query: { term: 'Corvanel Sectoral Ironworks' },
  },
  cryptoParty: {
    entryId: 'SBX-2002',
    // The EIP-55 example address (a published test vector, not a real party's wallet).
    query: { 'crypto-address': '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' },
  },
  headOfGovernment: {
    entryId: 'Q-test-1001',
    query: { 'name-first': 'Marlowe', 'name-last': 'Testerton', birthdate: '1968-03-14' },
  },
} as const;

interface ImportFile {
  source: string;
  entries: { entry_id: string; names: { full: string }[] }[];
}

/** Fails unless `file` (a committed normalised list) holds `entryId`. */
export async function assertInFixture(file: string, entryId: string): Promise<void> {
  const list = JSON.parse(await readFile(watchlistFixture(file), 'utf8')) as ImportFile;
  expect(
    list.entries.map((entry) => entry.entry_id),
    `${file} holds ${entryId}`,
  ).toContain(entryId);
}

/** The seeded `Default <type>` template of the key's environment (C71.3). */
export async function seededTemplateId(
  client: OpenVerifyClient,
  type: ReportType,
): Promise<string> {
  const { data } = await client.reportTemplates.list({
    filter: { 'report-type': type, status: 'active' },
    page: { size: 100 },
  });
  // Seeded names capitalise acronyms ("Default IP address", Workflow 7A), so compare without case.
  const name = `Default ${type.replaceAll('-', ' ')}`;
  const template = data.find(
    (candidate) => candidate.attributes.name.toLowerCase() === name.toLowerCase(),
  );
  if (template === undefined) {
    throw new Error(`seed:dev created no "${name}" template in this environment`);
  }
  return template.id;
}

/** The report's attributes, typed loosely for the per-type members. */
export function attributesOf(report: ReportData): ReportAttributes {
  return report.attributes;
}

/**
 * Waits until `done` holds for the report (by default: its latest run completed, so the status is
 * `ready` or `errored`), and returns it.
 */
export async function waitForReport(
  client: OpenVerifyClient,
  id: string,
  done: (report: ReportData) => boolean = (report) => report.attributes.status !== 'pending',
  timeoutMs = 60_000,
): Promise<ReportData> {
  let latest: ReportData | undefined;
  await expect
    .poll(
      async () => {
        latest = (await client.reports.retrieve(id)).data;
        return done(latest);
      },
      { timeout: timeoutMs, intervals: [500, 1000] },
    )
    .toBe(true);
  if (latest === undefined) {
    throw new Error(`Report ${id} was never read`);
  }
  return latest;
}

export type HistoryEntry = Awaited<ReturnType<Reports['history']>>['data'][number];

/** Every run and action of the report, newest first (C74.2). */
export async function historyOf(client: OpenVerifyClient, id: string): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = [];
  for await (const entry of client.reports.historyAll(id, { page: { size: 100 } })) {
    entries.push(entry);
  }
  return entries;
}

/** The runs of a history, newest first. */
export function runsOf(
  history: readonly HistoryEntry[],
): (HistoryEntry & { type: 'report-run' })[] {
  return history.filter(
    (entry): entry is HistoryEntry & { type: 'report-run' } => entry.type === 'report-run',
  );
}

/** Waits until the report holds `count` completed runs, and returns its history. */
export async function waitForCompletedRuns(
  client: OpenVerifyClient,
  id: string,
  count: number,
  timeoutMs = 60_000,
): Promise<HistoryEntry[]> {
  let history: HistoryEntry[] = [];
  await expect
    .poll(
      async () => {
        history = await historyOf(client, id);
        return runsOf(history).filter((run) => ['ready', 'errored'].includes(run.attributes.status))
          .length;
      },
      { timeout: timeoutMs, intervals: [500, 1000] },
    )
    .toBeGreaterThanOrEqual(count);
  return history;
}
