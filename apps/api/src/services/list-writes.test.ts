/**
 * Workflow 8A Stage 1b (A) (C127.12; F20, V03, outcome 25): `lists.version` moves on every item write,
 * and a monitored custom-list report keeps reading "no match" against an old list unless each move
 * stages `list.updated`. So this file fails a bump that stages nothing, in two parts:
 *
 * - **the guard**, read from the source: every repository function that bumps is in the table below,
 *   and every file that calls one owes a call of `stageListUpdated`, unless it hands what changed to
 *   its callers, who are then held to the same rule;
 * - **the paths**, one behaviour test per write the API runs. The import and the embed job are in
 *   their own suites (`jobs/importers/process.test.ts`, `jobs/lists/embed.test.ts`).
 *
 * The hook is a recording fake here; its behaviour is `api-actions`'. Synthetic values.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIST_KEYS_VERSION } from '@openverify/checks';
import { getList, getListItem, type EnvironmentSettings } from '@openverify/db';
import {
  createTestInquiry,
  seedList,
  seedListItem,
  seedListItemFace,
} from '@openverify/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StagedEvent } from '../events/index.js';
import { bearer } from '../test-support/harness.js';
import {
  createAllowAllRateLimiter,
  createRecordingEventPublisher,
  fixedClock,
} from '../test-support/fakes.js';
import { createInquiryTestApi, type InquiryTestApi } from './inquiries.test-support.js';
import { onSettingsChangedInTx } from './lists/biometric/settings-hook.js';
import { createListService } from './lists/item-writer.js';
import { rebuildListIndexes } from './lists/rebuild.js';
import { runRetention } from './retention.js';

const hook = vi.hoisted(() => vi.fn());
vi.mock('../workflows/actions/lists/list-updated.js', () => ({ stageListUpdated: hook }));

const SOURCE = dirname(fileURLToPath(import.meta.url));
const API_SOURCE = join(SOURCE, '..');
const REPOSITORIES = join(API_SOURCE, '../../../packages/db/src/repositories');

/** The source files under `root`, tests and test support left out. */
function sourcesOf(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (statSync(path).isDirectory()) {
      return name === 'test-support' ? [] : sourcesOf(path);
    }
    return name.endsWith('.ts') && !/\.test\.ts$|\.test-support\.ts$|testing\.ts$/.test(name)
      ? [path]
      : [];
  });
}

/** Each exported function of a file, with its body. */
function exportedFunctions(text: string): { name: string; body: string }[] {
  return [...text.matchAll(/^export (?:async )?function (\w+)/gm)].map((match) => {
    const start = match.index;
    const end = text.indexOf('\n}\n', start);
    return { name: match[1] ?? '', body: text.slice(start, end === -1 ? undefined : end) };
  });
}

/** Whether a file imports `name` from the database package, under whatever alias. */
function importsFromDb(text: string, name: string): boolean {
  return [...text.matchAll(/import \{([^}]*)\} from '@openverify\/db';/g)].some((block) =>
    new RegExp(`\\b${name}\\b`).test(block[1] ?? ''),
  );
}

/** Every exported repository function that moves `lists.version`, and what is owed for it. */
const BUMPS: Readonly<
  Record<string, 'stages' | 'through redactExpiredListItems' | 'a pending item is not matchable yet'>
> = {
  insertListItems: 'stages',
  archiveListItem: 'stages',
  rewriteListItemKeys: 'stages',
  redactListItems: 'through redactExpiredListItems',
  insertBiometricListItem: 'a pending item is not matchable yet',
  completeListItemFace: 'stages',
  completeListItemBackground: 'stages',
  archiveUnavailableBiometricItem: 'stages',
  redactBiometricItems: 'stages',
  redactBiometricLists: 'stages',
  archiveList: 'stages',
};

/**
 * Where a write stops being staged in place: each of these hands what changed to its callers, and the
 * value names what they call. A repository's own caller is covered by this table too.
 */
const HANDED_ON: Readonly<Record<string, string>> = {
  // The `ListItemWriter` port: the import and `ListService.createItem` stage.
  'services/lists/item-writer.ts': '.insertItems(',
  // The `BiometricItemRedactor` port: a redaction's transaction stages.
  'services/lists/biometric/index.ts': '.redactBySource(',
};

