import { DEFAULT_CASE_RESOLUTIONS, DEFAULT_CASE_STATUSES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  buildCaseTemplateResource,
  buildCaseTemplateVersionResource,
  caseTemplateDeletedFieldMetaSchema,
  caseTemplateDocumentSchema,
  caseTemplateKeySchema,
  caseTemplateVersionDocumentSchema,
  createCaseTemplateBodySchema,
  createCaseTemplateVersionBodySchema,
  listCaseTemplatesQuerySchema,
  updateCaseTemplateBodySchema,
  updateCaseTemplateVersionBodySchema,
  type CaseTemplateRecord,
  type CaseTemplateVersionRecord,
} from './case-templates.js';
import { readFixture } from './test-support.js';

const AT = new Date('2026-10-20T12:00:00.000Z');
const LATER = new Date('2026-10-20T12:05:00.000Z');
const TEMPLATE = 'ctmpl_01M5CN00000000000000000002';
const VERSION = 'ctmplv_01M5CN00000000000000000003';
const DRAFT = 'ctmplv_01M5CN00000000000000000004';

const body = (attributes: Record<string, unknown>) => ({ data: { attributes } });
const accepted = (attributes: Record<string, unknown>) =>
  createCaseTemplateBodySchema.safeParse(body({ name: 'Review', key: 'KYC', ...attributes }))
    .success;

describe('case templates (C130.1, C129.3)', () => {
  it('builds the golden template', () => {
    const golden = caseTemplateDocumentSchema.parse(readFixture('api/case-template.json'));
    const { attributes } = golden.data;
    const record: CaseTemplateRecord = {
      id: TEMPLATE,
      name: attributes.name,
      key: attributes.key,
      status: attributes.status,
      visibleToRoles: attributes['visible-to-roles'],
      resolutions: attributes.resolutions,
      fieldSchemas: attributes['field-schemas'],
      publishedVersion: 1,
      publishedVersionId: VERSION,
      draftVersion: 2,
      draftVersionId: DRAFT,
      createdAt: AT,
      updatedAt: LATER,
      archivedAt: null,
    };
    expect(buildCaseTemplateResource(record)).toEqual(golden.data);
  });

  it('reads a key of 2 to 10 capitals and digits, starting with a capital', () => {
    expect(caseTemplateKeySchema.safeParse('KYC').success).toBe(true);
    expect(caseTemplateKeySchema.safeParse('A1').success).toBe(true);
    expect(caseTemplateKeySchema.safeParse('A').success).toBe(false);
    expect(caseTemplateKeySchema.safeParse('kyc').success).toBe(false);
    expect(caseTemplateKeySchema.safeParse('1KYC').success).toBe(false);
    expect(caseTemplateKeySchema.safeParse('ABCDEFGHIJK').success).toBe(false);
  });

  it('takes a name and a key, and the defaults stand for the rest', () => {
    expect(accepted({})).toBe(true);
    expect(accepted({ key: 'kyc' })).toBe(false);
    expect(accepted({ name: 'x'.repeat(81) })).toBe(false);
    expect(createCaseTemplateBodySchema.safeParse(body({ key: 'KYC' })).success).toBe(false);
  });

  it('holds the key: a PATCH changes the name and the roles, nothing else', () => {
    const update = (attributes: Record<string, unknown>) =>
      updateCaseTemplateBodySchema.safeParse(body(attributes)).success;
    expect(update({ name: 'Renamed' })).toBe(true);
    expect(update({ 'visible-to-roles': ['role_01M5CN00000000000000000012'] })).toBe(true);
    expect(update({ key: 'NEW' })).toBe(false);
    expect(update({ statuses: DEFAULT_CASE_STATUSES })).toBe(false);
    expect(update({})).toBe(false);
  });

  it('filters by status and key', () => {
    expect(
      listCaseTemplatesQuerySchema.safeParse({ 'filter[status]': 'active,archived' }).success,
    ).toBe(true);
    expect(listCaseTemplatesQuerySchema.safeParse({ 'filter[status]': 'draft' }).success).toBe(
      false,
    );
  });
});

