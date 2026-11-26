/** C144: the generated reference pages match the code, and name everything it holds. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_ERROR_TYPES, WORKFLOW_RUN_LIMITS } from '@openverify/workflow-engine';
import { WORKFLOW_ACTION_ERROR_TYPES } from '@openverify/workflow-engine/actions';
import { describe, expect, it } from 'vitest';
import { RUN_WORKFLOW_ERROR_TYPES } from '../flow-actions/run-workflow.js';
import { WORKFLOW_ACTIONS } from './definitions/registry.js';
import { REFERENCE_DOCS } from './reference-docs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('docs/workflows reference pages (C144)', () => {
  it.each(Object.keys(REFERENCE_DOCS))('%s is what the code says', (file) => {
    expect(readFileSync(path.join(ROOT, file), 'utf8')).toBe(REFERENCE_DOCS[file]?.());
  });

  it('names each action with its delivery, and each code and limit', () => {
    const actions = REFERENCE_DOCS['docs/workflows/actions.md']?.() ?? '';
    for (const { key, delivery } of WORKFLOW_ACTIONS.list()) {
      expect(actions).toMatch(new RegExp(`\\| \`${key}\` .*\\| ${delivery} \\|`));
    }
    const errors = REFERENCE_DOCS['docs/workflows/errors.md']?.() ?? '';
    for (const code of Object.keys({ ...ENGINE_ERROR_TYPES, ...WORKFLOW_ACTION_ERROR_TYPES })) {
      expect(errors).toContain(`\`${code}\``);
    }
    // C174.8, C152 (Workflow 9A): a flow action step's error-type, `workflow_grant_widened` among
    // them, in a section of its own.
    const flowActions = errors.slice(errors.indexOf('## Flow action steps'));
    expect(flowActions).not.toBe('');
    for (const code of [
      ...RUN_WORKFLOW_ERROR_TYPES,
      'action_not_entered',
      'account_fields_invalid',
      'account_missing',
      'account_redacted',
      'verification_not_decided',
      'inquiry_not_open',
      'field_unknown',
      'field_write_once',
      'fields_too_large',
    ]) {
      expect(flowActions).toContain(`| \`${code}\` |`);
    }
    const limits = REFERENCE_DOCS['docs/workflows/limits.md']?.() ?? '';
    for (const name of Object.keys(WORKFLOW_RUN_LIMITS)) {
      expect(limits).toContain(`\`${name}\``);
    }
  });
});
