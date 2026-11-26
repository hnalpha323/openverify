import { describe, expect, it } from 'vitest';
import { ID_PREFIXES, idPattern } from './ids.js';

describe('ID_PREFIXES (C1)', () => {
  it('holds the Phase 6 report prefixes, as the contracts table does (C70.1)', () => {
    expect(ID_PREFIXES).toMatchObject({
      report: 'rep',
      reportTemplate: 'rptp',
      reportTemplateVersion: 'rptpv',
      reportRun: 'rpr',
      reportAction: 'ract',
      reportMatch: 'rpm',
    });
  });

  it('holds the Phase 7 device and network prefixes (C91.2, C91.3)', () => {
    expect(ID_PREFIXES).toMatchObject({ device: 'dev', network: 'net', handoff: 'hnd' });
  });

  it('holds the Workflow 8A prefixes, as the contracts table does (C112.1)', () => {
    expect(ID_PREFIXES).toMatchObject({
      workflow: 'wfl',
      workflowVersion: 'wfv',
      workflowDeployment: 'wfd',
      workflowRun: 'wfr',
      scheduledRun: 'srrun',
      accountAction: 'accac',
      workflowSecret: 'wsec',
      workflowSecretValue: 'wsecv',
      workflowRunStep: 'wfst',
      workflowTriggerDelivery: 'wftd',
      workflowSchedule: 'wfsc',
      workflowEffect: 'wfef',
      workflowRunFile: 'wfrf',
      inquiryDecision: 'idec',
    });
  });

  it('holds the Workflow 8B prefixes, as the contracts table does (C129.1)', () => {
    expect(ID_PREFIXES).toMatchObject({
      case: 'case',
      caseTemplate: 'ctmpl',
      caseTemplateVersion: 'ctmplv',
      caseQueue: 'cqueue',
      caseComment: 'cscm',
      caseAssignmentPolicy: 'cap',
      caseAttachment: 'catt',
      caseAction: 'cact',
      caseSlaPolicy: 'cslap',
      caseCalendar: 'ccal',
      caseExport: 'cexp',
      caseBulkAction: 'cblk',
      userNotification: 'unot',
    });
  });

  it('holds the Workflow 9A prefixes, as the contracts table does (C174.1)', () => {
    expect(ID_PREFIXES).toMatchObject({
      themeSet: 'theset',
      deployment: 'dply',
      themeAsset: 'tsa',
      simulationPreset: 'ssp',
    });
  });

  it('holds the Workflow 9B prefixes, as the contracts table does (C174.1)', () => {
    expect(ID_PREFIXES).toMatchObject({ export: 'exp', savedView: 'svw', reportBulkJob: 'rbulk' });
    // Workflow 10B (C221.2): an integrity challenge.
    expect(ID_PREFIXES).toHaveProperty('integrityChallenge', 'ich');
  });

  it('holds the Workflow 11A Connect prefixes, as the contracts table does (C230.1)', () => {
    expect(ID_PREFIXES).toMatchObject({
      connection: 'cxn',
      shareToken: 'cnst',
      sharePolicy: 'cxnp',
      consentRecord: 'cnsr',
    });
  });

  it('holds the Workflow 11B account-export prefix, as the contracts table does (C253.1)', () => {
    expect(ID_PREFIXES).toHaveProperty('accountExport', 'aexp');
    expect(ID_PREFIXES).toHaveProperty('ssoProvider', 'ssop');
  });

  it('uses distinct, lowercase prefixes, each with its id format check', () => {
    const prefixes = Object.values(ID_PREFIXES);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const prefix of prefixes) {
      expect(prefix).toMatch(/^[a-z]+$/);
      expect(idPattern(prefix)).toBe(`^${prefix}_[0-9A-HJKMNP-TV-Z]{26}$`);
    }
  });
});
