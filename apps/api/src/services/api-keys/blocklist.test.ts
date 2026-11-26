/**
 * C169.3 (S4; review P22; Workflow 9B, `api-keys-webhooks`): a key's attribute blocklist removes the
 * names it lists from every document served to that key, recursively, at every exit, keeping ids,
 * types and relationships. One test per exit (top-level `data`, `included[]`, an event's `payload`,
 * export columns, bulk-report results, the `meta` of asynchronous jobs, problems), and one per
 * resource family over every golden document of `contracts/fixtures/api/`. Every value is synthetic.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ApiKeyPrincipal, Principal } from '../../ports.js';
import {
  applyKeyAttributeBlocklist,
  blockDocumentAttributes,
  blockExportColumns,
  keyAttributeBlocklistOf,
} from './blocklist.js';

const principal = {
  kind: 'api-key',
  apiKeyId: 'key_synthetic',
  attributeBlocklist: ['birthdate'],
} as unknown as ApiKeyPrincipal;

const JSON_API = 'application/vnd.api+json; charset=utf-8';
const PROBLEM = 'application/problem+json; charset=utf-8';

/** The hook as the plugin calls it, on a serialized body, read back as JSON. */
function served(document: unknown, blocklist: readonly string[], contentType = JSON_API): unknown {
  const sent = applyKeyAttributeBlocklist(JSON.stringify(document), {
    principal,
    blocklist,
    contentType,
  });
  expect(typeof sent).toBe('string');
  return JSON.parse(sent as string) as unknown;
}

const inquiry = {
  type: 'inquiry',
  id: 'inq_synthetic',
  attributes: {
    status: 'completed',
    birthdate: '1990-01-01',
    'reference-id': 'ref-synthetic',
    fields: { birthdate: '1990-01-01', name_first: 'Alex' },
  },
  relationships: { account: { data: { type: 'account', id: 'act_synthetic' } } },
  links: { self: '/api/v1/inquiries/inq_synthetic' },
};

