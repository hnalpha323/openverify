/** C121.2, C121.3, C121.5: the grant of a version, what a publisher must hold, and what pauses. */
import { describe, expect, it } from 'vitest';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';
import { deriveGrant, publisherRequirements, scopesThatPause } from './grant.js';
import { action, approve, chain, decline, INQUIRY } from './testing.js';

const LIST = 'lst_01M5CK3190XEVBM5ZXA76E1JSN';
const inputs = { registry: WORKFLOW_ACTIONS, egress: false, nested: [] };

describe('deriveGrant (C121.2)', () => {
  it('holds API scopes alone, each once, in order', () => {
    const grant = deriveGrant(chain([approve('one'), decline('two')]), inputs);
    expect(grant).toEqual({ scopes: ['inquiries:write'], pii: false });
  });

  it('reads a grant that depends on the config', () => {
    const redact = action('wipe', 'redact_object', { 'object-type': 'account', 'object-id': 'x' });
    expect(deriveGrant(chain([redact]), inputs).scopes).toEqual(['accounts:redact']);
  });

  it('is pii when a step needs unmasked values, or anything leaves', () => {
    const match = action('match', 'get_list_match', {
      'list-ids': [LIST],
      probe: { kind: 'email-address', value: '{{ trigger.fields.email }}' },
    });
    expect(deriveGrant(chain([match]), inputs).pii).toBe(true);
    expect(deriveGrant(chain([approve('one')]), { ...inputs, egress: true }).pii).toBe(true);
  });

  it('takes in the grants of its modules and the workflows it starts (C121.3)', () => {
    const grant = deriveGrant(chain([approve('one')]), {
      ...inputs,
      nested: [{ scopes: ['reports:write', 'inquiries:write'], pii: true }],
    });
    expect(grant).toEqual({ scopes: ['inquiries:write', 'reports:write'], pii: true });
  });

  it('adds the trigger scope for a step that starts a run (C121.3)', () => {
    const start = action('child', 'run_workflow', {
      'workflow-id': 'wfl_01M5CK3190XEVBM5ZXA76E1JSN',
      version: 'latest-published',
    });
    expect(deriveGrant(chain([start]), inputs).scopes).toEqual(['workflows:trigger']);
  });
});

describe('publisherRequirements (C116.4)', () => {
  it('adds publishing itself, and pii:view only when the grant reads PII', () => {
    expect(publisherRequirements({ scopes: ['inquiries:write'], pii: false }, 'sandbox')).toEqual([
      'inquiries:write',
      'workflows:publish',
    ]);
    expect(publisherRequirements({ scopes: [], pii: true }, 'sandbox')).toEqual([
      'workflows:publish',
      'pii:view',
    ]);
  });

  it('adds production for a production environment', () => {
    expect(publisherRequirements({ scopes: [], pii: false }, 'production')).toEqual([
      'workflows:publish',
      'environments:production',
    ]);
  });
});

describe('scopesThatPause (C121.5)', () => {
  it('holds the scopes of egress, redaction, decline and other adverse steps alone', () => {
    const tag = action('tag', 'tag_object', {
      'object-type': 'account',
      'object-id': 'x',
      tag: 'seen',
    });
    const redact = action('wipe', 'redact_object', { 'object-type': 'report', 'object-id': 'x' });
    const scopes = scopesThatPause(chain([tag, decline('no'), redact]), WORKFLOW_ACTIONS);
    expect([...scopes].sort()).toEqual(['inquiries:write', 'reports:redact']);
  });

  it('reads a by-config step as adverse, and an inquiry link as egress', () => {
    const add = action('block', 'add_list_item', {
      'list-id': LIST,
      item: { kind: 'string', value: INQUIRY },
    });
    const link = action('link', 'send_inquiry_link_email', { 'inquiry-id': INQUIRY });
    expect([...scopesThatPause(chain([add, link]), WORKFLOW_ACTIONS)].sort()).toEqual([
      'inquiries:write',
      'inquiry-sessions:write',
      'lists:write',
    ]);
  });

  it('is empty for internal steps that are not adverse', () => {
    expect(scopesThatPause(chain([approve('yes')]), WORKFLOW_ACTIONS).size).toBe(0);
    const tag = action('tag', 'tag_object', {
      'object-type': 'account',
      'object-id': 'x',
      tag: 'seen',
    });
    expect(scopesThatPause(chain([tag]), WORKFLOW_ACTIONS).size).toBe(0);
  });
});
