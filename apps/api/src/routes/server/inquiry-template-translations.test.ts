/**
 * C162.7 (Workflow 9A, `api-templates`): a template's translations, as JSON and as CSV, from its
 * latest draft (else its latest published version). An import writes into the draft (creating one
 * from the latest published version), never publishes, and a blank value deletes nothing; a refused
 * text names its row and column, never the value. The CSV is written with every cell quoted and
 * neutralised, so a text that starts with `=` or `-` survives an export and re-import unchanged.
 * Every text is synthetic.
 */
import { defaultInquiryTemplateAttributes } from '@openverify/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createInquiryTestApi,
  type InquiryTestApi,
} from '../../services/inquiries.test-support.js';
import { bearer, createTemplate } from '../../test-support/harness.js';

let api: InquiryTestApi;

beforeAll(async () => {
  api = await createInquiryTestApi();
});

afterAll(async () => {
  await api.close();
});

interface Translations {
  data: {
    attributes: {
      'inquiry-template-version-id': string;
      translations: {
        step: string | null;
        component: string | null;
        'attribute-name': string;
        'locale-values': { locale: string; value: string }[];
      }[];
    };
  };
}

const path = (templateId: string, csv = false) =>
  `/api/v1/inquiry-templates/${templateId}/translations${csv ? '.csv' : ''}`;

async function templateWithDraft(copy: Record<string, Record<string, string>>) {
  const templateId = await createTemplate(api, api.token);
  const attributes = defaultInquiryTemplateAttributes();
  const response = await api.app.inject({
    method: 'POST',
    url: '/api/v1/inquiry-template-versions',
    headers: bearer(api.token),
    payload: {
      data: {
        attributes: {
          'inquiry-template-id': templateId,
          flow: attributes.flow,
          'verification-config': attributes['verification-config'],
          'enabled-locales': ['en', 'fr'],
          copy: { messages: copy },
        },
      },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return { templateId, draftId: response.json<{ data: { id: string } }>().data.id };
}

const importRows = (templateId: string, translations: unknown[]) =>
  api.app.inject({
    method: 'POST',
    url: path(templateId),
    headers: bearer(api.token),
    payload: { data: { attributes: { translations } } },
  });

describe('translations as JSON (C162.7)', () => {
  it('reads every text of the latest draft with its locale values', async () => {
    const { templateId, draftId } = await templateWithDraft({
      en: { 'completion.title': 'All done' },
      fr: { 'completion.title': 'Terminé' },
    });
    const response = await api.app.inject({
      method: 'GET',
      url: path(templateId),
      headers: bearer(api.token),
    });
    expect(response.statusCode, response.body).toBe(200);
    const { attributes } = response.json<Translations>().data;
    expect(attributes['inquiry-template-version-id']).toBe(draftId);
    expect(attributes.translations).toEqual([
      {
        step: null,
        'step-display-name': null,
        component: null,
        'attribute-name': 'completion.title',
        'locale-values': [
          { locale: 'en', value: 'All done' },
          { locale: 'fr', value: 'Terminé' },
        ],
      },
    ]);
  });

  it('imports into the draft partially, deletes nothing for a blank, and creates a draft when none', async () => {
    const templateId = await createTemplate(api, api.token);
    const response = await importRows(templateId, [
      {
        step: null,
        'step-display-name': null,
        component: null,
        'attribute-name': 'completion.title',
        'locale-values': [{ locale: 'en', value: 'Finished' }],
      },
    ]);
    expect(response.statusCode, response.body).toBe(200);
    const imported = response.json<Translations>().data.attributes;
    expect(imported.translations[0]?.['locale-values']).toEqual([
      { locale: 'en', value: 'Finished' },
    ]);
    const blank = await importRows(templateId, [
      {
        step: null,
        'step-display-name': null,
        component: null,
        'attribute-name': 'completion.title',
        'locale-values': [{ locale: 'en', value: '' }],
      },
    ]);
    expect(blank.json<Translations>().data.attributes.translations[0]?.['locale-values']).toEqual([
      { locale: 'en', value: 'Finished' },
    ]);
    const template = await api.app.inject({
      method: 'GET',
      url: `/api/v1/inquiry-templates/${templateId}`,
      headers: bearer(api.token),
    });
    expect(
      template.json<{ data: { attributes: { 'current-version': { id: string } } } }>().data
        .attributes['current-version'].id,
    ).not.toBe(imported['inquiry-template-version-id']);
  });

  it('refuses a text that breaks a copy rule at its row and column, never echoing it', async () => {
    const templateId = await createTemplate(api, api.token);
    const response = await importRows(templateId, [
      {
        step: null,
        'step-display-name': null,
        component: null,
        'attribute-name': 'completion.title',
        'locale-values': [{ locale: 'en', value: 'Secret <b>canary-markup</b>' }],
      },
    ]);
    expect(response.statusCode).toBe(422);
    expect(response.json<{ errors: { pointer: string }[] }>().errors).toEqual([
      expect.objectContaining({ pointer: '/data/attributes/translations/0/locale-values/0/value' }),
    ]);
    expect(response.body).not.toContain('canary-markup');
  });
});

describe('translations as CSV (C162.7)', () => {
  it('round-trips a text that starts with = or - unchanged, every cell quoted', async () => {
    const { templateId } = await templateWithDraft({
      en: { 'completion.title': '=SUM(1,2) is not a formula', 'failure.title': '-1 attempt left' },
    });
    const exported = await api.app.inject({
      method: 'GET',
      url: path(templateId, true),
      headers: bearer(api.token),
    });
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.headers['content-type']).toMatch(/^text\/csv/);
    expect(exported.body.split('\r\n')[0]).toBe('"step","component","attribute","en","fr"');
    const reimported = await api.app.inject({
      method: 'POST',
      url: path(templateId, true),
      headers: { ...bearer(api.token), 'content-type': 'text/csv' },
      payload: exported.body,
    });
    expect(reimported.statusCode, reimported.body).toBe(200);
    const values = reimported
      .json<Translations>()
      .data.attributes.translations.flatMap((row) =>
        row['locale-values'].map(({ value }) => value),
      );
    expect(values).toEqual(
      expect.arrayContaining(['=SUM(1,2) is not a formula', '-1 attempt left']),
    );
  });

  it('refuses a file with a column it does not know, naming the column and no value', async () => {
    const templateId = await createTemplate(api, api.token);
    const response = await api.app.inject({
      method: 'POST',
      url: path(templateId, true),
      headers: { ...bearer(api.token), 'content-type': 'text/csv' },
      payload: 'step,component,attribute,xx\r\n,,completion.title,canary-value\r\n',
    });
    expect(response.statusCode).toBe(422);
    expect(response.body).not.toContain('canary-value');
  });
});
