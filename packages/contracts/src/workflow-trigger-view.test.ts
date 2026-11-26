/** C114.4 (H27): the closed table, read against its golden vector. */
import { describe, expect, it } from 'vitest';
import { readFixture } from './test-support.js';
import { VERIFICATION_RESOURCE_TYPES } from './verification-types.js';
import {
  WORKFLOW_TRIGGER_ALIASES,
  workflowTriggerAliasOf,
  workflowTriggerAliasSchema,
  workflowTriggerMemberOf,
} from './workflow-trigger-view.js';

const golden = readFixture('workflows/trigger-aliases.json') as Record<string, unknown>;

describe('the trigger view alias table (C114.4)', () => {
  it('maps the two names the plan gives', () => {
    expect(workflowTriggerAliasOf('template')).toEqual({
      kind: 'relationship',
      relationship: 'inquiry-template',
    });
    expect(workflowTriggerAliasOf('verification_government_id')).toEqual({
      kind: 'verification',
      'resource-type': 'verification/government-id',
    });
  });

  it('reads the public id name as our id', () => {
    expect(workflowTriggerAliasOf('token')).toEqual({ kind: 'member', member: 'id' });
  });

  it('has an alias for every verification type', () => {
    const aliases: readonly { kind: string; 'resource-type'?: string }[] =
      Object.values(WORKFLOW_TRIGGER_ALIASES);
    const covered = aliases.flatMap((alias) =>
      alias.kind === 'verification' ? [alias['resource-type']] : [],
    );
    expect(covered.sort()).toEqual([...VERIFICATION_RESOURCE_TYPES].sort());
  });

  it('is closed: an unknown public name has no alias, which publish refuses', () => {
    expect(workflowTriggerAliasOf('verification_passport')).toBeUndefined();
  });

  it.each(['constructor', 'toString', '__proto__'])('never reads %s off the prototype', (name) => {
    expect(workflowTriggerAliasOf(name)).toBeUndefined();
  });

  it('holds a golden vector for each alias, and no vector without one', () => {
    expect(Object.keys(golden).sort()).toEqual(Object.keys(WORKFLOW_TRIGGER_ALIASES).sort());
  });

  it.each(Object.keys(golden))('%s reads as its golden vector', (name) => {
    expect(workflowTriggerAliasOf(name)).toEqual(golden[name]);
    expect(workflowTriggerAliasSchema.parse(golden[name])).toEqual(golden[name]);
  });

  it('refuses an alias of an unknown kind', () => {
    expect(workflowTriggerAliasSchema.safeParse({ kind: 'path', path: 'a' }).success).toBe(false);
  });

  it('reads a public member as its attribute', () => {
    expect(workflowTriggerMemberOf('country_code')).toBe('country-code');
    expect(workflowTriggerMemberOf('status')).toBe('status');
  });
});
