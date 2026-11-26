import { describe, expect, it } from 'vitest';
import { AT, AT_ISO, LATER, readFixture } from './test-support.js';
import { webhookFiltersSchema } from './webhooks.js';
import {
  WORKFLOW_INCLUDES,
  WORKFLOW_INCLUDE_PERMISSIONS,
  activateWorkflowBodySchema,
  archiveWorkflowBodySchema,
  buildWorkflowDeploymentResource,
  buildWorkflowResource,
  buildWorkflowVersionResource,
  createWorkflowBodySchema,
  getWorkflowQuerySchema,
  listWorkflowVersionsQuerySchema,
  listWorkflowsQuerySchema,
  pauseWorkflowBodySchema,
  promoteWorkflowBodySchema,
  publishWorkflowBodySchema,
  putWorkflowDraftBodySchema,
  restoreWorkflowBodySchema,
  rolloutWorkflowBodySchema,
  updateWorkflowBodySchema,
  validateWorkflowDraftBodySchema,
  workflowAcknowledgementKeySchema,
  workflowAttributesSchema,
  workflowDefinitionCheckDocumentSchema,
  workflowGrantSchema,
  workflowVersionAttributesSchema,
  workflowVersionDiffQuerySchema,
} from './workflows.js';

const WFL = 'wfl_01M5CM00000000000000000001';
const WFV = 'wfv_01M5CM00000000000000000002';
const WFV2 = 'wfv_01M5CM00000000000000000003';
const WFD = 'wfd_01M5CM00000000000000000004';
const USR = 'usr_01M5CJXHG03PHEQZPRWAH2RXM5';

const workflow = {
  id: WFL,
  name: 'Review on match',
  description: null,
  status: 'running' as const,
  kind: 'workflow' as const,
  pausedReason: null,
  latestPublishedVersionId: WFV,
  activeDeploymentId: null,
  draftVersionId: null,
  createdAt: AT,
  updatedAt: LATER,
  archivedAt: null,
};

const definition = readFixture('workflows/definition-every-node.json') as never;

const draft = {
  id: WFV,
  workflowId: WFL,
  status: 'draft' as const,
  triggerType: null,
  live: false,
  rolloutLabel: null,
  rolloutPercentage: null,
  lastUpdater: USR,
  description: null,
  publishedAt: null,
  createdAt: AT,
  updatedAt: LATER,
  versionNumber: 2,
  schemaVersion: 1,
  lockVersion: 3,
  definition,
  inputs: [],
  outputs: [],
  definitionSha256: null,
  grant: null,
  egress: [],
  acknowledgements: [],
  warnings: [],
  promotedFrom: null,
};

describe('the workflow resource (C112.3)', () => {
  it('builds with its three relationships', () => {
    const resource = buildWorkflowResource(workflow);
    expect(resource.relationships).toEqual({
      'latest-published-version': { data: { type: 'workflow-version', id: WFV } },
      'active-deployment': { data: null },
      'draft-version': { data: null },
    });
    expect(resource.attributes.status).toBe('running');
  });

  it('says why it is paused, and only when it is', () => {
    expect(
      buildWorkflowResource({ ...workflow, status: 'paused', pausedReason: 'publisher_revoked' })
        .attributes['paused-reason'],
    ).toBe('publisher_revoked');
    expect(() => buildWorkflowResource({ ...workflow, status: 'paused' })).toThrow();
    expect(() => buildWorkflowResource({ ...workflow, pausedReason: 'operator' })).toThrow();
  });

  it('is archived exactly when it says when', () => {
    expect(() => buildWorkflowResource({ ...workflow, status: 'archived' })).toThrow();
    expect(() => buildWorkflowResource({ ...workflow, archivedAt: AT })).toThrow();
    expect(
      buildWorkflowResource({ ...workflow, status: 'archived', archivedAt: AT }).attributes[
        'archived-at'
      ],
    ).toBe(AT_ISO);
  });

  it('refuses a name past 80 characters and a description past 500', () => {
    const attributes = buildWorkflowResource(workflow).attributes;
    expect(
      workflowAttributesSchema.safeParse({ ...attributes, name: 'x'.repeat(81) }).success,
    ).toBe(false);
    expect(
      workflowAttributesSchema.safeParse({ ...attributes, description: 'x'.repeat(501) }).success,
    ).toBe(false);
  });
});

