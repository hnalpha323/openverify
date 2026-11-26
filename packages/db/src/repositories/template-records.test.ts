/**
 * Workflow 9A (`api-templates`): the template repositories of C154.1, C154.5, C154.7 and C156.4: the
 * version members, a template's draft and latest version, a template that holds only a draft, the
 * publish's note and acknowledgements, deployments, promotions and simulation presets.
 */
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from 'vitest';
import { createUser } from './users.js';
import {
  createdAtClock,
  createTestDatabase,
  createTestTenant,
  testId,
  wallClockStepsBack,
  type TestDatabase,
} from '../testing.js';
import {
  createDeploymentInTx,
  getDeployment,
  latestDeploymentOfTemplate,
  listDeployments,
} from './deployments.js';
import {
  createDraftInquiryTemplateVersion,
  createInquiryTemplate,
  createInquiryTemplateWithDraft,
  findLatestTemplateVersion,
  findPromotedTemplateId,
  findTemplateDraft,
  getInquiryTemplate,
  getInquiryTemplateRow,
  getInquiryTemplateVersion,
  listInquiryTemplates,
  publishInquiryTemplateVersion,
  recordInquiryTemplatePromotionInTx,
  updateDraftInquiryTemplateVersion,
} from './inquiry-templates.js';
import {
  createSimulationPreset,
  deleteSimulationPreset,
  listSimulationPresets,
} from './simulation-presets.js';

const FLOW = { version: 1, steps: [{ type: 'consent' }, { type: 'completion' }] };
const CONFIG = { government_id: { checks: {} } };
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database.close();
});

async function template(environmentId: string, name = 'KYC') {
  return createInquiryTemplate(database.db, environmentId, {
    id: testId('itmpl'),
    name,
    version: { id: testId('itmplv'), flow: FLOW, verificationConfig: CONFIG },
  });
}

describe('the version members (C154.1)', () => {
  it('stores them on a draft, replaces the ones a change sends and keeps the rest', async () => {
    const { environment } = await createTestTenant(database.db);
    const { id } = await template(environment.id);
    const draft = await createDraftInquiryTemplateVersion(database.db, environment.id, id, {
      id: testId('itmplv'),
      flow: FLOW,
      verificationConfig: CONFIG,
      members: {
        description: 'First',
        enabledLocales: ['en', 'fr'],
        defaultLocale: 'fr',
        copy: { messages: { fr: { 'consent.title': 'Bonjour' } } },
        fieldSchemas: [{ key: 'name_first', type: 'string', label: 'First name', pii: true }],
        lastUpdater: { type: 'user', id: testId('usr') },
        validation: { status: 'invalid', problems: [] },
        flowSha256: 'a'.repeat(64),
      },
    });
    expect(draft).toMatchObject({ description: 'First', defaultLocale: 'fr' });
    const changed = await updateDraftInquiryTemplateVersion(
      database.db,
      environment.id,
      draft?.id ?? '',
      { members: { description: 'Second', redirectIncludeStatus: true } },
    );
    expect(changed).toMatchObject({
      description: 'Second',
      redirectIncludeStatus: true,
      enabledLocales: ['en', 'fr'],
      flowSha256: 'a'.repeat(64),
    });
  });

  it('stores the publish note, acknowledgements and last updater with the publish', async () => {
    const { environment } = await createTestTenant(database.db);
    const { id } = await template(environment.id);
    const draft = await createDraftInquiryTemplateVersion(database.db, environment.id, id, {
      id: testId('itmplv'),
      flow: FLOW,
      verificationConfig: CONFIG,
    });
    const acknowledgement = {
      key: 'fallback:id_card',
      'acknowledged-by': testId('usr'),
      'acknowledged-at': '2026-11-05T00:00:00.000Z',
    };
    const result = await publishInquiryTemplateVersion(
      database.db,
      environment.id,
      draft?.id ?? '',
      new Date('2026-11-05T00:00:00Z'),
      {
        publishNote: 'Adds a fallback',
        acknowledgements: [acknowledgement],
        lastUpdater: { type: 'api-key', id: testId('key') },
      },
    );
    expect(result?.status).toBe('published');
    expect(
      await getInquiryTemplateVersion(database.db, environment.id, draft?.id ?? ''),
    ).toMatchObject({
      publishNote: 'Adds a fallback',
      acknowledgements: [acknowledgement],
      lastUpdater: { type: 'api-key' },
    });
  });
});

