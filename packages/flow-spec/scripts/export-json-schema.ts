/**
 * Writes the JSON Schema of each flow-spec version (C147.1): `schema/flow.schema.json` (version 1,
 * unchanged; the package script formats it) and `schema/flow.v2.schema.json` (version 2, written
 * already formatted with the repository's Prettier settings). Run with
 * `pnpm --filter @openverify/flow-spec schema:export`; a test fails when a committed file no longer
 * matches its schema.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { format, resolveConfig } from 'prettier';
import { flowJsonSchema } from '../src/json-schema.js';
import { flowV2JsonSchema } from '../src/v2/json-schema.js';

const v1 = path.resolve(import.meta.dirname, '../schema/flow.schema.json');
writeFileSync(v1, `${JSON.stringify(flowJsonSchema(), null, 2)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), v1)}`);

const v2 = path.resolve(import.meta.dirname, '../schema/flow.v2.schema.json');
const options = (await resolveConfig(v2)) ?? {};
writeFileSync(v2, await format(JSON.stringify(flowV2JsonSchema()), { ...options, filepath: v2 }));
console.log(`Wrote ${path.relative(process.cwd(), v2)}`);
