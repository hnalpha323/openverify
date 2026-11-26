import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { InvalidCursorError } from '../errors.js';
import { inquiryTemplates } from '../schema.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestTenant,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import {
  createInquiryTemplate,
  createInquiryTemplateVersion,
  getInquiryTemplate,
  getInquiryTemplateVersion,
  listInquiryTemplates,
} from './inquiry-templates.js';

const FLOW = { version: 1, steps: [{ type: 'consent' }, { type: 'completion' }] };
const CONFIG = {
  government_id: { checks: { id_blur_detection: { enabled: true, required: true } } },
};
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

const newTemplate = (environmentId: string, name = 'Default KYC') =>
  createInquiryTemplate(database.db, environmentId, {
    id: testId('itmpl'),
    name,
    version: { id: testId('itmplv'), flow: FLOW, verificationConfig: CONFIG },
  });

describe('inquiry templates', () => {
  it('creates a template together with version 1', async () => {
    const { environment } = await createTestTenant(database.db);

    const template = await newTemplate(environment.id);

    expect(template).toMatchObject({ environmentId: environment.id, name: 'Default KYC' });
    expect(template.latestVersion).toMatchObject({
      environmentId: environment.id,
      inquiryTemplateId: template.id,
      version: 1,
      flow: FLOW,
      verificationConfig: CONFIG,
    });
    expect(await getInquiryTemplate(database.db, environment.id, template.id)).toEqual(template);
  });

  it('adds numbered versions and reads the latest one', async () => {
    const { environment } = await createTestTenant(database.db);
    const template = await newTemplate(environment.id);

    const second = await createInquiryTemplateVersion(database.db, environment.id, template.id, {
      id: testId('itmplv'),
      flow: { ...FLOW, version: 2 },
      verificationConfig: {},
    });

    expect(second?.version).toBe(2);
    expect(
      (await getInquiryTemplate(database.db, environment.id, template.id))?.latestVersion,
    ).toEqual(second);
    // C11: publishing version 2 supersedes version 1; its content is unchanged.
    const first = await getInquiryTemplateVersion(
      database.db,
      environment.id,
      template.latestVersion.id,
    );
    expect(first).toMatchObject({
      id: template.latestVersion.id,
      version: 1,
      flow: template.latestVersion.flow,
      verificationConfig: template.latestVersion.verificationConfig,
      publishedAt: template.latestVersion.publishedAt,
      status: 'superseded',
    });
  });

  it('keeps templates and versions inside their environment', async () => {
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    const template = await newTemplate(environment.id);

    expect(await getInquiryTemplate(database.db, other.environment.id, template.id)).toBeNull();
    expect(
      await getInquiryTemplateVersion(database.db, other.environment.id, template.latestVersion.id),
    ).toBeNull();
    expect(
      await createInquiryTemplateVersion(database.db, other.environment.id, template.id, {
        id: testId('itmplv'),
        flow: FLOW,
        verificationConfig: CONFIG,
      }),
    ).toBeNull();
  });

  it('lists templates newest first with cursor pagination', async () => {
    onTestFinished(wallClockStepsBack());
    const { environment } = await createTestTenant(database.db);
    const clock = createdAtClock(database.db);
    const created = [];
    for (const name of ['one', 'two', 'three']) {
      const template = await newTemplate(environment.id, name);
      await clock.at('inquiry_templates', template.id);
      created.push(template);
    }

    const first = await listInquiryTemplates(database.db, environment.id, { size: 2 });
    const second = await listInquiryTemplates(database.db, environment.id, {
      size: 2,
      after: first.next ?? '',
    });

    expect(first.items.map((template) => template.name)).toEqual(['three', 'two']);
    expect(first.items[0]?.latestVersion.version).toBe(1);
    expect(first.next).toBe(created[1]?.id);
    expect(second.items.map((template) => template.name)).toEqual(['one']);
    expect(second.next).toBeNull();
    expect(
      await listInquiryTemplates(database.db, (await createTestTenant(database.db)).environment.id),
    ).toEqual({
      items: [],
      next: null,
    });
  });

  it('rejects a cursor that is not in the list', async () => {
    const { environment } = await createTestTenant(database.db);
    const other = await createTestTenant(database.db);
    const foreign = await newTemplate(other.environment.id);

    await expect(
      listInquiryTemplates(database.db, environment.id, { after: foreign.id }),
    ).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it('runs inside a caller transaction, as a savepoint that rolls back with it', async () => {
    const { environment } = await createTestTenant(database.db);
    const id = testId('itmpl');

    await expect(
      database.db.transaction(async (tx) => {
        await createInquiryTemplate(tx, environment.id, {
          id,
          name: 'rolled back',
          version: { id: testId('itmplv'), flow: FLOW, verificationConfig: CONFIG },
        });
        expect(await getInquiryTemplate(tx, environment.id, id)).not.toBeNull();
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await getInquiryTemplate(database.db, environment.id, id)).toBeNull();
  });

  // C154.5 (Workflow 9A): a template holding no published version (a promote's) is not served.
  it('does not return a template that has no published version', async () => {
    const { environment } = await createTestTenant(database.db);
    const id = testId('itmpl');
    await database.db
      .insert(inquiryTemplates)
      .values({ id, environmentId: environment.id, name: 'x' });

    expect(await getInquiryTemplate(database.db, environment.id, id)).toBeNull();
  });
});
