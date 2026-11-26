/**
 * C194.4 (review H03; Workflow 10A Stage 1a): the members of every client view a spec-2 client
 * renders, exported for Android's member test. `contracts/fixtures/flow-spec/client-view-members.json`
 * lists the session response's members (with an object member's own members), every
 * `clientStepViewSchema` step type's members and every component kind's members, read from the zod
 * schemas themselves. Android's `FlowSpecMembersTest` fails when `flow-spec-members.json` gives one
 * of them no treatment, so a member a later phase adds cannot ship without an Android decision.
 *
 * Assert-only (C221.8): this test fails when the committed file differs from what the schemas give,
 * and writes it only under `UPDATE_CONTRACT_FIXTURES=1`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { clientStepViewSchema, componentSchema } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import { flowSessionResponseSchema } from './flow-api.js';

const FILE = path.resolve(
  import.meta.dirname,
  '../../../contracts/fixtures/flow-spec/client-view-members.json',
);

interface ZodLike {
  readonly _zod: {
    readonly def: {
      readonly type: string;
      readonly innerType?: ZodLike;
      readonly in?: ZodLike;
      readonly getter?: () => ZodLike;
      readonly options?: readonly ZodLike[];
    };
  };
  readonly shape?: Readonly<Record<string, ZodLike>>;
}

/** The schema under every optional, nullable, default, lazy and pipe wrapper. */
function unwrap(schema: ZodLike): ZodLike {
  let current = schema;
  for (;;) {
    const { def } = current._zod;
    if (def.innerType !== undefined) {
      current = def.innerType;
    } else if (def.type === 'lazy' && def.getter !== undefined) {
      current = def.getter();
    } else if (def.type === 'pipe' && def.in !== undefined) {
      current = def.in;
    } else {
      return current;
    }
  }
}

function membersOf(schema: ZodLike): string[] {
  const shape = unwrap(schema).shape;
  return shape === undefined ? [] : Object.keys(shape).sort();
}

function literalOf(schema: ZodLike, key: string): string {
  const member = unwrap(schema).shape?.[key];
  const def = member?._zod.def as { values?: readonly string[] } | undefined;
  const value = def?.values?.[0];
  if (value === undefined) {
    throw new Error(`no literal ${key}`);
  }
  return value;
}

function variants(schema: ZodLike): readonly ZodLike[] {
  return unwrap(schema)._zod.def.options ?? [];
}

export function clientViewMembers(): Record<string, unknown> {
  const sessionShape = (flowSessionResponseSchema as unknown as ZodLike).shape ?? {};
  const session = Object.fromEntries(
    Object.entries(sessionShape)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([member, schema]) => [member, membersOf(schema)]),
  );
  const steps = Object.fromEntries(
    variants(clientStepViewSchema as unknown as ZodLike)
      .map((variant) => [literalOf(variant, 'type'), membersOf(variant)] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const components = Object.fromEntries(
    variants(componentSchema as unknown as ZodLike)
      .map((variant) => [literalOf(variant, 'kind'), membersOf(variant)] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return {
    format: 1,
    description:
      'C194.4: the members of the session response (an object member with its own members), of each client-view step type and of each component kind, from the zod schemas. Written by packages/contracts/src/client-view-members.export.test.ts with UPDATE_CONTRACT_FIXTURES=1; never edited by hand. Android treats each one in android/openverify-sdk/flow-spec-members.json.',
    session,
    steps,
    components,
  };
}

/**
 * JSON as the repository's Prettier prints it (`.prettierrc`: width 100): objects one member per
 * line, an array of strings on one line when it fits, else one item per line.
 */
export function prettierJson(value: unknown, indent = '', lead = 0): string {
  if (Array.isArray(value)) {
    const items = value.map((item) => JSON.stringify(item));
    const inline = `[${items.join(', ')}]`;
    if (lead + inline.length <= 100) {
      return inline;
    }
    const inner = `${indent}  `;
    return `[\n${items.map((item) => `${inner}${item}`).join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const inner = `${indent}  `;
    const lines = Object.entries(value).map(([key, member]) => {
      const head = `${inner}${JSON.stringify(key)}: `;
      return `${head}${prettierJson(member, inner, head.length + 1)}`;
    });
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

describe('the client-view members export (C194.4)', () => {
  const expected = `${prettierJson(clientViewMembers())}\n`;

  it('lists the seventeen step types (share_consent since Workflow 11A) and the twenty-two component kinds', () => {
    const members = clientViewMembers() as {
      steps: Record<string, unknown>;
      components: Record<string, unknown>;
    };
    expect(Object.keys(members.steps)).toHaveLength(17);
    expect(Object.keys(members.components)).toHaveLength(22);
  });

  it('is the committed file', () => {
    if (process.env.UPDATE_CONTRACT_FIXTURES === '1') {
      writeFileSync(FILE, expected);
    }
    expect(readFileSync(FILE, 'utf8')).toBe(expected);
  });
});
