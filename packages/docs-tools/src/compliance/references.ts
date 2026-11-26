/**
 * Rule 10 for the guide: every repository path a page names in backticks, and every relative
 * link, exists at this commit, so a claim's citation cannot rot unseen.
 */
import path from 'node:path';
import type { CheckFinding, Repository } from '../types.js';

/** A repository path under one of the top-level folders a page cites, with no pattern character. */
const PATH_TOKEN =
  /^(?:\.github|android|apps|contracts|deploy|docs|e2e|infra|load|packages|scripts|security|services)\/[^\s*{}<>|]*$/;

/** The repository paths `text` names in backticks (a trailing `:line` dropped). */
export function backtickedPaths(text: string): readonly string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const token = (match[1] ?? '').replace(/:[\d-]+$/, '');
    if (PATH_TOKEN.test(token)) {
      found.push(token);
    }
  }
  return found;
}

/** The relative link targets of `text` (no scheme, no pure anchor), anchors dropped. */
export function relativeLinks(text: string): readonly string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1] ?? '';
    if (target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
      continue;
    }
    found.push(target.replace(/#.*$/, ''));
  }
  return found;
}

/** Whether `relative` is a file, or a directory holding at least one file. */
function present(repo: Repository, relative: string): boolean {
  const trimmed = relative.replace(/\/$/, '');
  if (!relative.endsWith('/') && repo.exists(trimmed)) {
    return true;
  }
  return repo.listFiles(trimmed).length > 0;
}

/** The missing paths and links of one page. */
export function referenceFindings(
  repo: Repository,
  page: string,
  text: string,
): readonly CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const cited of new Set(backtickedPaths(text))) {
    if (!present(repo, cited)) {
      findings.push({
        rule: 'compliance-path',
        path: page,
        message: `names ${cited}, which does not exist`,
        severity: 'error',
      });
    }
  }
  for (const link of new Set(relativeLinks(text))) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(page), link));
    const target = link.endsWith('/') ? `${resolved}/` : resolved;
    if (resolved.startsWith('..') || !present(repo, target)) {
      findings.push({
        rule: 'compliance-link',
        path: page,
        message: `links ${link} (${resolved}), which does not exist`,
        severity: 'error',
      });
    }
  }
  return findings;
}
