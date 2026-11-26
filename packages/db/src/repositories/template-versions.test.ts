/** C11 template status and the draft -> published -> superseded version lifecycle. */
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { InvalidCursorError } from '../errors.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestInquiry,
  createTestTenant,
  testId,
  type TestDatabase,
  wallClockStepsBack,
} from '../testing.js';
import {
  createDraftInquiryTemplateVersion,
  getInquiryTemplate,
  getInquiryTemplateVersion,
  listInquiryTemplates,
  listInquiryTemplateVersions,
  publishInquiryTemplateVersion,
  updateDraftInquiryTemplateVersion,
  updateInquiryTemplate,
} from './index.js';

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

async function setup() {
  const { environment } = await createTestTenant(database.db);
  const { template } = await createTestInquiry(database.db, environment.id);
  const draft = () =>
    createDraftInquiryTemplateVersion(database.db, environment.id, template.id, {
      id: testId('itmplv'),
      flow: { steps: ['consent'] },
      verificationConfig: {},
      settings: { 'inquiry-expiration-seconds': 600 },
    });
  return { env: environment.id, template, draft };
}

describe('template versions (C11)', () => {
  it('creates numbered drafts that do not change the current version', async () => {
    const { env, template, draft } = await setup();

    const second = await draft();
    const third = await draft();

    expect(second).toMatchObject({
      version: 2,
      status: 'draft',
      publishedAt: null,
      settings: { 'inquiry-expiration-seconds': 600 },
    });
    expect(third?.version).toBe(3);
    expect((await getInquiryTemplate(database.db, env, template.id))?.currentVersion.id).toBe(
      template.currentVersion.id,
    );
    expect(template.currentVersion).toMatchObject({
      status: 'published',
      publishedAt: expect.any(Date) as Date,
    });
  });

  it('edits drafts only', async () => {
    const { env, template, draft } = await setup();
    const version = await draft();

    const edited = await updateDraftInquiryTemplateVersion(database.db, env, version?.id ?? '', {
      flow: { steps: ['consent', 'selfie'] },
      verificationConfig: { selfie: {} },
      settings: {},
    });
    const unchanged = await updateDraftInquiryTemplateVersion(
      database.db,
      env,
      version?.id ?? '',
      {},
    );
    const published = await updateDraftInquiryTemplateVersion(
      database.db,
      env,
      template.currentVersion.id,
      {
        settings: {},
      },
    );

    expect(edited).toMatchObject({
      flow: { steps: ['consent', 'selfie'] },
      verificationConfig: { selfie: {} },
      settings: {},
    });
    expect(unchanged).toEqual(edited);
    expect(published).toBeNull();
  });

  it('publishes a draft, superseding the previous version', async () => {
    const { env, template, draft } = await setup();
    const version = await draft();

    const result = await publishInquiryTemplateVersion(database.db, env, version?.id ?? '');
    const again = await publishInquiryTemplateVersion(database.db, env, version?.id ?? '');

    expect(result).toMatchObject({
      status: 'published',
      version: { id: version?.id, status: 'published', publishedAt: expect.any(Date) as Date },
      superseded: { id: template.currentVersion.id, status: 'superseded' },
    });
    expect(again).toMatchObject({ status: 'not_draft', version: { id: version?.id } });
    expect((await getInquiryTemplate(database.db, env, template.id))?.currentVersion.id).toBe(
      version?.id,
    );
    expect(
      (await getInquiryTemplateVersion(database.db, env, template.currentVersion.id))?.status,
    ).toBe('superseded');
    expect(
      await publishInquiryTemplateVersion(database.db, testId('env'), version?.id ?? ''),
    ).toBeNull();
  });

  it('lists versions by template and status, newest first', async () => {
    onTestFinished(wallClockStepsBack());
    const { env, template, draft } = await setup();
    const clock = createdAtClock(database.db);
    await clock.at('inquiry_template_versions', template.currentVersion.id);
    const second = await draft();
    await clock.at('inquiry_template_versions', second?.id ?? '');
    const other = await setup();
    await other.draft();

    const all = await listInquiryTemplateVersions(database.db, env, {});
    const forTemplate = await listInquiryTemplateVersions(database.db, env, {
      inquiryTemplateId: template.id,
      size: 1,
    });
    const drafts = await listInquiryTemplateVersions(database.db, env, { status: 'draft' });

    expect(all.items.map((version) => version.id)).toEqual([
      second?.id,
      template.currentVersion.id,
    ]);
    expect(forTemplate).toMatchObject({ items: [{ id: second?.id }], next: second?.id });
    expect(drafts.items.map((version) => version.id)).toEqual([second?.id]);
    expect((await listInquiryTemplateVersions(database.db, env, { status: [] })).items).toEqual([]);
    await expect(
      listInquiryTemplateVersions(database.db, env, { after: testId('itmplv') }),
    ).rejects.toThrow(InvalidCursorError);
  });
});

describe('template status (C11)', () => {
  it('renames and archives a template, and filters lists by status', async () => {
    const { env, template } = await setup();

    const archived = await updateInquiryTemplate(database.db, env, template.id, {
      name: 'Renamed',
      status: 'archived',
    });
    const same = await updateInquiryTemplate(database.db, env, template.id, {});

    expect(archived).toMatchObject({
      name: 'Renamed',
      status: 'archived',
      currentVersion: { id: template.currentVersion.id },
    });
    expect(same).toEqual(archived);
    expect(
      (await listInquiryTemplates(database.db, env, { status: 'archived' })).items,
    ).toHaveLength(1);
    expect((await listInquiryTemplates(database.db, env, { status: 'active' })).items).toEqual([]);
    expect(
      await updateInquiryTemplate(database.db, testId('env'), template.id, { name: 'x' }),
    ).toBeNull();
  });
});