describe('case template versions (C130.2)', () => {
  it('builds the golden version', () => {
    const golden = caseTemplateVersionDocumentSchema.parse(
      readFixture('api/case-template-version.json'),
    );
    const { attributes } = golden.data;
    const record: CaseTemplateVersionRecord = {
      id: VERSION,
      caseTemplateId: TEMPLATE,
      versionNumber: 1,
      status: attributes.status,
      fieldSchemas: attributes['field-schemas'],
      statuses: attributes.statuses,
      resolutions: attributes.resolutions,
      transitions: attributes.transitions,
      defaultQueueId: attributes['default-queue-id'],
      assignmentPolicyId: attributes['assignment-policy-id'],
      slaPolicyId: attributes['sla-policy-id'],
      slaStartsOn: attributes['sla-starts-on'],
      heldObjectTypes: attributes['held-object-types'],
      attachmentPolicy: attributes['attachment-policy'],
      notifyOnCreate: attributes['notify-on-create'],
      layoutModules: attributes['layout-modules'],
      createdAt: AT,
      publishedAt: LATER,
    };
    expect(buildCaseTemplateVersionResource(record)).toEqual(golden.data);
  });

  it('takes the defaults, with statuses in the public categories', () => {
    expect(
      accepted({ statuses: DEFAULT_CASE_STATUSES, resolutions: DEFAULT_CASE_RESOLUTIONS }),
    ).toBe(true);
  });

  it('needs exactly one initial status, at least one end, and distinct keys', () => {
    const open = DEFAULT_CASE_STATUSES[0];
    const done = DEFAULT_CASE_STATUSES[2];
    expect(accepted({ statuses: [open, done] })).toBe(true);
    expect(accepted({ statuses: [done, { ...done, key: 'other' }] })).toBe(false);
    expect(accepted({ statuses: [open, { ...open, key: 'other' }] })).toBe(false);
    expect(accepted({ statuses: [open, { ...open, key: 'other' }, done] })).toBe(false);
    expect(accepted({ statuses: [open, done, done] })).toBe(false);
  });

  it('refuses a transition that names no status of the version', () => {
    const statuses = DEFAULT_CASE_STATUSES;
    expect(accepted({ statuses, transitions: { open: ['approved'] } })).toBe(true);
    expect(accepted({ statuses, transitions: { open: ['closed'] } })).toBe(false);
    expect(accepted({ statuses, transitions: { closed: ['open'] } })).toBe(false);
  });

  it('refuses a file or json field at any depth, and keeps platform-file (F37)', () => {
    const fields = (field: Record<string, unknown>) => ({ 'field-schemas': [field] });
    expect(accepted(fields({ type: 'platform-file', key: 'photo', label: 'Photo' }))).toBe(true);
    expect(accepted(fields({ type: 'file', key: 'scan', label: 'Scan' }))).toBe(false);
    expect(
      accepted(
        fields({
          type: 'json',
          key: 'blob',
          label: 'Blob',
          config: { 'json-schema': { type: 'object' } },
        }),
      ),
    ).toBe(false);
    expect(
      accepted(
        fields({
          type: 'hash',
          key: 'outer',
          label: 'Outer',
          config: { 'item-schemas': [{ type: 'file', key: 'scan', label: 'Scan' }] },
        }),
      ),
    ).toBe(false);
  });

  it('holds the attachment policy to 20 files of the four types (decision 62)', () => {
    const policy = (attachmentPolicy: Record<string, unknown>) =>
      accepted({ 'attachment-policy': attachmentPolicy });
    expect(policy({ 'max-files': 20, types: ['jpeg', 'pdf'] })).toBe(true);
    expect(policy({ 'max-files': 21, types: ['jpeg'] })).toBe(false);
    expect(policy({ 'max-files': 5, types: ['gif'] })).toBe(false);
    expect(policy({ 'max-files': 5, types: ['jpeg', 'jpeg'] })).toBe(false);
  });

  it('names a module with what a reader needs, and takes each once', () => {
    const modules = (layout: unknown) => accepted({ 'layout-modules': layout });
    expect(modules([{ key: 'graph', 'required-permissions': ['graph:read'] }])).toBe(true);
    expect(modules([{ key: 'graph', 'required-permissions': ['graph:look'] }])).toBe(false);
    expect(
      modules([
        { key: 'graph', 'required-permissions': [] },
        { key: 'graph', 'required-permissions': [] },
      ]),
    ).toBe(false);
    expect(modules([{ key: 'checklist', 'required-permissions': [] }])).toBe(false);
  });

  it('opens a draft from a template, and changes it with something to change', () => {
    expect(
      createCaseTemplateVersionBodySchema.safeParse(body({ 'case-template-id': TEMPLATE })).success,
    ).toBe(true);
    expect(updateCaseTemplateVersionBodySchema.safeParse(body({})).success).toBe(false);
    expect(
      updateCaseTemplateVersionBodySchema.safeParse(body({ 'sla-starts-on': 'assigned' })).success,
    ).toBe(true);
    expect(
      updateCaseTemplateVersionBodySchema.safeParse(body({ 'sla-starts-on': 'resolved' })).success,
    ).toBe(false);
  });

  it('refuses a published version without its time, and a draft with one', () => {
    const golden = readFixture('api/case-template-version.json') as {
      data: { attributes: Record<string, unknown> };
    };
    const withAttributes = (changes: Record<string, unknown>) => ({
      data: { ...golden.data, attributes: { ...golden.data.attributes, ...changes } },
    });
    expect(
      caseTemplateVersionDocumentSchema.safeParse(withAttributes({ status: 'draft' })).success,
    ).toBe(false);
    expect(
      caseTemplateVersionDocumentSchema.safeParse(withAttributes({ 'published-at': null })).success,
    ).toBe(false);
  });

  it('names a dropped field by its key, never a value (H29)', () => {
    expect(
      caseTemplateDeletedFieldMetaSchema.safeParse({ 'field-key': 'contact', 'version-number': 2 })
        .success,
    ).toBe(true);
    expect(caseTemplateDeletedFieldMetaSchema.safeParse({ 'field-key': 'contact' }).success).toBe(
      false,
    );
  });
});
