/**
 * C276.5 (Workflow 11E, `docs-records`): the record test of `docs/security/README.md`, the index of
 * every `docs/security/` document (docs-security's threat model and checklists, the id lists, and
 * this area's records). Each document beside the index must be linked from it by its file name, and
 * the index must state the wording rule of C274.5.
 */
import type { CheckFinding, CheckResult, Repository } from '../types.js';
import { draftFindings, pathFindings } from './checks.js';

export const SECURITY_INDEX_PATH = 'docs/security/README.md';
const DIRECTORY = 'docs/security';

/** The `docs/security/` documents the index must link, every one but itself. */
export function securityDocuments(repo: Repository): readonly string[] {
  return repo
    .listFiles(DIRECTORY)
    .filter(
      (path) => path !== SECURITY_INDEX_PATH && !path.slice(DIRECTORY.length + 1).includes('/'),
    );
}

const finding = (message: string): CheckFinding => ({
  rule: 'security-index',
  path: SECURITY_INDEX_PATH,
  message,
  severity: 'error',
});

/** The index's record test (C276.5). */
export function checkSecurityIndex(repo: Repository): CheckResult {
  const text = repo.exists(SECURITY_INDEX_PATH) ? repo.readText(SECURITY_INDEX_PATH) : '';
  const linked = new Set(
    [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => (match[1] ?? '').split('#')[0] ?? ''),
  );
  return {
    name: 'security-index',
    status: 'built',
    findings: [
      ...draftFindings(SECURITY_INDEX_PATH, text),
      ...securityDocuments(repo)
        .map((path) => path.slice(DIRECTORY.length + 1))
        .filter((name) => !linked.has(name))
        .map((name) => finding(`does not link ${name}, a document of docs/security/`)),
      ...(text.includes('C274.5') ? [] : [finding('does not state the wording rule of C274.5')]),
      ...pathFindings(repo, SECURITY_INDEX_PATH, text),
    ],
  };
}
