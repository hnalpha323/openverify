// @ts-check
/**
 * Builds the committed legal-form table `packages/watchlist/data/legal-forms.json` (plan C78.1,
 * C79.2) once, from rigour's `resources/names/org_types.yml` at a pinned commit (MIT). A dev-only
 * step; nothing here runs in CI or at run time. Download the two pinned files into an empty
 * directory of your own, then, from `packages/watchlist`:
 *
 *   curl -o <dir>/org_types.yml \
 *     https://raw.githubusercontent.com/opensanctions/rigour/<COMMIT>/resources/names/org_types.yml
 *   curl -o <dir>/LICENSE https://raw.githubusercontent.com/opensanctions/rigour/<COMMIT>/LICENSE
 *   node --experimental-transform-types --no-warnings --conditions=@openverify/source \
 *     --import ../checks/scripts/register-ts.mjs \
 *     scripts/build-legal-forms.mjs <dir>/org_types.yml <dir>/LICENSE
 *
 * Both files are refused unless their SHA-256 is the pinned one. The table records the commit,
 * both digests and the licence text (MIT asks for its notice to travel with the data).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildLegalFormTable,
  parseOrgTypes,
  serialiseLegalFormTable,
} from '../src/names/legal-forms-build.js';

const PIN = Object.freeze({
  repository: 'https://github.com/opensanctions/rigour',
  commit: '607fa82b1ba3338c5e2e04f81c3a77e8cbbe0ee7',
  path: 'resources/names/org_types.yml',
  sha256: '772d6c6cf48af7a5b4832ac9aab1e293f0002111f2abb9588377a0459f087f20',
  license: 'MIT',
  licenseSha256: '099eeaff53a618bbd4420fa4746311ff72e418816bb21133781af0493d63c6d1',
});

const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'legal-forms.json');

/** @param {Buffer} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const [sourcePath, licensePath] = process.argv.slice(2);
if (sourcePath === undefined || licensePath === undefined) {
  console.error('usage: build-legal-forms.mjs <org_types.yml> <LICENSE>');
  process.exit(2);
}
const source = readFileSync(sourcePath);
const license = readFileSync(licensePath);
if (sha256(source) !== PIN.sha256 || sha256(license) !== PIN.licenseSha256) {
  console.error('refused: a file is not the pinned one (check the commit and both SHA-256)');
  process.exit(1);
}
const table = buildLegalFormTable(parseOrgTypes(source.toString('utf8')), {
  ...PIN,
  licenseText: license.toString('utf8'),
});
writeFileSync(OUTPUT, serialiseLegalFormTable(table));
console.log(`wrote ${String(table.forms.length)} legal forms to ${OUTPUT}`);
