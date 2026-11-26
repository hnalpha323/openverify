/**
 * C172, C173 (Workflow 9B Stage 1a, (C)): the case template version members (layout, checklists,
 * the switcher's required fields, preset comments), the checklist state and its route, the case
 * action's placement and visibility, the report's latest run notes and the bulk origin, the
 * verification's files and redaction time, the print audit, and the graph property-node expansion
 * (owner decision 20 after Workflow 7B). Read through the package root.
 */
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as contracts from './index.js';
import { readFixture } from './test-support.js';

const pick = (name: string): unknown => (contracts as Readonly<Record<string, unknown>>)[name];
const schema = (name: string): z.ZodType => {
  const found = pick(name);
  expect(found, name).toBeDefined();
  return found as z.ZodType;
};
const parses = (name: string, value: unknown) => schema(name).safeParse(value).success;
const version = (attributes: Record<string, unknown>) => ({
  data: { type: 'case-template-version', attributes },
});

describe('case template version members (C172.1-C172.4)', () => {
  it('lays modules out in one to three columns, keyboard-orderable', () => {
    const layout = (value: unknown) =>
      parses('updateCaseTemplateVersionBodySchema', version({ layout: value }));
    expect(
      layout({
        columns: 2,
        modules: [
          { key: 'held-objects', column: 1, order: 0, collapsed: false },
          { key: 'comments', column: 2, order: 0, collapsed: true },
        ],
      }),
    ).toBe(true);
    expect(layout({ columns: 4, modules: [] })).toBe(false);
    expect(
      layout({
        columns: 1,
        modules: [{ key: 'held-objects', column: 2, order: 0, collapsed: false }],
      }),
    ).toBe(false);
    expect(
      layout({
        columns: 1,
        modules: [
          { key: 'held-objects', column: 1, order: 0, collapsed: false },
          { key: 'held-objects', column: 1, order: 1, collapsed: false },
        ],
      }),
    ).toBe(false);
  });

  it('holds checklists whose items name the statuses they gate, and plain preset comments', () => {
    expect(
      parses(
        'updateCaseTemplateVersionBodySchema',
        version({
          checklists: [
            {
              key: 'kyc',
              label: 'KYC review',
              items: [
                { key: 'id-reviewed', label: 'ID reviewed', 'required-for-statuses': ['resolved'] },
              ],
            },
          ],
          'preset-comments': [
            { key: 'need-doc', label: 'Ask for a document', text: 'Please upload a utility bill.' },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      parses(
        'updateCaseTemplateVersionBodySchema',
        version({ 'preset-comments': [{ key: 'p', label: 'P', text: 'Hello {name}' }] }),
      ),
    ).toBe(false);
    expect(
      parses(
        'updateCaseTemplateVersionBodySchema',
        version({ 'preset-comments': [{ key: 'p', label: 'P', text: 'x'.repeat(2001) }] }),
      ),
    ).toBe(false);
  });

  it('lets a status require fields before a case enters it (C172.3)', () => {
    const golden = readFixture('api/case-template-version-phase9b.json');
    expect(schema('caseTemplateVersionDocumentSchema').parse(golden)).toEqual(golden);
    const statuses = (golden as { data: { attributes: { statuses: Record<string, unknown>[] } } })
      .data.attributes.statuses;
    expect(statuses.map((status) => status['requires-fields'] ?? [])).toContainEqual([
      'resolution-notes',
    ]);
  });
});

describe('the checklist state (C172.2)', () => {
  it('checks or unchecks one item, and records who and when', () => {
    expect(
      parses('setCaseChecklistItemBodySchema', {
        meta: {
          'checklist-key': 'kyc',
          'item-key': 'id-reviewed',
          checked: true,
          'lock-version': 3,
        },
      }),
    ).toBe(true);
    expect(
      parses('setCaseChecklistItemBodySchema', { meta: { 'checklist-key': 'kyc', checked: true } }),
    ).toBe(false);
    const state = readFixture('api/case-checklist-state.json');
    expect(schema('caseChecklistStateDocumentSchema').parse(state)).toEqual(state);
    expect(pick('CASE_CHECKLIST_HISTORY_KINDS')).toEqual([
      'checklist-item-checked',
      'checklist-item-unchecked',
    ]);
  });
});

describe('case action placement and visibility (C172.5)', () => {
  it('places an action in the header, a module or the status switcher', () => {
    const placement = schema('caseActionPlacementInputSchema');
    for (const value of ['header', 'status-switcher', 'module:attachments']) {
      expect(placement.safeParse(value).success, value).toBe(true);
    }
    for (const value of ['footer', 'module:', 'module:Bad']) {
      expect(placement.safeParse(value).success, value).toBe(false);
    }
    expect(
      parses('caseActionVisibleWhenSchema', {
        statuses: ['open'],
        'role-ids': ['role_01M5CN00000000000000009B41'],
      }),
    ).toBe(true);
  });
});

describe('reports and verifications (C173.1, C173.2, C166.5)', () => {
  it('serves the latest run notes and the bulk origin on a report', () => {
    const report = readFixture('api/report-watchlist-phase9b.json');
    expect(schema('reportDocumentSchema').parse(report)).toEqual(report);
    expect(report).toMatchObject({
      data: { attributes: { origin: 'bulk', 'latest-run-notes': ['report_match'] } },
    });
  });

  it('includes a verification files and serves its redaction time', () => {
    expect(pick('VERIFICATION_INCLUDES')).toEqual(['selfies', 'files']);
    const verification = readFixture('api/verification-files.json');
    expect(schema('verificationDocumentSchema').parse(verification)).toEqual(verification);
  });
});

describe('the print audit (C173.3)', () => {
  it('records use of the print button for an inquiry, a report or a verification', () => {
    for (const id of [
      'inq_01M5CN00000000000000009B60',
      'rep_01M5CN00000000000000009B37',
      'ver_01M5CN00000000000000009B61',
    ]) {
      expect(parses('createPrintAuditBodySchema', { 'object-id': id }), id).toBe(true);
    }
    expect(
      parses('createPrintAuditBodySchema', { 'object-id': 'acc_01M5CN00000000000000009B62' }),
    ).toBe(false);
    const answer = readFixture('api/print-audit.json');
    expect(schema('printAuditDocumentSchema').parse(answer)).toEqual(answer);
  });
});

describe('the property-node expansion (owner decision 20 after Workflow 7B)', () => {
  it('expands a stored node into a new query, synchronously on request', () => {
    expect(parses('expandGraphNodeBodySchema', {})).toBe(true);
    expect(parses('expandGraphNodeBodySchema', { meta: { 'run-sync': true } })).toBe(true);
    expect(parses('expandGraphNodeBodySchema', { meta: { depth: 2 } })).toBe(false);
    expect(
      parses('expandGraphNodeParamsSchema', {
        id: 'grphq_01M5CN00000000000000009B63',
        nodeId: 'gn_AAAAAAAAAAAAAAAAAAAAAA',
      }),
    ).toBe(true);
    const expanded = readFixture('api/graph-query-expanded.json');
    expect(schema('graphQueryDocumentSchema').parse(expanded)).toEqual(expanded);
  });
});