const STAGES = /\bstageListUpdated\(|\bafterListItemsRedactedInTx\(/;

describe('the guard: a bump that stages nothing fails here (F20)', () => {
  const apiFiles = sourcesOf(API_SOURCE).map((path) => ({
    path: relative(API_SOURCE, path),
    text: readFileSync(path, 'utf8'),
  }));

  it('knows every repository function that moves a list version', () => {
    const bumping = sourcesOf(REPOSITORIES).flatMap((path) =>
      exportedFunctions(readFileSync(path, 'utf8'))
        .filter(({ body }) => /\bbumpList\(|\btouchList\(|version: sql`\$\{lists\.version\} \+ 1/.test(body))
        .map(({ name }) => name),
    );

    expect(bumping.toSorted()).toEqual(Object.keys(BUMPS).toSorted());
  });

  it.each(Object.entries(BUMPS).filter(([, owed]) => owed === 'stages'))(
    '%s: each caller stages, or hands on what changed',
    (name) => {
      const callers = apiFiles.filter(({ text }) => importsFromDb(text, name));

      expect(callers.length, `nothing calls ${name}`).toBeGreaterThan(0);
      for (const { path, text } of callers) {
        expect(
          STAGES.test(text) || path in HANDED_ON,
          `${path} calls ${name} and stages nothing`,
        ).toBe(true);
      }
    },
  );

  it.each(Object.entries(HANDED_ON))('%s: its callers stage', (_path, call) => {
    const callers = apiFiles.filter(({ text }) => text.includes(call));

    expect(callers.length).toBeGreaterThan(0);
    for (const { path, text } of callers) {
      expect(STAGES.test(text), `${path} calls ${call} and stages nothing`).toBe(true);
    }
  });

  it('redactExpiredListItems is only called with what to do for what it took', () => {
    const callers = apiFiles.filter(({ text }) => importsFromDb(text, 'redactExpiredListItems'));

    expect(callers.map(({ path }) => path)).toEqual(['services/retention.ts']);
    expect(callers[0]?.text).toContain('onRedacted');
  });
});

describe('the paths', () => {
  let api: InquiryTestApi;

  beforeAll(async () => {
    api = await createInquiryTestApi();
  });

  afterAll(async () => {
    await api.close();
  });

  const STAGED: StagedEvent = { eventId: 'evt_synthetic', deliveries: [] };

  beforeEach(() => {
    hook.mockReset().mockResolvedValue([STAGED]);
  });

  const updates = () => hook.mock.calls.map((call) => call.slice(2) as [string, unknown[]]);

  const call = (method: 'POST' | 'DELETE' | 'PATCH', url: string, payload?: unknown) =>
    api.app.inject({
      method,
      url: `/api/v1${url}`,
      headers: bearer(api.token),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });

  const emailList = () => seedList(api.database.db, api.environmentId, { kind: 'email-address' });

  const newItem = (listId: string, emailAddress: string) =>
    call('POST', '/list-item/email-addresses', {
      data: { attributes: { 'list-id': listId, value: emailAddress } },
    });

  it('stages an added item once, in the route’s transaction', async () => {
    const { id: listId } = await emailList();

    expect((await newItem(listId, 'a@example.com')).statusCode).toBe(201);

    expect(updates()).toEqual([
      [api.environmentId, [{ listId, changeKind: 'items-added', items: 1 }]],
    ]);
    expect(hook.mock.calls[0]?.[0]).not.toBe(api.database.db);
  });

  it('stages nothing for a value the list already holds', async () => {
    const { id: listId } = await emailList();
    await newItem(listId, 'twice@example.com');
    hook.mockClear();

    expect((await newItem(listId, 'twice@example.com')).statusCode).toBe(409);

    expect(hook).not.toHaveBeenCalled();
  });

  it('stages an archived item once, and a repeat not at all', async () => {
    const { id: listId } = await emailList();
    const response = await newItem(listId, 'gone@example.com');
    const { data } = response.json<{ data: { id: string } }>();
    hook.mockClear();

    await call('DELETE', `/list-item/email-addresses/${data.id}`);
    await call('DELETE', `/list-item/email-addresses/${data.id}`);

    expect(updates()).toEqual([
      [api.environmentId, [{ listId, changeKind: 'items-archived', items: 1 }]],
    ]);
  });

  it('stages an archived list once, and a repeat not at all (outcome 25)', async () => {
    const { id: listId } = await emailList();

    await call('DELETE', `/lists/${listId}`);
    await call('DELETE', `/lists/${listId}`);

    expect(updates()).toEqual([[api.environmentId, [{ listId, changeKind: 'archived', items: 0 }]]]);
    expect((await getList(api.database.db, api.environmentId, listId))?.version).toBe(2);
  });

  it('stages nothing for a PATCH that changes no item (outcome 25)', async () => {
    const { id: listId } = await emailList();

    const response = await call('PATCH', `/lists/${listId}`, {
      data: { attributes: { name: 'Renamed' } },
    });

    expect(response.statusCode).toBe(200);
    expect(hook).not.toHaveBeenCalled();
    expect((await getList(api.database.db, api.environmentId, listId))?.version).toBe(1);
  });

  describe('ListService.createItem', () => {
    const service = (events = createRecordingEventPublisher()) =>
      createListService({
        db: api.database.db,
        blindIndexKey: new Uint8Array(32).fill(7),
        rateLimiter: createAllowAllRateLimiter(fixedClock()),
        events,
      });
    const creator = { type: 'user', id: `usr_${'0'.repeat(26)}` } as const;

    it('stages a new item, and dispatches it after the commit', async () => {
      const { id: listId } = await seedList(api.database.db, api.environmentId, { kind: 'string' });
      const events = createRecordingEventPublisher();
      const dispatch = vi.spyOn(events, 'dispatch');

      await service(events).createItem({
        environmentId: api.environmentId,
        listId,
        item: { attributes: { value: 'graph value' }, creator },
      });

      expect(updates()).toEqual([
        [api.environmentId, [{ listId, changeKind: 'items-added', items: 1 }]],
      ]);
      expect(dispatch).toHaveBeenCalledWith([STAGED]);
    });

    it('stages nothing for a value already live', async () => {
      const { id: listId } = await seedList(api.database.db, api.environmentId, { kind: 'string' });
      const input = {
        environmentId: api.environmentId,
        listId,
        item: { attributes: { value: 'graph value' }, creator },
      };
      await service().createItem(input);
      hook.mockClear();

      expect((await service().createItem(input)).alreadyPresent).toBe(true);

      expect(hook).not.toHaveBeenCalled();
    });
  });

  it('stages each list blind-index:rebuild rewrote, once a page, with its count', async () => {
    const key = new Uint8Array(32).fill(9);
    const { id: listId } = await seedList(api.database.db, api.environmentId, { kind: 'string' });
    const row = { listId, value: { value: 'rewritten' }, normaliserVersion: 'lists-0' };
    await seedListItem(api.database.db, api.environmentId, row);
    await seedListItem(api.database.db, api.environmentId, {
      ...row,
      value: { value: 'rewritten too' },
    });
    const events = createRecordingEventPublisher();
    const dispatch = vi.spyOn(events, 'dispatch');

    const result = await rebuildListIndexes(api.database.db, key, { batchSize: 500, events });

    expect(result.updated).toBeGreaterThanOrEqual(2);
    expect(LIST_KEYS_VERSION).not.toBe('lists-0');
    const mine = updates().filter(([environmentId]) => environmentId === api.environmentId);
    expect(mine.flatMap(([, listUpdates]) => listUpdates)).toContainEqual({
      listId,
      changeKind: 'items-rewritten',
      items: 2,
    });
    expect(dispatch).toHaveBeenCalled();
  });

  it('stages what retention redacted, and dispatches it', async () => {
    const { id: listId } = await seedList(api.database.db, api.environmentId, {
      itemRetentionDays: 1,
    });
    await seedListItem(api.database.db, api.environmentId, {
      listId,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const events = createRecordingEventPublisher();
    const dispatch = vi.spyOn(events, 'dispatch');

    await runRetention({
      db: api.database.db,
      storage: api.storage,
      redaction: api.deps.redaction,
      events,
    });

    expect(updates().flatMap(([, listUpdates]) => listUpdates)).toContainEqual({
      listId,
      changeKind: 'items-redacted',
      items: 1,
    });
    expect(dispatch).toHaveBeenCalledWith(expect.arrayContaining([STAGED]));
  });

  it('stages each biometric list clearing the basis archived (C97.4, outcome 25)', async () => {
    const tenant = await api.newTenant();
    const { id: listId } = await seedList(api.database.db, tenant.environmentId, { kind: 'face' });
    const { inquiry } = await createTestInquiry(api.database.db, tenant.environmentId);
    const { id: itemId } = await seedListItem(api.database.db, tenant.environmentId, {
      listId,
      prefix: 'lifc',
      value: null,
      matchKey: null,
    });
    await seedListItemFace(api.database.db, tenant.environmentId, {
      itemId,
      sourceInquiryId: inquiry.id,
    });
    const basis = { 'biometric-lists-basis': 'consent' } as never as EnvironmentSettings;

    const staged = await api.database.db.transaction((tx) =>
      onSettingsChangedInTx(tx, tenant.environmentId, basis, {}, { events: api.events }),
    );

    expect(staged).toEqual([STAGED]);
    expect(updates()).toEqual([
      [tenant.environmentId, [{ listId, changeKind: 'archived', items: 1 }]],
    ]);
    expect(await getListItem(api.database.db, tenant.environmentId, itemId)).toMatchObject({
      status: 'archived',
    });
  });
});
