/** C144: writes the generated pages of `docs/workflows/` (`reference-docs.ts`). */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REFERENCE_DOCS } from '../src/workflows/reference-docs.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
for (const [file, render] of Object.entries(REFERENCE_DOCS)) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the generated pages' fixed repository paths (REFERENCE_DOCS)
  await writeFile(path.join(root, file), render());
}
