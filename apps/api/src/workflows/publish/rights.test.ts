/** C121.5: a test per case of what a publisher's lost right does to a running workflow. */
import type { Permission } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { WORKFLOW_ACTIONS } from '../definitions/registry.js';
import { publisherVerdict, type LiveVersion } from './rights.js';
import { action, chain, decline, INQUIRY } from './testing.js';

const tag = action('mark', 'tag_object', {
  'object-type': 'account',
  'object-id': INQUIRY,
  tag: 'seen',
});

const verdict = (
  permissions: readonly Permission[],
  version: LiveVersion,
  options: { active?: boolean; kind?: 'sandbox' | 'production' } = {},
) =>
  publisherVerdict(
    { active: options.active ?? true, permissions: new Set(permissions) },
    version,
    options.kind ?? 'sandbox',
    WORKFLOW_ACTIONS,
  );

const adverse: LiveVersion = {
  definition: chain([tag, decline('no')]),
  grant: { scopes: ['accounts:write', 'inquiries:write'], pii: false },
};

describe('publisherVerdict (C121.5)', () => {
  it('is fine for a publisher who holds everything', () => {
    expect(verdict(['accounts:write', 'inquiries:write'], adverse)).toEqual({ kind: 'fine' });
  });

  it('pauses for a deactivated or deleted publisher', () => {
    expect(verdict(['accounts:write', 'inquiries:write'], adverse, { active: false })).toEqual({
      kind: 'pause',
    });
  });

  it('pauses when pii:view goes from a version that reads PII', () => {
    const version = { ...adverse, grant: { ...adverse.grant, pii: true } };
    expect(verdict(['accounts:write', 'inquiries:write'], version)).toEqual({ kind: 'pause' });
    expect(verdict(['accounts:write', 'inquiries:write', 'pii:view'], version)).toEqual({
      kind: 'fine',
    });
  });

  it('pauses when production goes from a production workflow', () => {
    expect(verdict(['accounts:write', 'inquiries:write'], adverse, { kind: 'production' })).toEqual(
      { kind: 'pause' },
    );
  });

  it('pauses when a scope of an adverse step goes', () => {
    expect(verdict(['accounts:write'], adverse)).toEqual({ kind: 'pause' });
  });

  it("keeps running, flagged, when only an internal step's scope goes", () => {
    expect(verdict(['inquiries:write'], adverse)).toEqual({
      kind: 'flag',
      missingScopes: ['accounts:write'],
    });
  });

  it("pauses when an egress step's scope goes", () => {
    const link = action('link', 'send_inquiry_link_email', { 'inquiry-id': INQUIRY });
    const version: LiveVersion = {
      definition: chain([link]),
      grant: { scopes: ['inquiries:write', 'inquiry-sessions:write'], pii: false },
    };
    expect(verdict(['inquiries:write'], version)).toEqual({ kind: 'pause' });
  });
});