describe('the exits (C169.3; review P22)', () => {
  it('top-level data: removes the names at any depth of the attributes, keeping type, id, relationships and links', () => {
    expect(served({ data: inquiry }, ['birthdate', 'reference-id'])).toEqual({
      data: {
        ...inquiry,
        attributes: { status: 'completed', fields: { name_first: 'Alex' } },
      },
    });
  });

  it('top-level data of a list, and a whole object by its name (`fields`)', () => {
    expect(served({ data: [inquiry, inquiry], links: { next: null } }, ['fields'])).toEqual({
      data: [inquiry, inquiry].map((resource) => ({
        ...resource,
        attributes: {
          status: 'completed',
          birthdate: '1990-01-01',
          'reference-id': 'ref-synthetic',
        },
      })),
      links: { next: null },
    });
  });

  it('included[]', () => {
    const account = {
      type: 'account',
      id: 'act_synthetic',
      attributes: { birthdate: '1990-01-01', status: 'active' },
    };

    expect(served({ data: inquiry, included: [account] }, ['birthdate'])).toMatchObject({
      included: [{ type: 'account', id: 'act_synthetic', attributes: { status: 'active' } }],
    });
  });

  it('the payload of GET /events and GET /events/:id, with the embedded document kept whole', () => {
    const event = {
      type: 'event',
      id: 'evt_synthetic',
      attributes: {
        name: 'inquiry.completed',
        payload: { data: inquiry, included: [{ ...inquiry, id: 'inq_other' }] },
        'created-at': '2026-11-06T12:00:00.000Z',
      },
    };

    const one = served({ data: event }, ['birthdate', 'data', 'included', 'type', 'id']) as {
      data: { attributes: { payload: { data: unknown; included: unknown[] } } };
    };
    const listed = served({ data: [event] }, ['birthdate']) as {
      data: { attributes: { payload: { data: { attributes: object } } } }[];
    };

    expect(one.data.attributes.payload.data).toEqual({
      ...inquiry,
      attributes: {
        status: 'completed',
        'reference-id': 'ref-synthetic',
        fields: { name_first: 'Alex' },
      },
    });
    expect(one.data.attributes.payload.included).toHaveLength(1);
    expect(listed.data[0]?.attributes.payload.data.attributes).not.toHaveProperty('birthdate');
  });

  it('export columns: a blocked attribute and the columns under it go, the id stays', () => {
    expect(
      blockExportColumns(
        ['id', 'status', 'reference-id', 'fields', 'fields.birthdate', 'fields.name_first'],
        ['reference-id', 'fields', 'id'],
      ),
    ).toEqual(['id', 'status']);
    expect(blockExportColumns(['id', 'fields.birthdate'], [])).toEqual(['id', 'fields.birthdate']);
  });

  it('bulk-report results: the job document’s attributes and its rows', () => {
    const job = {
      data: {
        type: 'report-bulk-job',
        id: 'rbulk_synthetic',
        attributes: {
          status: 'completed',
          rows: [{ row: 1, outcome: 'created', 'report-id': 'rep_synthetic', 'error-code': null }],
        },
      },
    };

    expect(served(job, ['report-id'])).toEqual({
      data: {
        ...job.data,
        attributes: {
          status: 'completed',
          rows: [{ row: 1, outcome: 'created', 'error-code': null }],
        },
      },
    });
  });

  it('the meta of an asynchronous job: names in it and resources under it', () => {
    const document = {
      data: { type: 'export', id: 'exp_synthetic', attributes: { status: 'pending' } },
      meta: { birthdate: '1990-01-01', result: { data: inquiry }, 'job-id': 'synthetic' },
    };

    expect(served(document, ['birthdate'])).toEqual({
      data: document.data,
      meta: {
        result: {
          data: {
            ...inquiry,
            attributes: {
              status: 'completed',
              'reference-id': 'ref-synthetic',
              fields: { name_first: 'Alex' },
            },
          },
        },
        'job-id': 'synthetic',
      },
    });
  });

  it('problems: an extension member named by the list goes, the RFC 9457 members and errors stay', () => {
    const problem = {
      type: 'https://openverify.dev/problems/conflict',
      title: 'Conflict',
      status: 409,
      detail: 'The inquiry changed.',
      code: 'conflict',
      birthdate: '1990-01-01',
      current: { data: inquiry },
      errors: [{ detail: 'is required', pointer: '/data/attributes/birthdate' }],
    };

    expect(
      served(
        problem,
        ['birthdate', 'type', 'title', 'status', 'detail', 'code', 'errors'],
        PROBLEM,
      ),
    ).toEqual({
      type: problem.type,
      title: 'Conflict',
      status: 409,
      detail: 'The inquiry changed.',
      code: 'conflict',
      current: {
        data: {
          ...inquiry,
          // The list names `status`: the problem keeps its own, the inquiry loses its attribute.
          attributes: {
            'reference-id': 'ref-synthetic',
            fields: { name_first: 'Alex' },
          },
        },
      },
      errors: problem.errors,
    });
  });
});

