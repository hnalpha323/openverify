/** C113.7: stored versions are never rewritten; each schema version reads through pure upgrades. */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WORKFLOW_SCHEMA_VERSION, workflowDefinitionSchema } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical.js';
import { DEFINITION_UPGRADES, DefinitionReadError, readDefinition } from './read.js';
import { readWorkflowFixture } from './testing.js';

const everyNode = readWorkflowFixture('definition-every-node.json') as Record<string, unknown>;

const FIXTURES = fileURLToPath(
  new URL('../../../../contracts/fixtures/workflows', import.meta.url),
);

/** Every `definition-*.json` is a stored definition of its `schema-version`. */
const stored = readdirSync(FIXTURES).filter((name) => /^definition-.*\.json$/.test(name));

describe('readDefinition (C113.7)', () => {
  it('finds the fixtures of every schema version', () => {
    expect(stored.length).toBeGreaterThanOrEqual(2);
  });

  it.each(stored)('loads %s', (name) => {
    const raw = readWorkflowFixture(name);
    const definition = readDefinition(raw);
    expect(definition['schema-version']).toBe(WORKFLOW_SCHEMA_VERSION);
    expect(workflowDefinitionSchema.safeParse(definition).success).toBe(true);
  });

  it('never rewrites what it was given', () => {
    const before = canonicalJson(everyNode);
    readDefinition(everyNode);
    expect(canonicalJson(everyNode)).toBe(before);
  });

  it('has an upgrade from every version before the current one', () => {
    for (let version = 1; version < WORKFLOW_SCHEMA_VERSION; version += 1) {
      expect(DEFINITION_UPGRADES[version]).toBeTypeOf('function');
    }
  });

  it('walks a chain of pure upgrades to the current version', () => {
    // A synthetic older shape, one step per version, so the walk is proved before version 2 exists.
    const { variables, ...older } = everyNode;
    const upgrades = {
      [-1]: (raw: Readonly<Record<string, unknown>>) => {
        const { 'old-vars': vars, ...rest } = raw;
        return { ...rest, 'schema-version': 0, vars };
      },
      0: (raw: Readonly<Record<string, unknown>>) => {
        const { vars, ...rest } = raw;
        return { ...rest, 'schema-version': 1, variables: vars };
      },
    };
    const read = readDefinition(
      { ...older, 'schema-version': -1, 'old-vars': variables },
      upgrades,
    );
    expect(read.variables).toEqual(variables);
  });

  it.each([
    ['a value that is no object', 'text'],
    ['null', null],
    ['an array', []],
    ['no schema version', { steps: [] }],
    ['a schema version that is no integer', { 'schema-version': 'one' }],
    ['a newer schema version', { 'schema-version': WORKFLOW_SCHEMA_VERSION + 1 }],
    ['a version with no upgrade', { 'schema-version': 0 }],
  ])('refuses %s', (_label, raw) => {
    expect(() => readDefinition(raw)).toThrow(DefinitionReadError);
  });

  it('refuses a definition its schema refuses, and quotes nothing of it', () => {
    const secret = 'change-me-canary-definition';
    const read = () => readDefinition({ ...everyNode, trigger: { type: secret } });
    expect(read).toThrow(DefinitionReadError);
    try {
      read();
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('refuses an upgrade that does not move the version on, rather than looping', () => {
    const stuck = { 0: (raw: Readonly<Record<string, unknown>>) => raw };
    expect(() => readDefinition({ 'schema-version': 0 }, stuck)).toThrow(DefinitionReadError);
  });
});
