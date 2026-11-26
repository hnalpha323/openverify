/**
 * Workflow 9D (`fix-api`): the contract changes of the review, read through the package root so the
 * index line is held too.
 *
 * - K9-22 (DS8): `GET /dashboard/users/:id/permissions` answers what a user holds, the
 *   organisation-level permissions once as organisation-wide and the environment-level ones per
 *   environment, with whether the user may enter each environment (C167.2).
 * - K9-29 (S4B-14, EX2): a list export of a kind with no importer is refused with its own code,
 *   `export_list_kind_refused` (422), and a list export's columns are the importer's for its kind,
 *   so `EXPORT_CSV_COLUMNS` holds no fixed columns for lists.
 *
 * Every value is synthetic.
 */
import { EXPORT_OBJECT_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as contracts from './index.js';
import { readFixture } from './test-support.js';

const pick = (name: string): unknown => (contracts as Readonly<Record<string, unknown>>)[name];
const schema = (name: string): z.ZodType => {
  const found = pick(name);
  expect(found, name).toBeDefined();
  return found as z.ZodType;
};
const parses = (name: string, value: unknown) => schema(name).safeParse(value).success;

const USER = 'usr_01M5CN00000000000000009D21';
const SANDBOX = 'env_01M5CN00000000000000009D40';

const permissionsDocument = (attributes: unknown) => ({
  data: { type: 'user-effective-permissions', id: USER, attributes },
});

describe('a user’s effective permissions (K9-22, DS8, C167.2)', () => {
  it('parses its golden fixture', () => {
    const fixture = readFixture('api/user-effective-permissions.json');
    expect(schema('userEffectivePermissionsDocumentSchema').parse(fixture)).toEqual(fixture);
  });

  it('holds organisation-level permissions only as organisation-wide, environment-level ones only per environment', () => {
    const name = 'userEffectivePermissionsDocumentSchema';
    expect(
      parses(
        name,
        permissionsDocument({
          organization: ['users:read'],
          environments: [
            { 'environment-id': SANDBOX, 'may-enter': true, permissions: ['inquiries:read'] },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      parses(name, permissionsDocument({ organization: ['inquiries:read'], environments: [] })),
    ).toBe(false);
    expect(
      parses(
        name,
        permissionsDocument({
          organization: [],
          environments: [
            { 'environment-id': SANDBOX, 'may-enter': true, permissions: ['users:read'] },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      parses(
        name,
        permissionsDocument({
          organization: [],
          environments: [
            { 'environment-id': SANDBOX, 'may-enter': true, permissions: ['no:such'] },
          ],
        }),
      ),
    ).toBe(false);
  });

  it('never holds a permission twice in one scope', () => {
    expect(
      parses(
        'userEffectivePermissionsDocumentSchema',
        permissionsDocument({ organization: ['users:read', 'users:read'], environments: [] }),
      ),
    ).toBe(false);
  });
});

describe('a refused list export, and the list columns (K9-29, C166.3)', () => {
  it('refuses a list kind with no importer with export_list_kind_refused (422), with its golden problem', () => {
    expect(pick('EXPORT_PROBLEM_STATUSES')).toMatchObject({ export_list_kind_refused: 422 });
    const problem = readFixture('problems/exports/export-list-kind-refused.json');
    expect(schema('problemSchema').parse(problem)).toMatchObject({
      status: 422,
      code: 'export_list_kind_refused',
    });
  });

  it('holds no fixed columns for lists, whose header is the importer’s columns of the list’s kind', () => {
    const columns = pick('EXPORT_CSV_COLUMNS') as Readonly<Record<string, unknown>>;
    expect(columns).not.toHaveProperty('lists');
    expect(Object.keys(columns).sort()).toEqual(
      EXPORT_OBJECT_TYPES.filter((type) => type !== 'lists').sort(),
    );
  });
});