describe('what the hook sends', () => {
  it('a Buffer of JSON is read too, and sent as a string', () => {
    const sent = applyKeyAttributeBlocklist(Buffer.from(JSON.stringify({ data: inquiry })), {
      principal,
      blocklist: ['birthdate'],
      contentType: 'application/json',
    });

    expect(JSON.parse(sent as string)).toMatchObject({
      data: { attributes: { status: 'completed' } },
    });
    expect(sent as string).not.toContain('birthdate');
  });

  it('a body that is not JSON passes as it is: a file, a CSV, nothing', () => {
    const image = Buffer.from([0xff, 0xd8, 0xff]);
    const csv = 'id,birthdate\r\ninq_synthetic,1990-01-01\r\n';
    const context = { principal, blocklist: ['birthdate'] };

    expect(applyKeyAttributeBlocklist(image, { ...context, contentType: 'image/jpeg' })).toBe(
      image,
    );
    expect(applyKeyAttributeBlocklist(csv, { ...context, contentType: 'text/csv' })).toBe(csv);
    expect(applyKeyAttributeBlocklist(undefined, { ...context, contentType: undefined })).toBe(
      undefined,
    );
  });

  it('a JSON body that does not parse is not sent (fail closed)', () => {
    expect(
      applyKeyAttributeBlocklist('{"data":{"attributes":{"birthdate":"1990-', {
        principal,
        blocklist: ['birthdate'],
        contentType: JSON_API,
      }),
    ).toBe('');
  });

  it('a JSON body without a content type is still read', () => {
    expect(
      applyKeyAttributeBlocklist(JSON.stringify({ data: inquiry }), {
        principal,
        blocklist: ['birthdate'],
        contentType: undefined,
      }),
    ).not.toContain('birthdate');
  });

  it('never changes the document it is given', () => {
    const document = structuredClone({ data: inquiry });

    blockDocumentAttributes(document, ['birthdate', 'fields']);

    expect(document).toEqual({ data: inquiry });
  });

  it('reads a key’s blocklist from its principal, and none for a user', () => {
    const user = { kind: 'user', userId: 'usr_synthetic' } as unknown as Principal;
    const bare = { kind: 'api-key', apiKeyId: 'key_synthetic' } as unknown as Principal;

    expect(keyAttributeBlocklistOf(principal)).toEqual(['birthdate']);
    expect(keyAttributeBlocklistOf(bare)).toEqual([]);
    expect(keyAttributeBlocklistOf(user)).toEqual([]);
  });
});

// Resource families ---------------------------------------------------------------------------

const FIXTURES = new URL('../../../../../contracts/fixtures/api/', import.meta.url);

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isResource = (value: unknown): value is Json =>
  isObject(value) && typeof value.type === 'string' && isObject(value.attributes);

/** Every resource object in a document: data, included, and those embedded in attributes. */
function resourcesOf(value: unknown, found: Json[] = []): Json[] {
  if (Array.isArray(value)) {
    value.forEach((item) => resourcesOf(item, found));
  } else if (isObject(value)) {
    if (isResource(value)) found.push(value);
    Object.values(value).forEach((item) => resourcesOf(item, found));
  }
  return found;
}

/** The resources of `data` and `included`. */
function topLevel(document: unknown): Json[] {
  if (!isObject(document)) return [];
  const data: unknown[] = Array.isArray(document.data) ? document.data : [document.data];
  const included: unknown[] = Array.isArray(document.included) ? document.included : [];
  return [...data, ...included].filter(isObject);
}

/** Every member name at any depth of an object. */
function namesIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => namesIn(item, found));
  } else if (isObject(value)) {
    for (const [name, item] of Object.entries(value)) {
      found.add(name);
      namesIn(item, found);
    }
  }
  return found;
}

const documents = readdirSync(FIXTURES)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({
    name,
    document: JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as unknown,
  }))
  .filter(({ document }) => isObject(document) && resourcesOf(document.data).length > 0);

describe('every resource family of the golden documents (C169.3)', () => {
  it('has golden documents to read', () => {
    expect(documents.length).toBeGreaterThan(100);
  });

  it.each(documents.map(({ name, document }) => [name, document] as const))(
    '%s: every top-level attribute blocked leaves each resource its type, id and relationships only',
    (_, document) => {
      const before = resourcesOf(document);
      const blocklist = [
        ...new Set(before.flatMap((resource) => Object.keys(resource.attributes as Json))),
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      ].filter((name) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name));

      const sent = served(document, blocklist);
      const after = resourcesOf(sent);

      const outer = (resources: Json[]) =>
        resources.map(({ type, id, relationships, links }) => ({ type, id, relationships, links }));
      expect(outer(topLevel(sent))).toEqual(outer(topLevel(document)));
      for (const resource of after) {
        const left = namesIn(resource.attributes);
        expect(
          blocklist.filter((name) => left.has(name)),
          `${String(resource.type)} ${String(resource.id)}`,
        ).toEqual([]);
      }
    },
  );
});
