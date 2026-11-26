/** Test support: the golden definitions the contracts hold, read from their fixtures. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURES = new URL('../../../../contracts/fixtures/workflows/', import.meta.url);

export const readWorkflowFixture = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(name, FIXTURES)), 'utf8'));
