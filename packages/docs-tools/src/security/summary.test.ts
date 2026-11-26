/** C274.3: the generated ASVS and MASVS summary, over fixtures. */
import { describe, expect, it } from 'vitest';
import { wordingFindings } from '../wording.js';
import { parseSecurityChecklist, SECURITY_CHECKLIST_COLUMNS } from './checklist.js';
import { ASVS_SUMMARY_PATH, renderAsvsSummary } from './summary.js';

const HEADER = SECURITY_CHECKLIST_COLUMNS.join(',');

const ASVS = parseSecurityChecklist(
  [
    HEADER,
    'v5.0.0-1.1.1,2,met,a.test.ts,Our words.,B3-T1,2026-11-20,abc1234',
    'v5.0.0-1.2.1,1,partial,a.ts,Partly (11F).,,2026-11-20,abc1234',
    'v5.0.0-2.1.1,1,gap,,Not built; next release.,,2026-11-20,abc1234',
    'v5.0.0-10.4.1,1,not_applicable,,Not applicable because no server.,,2026-11-20,abc1234',
    'v5.0.0-12.1.1,1,operator,,The ingress.,,2026-11-19,def5678',
    '',
  ].join('\n'),
);

const MASVS = parseSecurityChecklist(
  [
    HEADER,
    'MASVS-STORAGE-1,MASVS-STORAGE,met,a.test.ts,Our words.,,2026-11-20,abc1234',
    'MASVS-NETWORK-2,MASVS-NETWORK,operator,,The host app.,,2026-11-20,abc1234',
    '',
  ].join('\n'),
);

describe('renderAsvsSummary', () => {
  const page = renderAsvsSummary(ASVS, MASVS);

  it('counts each ASVS chapter by status, in chapter order, with totals', () => {
    expect(page).toContain('| V1 | 1 | 1 | 0 | 0 | 0 | 2 |');
    expect(page).toContain('| V2 | 0 | 0 | 1 | 0 | 0 | 1 |');
    expect(page).toContain('| V10 | 0 | 0 | 0 | 1 | 0 | 1 |');
    expect(page).toContain('| V12 | 0 | 0 | 0 | 0 | 1 | 1 |');
    expect(page).toContain('| All | 1 | 1 | 1 | 1 | 1 | 5 |');
    expect(page.indexOf('| V2 |')).toBeLessThan(page.indexOf('| V10 |'));
  });

  it('counts each MASVS group by status', () => {
    expect(page).toContain('| MASVS-STORAGE | 1 | 0 | 0 | 0 | 0 | 1 |');
    expect(page).toContain('| MASVS-NETWORK | 0 | 0 | 0 | 0 | 1 | 1 |');
  });

  it('lists the operator and gap rows by id, and the reviews by date and commit', () => {
    expect(page).toContain('`v5.0.0-12.1.1`');
    expect(page).toContain('`MASVS-NETWORK-2`');
    expect(page).toContain('`v5.0.0-2.1.1`');
    expect(page).toContain('| 2026-11-20 | `abc1234` | 4 |');
    expect(page).toContain('| 2026-11-19 | `def5678` | 1 |');
  });

  it('is deterministic, ends with one newline and passes the wording rule', () => {
    expect(renderAsvsSummary(ASVS, MASVS)).toBe(page);
    expect(page.endsWith('\n')).toBe(true);
    expect(page.endsWith('\n\n')).toBe(false);
    expect(wordingFindings(ASVS_SUMMARY_PATH, page)).toEqual([]);
  });
});
