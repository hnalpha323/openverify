import {
  CLIENT_ADDRESS_SOURCES,
  HANDOFF_METHODS,
  NETWORK_FACT_FIELDS,
  SESSION_DEVICE_TYPES,
} from '@openverify/contracts';
import { COLLECTOR_TIERS } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_ADDRESS_SOURCE_WORDS,
  COLLECTOR_TIER_LABELS,
  HANDOFF_METHOD_LABELS,
  NETWORK_FACT_LABELS,
  SESSION_DEVICE_TYPE_LABELS,
  networkErrorCodeText,
  networkSyncOutcomeText,
} from './network-words';

describe('network and device vocabularies in words (C91, C93, C96, C108)', () => {
  it.each(NETWORK_FACT_FIELDS)('labels the network fact %s', (field) => {
    expect(NETWORK_FACT_LABELS[field]).toMatch(/^[A-Z]/);
  });

  it.each(CLIENT_ADDRESS_SOURCES)('says how the address was resolved (%s)', (source) => {
    expect(CLIENT_ADDRESS_SOURCE_WORDS[source]).toMatch(/^[A-Z]/);
  });

  it('warns that trust-all lets the client choose its address (C93.1)', () => {
    expect(CLIENT_ADDRESS_SOURCE_WORDS['trust-all']).toMatch(/client/i);
  });

  it.each(COLLECTOR_TIERS)('labels the collection tier %s', (tier) => {
    expect(COLLECTOR_TIER_LABELS[tier]).toMatch(/^[A-Z]/);
  });

  it.each(SESSION_DEVICE_TYPES)('labels the device type %s', (type) => {
    expect(SESSION_DEVICE_TYPE_LABELS[type]).toMatch(/^[A-Z]/);
  });

  it.each(HANDOFF_METHODS)('labels the handoff method %s', (method) => {
    expect(HANDOFF_METHOD_LABELS[method]).toMatch(/^[A-Z]/);
  });
});

describe('network syncs in words (C92.2)', () => {
  it.each([
    ['applied', 'Applied'],
    ['unchanged', 'Unchanged (same publication)'],
    ['busy', 'Skipped: another sync held the source'],
    ['refused_rollback', 'Refused: older than the applied publication'],
    ['refused_future', 'Refused: published in the future'],
    ['refused_mass_removal', 'Refused: too much removed at once'],
    ['refused_mass_addition', 'Refused: too much added at once'],
    ['refused_schema', 'Refused: the file did not match its format'],
    ['refused_size', 'Refused: the file is too large'],
    ['refused_digest', "Refused: the publisher's digest did not match"],
    ['error', 'Failed: the check could not finish'],
  ])('says the outcome %s', (outcome, words) => {
    expect(networkSyncOutcomeText(outcome)).toBe(words);
  });

  it('reads an outcome it does not know as its code', () => {
    expect(networkSyncOutcomeText('refused_other')).toBe('refused_other');
  });

  it.each([
    ['storage_not_configured', 'Not configured: this process has no object storage'],
    ['source_disabled', 'Not configured: the source is turned off'],
  ])('says the error code %s', (code, words) => {
    expect(networkErrorCodeText(code)).toBe(words);
  });

  it('reads an error code it does not know as its code', () => {
    expect(networkErrorCodeText('download_timeout')).toBe('download_timeout');
  });
});
