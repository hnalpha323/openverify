/**
 * C284.2's gap rule (docs-release): no `gap` row of the threat model, the ASVS checklist or the
 * MASVS checklist lacks a phase, a release or a finding. The CSVs are C274.1's columns (`status`,
 * `notes`); the threat model is C273.1's table (`status`, `mitigation or owner`). A document still
 * a stub holds no row, and the security checks report it.
 */
import { parse } from 'csv-parse/sync';
import type { CheckFinding, Repository } from '../types.js';
import { tablesOf } from './markdown.js';

export const THREAT_MODEL_PATH = 'docs/security/threat-model.md';
export const CHECKLIST_CSVS = ['docs/security/asvs-5.0.0-l2.csv', 'docs/security/masvs-2.1.0.csv'];

/** Whether `text` names a phase, a Workflow, a release or a finding id. */
export function namesPlacement(text: string): boolean {
  return [
    /\bphase \d+/i,
    /\bworkflow 11[a-g]\b/i,
    /\b11[A-G]\b/,
    /\bnext release\b/i,
    /\bKP\d+-\d+\b/,
    /\bK\d+[A-Z]?-[A-Z0-9-]+\b/,
    /\b[A-Z]\d{3}\b/,
    /\bC\d{3}\b/,
  ].some((pattern) => pattern.test(text));
}

const gap = (path: string, line: number, id: string): CheckFinding => ({
  rule: 'gap-row',
  path,
  line,
  message: `${id} is a gap that names no phase, release or finding`,
  severity: 'error',
});

/** C284.2's gap rule over the three security documents. */
export function gapFindings(repo: Repository): readonly CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const path of CHECKLIST_CSVS) {
    if (!repo.exists(path)) {
      continue;
    }
    let rows: Record<string, string>[];
    try {
      rows = parse<Record<string, string>>(repo.readText(path), {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
      });
    } catch {
      findings.push({
        rule: 'gap-row',
        path,
        message: 'the CSV does not parse',
        severity: 'error',
      });
      continue;
    }
    rows.forEach((row, index) => {
      if (row.status === 'gap' && !namesPlacement(row.notes ?? '')) {
        findings.push(gap(path, index + 2, row.id ?? `row ${String(index + 1)}`));
      }
    });
  }
  if (repo.exists(THREAT_MODEL_PATH)) {
    for (const table of tablesOf(repo.readText(THREAT_MODEL_PATH))) {
      const header = table.header.map((cell) => cell.toLowerCase());
      const status = header.indexOf('status');
      const owner = header.indexOf('mitigation or owner');
      if (status < 0 || owner < 0) {
        continue;
      }
      for (const row of table.rows) {
        if (
          (row.cells[status] ?? '').replaceAll('`', '') === 'gap' &&
          !namesPlacement(row.cells[owner] ?? '')
        ) {
          findings.push(gap(THREAT_MODEL_PATH, row.line, row.cells[0] ?? 'row'));
        }
      }
    }
  }
  return findings;
}
