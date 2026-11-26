/**
 * C276.3 (Workflow 11E, `docs-records`): the record test of `docs/security/logging.md`. The page
 * documents each logger's redaction paths in a table under a fixed heading, one row per set of keys
 * with the prefixes they are redacted at (the top level written as "top level"); the test expands
 * the rows and compares them with the configured lists:
 *
 * - `REDACT_PATHS` (with `PERSONAL_LOG_KEYS` inside it), `apps/api/src/logger.ts`, which the API
 *   applies and the worker applies too;
 * - `WORKER_REDACT_PATHS`, `apps/api/src/jobs/logger.ts`, the worker's own.
 *
 * Only these two processes configure pino redaction (Stage 1a amendment 8); the page states what the
 * console, the flow server, vision and the code runner write, and a test names every process.
 */
import { API_LOG_REDACTED_KEYS, API_LOG_REDACTED_VALUE_MAPS } from '@openverify/contracts';
import { CONFIG_PROCESSES } from '../../../../apps/api/src/config-registry.js';
import { WORKER_REDACT_PATHS } from '../../../../apps/api/src/jobs/logger.js';
import { PERSONAL_LOG_KEYS, REDACT_PATHS } from '../../../../apps/api/src/logger.js';
import type { CheckFinding, CheckResult, Repository } from '../types.js';
import {
  codeSpans,
  commandFindings,
  draftFindings,
  pathFindings,
  requiredSpanFindings,
  variableFindings,
} from './checks.js';

export const LOGGING_PATH = 'docs/security/logging.md';

/** The redaction tables of the page, by the heading each sits under. */
export const LOGGING_TABLE_HEADINGS = Object.freeze({
  api: '### The API and the worker: `REDACT_PATHS`',
  worker: '### The worker only: `WORKER_REDACT_PATHS`',
});

/** The lines of the section that starts at `heading`, up to the next heading. */
function sectionLines(text: string, heading: string): readonly string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return [];
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('#'));
  return end === -1 ? rest : rest.slice(0, end);
}

/** The cells of a Markdown table row; `null` for a line that is not a body row. */
function rowCells(line: string): readonly string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || /^\|[\s|:-]+\|$/.test(trimmed)) {
    return null;
  }
  return trimmed.slice(1, trimmed.endsWith('|') ? -1 : undefined).split(' | ');
}

/** The paths a redaction table documents, expanded (`prefix + key` for every row). */
export function documentedRedactionPaths(text: string, heading: string): readonly string[] {
  const paths: string[] = [];
  for (const line of sectionLines(text, heading)) {
    const cells = rowCells(line);
    if (cells === null || cells.length < 2) {
      continue;
    }
    const keys = codeSpans(cells[0] ?? '');
    const where = cells[1] ?? '';
    const prefixes = [...(where.includes('top level') ? [''] : []), ...codeSpans(where)];
    for (const key of keys) {
      for (const prefix of prefixes) {
        paths.push(`${prefix}${key}`);
      }
    }
  }
  return paths;
}

function listFindings(
  heading: string,
  documented: readonly string[],
  configured: readonly string[],
  source: string,
): readonly CheckFinding[] {
  const have = new Set(documented);
  const want = new Set(configured);
  const finding = (message: string): CheckFinding => ({
    rule: 'redaction-paths',
    path: LOGGING_PATH,
    message,
    severity: 'error',
  });
  return [
    ...configured
      .filter((path) => !have.has(path))
      .map((path) => finding(`${heading} does not document ${path}, which ${source} redacts`)),
    ...documented
      .filter((path) => !want.has(path))
      .map((path) => finding(`${heading} documents ${path}, which ${source} does not redact`)),
    ...(new Set(documented).size === documented.length
      ? []
      : [finding(`${heading} documents a path twice`)]),
  ];
}

/** The page's record test (C276.3). */
export function checkLogging(repo: Repository): CheckResult {
  const text = repo.exists(LOGGING_PATH) ? repo.readText(LOGGING_PATH) : '';
  const required = [
    ...PERSONAL_LOG_KEYS.map((span) => ({ span, why: 'a PERSONAL_LOG_KEYS key (C53.8)' })),
    ...[...API_LOG_REDACTED_KEYS, ...API_LOG_REDACTED_VALUE_MAPS].map((span) => ({
      span,
      why: 'a key a stored API log redacts (API_LOG_REDACTED_KEYS, API_LOG_REDACTED_VALUE_MAPS)',
    })),
    ...CONFIG_PROCESSES.map((span) => ({ span, why: 'a process of CONFIG_PROCESSES' })),
  ];
  const seen = new Set<string>();
  return {
    name: 'logging',
    status: 'built',
    findings: [
      ...draftFindings(LOGGING_PATH, text),
      ...listFindings(
        LOGGING_TABLE_HEADINGS.api,
        documentedRedactionPaths(text, LOGGING_TABLE_HEADINGS.api),
        REDACT_PATHS,
        'apps/api/src/logger.ts',
      ),
      ...listFindings(
        LOGGING_TABLE_HEADINGS.worker,
        documentedRedactionPaths(text, LOGGING_TABLE_HEADINGS.worker),
        WORKER_REDACT_PATHS,
        'apps/api/src/jobs/logger.ts',
      ),
      ...requiredSpanFindings(
        LOGGING_PATH,
        text,
        required.filter((item) => (seen.has(item.span) ? false : (seen.add(item.span), true))),
      ),
      ...pathFindings(repo, LOGGING_PATH, text),
      ...commandFindings(repo, LOGGING_PATH, text),
      ...variableFindings(LOGGING_PATH, text),
    ],
  };
}
