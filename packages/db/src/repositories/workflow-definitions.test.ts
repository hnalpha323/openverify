/**
 * Workflow 8A Stage 3 (`api-workflows`; C112.3, C112.4, C116, C119.3, C121.5): the workflow, version,
 * deployment and wait-index repositories over the Stage 1b tables. One draft per workflow, an
 * optimistic lock on it, published versions that never change, environment isolation. Order is
 * asserted only on what the code orders by, on rows stamped by `createdAtClock`. Every value is
 * synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { createKeyring, setDefaultKeyring } from '../crypto.js';
import {
  createTestDatabase,
  createTestTenant,
  createdAtClock,
  seedList,
  seedWorkflowRun,
  testId,
  wallClockStepsBack,
  type TestDatabase,
} from '../testing.js';
import {
  WORKFLOW_REFERENCE_KINDS,
  createWorkflowDeployment,
  createWorkflowDraft,
  countWorkflowsListeningToEvent,
  findWorkflowReferences,
  readWorkflowReferences,
  getWorkflowDeployment,
  getWorkflowVersion,
  archiveWorkflowVersion,
  listPublishedWorkflowVersions,
  listPublishedWorkflowVersionsCalling,
  listWorkflowVersions,
  nextWorkflowVersionNumber,
  publishWorkflowVersion,
  saveWorkflowDraft,
  setWorkflowDeploymentStatus,
  setWorkflowDeploymentVersions,
} from './workflow-versions.js';
import {
  createWorkflow,
  getWorkflow,
  listRunningWorkflows,
  listWorkflows,
  listWorkflowsNamed,
  lockWorkflow,
  setWorkflowStatus,
  setWorkflowVersionPointers,
  updateWorkflow,
} from './workflows.js';
import {
  recordWorkflowWaitIndex,
  removeRetiredWorkflowWaitIndex,
  removeWorkflowWaitIndex,
} from './workflow-wait-index.js';
import { workflowTriggers, workflowWaitIndex } from '../schema.js';
import { and, eq } from 'drizzle-orm';

let database: TestDatabase;
let environmentId: string;
let otherEnvironmentId: string;

const USER = testId('usr');
const AT = new Date('2026-10-20T12:00:00.000Z');
const EMPTY = { 'schema-version': 1, trigger: null, steps: [], edges: [] };

const newWorkflow = (name = 'Synthetic workflow') =>
  createWorkflow(database.db, environmentId, { id: testId('wfl'), name, kind: 'workflow' });

const newDraft = (workflowId: string, versionNumber = 1) =>
  createWorkflowDraft(database.db, environmentId, {
    id: testId('wfv'),
    workflowId,
    versionNumber,
    schemaVersion: 1,
    definition: EMPTY,
    lastUpdater: USER,
  });

const PUBLICATION = {
  definitionSha256: 'a'.repeat(64),
  grant: { scopes: ['inquiries:write'], pii: false },
  egress: [],
  acknowledgements: [{ key: 'irreversible:wipe' }],
  warnings: [],
  description: 'A change note.',
  publishedAt: AT,
  publishedById: USER,
};

beforeAll(async () => {
  setDefaultKeyring(createKeyring(randomBytes(32)));
  database = await createTestDatabase();
  environmentId = (await createTestTenant(database.db)).environment.id;
  otherEnvironmentId = (await createTestTenant(database.db)).environment.id;
}, 120_000);

afterAll(async () => {
  await database.close();
  setDefaultKeyring(undefined);
});

describe('workflows (C112.3)', () => {
  it('creates a paused workflow and reads it only in its environment', async () => {
    const workflow = await newWorkflow();
    expect(workflow).toMatchObject({
      status: 'paused',
      kind: 'workflow',
      pausedReason: 'operator',
    });
    expect(await getWorkflow(database.db, environmentId, workflow.id)).not.toBeNull();
    expect(await getWorkflow(database.db, otherEnvironmentId, workflow.id)).toBeNull();
    expect(await lockWorkflow(database.db, otherEnvironmentId, workflow.id)).toBeNull();
  });

  it('renames in place and leaves another environment alone', async () => {
    const workflow = await newWorkflow();
    const renamed = await updateWorkflow(database.db, environmentId, workflow.id, {
      name: 'Renamed',
      description: null,
    });
    expect(renamed).toMatchObject({ name: 'Renamed', description: null });
    expect(
      await updateWorkflow(database.db, otherEnvironmentId, workflow.id, { name: 'No' }),
    ).toBeNull();
  });

  it('lists newest first with ties broken by id, filtered by status and kind', async () => {
    onTestFinished(wallClockStepsBack());
    const clock = createdAtClock(database.db);
    const scope = (await createTestTenant(database.db)).environment.id;
    const add = async (kind: 'workflow' | 'module') =>
      clock.stamp(
        'workflows',
        await createWorkflow(database.db, scope, { id: testId('wfl'), name: 'One', kind }),
      );
    const first = await add('workflow');
    const second = await add('module');
    const third = await add('workflow');
    const page = await listWorkflows(database.db, scope, {}, {});
    expect(page.items.map((row) => row.id)).toEqual([third.id, second.id, first.id]);
    const modules = await listWorkflows(database.db, scope, { kinds: ['module'] }, {});
    expect(modules.items.map((row) => row.id)).toEqual([second.id]);
    const running = await listWorkflows(database.db, scope, { statuses: ['running'] }, {});
    expect(running.items).toEqual([]);
  });

  it('points at its versions, leaving a pointer that is not given', async () => {
    const workflow = await newWorkflow();
    const draft = await newDraft(workflow.id);
    await setWorkflowVersionPointers(database.db, environmentId, workflow.id, {
      draftVersionId: draft.id,
    });
    const pointed = await setWorkflowVersionPointers(database.db, environmentId, workflow.id, {
      latestPublishedVersionId: draft.id,
    });
    expect(pointed).toMatchObject({ draftVersionId: draft.id, latestPublishedVersionId: draft.id });
    const cleared = await setWorkflowVersionPointers(database.db, environmentId, workflow.id, {
      draftVersionId: null,
    });
    expect(cleared).toMatchObject({ draftVersionId: null, latestPublishedVersionId: draft.id });
  });

  it('sets a status with its reason, stamps an archive, and clears both on a run', async () => {
    const workflow = await newWorkflow();
    const running = await setWorkflowStatus(
      database.db,
      environmentId,
      workflow.id,
      'running',
      null,
      AT,
    );
    expect(running).toMatchObject({ status: 'running', pausedReason: null, archivedAt: null });
    const paused = await setWorkflowStatus(
      database.db,
      environmentId,
      workflow.id,
      'paused',
      'publisher_revoked',
      AT,
    );
    expect(paused).toMatchObject({ status: 'paused', pausedReason: 'publisher_revoked' });
    const archived = await setWorkflowStatus(
      database.db,
      environmentId,
      workflow.id,
      'archived',
      null,
      AT,
    );
    expect(archived).toMatchObject({ status: 'archived', pausedReason: null, archivedAt: AT });
  });

  it('walks the running workflows of every environment by id (C121.5)', async () => {
    const ids = [];
    for (const scope of [environmentId, otherEnvironmentId]) {
      const row = await createWorkflow(database.db, scope, {
        id: testId('wfl'),
        name: 'Running',
        kind: 'workflow',
      });
      await setWorkflowStatus(database.db, scope, row.id, 'running', null, AT);
      ids.push(row.id);
    }
    const seen: string[] = [];
    let after: string | null = null;
    for (;;) {
      const batch: { id: string }[] = await listRunningWorkflows(database.db, { after, limit: 50 });
      const last = batch.at(-1);
      if (last === undefined) {
        break;
      }
      seen.push(...batch.map((row) => row.id));
      after = last.id;
    }
    expect(seen).toEqual([...seen].sort());
    expect(seen).toEqual(expect.arrayContaining(ids));
  });

  it('finds workflows of a name and kind in one environment (C112.2)', async () => {
    const name = `Named ${testId('wfl')}`.slice(0, 80);
    const row = await newWorkflow(name);
    expect(
      (await listWorkflowsNamed(database.db, environmentId, name, 'workflow')).map((one) => one.id),
    ).toEqual([row.id]);
    expect(await listWorkflowsNamed(database.db, environmentId, name, 'module')).toEqual([]);
    expect(await listWorkflowsNamed(database.db, otherEnvironmentId, name, 'workflow')).toEqual([]);
  });
});

describe('versions (C112.4, C116.1)', () => {
  it('holds one draft per workflow', async () => {
    const workflow = await newWorkflow();
    await newDraft(workflow.id);
    await expect(newDraft(workflow.id, 2)).rejects.toThrow();
  });

  it('saves a draft only at its lock version, and bumps it', async () => {
    const workflow = await newWorkflow();
    const draft = await newDraft(workflow.id);
    const changes = {
      definition: { ...EMPTY, steps: [{ id: 'one' }] },
      schemaVersion: 1,
      triggerType: 'trigger-api',
      triggerConfig: {},
      warnings: [{ pointer: '', code: 'variable_unused' }],
      lastUpdater: USER,
    } as const;
    const saved = await saveWorkflowDraft(database.db, environmentId, draft.id, 1, changes);
    expect(saved).toMatchObject({ lockVersion: 2, triggerType: 'trigger-api', triggerConfig: {} });
    expect(saved?.warnings).toEqual(changes.warnings);
    expect(await saveWorkflowDraft(database.db, environmentId, draft.id, 1, changes)).toBeNull();
    expect(
      await saveWorkflowDraft(database.db, otherEnvironmentId, draft.id, 2, changes),
    ).toBeNull();
  });

  it('freezes a draft once, and a published version takes no save', async () => {
    const workflow = await newWorkflow();
    const draft = await newDraft(workflow.id);
    const published = await publishWorkflowVersion(
      database.db,
      environmentId,
      draft.id,
      PUBLICATION,
    );
    expect(published).toMatchObject({
      status: 'published',
      definitionSha256: 'a'.repeat(64),
      publishedByType: 'user',
      publishedById: USER,
      publishedAt: AT,
      description: 'A change note.',
    });
    expect(published?.grant).toEqual(PUBLICATION.grant);
    expect(await getWorkflowVersion(database.db, environmentId, draft.id)).toEqual(published);
    expect(await getWorkflowVersion(database.db, otherEnvironmentId, draft.id)).toBeNull();
    expect(published?.acknowledgements).toEqual(PUBLICATION.acknowledgements);
    expect(
      await publishWorkflowVersion(database.db, environmentId, draft.id, PUBLICATION),
    ).toBeNull();
    expect(
      await saveWorkflowDraft(database.db, environmentId, draft.id, 1, {
        definition: EMPTY,
        schemaVersion: 1,
        triggerType: null,
        triggerConfig: null,
        warnings: [],
        lastUpdater: USER,
      }),
    ).toBeNull();
  });

  it('archives a published version, never a draft', async () => {
    const workflow = await newWorkflow();
    const draft = await newDraft(workflow.id);
    expect(await archiveWorkflowVersion(database.db, environmentId, draft.id)).toBeNull();
    await publishWorkflowVersion(database.db, environmentId, draft.id, PUBLICATION);
    const archived = await archiveWorkflowVersion(database.db, environmentId, draft.id);
    expect(archived).toMatchObject({ status: 'archived' });
    expect(archived?.publishedAt).toEqual(AT);
  });

  it('counts the next version after the highest, whatever its status', async () => {
    const workflow = await newWorkflow();
    expect(await nextWorkflowVersionNumber(database.db, environmentId, workflow.id)).toBe(1);
    const draft = await newDraft(workflow.id, 4);
    await publishWorkflowVersion(database.db, environmentId, draft.id, PUBLICATION);
    await archiveWorkflowVersion(database.db, environmentId, draft.id);
    expect(await nextWorkflowVersionNumber(database.db, environmentId, workflow.id)).toBe(5);
  });

  it('lists published versions and the draft newest first, never an archived one', async () => {
    onTestFinished(wallClockStepsBack());
    const clock = createdAtClock(database.db);
    const workflow = await newWorkflow();
    const add = async (number: number) =>
      clock.stamp('workflow_versions', await newDraft(workflow.id, number));
    const first = await add(1);
    await publishWorkflowVersion(database.db, environmentId, first.id, PUBLICATION);
    await archiveWorkflowVersion(database.db, environmentId, first.id);
    const second = await add(2);
    await publishWorkflowVersion(database.db, environmentId, second.id, PUBLICATION);
    const third = await add(3);
    const page = await listWorkflowVersions(database.db, environmentId, workflow.id, {});
    expect(page.items.map((row) => row.id)).toEqual([third.id, second.id]);
    const published = await listPublishedWorkflowVersions(database.db, environmentId, workflow.id);
    expect(published.map((row) => row.id)).toEqual([second.id]);
    expect(
      (await listWorkflowVersions(database.db, otherEnvironmentId, workflow.id, {})).items,
    ).toEqual([]);
  });

  it('finds the published versions whose steps name a workflow (C121.3)', async () => {
    const target = testId('wfl');
    const calling = await newWorkflow();
    const version = await createWorkflowDraft(database.db, environmentId, {
      id: testId('wfv'),
      workflowId: calling.id,
      versionNumber: 1,
      schemaVersion: 1,
      definition: { ...EMPTY, steps: [{ id: 'child', config: { 'workflow-id': target } }] },
      lastUpdater: USER,
    });
    expect(await listPublishedWorkflowVersionsCalling(database.db, environmentId, target)).toEqual(
      [],
    );
    await publishWorkflowVersion(database.db, environmentId, version.id, PUBLICATION);
    const found = await listPublishedWorkflowVersionsCalling(database.db, environmentId, target);
    expect(found.map((row) => row.id)).toEqual([version.id]);
    expect(
      await listPublishedWorkflowVersionsCalling(database.db, otherEnvironmentId, target),
    ).toEqual([]);
  });

  it('counts the other workflows an event starts (H18)', async () => {
    const eventName = 'inquiry.completed';
    const scope = (await createTestTenant(database.db)).environment.id;
    const listen = async (kind: 'trigger-event' | 'trigger-verification' | 'trigger-api') => {
      const row = await createWorkflow(database.db, scope, {
        id: testId('wfl'),
        name: 'Listener',
        kind: 'workflow',
      });
      const version = await createWorkflowDraft(database.db, scope, {
        id: testId('wfv'),
        workflowId: row.id,
        versionNumber: 1,
        schemaVersion: 1,
        definition: EMPTY,
        lastUpdater: USER,
      });
      await database.db.insert(workflowTriggers).values({
        environmentId: scope,
        kind,
        eventName,
        workflowId: row.id,
        workflowVersionId: version.id,
      });
      return row;
    };
    const one = await listen('trigger-event');
    await listen('trigger-verification');
    await listen('trigger-api');
    expect(await countWorkflowsListeningToEvent(database.db, scope, eventName, testId('wfl'))).toBe(
      2,
    );
    expect(await countWorkflowsListeningToEvent(database.db, scope, eventName, one.id)).toBe(1);
  });
});

describe('references (C112.2, C116.4)', () => {
  it('reads active objects by id and by name, in one environment', async () => {
    const name = `Reference ${testId('lst')}`.slice(0, 60);
    const { id: active } = await seedList(database.db, environmentId, { name });
    const { id: archived } = await seedList(database.db, environmentId, {
      name,
      status: 'archived',
    });
    const read = await readWorkflowReferences(database.db, environmentId, 'list', [
      active,
      archived,
      testId('lst'),
    ]);
    expect(read).toEqual([{ id: active, name }]);
    expect(await readWorkflowReferences(database.db, otherEnvironmentId, 'list', [active])).toEqual(
      [],
    );
    expect(await readWorkflowReferences(database.db, environmentId, 'list', [])).toEqual([]);
    expect(await findWorkflowReferences(database.db, environmentId, 'list', name)).toEqual([
      { id: active, name },
    ]);
    expect(await findWorkflowReferences(database.db, otherEnvironmentId, 'list', name)).toEqual([]);
  });

  it('answers each kind of reference', async () => {
    const workflow = await newWorkflow(`Named ${testId('wfl')}`.slice(0, 80));
    for (const kind of WORKFLOW_REFERENCE_KINDS) {
      expect(
        await readWorkflowReferences(database.db, environmentId, kind, [testId('lst')]),
      ).toEqual([]);
      expect(await findWorkflowReferences(database.db, environmentId, kind, 'Nothing')).toEqual([]);
    }
    expect(
      await findWorkflowReferences(database.db, environmentId, 'workflow', workflow.name),
    ).toEqual([{ id: workflow.id, name: workflow.name }]);
  });
});

describe('deployments (C116.3)', () => {
  const VERSIONS = [
    { token: testId('wfv'), percentage: 10, label: 'treatment' },
    { token: testId('wfv'), percentage: 90, label: 'control' },
  ];

  it('holds one active rollout per workflow, and ends it', async () => {
    const workflow = await newWorkflow();
    const deployment = await createWorkflowDeployment(database.db, environmentId, {
      id: testId('wfd'),
      workflowId: workflow.id,
      versions: VERSIONS,
    });
    expect(deployment).toMatchObject({ status: 'active' });
    expect(deployment.versions).toEqual(VERSIONS);
    await expect(
      createWorkflowDeployment(database.db, environmentId, {
        id: testId('wfd'),
        workflowId: workflow.id,
        versions: VERSIONS,
      }),
    ).rejects.toThrow();
    const ended = await setWorkflowDeploymentStatus(
      database.db,
      environmentId,
      deployment.id,
      'inactive',
    );
    expect(ended).toMatchObject({ status: 'inactive' });
    expect(await getWorkflowDeployment(database.db, otherEnvironmentId, deployment.id)).toBeNull();
    expect(
      await setWorkflowDeploymentStatus(database.db, otherEnvironmentId, deployment.id, 'inactive'),
    ).toBeNull();
  });

  it('rewrites the percentages of a rollout', async () => {
    const workflow = await newWorkflow();
    const deployment = await createWorkflowDeployment(database.db, environmentId, {
      id: testId('wfd'),
      workflowId: workflow.id,
      versions: VERSIONS,
    });
    const changed = [
      { ...VERSIONS[0], percentage: 40 },
      { ...VERSIONS[1], percentage: 60 },
    ];
    const updated = await setWorkflowDeploymentVersions(
      database.db,
      environmentId,
      deployment.id,
      changed,
    );
    expect(updated?.versions).toEqual(changed);
    expect(
      await setWorkflowDeploymentVersions(database.db, otherEnvironmentId, deployment.id, changed),
    ).toBeNull();
  });
});

describe('the wait index (C119.3)', () => {
  it('forgets a version archived long enough ago with no unfinished run', async () => {
    const events = ['case.resolved'];
    const archivedVersion = async (run: 'in_progress' | 'completed' | null) => {
      const workflow = await newWorkflow();
      const draft = await newDraft(workflow.id);
      await publishWorkflowVersion(database.db, environmentId, draft.id, PUBLICATION);
      await recordWorkflowWaitIndex(database.db, environmentId, draft.id, events);
      await archiveWorkflowVersion(database.db, environmentId, draft.id);
      if (run !== null) {
        await seedWorkflowRun(database.db, environmentId, {
          workflowId: workflow.id,
          workflowVersionId: draft.id,
          status: run,
        });
      }
      return draft.id;
    };
    const idle = await archivedVersion(null);
    const finished = await archivedVersion('completed');
    const waiting = await archivedVersion('in_progress');
    const live = await newDraft((await newWorkflow()).id);
    await recordWorkflowWaitIndex(database.db, environmentId, live.id, events);
    const held = async () =>
      (await database.db.select().from(workflowWaitIndex)).map((row) => row.workflowVersionId);

    await removeRetiredWorkflowWaitIndex(database.db, new Date(Date.now() - 60_000));
    expect(await held()).toEqual(expect.arrayContaining([idle, finished, waiting, live.id]));

    await removeRetiredWorkflowWaitIndex(database.db, new Date(Date.now() + 60_000));
    const left = await held();
    expect(left).toEqual(expect.arrayContaining([waiting, live.id]));
    expect(left).not.toContain(idle);
    expect(left).not.toContain(finished);
  });

  it('records each event of a version once, and removes the version', async () => {
    const workflow = await newWorkflow();
    const version = await newDraft(workflow.id);
    await recordWorkflowWaitIndex(database.db, environmentId, version.id, [
      'case.resolved',
      'report/watchlist.ready',
      'case.resolved',
    ]);
    await recordWorkflowWaitIndex(database.db, environmentId, version.id, ['case.resolved']);
    await recordWorkflowWaitIndex(database.db, environmentId, version.id, []);
    const rows = () =>
      database.db
        .select()
        .from(workflowWaitIndex)
        .where(
          and(
            eq(workflowWaitIndex.environmentId, environmentId),
            eq(workflowWaitIndex.workflowVersionId, version.id),
          ),
        );
    expect((await rows()).map((row) => row.eventName).sort()).toEqual([
      'case.resolved',
      'report/watchlist.ready',
    ]);
    await removeWorkflowWaitIndex(database.db, otherEnvironmentId, version.id);
    expect(await rows()).toHaveLength(2);
    await removeWorkflowWaitIndex(database.db, environmentId, version.id);
    expect(await rows()).toEqual([]);
  });
});