describe('the workflow routes (C112.6)', () => {
  it('creates by name, with a kind and description', () => {
    const body = { data: { attributes: { name: 'A', kind: 'module', description: 'B' } } };
    expect(createWorkflowBodySchema.parse(body)).toEqual(body);
    expect(createWorkflowBodySchema.safeParse({ data: { attributes: {} } }).success).toBe(false);
    expect(
      createWorkflowBodySchema.safeParse({ data: { attributes: { name: 'A', status: 'running' } } })
        .success,
    ).toBe(false);
  });

  it('patches the name and description only', () => {
    expect(
      updateWorkflowBodySchema.safeParse({ data: { attributes: { name: 'A' } } }).success,
    ).toBe(true);
    expect(
      updateWorkflowBodySchema.safeParse({ data: { attributes: { description: null } } }).success,
    ).toBe(true);
    expect(updateWorkflowBodySchema.safeParse({ data: { attributes: {} } }).success).toBe(false);
    expect(
      updateWorkflowBodySchema.safeParse({ data: { attributes: { status: 'paused' } } }).success,
    ).toBe(false);
  });

  it('takes no parameters to pause, activate or archive', () => {
    for (const schema of [
      pauseWorkflowBodySchema,
      activateWorkflowBodySchema,
      archiveWorkflowBodySchema,
    ]) {
      expect(schema.safeParse(undefined).success).toBe(true);
      expect(schema.safeParse({ meta: { force: true } }).success).toBe(false);
    }
  });

  it('filters workflows by status and kind, and refuses the rest', () => {
    const query = {
      'filter[status]': 'paused,running',
      'filter[kind]': 'module',
      'page[after]': WFL,
    };
    expect(listWorkflowsQuerySchema.parse(query)).toEqual(query);
    expect(listWorkflowsQuerySchema.safeParse({ 'filter[status]': 'draft' }).success).toBe(false);
    expect(listWorkflowsQuerySchema.safeParse({ 'filter[name]': 'a' }).success).toBe(false);
  });

  it('includes the two public relationships, each under workflows:read (C143.6)', () => {
    expect(WORKFLOW_INCLUDES).toEqual(['latest-published-version', 'active-deployment']);
    expect(getWorkflowQuerySchema.safeParse({ include: 'active-deployment' }).success).toBe(true);
    expect(getWorkflowQuerySchema.safeParse({ include: 'draft-version' }).success).toBe(false);
    expect(WORKFLOW_INCLUDE_PERMISSIONS).toEqual({
      'latest-published-version': ['workflows:read'],
      'active-deployment': ['workflows:read'],
    });
  });

  it('replaces a draft with a whole definition and its lock version (C116.1)', () => {
    const body = { data: { attributes: { definition, 'lock-version': 3 } } };
    expect(putWorkflowDraftBodySchema.parse(body)).toEqual(body);
    expect(
      putWorkflowDraftBodySchema.safeParse({ data: { attributes: { definition } } }).success,
    ).toBe(false);
    expect(
      putWorkflowDraftBodySchema.safeParse({
        data: { attributes: { definition: { steps: [] }, 'lock-version': 3 } },
      }).success,
    ).toBe(false);
  });

  it('validates the stored draft, or any JSON, so a bad shape answers with its pointers', () => {
    expect(validateWorkflowDraftBodySchema.safeParse(undefined).success).toBe(true);
    expect(
      validateWorkflowDraftBodySchema.safeParse({
        data: { attributes: { definition: { steps: 'no' } } },
      }).success,
    ).toBe(true);
  });

  it('answers a check with errors and warnings together (C113.6)', () => {
    const issue = { pointer: '/steps/3/config/url', code: 'pii_in_url', detail: 'Use the body.' };
    const document = { meta: { valid: false, errors: [issue], warnings: [] } };
    expect(workflowDefinitionCheckDocumentSchema.parse(document)).toEqual(document);
  });

  it('publishes with a rollout of 1 to 100, a note and acknowledgements (C116.4)', () => {
    const body = {
      meta: {
        'rollout-percentage': 25,
        description: 'Adds the review.',
        acknowledgements: ['egress:notify', 'irreversible:forget'],
      },
    };
    expect(publishWorkflowBodySchema.parse(body)).toEqual(body);
    expect(publishWorkflowBodySchema.safeParse(undefined).success).toBe(true);
    expect(publishWorkflowBodySchema.safeParse({ meta: { 'rollout-percentage': 0 } }).success).toBe(
      false,
    );
  });

  it('moves a rollout from 0 to 100, and needs the number (C116.3)', () => {
    expect(rolloutWorkflowBodySchema.safeParse({ meta: { 'rollout-percentage': 0 } }).success).toBe(
      true,
    );
    expect(
      rolloutWorkflowBodySchema.safeParse({ meta: { 'rollout-percentage': 101 } }).success,
    ).toBe(false);
    expect(rolloutWorkflowBodySchema.safeParse({ meta: {} }).success).toBe(false);
  });

  it('restores a named version, and promotes to a named environment', () => {
    expect(restoreWorkflowBodySchema.safeParse({ meta: { 'version-id': WFV } }).success).toBe(true);
    expect(restoreWorkflowBodySchema.safeParse({ meta: { 'version-id': WFL } }).success).toBe(
      false,
    );
    expect(
      promoteWorkflowBodySchema.safeParse({
        meta: { 'environment-id': 'env_01M5CM00000000000000000005' },
      }).success,
    ).toBe(true);
    expect(promoteWorkflowBodySchema.safeParse({ meta: { 'environment-id': WFL } }).success).toBe(
      false,
    );
  });

  it('needs a workflow to list its versions, and another version to diff against', () => {
    expect(listWorkflowVersionsQuerySchema.safeParse({ 'filter[workflow-id]': WFL }).success).toBe(
      true,
    );
    expect(listWorkflowVersionsQuerySchema.safeParse({}).success).toBe(false);
    expect(workflowVersionDiffQuerySchema.safeParse({ against: WFV2 }).success).toBe(true);
    expect(workflowVersionDiffQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe('the acknowledgements (C116.4)', () => {
  it.each([
    'egress:notify',
    'irreversible:forget',
    'heuristic:decline',
    'override-failed:approve',
    'unconfirmed:mail_them',
  ])('takes %s', (key) => {
    expect(workflowAcknowledgementKeySchema.safeParse(key).success).toBe(true);
  });

  it.each(['egress', 'egress:', 'other:notify', 'egress:Notify', ':notify', 'notify'])(
    'refuses %j',
    (key) => {
      expect(workflowAcknowledgementKeySchema.safeParse(key).success).toBe(false);
    },
  );
});

describe('the version resource (C112.4)', () => {
  const published = {
    ...draft,
    status: 'published' as const,
    triggerType: 'trigger-event' as const,
    live: true,
    publishedAt: LATER,
    description: 'First.',
    definitionSha256: 'a'.repeat(64),
    grant: { scopes: ['inquiries:write' as const], pii: false },
  };

  it('builds a draft, with no grant and no publish time', () => {
    const { attributes } = buildWorkflowVersionResource(draft);
    expect(attributes.status).toBe('draft');
    expect(attributes.grant).toBeNull();
    expect(attributes['lock-version']).toBe(3);
  });

  it('builds a published version with its frozen grant', () => {
    expect(buildWorkflowVersionResource(published).attributes.grant).toEqual({
      scopes: ['inquiries:write'],
      pii: false,
    });
  });

  it('is a draft exactly when it was never published', () => {
    expect(() => buildWorkflowVersionResource({ ...draft, publishedAt: AT })).toThrow();
    expect(() => buildWorkflowVersionResource({ ...published, publishedAt: null })).toThrow();
  });

  it('holds API scopes in a grant, never an operator permission (C121.2)', () => {
    expect(workflowGrantSchema.safeParse({ scopes: ['pii:view'], pii: true }).success).toBe(false);
    expect(
      workflowGrantSchema.safeParse({ scopes: ['environments:production'], pii: false }).success,
    ).toBe(false);
  });

  it('names its updater by id, never by an email address (decision 64)', () => {
    const { attributes } = buildWorkflowVersionResource(published);
    expect(
      workflowVersionAttributesSchema.safeParse({
        ...attributes,
        'last-updater': 'someone@example.test',
      }).success,
    ).toBe(false);
  });

  it('refuses a rollout outside 1 to 100 and a digest that is not hex', () => {
    expect(() => buildWorkflowVersionResource({ ...published, rolloutPercentage: 0 })).toThrow();
    expect(() => buildWorkflowVersionResource({ ...published, definitionSha256: 'zz' })).toThrow();
  });

  it('carries no definition in an event', () => {
    const { attributes } = buildWorkflowVersionResource({ ...published, definition: null });
    expect(attributes.definition).toBeNull();
  });
});

describe('the deployment resource (C116.3)', () => {
  it('builds with the public configuration', () => {
    const resource = buildWorkflowDeploymentResource({
      id: WFD,
      workflowId: WFL,
      status: 'active',
      versions: [
        { token: WFV, percentage: 25, label: 'treatment' },
        { token: WFV2, percentage: 75, label: 'control' },
      ],
      createdAt: AT,
      updatedAt: LATER,
    });
    expect(resource.attributes.configuration.versions).toHaveLength(2);
    expect(resource.relationships.workflow.data.id).toBe(WFL);
  });
});

describe('the webhook filters of the new subjects (C143.4)', () => {
  it('filters a workflow, version or run event by workflow, and a list event by list', () => {
    const filters = {
      'workflow-ids': [WFL],
      'list-ids': ['lst_01M5CK3190XEVBM5ZXA76E1JSN'],
    };
    expect(webhookFiltersSchema.parse(filters)).toEqual(filters);
    expect(webhookFiltersSchema.safeParse({ 'workflow-ids': [WFV] }).success).toBe(false);
    expect(webhookFiltersSchema.safeParse({ 'list-ids': [WFL] }).success).toBe(false);
  });

  it('filters a case event by its template (C143.4)', () => {
    const filters = { 'case-template-ids': ['ctmpl_01M5CN00000000000000000002'] };
    expect(webhookFiltersSchema.parse(filters)).toEqual(filters);
    expect(webhookFiltersSchema.safeParse({ 'case-template-ids': [WFL] }).success).toBe(false);
  });
});
