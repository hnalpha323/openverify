/**
 * C150.9 (decision 68; a labelled Phase 7 C90.1 amendment, review H02): which signals a flow branch
 * may read, through a provisional snapshot computed from the session facts stored so far. True only
 * for signals whose inputs exist before completion (network, device and session facts); false for
 * any signal fed by a verification or a screening. And C150.2 (review H03): the check reasons that
 * mean an outage, so a check that ended with one reads `null` in a flow, never "not failed".
 */
import { describe, expect, it } from 'vitest';
import { CHECK_ERROR_REASONS, checkErrorClassOf } from './check-registry.js';
import { SIGNAL_REGISTRY } from './signal-registry.js';

const provisional = (entry: unknown): unknown =>
  (entry as { flowProvisional?: unknown }).flowProvisional;

describe('flowProvisional (C150.9)', () => {
  it('is set on every entry, and only network, device and session signals are true', () => {
    expect(SIGNAL_REGISTRY.map((entry) => [entry.name, provisional(entry)])).toEqual([
      ['inquiry/bot_score', true],
      ['inquiry/behavior_threat_level', true],
      ['inquiry/automation_artefact_count', true],
      ['inquiry/session_count', true],
      ['inquiry/network_threat_level', true],
      ['inquiry/tor_detected', true],
      ['inquiry/datacenter_detected', true],
      ['inquiry/vpn_detected', true],
      ['inquiry/proxy_detected', true],
      ['inquiry/country_from_session', true],
      ['inquiry/country_comparison', false],
      ['inquiry/max_session_distance', true],
      ['inquiry/handoff_count', true],
      ['inquiry/device_emulated', true],
      ['inquiry/device_rooted', true],
      ['inquiry/device_hooked', true],
      ['inquiry/device_integrity_level', true],
      ['inquiry/app_recognized', true],
      ['inquiry/list_match_count', false],
    ]);
  });

  it('is never true for a signal fed by a verification or a screening', () => {
    for (const entry of SIGNAL_REGISTRY.filter((candidate) => provisional(candidate) === true)) {
      expect(entry.inputs, entry.name).not.toContain('government-id-extraction');
      expect(entry.inputs, entry.name).not.toContain('lists');
    }
  });
});

describe('CHECK_ERROR_REASONS (C150.2, review H03)', () => {
  it('names the reasons that mean the check could not run', () => {
    expect(CHECK_ERROR_REASONS).toEqual([
      'execution_error',
      'input_missing',
      'provider_not_configured',
    ]);
  });

  it('classes every *_unavailable reason as errored, and an unbound provider as not configured', () => {
    expect(checkErrorClassOf(['execution_error'])).toBe('errored');
    expect(checkErrorClassOf(['input_missing'])).toBe('errored');
    expect(checkErrorClassOf(['list_unavailable'])).toBe('errored');
    expect(checkErrorClassOf(['domain_age_unavailable', 'document_too_old'])).toBe('errored');
    expect(checkErrorClassOf(['provider_not_configured'])).toBe('not_configured');
    expect(checkErrorClassOf(['provider_not_configured', 'list_unavailable'])).toBe('errored');
  });

  it('classes a not_applicable result for any other reason as no error', () => {
    expect(checkErrorClassOf([])).toBeNull();
    expect(checkErrorClassOf(['document_type_not_applicable'])).toBeNull();
    expect(checkErrorClassOf(['unavailable_feature'])).toBeNull();
  });
});
