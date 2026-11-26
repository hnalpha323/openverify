import { WORKFLOW_ERROR_TYPES } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { WORKFLOW_ACTION_ERROR_TYPES } from './errors.js';

describe('the step errors of the actions (C120.2, C122-C128)', () => {
  it('maps every code to one of the six documented types', () => {
    expect(Object.keys(WORKFLOW_ACTION_ERROR_TYPES).length).toBeGreaterThan(0);
    for (const [code, type] of Object.entries(WORKFLOW_ACTION_ERROR_TYPES)) {
      expect(WORKFLOW_ERROR_TYPES, code).toContain(type);
    }
  });

  it.each([
    ['subject_redacted', 'resource-error'],
    ['report_timed_out', 'resource-error'],
    ['graph_query_errored', 'resource-error'],
    ['graph_query_timed_out', 'resource-error'],
    ['graph_query_cancelled', 'resource-error'],
    ['graph_index_failed', 'resource-error'],
    ['publisher_revoked', 'configuration-error'],
    ['provider_not_configured', 'configuration-error'],
    ['decision_basis_missing', 'configuration-error'],
  ] as const)('%s is a %s, as the plan says', (code, type) => {
    expect(WORKFLOW_ACTION_ERROR_TYPES[code]).toBe(type);
  });

  it('holds the codes the object actions name (C127, C128)', () => {
    for (const code of [
      'invalid_transition',
      'review_required',
      'report_errored',
      'report_selector_limit',
      'verification_timed_out',
      'list_unavailable',
      'graph_index_pending',
      'related_objects_limit',
      'relation_cardinality_exceeded',
      'biometric_consent_missing',
      'cause_lacks_scope',
      'human_review_pending',
    ]) {
      expect(WORKFLOW_ACTION_ERROR_TYPES, code).toHaveProperty(code);
    }
  });
});

describe('the step errors of the case actions (C140.3, C129.7)', () => {
  it('types a stub, so a step that reaches one never reads as unknown', () => {
    expect(WORKFLOW_ACTION_ERROR_TYPES).toHaveProperty('not_implemented', 'configuration-error');
  });

  it.each([
    ['case_transition_refused', 'resource-error'],
    ['case_comment_required', 'configuration-error'],
    ['case_status_tag_required', 'configuration-error'],
    ['case_resolution_invalid', 'configuration-error'],
    ['case_objects_limit', 'resource-error'],
    ['object_type_unsupported', 'invalid-input-error'],
    ['case_assignee_ineligible', 'resource-error'],
    ['case_version_conflict', 'resource-error'],
    ['sla_out_of_range', 'invalid-input-error'],
    ['case_template_archived', 'resource-error'],
    ['case_template_not_published', 'configuration-error'],
  ] as const)('%s is a %s', (code, type) => {
    expect(WORKFLOW_ACTION_ERROR_TYPES).toHaveProperty(code, type);
  });
});

describe('a platform-file field a run cannot read (Workflow 8C review K8-26)', () => {
  it('is a configuration error, never unknown', () => {
    expect(WORKFLOW_ACTION_ERROR_TYPES).toHaveProperty(
      'platform_file_not_allowed',
      'configuration-error',
    );
  });
});
