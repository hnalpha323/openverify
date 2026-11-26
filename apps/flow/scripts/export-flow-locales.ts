/**
 * C161.8, C162.9: writes the built-in catalogs as JSON for Phase 10 and appends the released
 * consent texts to the append-only table the server checks consent digests against.
 *
 *   node apps/flow/scripts/export-flow-locales.ts           # write the files
 *   node apps/flow/scripts/export-flow-locales.ts --check   # exit 1 if any file is out of date
 *
 * Writes `contracts/fixtures/i18n/<locale>.json` for each built-in locale, appends to
 * `contracts/fixtures/i18n/consent-texts.json` (never changing or removing an entry), and writes
 * `apps/flow/src/i18n/catalog-version.ts`, each formatted with the repository's Prettier config.
 * The catalogs and what is written from them come from `apps/flow/src/i18n/locale-export.ts`,
 * loaded through Vite's module runner, which resolves the catalogs' extensionless imports; Node
 * (22.18 or later) runs this file by stripping its types.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { defaultServerConditions, runnerImport } from 'vite';

interface ConsentTextsTable {
  readonly entries: readonly unknown[];
}

interface LocaleExportModule {
  exportFiles(
    existing: ConsentTextsTable | null,
    sha256: (text: string) => string,
  ): Readonly<Record<string, unknown>>;
}

const FLOW_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const CONSENT_TEXTS = 'contracts/fixtures/i18n/consent-texts.json';
const check = process.argv.includes('--check');

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const { module: localeExport } = await runnerImport<LocaleExportModule>(
  join(FLOW_ROOT, 'src/i18n/locale-export.ts'),
  {
    root: FLOW_ROOT,
    configFile: false,
    logLevel: 'silent',
    // Workspace packages run from their TypeScript source, as the flow's own build reads them.
    environments: {
      inline: {
        resolve: {
          noExternal: [/^@openverify\//],
          conditions: ['@openverify/source', ...defaultServerConditions],
        },
      },
    },
  },
);

const existingPath = join(REPO_ROOT, CONSENT_TEXTS);
const existing = existsSync(existingPath)
  ? (JSON.parse(readFileSync(existingPath, 'utf8')) as ConsentTextsTable)
  : null;

const stale: string[] = [];
for (const [path, content] of Object.entries(localeExport.exportFiles(existing, sha256))) {
  const absolute = join(REPO_ROOT, path);
  const options = { ...(await resolveConfig(absolute)), filepath: absolute };
  const text = await format(
    typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
    options,
  );
  const current = existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
  if (current === text) {
    continue;
  }
  stale.push(path);
  if (!check) {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  }
}

if (check && stale.length > 0) {
  process.stderr.write(
    `Out of date: ${stale.join(', ')}. Run node apps/flow/scripts/export-flow-locales.ts\n`,
  );
  process.exit(1);
}
process.stdout.write(
  stale.length === 0 ? 'The locale exports are up to date.\n' : `Wrote ${stale.join(', ')}.\n`,
);
