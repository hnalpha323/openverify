/**
 * The Content rule's vendor-name test (the plan's "Rules for every agent"; review H18): no page
 * under `docs/` names the vendor OpenVerify's feature set is modelled on, outside the exempt paths,
 * while the vendor-naming switch (`src/switches.ts`, Q8) is off.
 *
 * A hit is the name as a word, any case (`-` and `.` are word boundaries, so the source API's
 * vendor-named header names are hits), and the vendor's host. Three tokens are paths or
 * identifiers, not naming: the repository's directory name (`persona-opensource`, in evidence
 * paths), the surface index's file name (`persona-surface.md`), and the source API's own
 * identifiers that contain `reusable-persona` (quoted as behaviour, C286).
 *
 * Exempt: `docs/research/`, `docs/plans/`, `docs/PLAN.md`, `docs/PROGRESS.md` and `docs/adr/`
 * (the plan's list), `docs/tdd/` (evidence quotes the developer's paths and one Phase 0 note;
 * contracts-11e's choice, Workflow 11E Stage 1a amendments), and the vendor-named migration page
 * while the switch is on (Q8 granted 2026-11-21, so on; Workflow 11G records-11g). While it is on,
 * a link to that page is its path, not naming, and every other page still names no vendor.
 */
import { DOCS_SWITCHES, MIGRATION_PAGES, type DocsSwitches } from './switches.js';
import type { CheckFinding, CheckResult, Repository } from './types.js';

/** The exempt paths: a directory ends with `/`, a file does not. */
export const VENDOR_NAME_EXEMPT: readonly string[] = Object.freeze([
  'docs/research/',
  'docs/plans/',
  'docs/PLAN.md',
  'docs/PROGRESS.md',
  'docs/adr/',
  'docs/tdd/',
]);

const NAME = /\bpersona\b/gi;
const HOST = /withpersona/gi;
/** The tokens that are paths or identifiers, not naming. */
const ALLOWED_TOKEN = /persona-opensource|persona-surface|reusable-persona/i;
const TOKEN_CHARACTER = /[\w./-]/;
const TEXT_FILE = /\.(?:md|csv|txt|json)$/;

/** Whether `path` is exempt under `switches`. */
export function vendorNameExempt(path: string, switches: DocsSwitches = DOCS_SWITCHES): boolean {
  if (switches.vendorNaming && path === MIGRATION_PAGES.vendorNamed) {
    return true;
  }
  return VENDOR_NAME_EXEMPT.some((exempt) =>
    exempt.endsWith('/') ? path.startsWith(exempt) : path === exempt,
  );
}

/** The whole token (letters, digits, `_`, `.`, `/`, `-`) around `index` in `line`. */
function tokenAround(line: string, index: number, length: number): string {
  let start = index;
  let end = index + length;
  while (start > 0 && TOKEN_CHARACTER.test(line.charAt(start - 1))) start -= 1;
  while (end < line.length && TOKEN_CHARACTER.test(line.charAt(end))) end += 1;
  return line.slice(start, end);
}

/** The vendor-named migration page's file name, a path token once the switch selects it (Q8). */
const VENDOR_NAMED_PAGE = MIGRATION_PAGES.vendorNamed.split('/').pop() ?? '';

/** Whether a token around a hit is a path or an identifier rather than naming, under `switches`. */
function allowedToken(token: string, switches: DocsSwitches): boolean {
  return ALLOWED_TOKEN.test(token) || (switches.vendorNaming && token.endsWith(VENDOR_NAMED_PAGE));
}

/**
 * The vendor-name findings of one file's text. With the switch on (Q8 granted), a link to the
 * vendor-named migration page is its path, not naming.
 */
export function vendorNameFindings(
  path: string,
  text: string,
  switches: DocsSwitches = DOCS_SWITCHES,
): readonly CheckFinding[] {
  return text.split('\n').flatMap((line, index): CheckFinding[] => {
    const named = [...line.matchAll(NAME)].some(
      (match) => !allowedToken(tokenAround(line, match.index, match[0].length), switches),
    );
    const host = [...line.matchAll(HOST)].length > 0;
    return named || host
      ? [
          {
            rule: 'vendor-name',
            path,
            line: index + 1,
            message: switches.vendorNaming
              ? 'names the vendor outside the vendor-named migration page (Q8, C280.6)'
              : 'names the vendor while the vendor-naming switch is off (Q8, C280.6)',
            severity: 'error',
          },
        ]
      : [];
  });
}

/** Every file under `docs/` the test reads, sorted. */
export function vendorNameScope(
  repo: Repository,
  switches: DocsSwitches = DOCS_SWITCHES,
): readonly string[] {
  return repo
    .listFiles('docs')
    .filter((file) => TEXT_FILE.test(file) && !vendorNameExempt(file, switches));
}

/** The vendor-name rule over `docs/`. */
export function checkVendorName(
  repo: Repository,
  switches: DocsSwitches = DOCS_SWITCHES,
): CheckResult {
  return {
    name: 'vendor-name',
    status: 'built',
    findings: vendorNameScope(repo, switches).flatMap((file) =>
      vendorNameFindings(file, repo.readText(file), switches),
    ),
  };
}
