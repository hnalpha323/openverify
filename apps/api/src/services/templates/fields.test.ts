/**
 * C149.2, C149.3, C149.5 (Workflow 9A): every write of an inquiry's `fields` is checked against the
 * pinned version's `field-schemas`: an unknown key is 422 `field_unknown`, a set write-once value
 * 422 `field_write_once`, a value of the wrong type or past its `max-length` 422 at its pointer,
 * `strip-html` removes tags, and `fields` past 256 KiB are 422 `fields_too_large` with `size` and
 * `limit` on every path. Each refusal names its pointer, never the value. Values are synthetic.
 */
import { MAX_INQUIRY_FIELDS_BYTES } from '@openverify/contracts';
import { inquiryTemplateVersions } from '@openverify/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInquiryTestApi, type InquiryTestApi } from '../inquiries.test-support.js';
import { bearer, createTemplate } from '../../test-support/harness.js';
import { validateInquiryFieldsWrite } from './fields.js';

let api: InquiryTestApi;
let templateId: string;
let versionId: string;

const FIELD_SCHEMAS = [
  { key: 'name_first', type: 'string', label: 'First name', pii: true, 'max-length': 20 },
  { key: 'member_number', type: 'string', label: 'Member', pii: true, 'write-once': true },
  { key: 'bio', type: 'string', label: 'About', pii: true, 'strip-html': true },
  { key: 'age', type: 'integer', label: 'Age', pii: true },
  { key: 'visit_date', type: 'date', label: 'Visit', pii: false },
  {
    key: 'plan',
    type: 'choices',
    label: 'Plan',
    pii: false,
    choices: [{ value: 'basic', label: 'Basic' }],
  },
];

beforeAll(async () => {
  api = await createInquiryTestApi();
  templateId = await createTemplate(api, api.token);
  const template = await api.app.inject({
    method: 'GET',
    url: `/api/v1/inquiry-templates/${templateId}`,
    headers: bearer(api.token),
  });
  versionId = template.json<{ data: { attributes: { 'current-version': { id: string } } } }>().data
    .attributes['current-version'].id;
  await api.database.db
    .update(inquiryTemplateVersions)
    .set({ fieldSchemas: FIELD_SCHEMAS })
    .where(eq(inquiryTemplateVersions.id, versionId));
});

afterAll(async () => {
  await api.close();
});

const create = (fields: Record<string, unknown>) =>
  api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiries',
    headers: bearer(api.token),
    payload: { data: { attributes: { 'inquiry-template-id': templateId, fields } } },
  });

const patch = (id: string, fields: Record<string, unknown>) =>
  api.app.inject({
    method: 'PATCH',
    url: `/api/v1/inquiries/${id}`,
    headers: bearer(api.token),
    payload: { data: { attributes: { fields } } },
  });

const problem = (response: { json: () => unknown }) =>
  response.json() as { code?: string; errors?: { pointer: string; code?: string }[] };

describe('the version field rules on create and PATCH (C149.2, C149.3)', () => {
  it('accepts declared values of their types', async () => {
    const response = await create({ name_first: 'Alex', age: 30, plan: 'basic' });
    expect(response.statusCode).toBe(201);
  });

  it('refuses an unknown key with field_unknown at its pointer, never echoing the value', async () => {
    const response = await create({ name_first: 'Alex', favourite_colour: 'teal-canary' });
    expect(response.statusCode).toBe(422);
    expect(problem(response)).toMatchObject({
      code: 'field_unknown',
      errors: [{ pointer: '/data/attributes/fields/favourite_colour', code: 'field_unknown' }],
    });
    expect(response.body).not.toContain('teal-canary');
  });

  it('refuses a wrong type, a value past max-length and an unknown choice at their pointers', async () => {
    const response = await create({ name_first: 'x'.repeat(21), age: 'thirty', plan: 'gold' });
    expect(response.statusCode).toBe(422);
    expect(problem(response).errors?.map(({ pointer, code }) => ({ pointer, code }))).toEqual([
      { pointer: '/data/attributes/fields/name_first', code: 'field_too_long' },
      { pointer: '/data/attributes/fields/age', code: 'field_type_invalid' },
      { pointer: '/data/attributes/fields/plan', code: 'field_type_invalid' },
    ]);
  });

  it('refuses a change to a write-once value that is set, and accepts it unchanged', async () => {
    const created = await create({ member_number: 'M-0001' });
    const { id } = created.json<{ data: { id: string } }>().data;
    expect((await patch(id, { member_number: 'M-0001', name_first: 'Sam' })).statusCode).toBe(200);
    const changed = await patch(id, { member_number: 'M-0002' });
    expect(changed.statusCode).toBe(422);
    expect(problem(changed)).toMatchObject({
      code: 'field_write_once',
      errors: [{ pointer: '/data/attributes/fields/member_number' }],
    });
  });

  it('refuses an impossible calendar day for a date field, and takes a leap day (R003)', async () => {
    const refused = await create({ visit_date: '2023-02-29' });
    expect(refused.statusCode).toBe(422);
    expect(problem(refused)).toMatchObject({
      errors: [{ pointer: '/data/attributes/fields/visit_date' }],
    });
    expect((await create({ visit_date: '2024-02-29' })).statusCode).toBe(201);
  });

  it('refuses fields past 256 KiB with fields_too_large, its size and limit', async () => {
    // Each value stays within the contract's 10,000 characters; together they pass 256 KiB.
    const response = await create(
      Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [`k_${String(i)}`, 'a'.repeat(9000)]),
      ),
    );
    expect(response.statusCode).toBe(422);
    const body = problem(response) as { code?: string; size?: number; limit?: number };
    expect(body.code).toBe('fields_too_large');
    expect(body.limit).toBe(MAX_INQUIRY_FIELDS_BYTES);
    expect(body.size).toBeGreaterThan(MAX_INQUIRY_FIELDS_BYTES);
  });
});

describe('the other write paths (C149.3, C149.5)', () => {
  it('answers the values to write with strip-html applied, and points into a screen submission', async () => {
    const written = await validateInquiryFieldsWrite(api.database.db, {
      kind: 'screen',
      environmentId: api.environmentId,
      versionId,
      fields: { bio: 'I <b>like</b> <script>x</script>maps', name_first: 'Alex' },
    });
    expect(written).toEqual({ bio: 'I like xmaps', name_first: 'Alex' });
    await expect(
      validateInquiryFieldsWrite(api.database.db, {
        kind: 'screen',
        environmentId: api.environmentId,
        versionId,
        fields: { unknown_key: 'x' },
      }),
    ).rejects.toMatchObject({
      code: 'field_unknown',
      errors: [{ pointer: '/values/unknown_key', code: 'field_unknown' }],
    });
  });

  it('keeps an untyped record for a version without field-schemas, under the size cap', async () => {
    const otherTemplate = await createTemplate(api, api.token);
    const response = await create({ name_first: 'Alex' });
    expect(response.statusCode).toBe(201);
    const untyped = await api.app.inject({
      method: 'POST',
      url: '/api/v1/inquiries',
      headers: bearer(api.token),
      payload: {
        data: { attributes: { 'inquiry-template-id': otherTemplate, fields: { anything: 'x' } } },
      },
    });
    expect(untyped.statusCode).toBe(201);
  });
});