describe("a template's draft and latest version", () => {
  it('finds the draft, and the newest version in the statuses asked', async () => {
    const { environment } = await createTestTenant(database.db);
    const { id, currentVersion } = await template(environment.id);
    expect(await findTemplateDraft(database.db, environment.id, id)).toBeNull();
    const draft = await createDraftInquiryTemplateVersion(database.db, environment.id, id, {
      id: testId('itmplv'),
      flow: FLOW,
      verificationConfig: CONFIG,
    });
    expect((await findTemplateDraft(database.db, environment.id, id))?.id).toBe(draft?.id);
    expect(
      (await findLatestTemplateVersion(database.db, environment.id, id, ['draft', 'published']))
        ?.id,
    ).toBe(draft?.id);
    expect(
      (await findLatestTemplateVersion(database.db, environment.id, id, ['published']))?.id,
    ).toBe(currentVersion.id);
    const other = await createTestTenant(database.db);
    expect(await findTemplateDraft(database.db, other.environment.id, id)).toBeNull();
    expect(await getInquiryTemplateRow(database.db, other.environment.id, id)).toBeNull();
    expect((await getInquiryTemplateRow(database.db, environment.id, id))?.name).toBe('KYC');
  });

  it('keeps a template holding only a draft out of the template reads until it is published', async () => {
    const { environment } = await createTestTenant(database.db);
    const draft = await createInquiryTemplateWithDraft(database.db, environment.id, {
      id: testId('itmpl'),
      name: 'Promoted',
      version: { id: testId('itmplv'), flow: FLOW, verificationConfig: CONFIG },
    });
    expect(draft).toMatchObject({ status: 'draft', version: 1, publishedAt: null });
    expect(
      await getInquiryTemplate(database.db, environment.id, draft.inquiryTemplateId),
    ).toBeNull();
    expect((await listInquiryTemplates(database.db, environment.id)).items).toEqual([]);
    await publishInquiryTemplateVersion(database.db, environment.id, draft.id);
    expect(
      (await getInquiryTemplate(database.db, environment.id, draft.inquiryTemplateId))
        ?.currentVersion.id,
    ).toBe(draft.id);
  });
});

describe('promotions (C154.5)', () => {
  it('records a promote and finds the template it created by the source template', async () => {
    const source = await createTestTenant(database.db);
    const target = await createTestTenant(database.db);
    const { id: sourceTemplateId, currentVersion } = await template(source.environment.id);
    expect(await findPromotedTemplateId(database.db, target.environment.id, sourceTemplateId)).toBe(
      null,
    );
    const draft = await createInquiryTemplateWithDraft(database.db, target.environment.id, {
      id: testId('itmpl'),
      name: 'KYC',
      version: { id: testId('itmplv'), flow: FLOW, verificationConfig: CONFIG },
    });
    await recordInquiryTemplatePromotionInTx(database.db, target.environment.id, {
      templateId: draft.inquiryTemplateId,
      versionId: draft.id,
      sourceEnvironmentId: source.environment.id,
      sourceTemplateId,
      sourceVersionId: currentVersion.id,
      promotedBy: testId('usr'),
    });
    expect(await findPromotedTemplateId(database.db, target.environment.id, sourceTemplateId)).toBe(
      draft.inquiryTemplateId,
    );
    expect(await findPromotedTemplateId(database.db, source.environment.id, sourceTemplateId)).toBe(
      null,
    );
  });
});

