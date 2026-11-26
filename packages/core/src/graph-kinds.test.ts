import { describe, expect, it } from 'vitest';
import {
  GRAPH_KINDS,
  GRAPH_KIND_REGISTRY,
  GRAPH_PERSON_KINDS,
  GRAPH_STRONG_KINDS,
  GRAPH_WEAK_KINDS,
  graphKindCode,
  graphKindOfCode,
} from './graph-kinds.js';

describe('the graph kinds (C101.2)', () => {
  it('freezes each kind with its stored code', () => {
    expect(GRAPH_KINDS.map((kind) => [kind, graphKindCode(kind)])).toEqual([
      ['government_id_number', 1],
      ['chip_signature', 2],
      ['crypto_address', 3],
      ['email_address', 4],
      ['phone_number', 5],
      ['email_address_unconfirmed', 6],
      ['phone_number_unconfirmed', 7],
      ['reference_id', 8],
      ['name_birthdate', 9],
      ['address', 10],
      ['device_fingerprint', 11],
      ['device_class', 12],
      ['browser_fingerprint', 13],
      ['ip_address', 14],
      ['name', 15],
      ['birthdate', 16],
      ['postal_code', 17],
      ['email_domain', 18],
    ]);
  });

  it('reads a stored code back, and says null for one it does not know', () => {
    for (const kind of GRAPH_KINDS) {
      expect(graphKindOfCode(graphKindCode(kind))).toBe(kind);
    }
    expect(graphKindOfCode(99)).toBeNull();
  });

  it('keeps every kind in snake case, as the public node types are (H19)', () => {
    for (const kind of GRAPH_KINDS) {
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      expect(kind).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
    }
  });

  it('gives the plan its strengths: components read only the strong kinds (C101.6, P26)', () => {
    expect(GRAPH_STRONG_KINDS).toEqual([
      'government_id_number',
      'chip_signature',
      'crypto_address',
      'email_address',
      'phone_number',
      'reference_id',
    ]);
    expect(GRAPH_WEAK_KINDS).toEqual([
      'device_class',
      'browser_fingerprint',
      'ip_address',
      'name',
      'birthdate',
      'postal_code',
      'email_domain',
    ]);
  });

  it('keeps the chip and crypto kinds on their existing indexes (decision 29, narrowed)', () => {
    for (const kind of ['government_id_number', 'chip_signature', 'crypto_address'] as const) {
      expect(GRAPH_KIND_REGISTRY[kind].key).toBe('existing-index');
    }
    expect(GRAPH_KIND_REGISTRY.email_address.key).toBe('identifier-email');
    expect(GRAPH_KIND_REGISTRY.email_address_unconfirmed.key).toBe('identifier-email');
  });

  it('names the person-identifying parameters that need pii:view (C102.4, P11)', () => {
    expect(GRAPH_PERSON_KINDS).toEqual([
      'government_id_number',
      'email_address',
      'phone_number',
      'email_address_unconfirmed',
      'phone_number_unconfirmed',
      'reference_id',
      'name_birthdate',
      'address',
      'name',
    ]);
  });

  it('writes the fingerprint kinds only under the device-recognition tier (C101.2)', () => {
    expect(GRAPH_KINDS.filter((kind) => GRAPH_KIND_REGISTRY[kind].needsDeviceRecognition)).toEqual([
      'device_fingerprint',
      'device_class',
      'browser_fingerprint',
    ]);
  });
});
