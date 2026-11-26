/**
 * C274.5's wording rule (decision 7; review H18): ASVS and MASVS are self-assessed, never
 * "certified" or "compliant"; and no page of the compliance guide says a deployment is compliant.
 *
 * - **Rule `asvs-masvs-claim`:** a sentence that names ASVS or MASVS may not hold "certified",
 *   "certification", "certify", "certifies", "compliant" or "complies", unless each such word is
 *   denied in its own clause ("never certified", "OWASP certifies nothing"; F007, Workflow 11F: a
 *   "no" in another clause denies nothing): the plan's own honesty statements
 *   are denials, and a rule that refused them would refuse the rule. Scope: every text file under
 *   `docs/` (Markdown, CSV, text), every README in the repository (the npm packages' included),
 *   `SECURITY.md`, the chart's `Chart.yaml` and `templates/NOTES.txt`; `docs/release/notes.md` is
 *   under `docs/`.
 * - **Rule `compliance-claim`:** under `docs/compliance/`, "compliant" and "complies" appear only
 *   where their own clause denies them.
 *
 * "Next to" is one sentence (`sentencesOf`), so a claim wrapped across lines is still found. A
 * claim word quoted on its own ("certified") is a mention of the word, not a claim, and so is code:
 * fenced code (tool output) and an inline code span holding a claim word (a quoted fixture) are
 * left out (F007).
 */
import { readAsRows, sentencesOf } from './text.js';
import type { CheckFinding, CheckResult, Repository } from './types.js';

const NAMES_STANDARD = /\b(?:asvs|masvs)\b/i;
/** Global, for `matchAll`: each claim word is checked in its own clause. */
const CLAIM = /\b(?:certified|certification|certify|certifies|compliant|complies)\b/gi;
const COMPLIANCE_CLAIM = /\b(?:compliant|complies)\b/gi;
/**
 * One of those words quoted on its own ("certified", `compliant`) is a mention of the word, as the
 * plan's rule text quotes it, not a claim; it is left out before the claim is looked for.
 */
const QUOTED_WORD =
  /["'`\u201c\u2018](?:certified|certification|certify|certifies|compliant|complies)\\?["'`\u201d\u2019]/gi;
/** A denial: not, no, never, nothing, neither, nor, without, none, cannot, n't. */
const DENIAL = /\b(?:not|no|never|nothing|neither|nor|without|none|cannot)\b|n't\b/i;
/**
 * An inline code span quotes literal text (a fixture, a command) and is left out, as fenced code
 * is (F007, Workflow 11F): the rule reads what the prose itself says. A span holding no claim word
 * (`MASVS`) leaves the sentence's own words to be read.
 */
const CODE_SPAN =
  /`[^`\n]*\b(?:certified|certification|certify|certifies|compliant|complies)\b[^`\n]*`/gi;
/** "Not only" asserts, it does not deny. */
const NOT_ONLY = /\bnot\s+only\b/gi;
/**
 * Where a clause ends: a sentence's inner punctuation (never a comma, which also separates the
 * items of a list) or a conjunction that starts a new assertion.
 */
const CLAUSE_BREAK =
  /[;:!?()\u2013\u2014]|\.(?=\s|$)|\b(?:and|but|so|while|whereas|although|though|yet|because)\b/gi;

const TEXT_FILE = /\.(?:md|csv|txt)$/;
const COMPLIANCE_DIR = 'docs/compliance/';

/** The single files outside `docs/` the rule reads (each read only when it exists). */
export const WORDING_FILES: readonly string[] = Object.freeze([
  'SECURITY.md',
  'deploy/helm/openverify/Chart.yaml',
  'deploy/helm/openverify/templates/NOTES.txt',
]);

/** Every file the wording rule reads in `repo`, sorted. */
export function wordingScope(repo: Repository): readonly string[] {
  const docs = repo.listFiles('docs').filter((file) => TEXT_FILE.test(file));
  const readmes = repo.listFiles('').filter((file) => /(?:^|\/)README\.md$/.test(file));
  const singles = WORDING_FILES.filter((file) => repo.exists(file));
  return [...new Set([...docs, ...readmes, ...singles])].sort();
}

/**
 * Whether every match of `claim` in `text` is denied in its own clause (F007, Workflow 11F
 * review): "never certified", "does not make the app compliant", "Nothing here says that a
 * deployment complies", "OWASP certifies nothing". A denial in another clause of the sentence
 * ("There is no gap: it is ASVS compliant") denies nothing, and "not only" denies nothing.
 */
function everyClaimDenied(text: string, claim: RegExp): boolean {
  const breaks = [...text.matchAll(CLAUSE_BREAK)].map((found) => found.index);
  for (const match of text.matchAll(claim)) {
    const start = Math.max(-1, ...breaks.filter((at) => at < match.index)) + 1;
    const ends = breaks.filter((at) => at > match.index);
    const end = ends.length === 0 ? text.length : Math.min(...ends);
    const clause = text.slice(start, end).replace(NOT_ONLY, ' ');
    if (!DENIAL.test(clause)) {
      return false;
    }
  }
  return true;
}

/** The wording findings of one file's text. */
export function wordingFindings(path: string, text: string): readonly CheckFinding[] {
  const inCompliance = path.startsWith(COMPLIANCE_DIR);
  return sentencesOf(text, readAsRows(path), false).flatMap((sentence): CheckFinding[] => {
    const claims = sentence.text.replace(QUOTED_WORD, '').replace(CODE_SPAN, ' ');
    if (NAMES_STANDARD.test(claims) && !everyClaimDenied(claims, CLAIM)) {
      return [
        {
          rule: 'asvs-masvs-claim',
          path,
          line: sentence.line,
          message: 'ASVS and MASVS are self-assessed: never "certified" or "compliant" (C274.5)',
          severity: 'error',
        },
      ];
    }
    if (inCompliance && !everyClaimDenied(claims, COMPLIANCE_CLAIM)) {
      return [
        {
          rule: 'compliance-claim',
          path,
          line: sentence.line,
          message:
            'the compliance guide says "compliant" or "complies" only to deny it (C274.5, C278.6)',
          severity: 'error',
        },
      ];
    }
    return [];
  });
}

/** C274.5 over the repository. */
export function checkWording(repo: Repository): CheckResult {
  return {
    name: 'wording',
    status: 'built',
    findings: wordingScope(repo).flatMap((file) => wordingFindings(file, repo.readText(file))),
  };
}