describe('deployments (C154.7)', () => {
  it('writes one per publish, reads it in its environment only and lists newest first', async () => {
    onTestFinished(wallClockStepsBack());
    const { environment } = await createTestTenant(database.db);
    const clock = createdAtClock(database.db);
    const first = await template(environment.id, 'One');
    const second = await template(environment.id, 'Two');
    expect(await latestDeploymentOfTemplate(database.db, environment.id, first.id)).toBeNull();
    const a = await createDeploymentInTx(database.db, environment.id, {
      id: testId('dply'),
      templateId: first.id,
      versionId: first.currentVersion.id,
      sourceDeploymentId: null,
      creator: { type: 'user', id: testId('usr') },
    });
    await clock.at('deployments', a.id);
    const b = await createDeploymentInTx(database.db, environment.id, {
      id: testId('dply'),
      templateId: second.id,
      versionId: second.currentVersion.id,
      sourceDeploymentId: null,
      creator: { type: 'api-key', id: testId('key') },
    });
    await clock.at('deployments', b.id);
    expect(a).toMatchObject({ inquiryTemplateId: first.id, creatorType: 'user' });
    expect((await getDeployment(database.db, environment.id, a.id))?.id).toBe(a.id);
    const other = await createTestTenant(database.db);
    expect(await getDeployment(database.db, other.environment.id, a.id)).toBeNull();
    expect((await listDeployments(database.db, environment.id, {})).items.map((d) => d.id)).toEqual(
      [b.id, a.id],
    );
    expect(
      (
        await listDeployments(database.db, environment.id, { inquiryTemplateId: [first.id] })
      ).items.map((d) => d.id),
    ).toEqual([a.id]);
    const page = await listDeployments(database.db, environment.id, { size: 1 });
    expect(page.items.map((d) => d.id)).toEqual([b.id]);
    expect(page.next).not.toBeNull();
    expect((await latestDeploymentOfTemplate(database.db, environment.id, first.id))?.id).toBe(
      a.id,
    );
  });
});

describe('simulation presets (C156.4)', () => {
  it("seals a user's preset, lists the user's own newest first and deletes only their own", async () => {
    onTestFinished(wallClockStepsBack());
    const { organization, environment } = await createTestTenant(database.db);
    const clock = createdAtClock(database.db);
    const user = (email: string) =>
      createUser(database.db, {
        id: testId('usr'),
        organizationId: organization.id,
        email,
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
      });
    const owner = await user(`${testId('usr').toLowerCase()}@example.com`);
    const stranger = await user(`${testId('usr').toLowerCase()}@example.com`);
    const scope = { fields: { name_first: 'Synthetic' } };
    const older = await createSimulationPreset(database.db, environment.id, {
      id: testId('ssp'),
      userId: owner.id,
      name: 'Passing',
      scope,
    });
    await clock.at('simulation_presets', older.id);
    const newer = await createSimulationPreset(database.db, environment.id, {
      id: testId('ssp'),
      userId: owner.id,
      name: 'Failing',
      scope: {},
    });
    await clock.at('simulation_presets', newer.id);
    expect(older).toMatchObject({ name: 'Passing', scope });
    expect(older).not.toHaveProperty('scopeSealed');
    const listed = await listSimulationPresets(database.db, environment.id, owner.id);
    expect(listed.map((preset) => preset.id)).toEqual([newer.id, older.id]);
    expect(listed[1]?.scope).toEqual(scope);
    expect(await listSimulationPresets(database.db, environment.id, stranger.id)).toEqual([]);
    expect(await deleteSimulationPreset(database.db, environment.id, stranger.id, older.id)).toBe(
      false,
    );
    expect(await deleteSimulationPreset(database.db, environment.id, owner.id, older.id)).toBe(
      true,
    );
    expect(
      (await listSimulationPresets(database.db, environment.id, owner.id)).map((p) => p.id),
    ).toEqual([newer.id]);
  });
});
