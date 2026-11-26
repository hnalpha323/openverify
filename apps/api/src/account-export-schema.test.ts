/**
 * C253.2 (Workflow 11B Stage 1a (D)): the committed JSON Schema of `openverify.account-export.v1`
 * (`contracts/schemas/`) accepts the golden manifest and refuses a manifest that serves a face
 * template's numbers or drops the review label, with ajv as a reader outside zod would use it.
 */
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

const read = (relative: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(new URL(`../../../contracts/${relative}`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>;

const validate = new Ajv2020({ strict: false }).compile(
  read('schemas/openverify.account-export.v1.schema.json'),
);

describe('the account-export manifest JSON Schema (C253.2)', () => {
  it('accepts the golden manifest', () => {
    expect(validate(read('fixtures/api/account-exports/manifest.json'))).toBe(true);
  });

  it('refuses face template numbers and a manifest without the review label', () => {
    const manifest = read('fixtures/api/account-exports/manifest.json');
    const subject = manifest.subject as Record<string, unknown>;
    expect(
      validate({
        ...manifest,
        subject: { ...subject, 'face-templates': { present: true, count: 2, vectors: [[0.1]] } },
      }),
    ).toBe(false);
    expect(
      validate({
        ...manifest,
        'operator-review': { ...(manifest['operator-review'] as object), label: 'subject' },
      }),
    ).toBe(false);
  });
});
