/**
 * C278.1 and Q7 (the guide's record test): every page of `docs/compliance/` says in its opening
 * (the lines before its first `## ` heading) that it is not legal advice and that counsel has not
 * reviewed it. The Phase 8 and Phase 10 pages are held too (docs-compliance's borrowed edits).
 */
import type { CheckFinding, Repository } from '../types.js';
import { COUNSEL_LINE, NOT_LEGAL_ADVICE, compliancePages } from './pages.js';

/** The lines before the first second-level heading. */
function openingOf(text: string): readonly string[] {
  const lines = text.split('\n');
  const end = lines.findIndex((line) => line.startsWith('## '));
  return end === -1 ? lines : lines.slice(0, end);
}

/** The findings for one page's text. */
export function openingFindings(path: string, text: string): readonly CheckFinding[] {
  const opening = openingOf(text);
  const findings: CheckFinding[] = [];
  if (!opening.some((line) => NOT_LEGAL_ADVICE.test(line))) {
    findings.push({
      rule: 'compliance-not-legal-advice',
      path,
      message: 'must say "not legal advice" before its first section (C278.1)',
      severity: 'error',
    });
  }
  if (!opening.some((line) => line.trim() === COUNSEL_LINE)) {
    findings.push({
      rule: 'compliance-not-reviewed',
      path,
      message: `must carry the line "${COUNSEL_LINE}" before its first section (Q7, C278.1)`,
      severity: 'error',
    });
  }
  return findings;
}

/** The findings over every page of the guide. */
export function guideOpeningFindings(repo: Repository): readonly CheckFinding[] {
  return compliancePages((dir) => repo.listFiles(dir)).flatMap((path) =>
    openingFindings(path, repo.readText(path)),
  );
}
