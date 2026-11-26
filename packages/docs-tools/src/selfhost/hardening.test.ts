/**
 * C277.1, C277.3: the hardening checklist is generated from the checklists' `operator` rows (ids,
 * our notes, our evidence; never a requirement's text, rule 15). The committed page is held as a
 * fresh render by `index.test.ts`' "holds over the repository".
 */
import { describe, expect, it } from 'vitest';
import { parseChecklist, renderHardeningChecklist, type ChecklistRow } from './hardening.js';

const HEADER = 'id,level,status,evidence,notes,threats,reviewed_at,reviewed_commit';

const asvs = [
  HEADER,
  'v5.0.0-12.3.1,2,operator,docs/self-hosting/requirements.md,"TLS between hosts | yours",B7-I1;B8-I1,2026-11-20,abc1234',
  'v5.0.0-1.2.1,1,met,apps/api/src/x.test.ts,ours,,2026-11-20,abc1234',
  'v5.0.0-3.4.1,1,operator,deploy/helm/openverify/values.yaml,HSTS at your ingress,,2026-11-20,abc1234',
  '',
].join('\n');

const masvs = [
  HEADER,
  'MASVS-PLATFORM-1,MASVS-PLATFORM,partial,android/openverify-sdk,ours,,2026-11-20,abc1234',
  'MASVS-RESILIENCE-1,MASVS-RESILIENCE,operator,docs/android/privacy.md,the host app signs and obfuscates,,2026-11-20,abc1234',
  '',
].join('\n');

function rowsOf(text: string): readonly ChecklistRow[] {
  const parsed = parseChecklist(text);
  expect(parsed.errors).toEqual([]);
  return parsed.rows;
}

describe('the checklists the hardening page reads', () => {
  it('reads every row in C274.1’s columns', () => {
    const rows = rowsOf(asvs);
    expect(rows.map((row) => `${row.id} ${row.status}`)).toEqual([
      'v5.0.0-12.3.1 operator',
      'v5.0.0-1.2.1 met',
      'v5.0.0-3.4.1 operator',
    ]);
    expect(rows[0]?.notes).toBe('TLS between hosts | yours');
  });

  it('refuses a stub, a missing column and text that does not parse', () => {
    expect(parseChecklist('Draft: written in Workflow 11E by docs-security\n').errors[0]).toMatch(
      /^the checklist lacks the columns /,
    );
    expect(parseChecklist('id,level\nx,1\n').errors).toEqual([
      'the checklist lacks the columns status, evidence, notes, threats',
    ]);
    expect(parseChecklist(`${HEADER}\n"unterminated,1\n`).errors[0]).toMatch(
      /^the checklist does not parse: /,
    );
  });
});

describe('the hardening checklist (C277.3)', () => {
  const page = (): string => renderHardeningChecklist(rowsOf(asvs), rowsOf(masvs));

  it('says it is generated, self-assessed, and holds no requirement text', () => {
    expect(page().startsWith('# Hardening checklist\n')).toBe(true);
    expect(page()).toContain('pnpm --filter @openverify/docs-tools docs:selfhost');
    expect(page()).toContain('self-assessed');
    expect(page()).toContain('`docs/security/asvs-5.0.0-l2.csv`');
    expect(page()).toContain('2 ASVS rows and 1 MASVS row');
  });

  it('lists only the operator rows, in the checklist’s order, with our notes and evidence', () => {
    const rows = page()
      .split('\n')
      .filter((line) => line.startsWith('| `'));
    expect(rows).toEqual([
      '| `v5.0.0-12.3.1` | 2 | TLS between hosts \\| yours | `docs/self-hosting/requirements.md` | B7-I1, B8-I1 |',
      '| `v5.0.0-3.4.1` | 1 | HSTS at your ingress | `deploy/helm/openverify/values.yaml` | none |',
      '| `MASVS-RESILIENCE-1` | MASVS-RESILIENCE | the host app signs and obfuscates | `docs/android/privacy.md` | none |',
    ]);
  });

  it('says so when a checklist has no operator row', () => {
    expect(renderHardeningChecklist([], [])).toContain('No row of this checklist has the status');
  });

  it('renders the same bytes twice', () => {
    expect(page()).toBe(page());
    expect(page().endsWith('\n')).toBe(true);
  });
});
