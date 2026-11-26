// @ts-check
/**
 * Builds the filtered variant-group file the worker loads (plan C78.3, F14), from rigour
 * `person_names.txt` as `scripts/fetch_data.py` pins it in `data/manifest.json`. A build step,
 * never in a test; the input and the output stay in the gitignored `data/` folder. From
 * `packages/watchlist`, after `python3 scripts/fetch_data.py` at the repository root:
 *
 *   node --experimental-transform-types --no-warnings --conditions=@openverify/source \
 *     --import ../checks/scripts/register-ts.mjs scripts/build-variant-groups.mjs \
 *     [--input <person_names.txt>] [--output <file>] [--hold-out <seed> --output <file>]
 *
 * - The input is refused unless its SHA-256 is the manifest's.
 * - The shipped build (no `--hold-out`) goes to `data/variant-groups.json` and is refused unless its
 *   digest is `SHIPPED_VARIANT_GROUPS_SHA256`, so a filter change cannot ship unnoticed; pass
 *   `--accept-new-digest` once to write it, then update the constant (and `KEYS_VERSION`'s golden
 *   test if keys change).
 * - `--hold-out <seed>` (evaluation-6 only, C78.8, V12) also drops the groups `isHeldOutGroup`
 *   selects for that seed, and needs `--output`, so it never replaces the shipped file.
 * - Every build carries rigour's MIT notice (`license`, `copyright`, `licenseText`; owner decision
 *   19 after 6B), from the licence text the committed legal-form table holds, pinned by its digest.
 *
 * Only counts and the digest are printed, never a form.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  RIGOUR_LICENSE,
  SHIPPED_VARIANT_GROUPS_SHA256,
  VARIANT_GROUPS_FILE_NAME,
  filterVariantGroups,
  parseRigourPersonNames,
  rigourLicenseText,
  serialiseVariantGroups,
} from '../src/keys/variant-groups.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MANIFEST_NAME = 'rigour_person_names';

/** @param {Buffer | string} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    output: { type: 'string' },
    'hold-out': { type: 'string' },
    'accept-new-digest': { type: 'boolean', default: false },
  },
});
const holdOut = values['hold-out'] ?? null;
if (holdOut !== null && values.output === undefined) {
  console.error('refused: --hold-out needs --output, so the shipped file is never replaced');
  process.exit(2);
}

/** @type {{ data: { name: string, filename: string, sha256: string }[] }} */
const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'manifest.json'), 'utf8'));
const entry = manifest.data.find((item) => item.name === MANIFEST_NAME);
if (entry === undefined) {
  console.error(`refused: data/manifest.json has no ${MANIFEST_NAME} entry`);
  process.exit(1);
}
const input = readFileSync(values.input ?? join(ROOT, 'data', entry.filename));
if (sha256(input) !== entry.sha256) {
  console.error(
    `refused: the input is not the pinned ${MANIFEST_NAME} (run scripts/fetch_data.py)`,
  );
  process.exit(1);
}

const { groups, report } = filterVariantGroups(parseRigourPersonNames(input.toString('utf8')), {
  holdOutSeed: holdOut,
});
const text = serialiseVariantGroups(groups, {
  sourceSha256: entry.sha256,
  heldOut: holdOut !== null,
  license: {
    license: RIGOUR_LICENSE.license,
    copyright: RIGOUR_LICENSE.copyright,
    licenseText: rigourLicenseText(),
  },
});
const digest = sha256(text);
if (holdOut === null && digest !== SHIPPED_VARIANT_GROUPS_SHA256 && !values['accept-new-digest']) {
  console.error(
    `refused: the shipped build's digest ${digest} is not SHIPPED_VARIANT_GROUPS_SHA256; ` +
      'update the constant with --accept-new-digest if the filter changed on purpose',
  );
  process.exit(1);
}
const output = values.output ?? join(ROOT, 'data', VARIANT_GROUPS_FILE_NAME);
writeFileSync(output, text);
console.log(JSON.stringify({ output, sha256: digest, heldOut: holdOut !== null, ...report }));
