import { describe, expect, it } from 'vitest';
import {
  IMPORT_ERROR_CODES,
  IMPORT_LIMITS,
  IMPORTER_LIST_KINDS,
  IMPORTER_MODES,
  LIST_ITEM_STATUSES,
  LIST_KEY_KINDS,
  LIST_KINDS,
  LIST_KIND_REGISTRY,
  LIST_LIMITS,
  LIST_MATCH_CONSTANTS,
  LIST_MATCH_METHODS,
  LIST_NOT_APPLICABLE_REASONS,
  LIST_PROBE_SOURCES,
  LIST_REVIEW_CAUSES,
  LIST_SCREENING_STATUSES,
  LIST_UNSCREENED_REASONS,
  toImporterResourceType,
  toListItemResourceType,
  toListResourceType,
} from './lists.js';

describe('the list kinds (C97.1)', () => {
  it('are the thirteen kinds, singular', () => {
    expect(LIST_KINDS).toEqual([
      'browser-fingerprint',
      'device-fingerprint',
      'country',
      'email-address',
      'face',
      'geolocation',
      'government-id-number',
      'field',
      'ip-address',
      'name',
      'phone-number',
      'selfie-background',
      'string',
    ]);
  });

  it('give each kind its plural path and item prefix (H18)', () => {
    expect(
      LIST_KINDS.map((kind) => [
        LIST_KIND_REGISTRY[kind].plural,
        LIST_KIND_REGISTRY[kind].itemPrefix,
      ]),
    ).toEqual([
      ['browser-fingerprints', 'libf'],
      ['device-fingerprints', 'lidf'],
      ['countries', 'lic'],
      ['email-addresses', 'liea'],
      ['faces', 'lifc'],
      ['geolocations', 'ligl'],
      ['government-id-numbers', 'ligin'],
      ['fields', 'liif'],
      ['ip-addresses', 'liip'],
      ['names', 'lin'],
      ['phone-numbers', 'lipn'],
      ['selfie-backgrounds', 'lisb'],
      ['strings', 'lis'],
    ]);
  });

  it('import every kind but faces and backgrounds (decision 27)', () => {
    expect(IMPORTER_LIST_KINDS).toEqual(
      LIST_KINDS.filter((kind) => kind !== 'face' && kind !== 'selfie-background'),
    );
  });

  it('marks only faces and backgrounds biometric, and keeps them out of "all" (C99.5, H16)', () => {
    expect(LIST_KINDS.filter((kind) => LIST_KIND_REGISTRY[kind].biometric)).toEqual([
      'face',
      'selfie-background',
    ]);
    expect(LIST_KINDS.filter((kind) => !LIST_KIND_REGISTRY[kind].screenedByAll)).toEqual([
      'face',
      'selfie-background',
      'string',
    ]);
  });

  it('records the key id only on the fingerprint kinds (C94.4, P09)', () => {
    expect(LIST_KINDS.filter((kind) => LIST_KIND_REGISTRY[kind].keyed)).toEqual([
      'browser-fingerprint',
      'device-fingerprint',
    ]);
  });

  it('names the three JSON:API types of a kind', () => {
    expect(toListResourceType('email-address')).toBe('list/email-address');
    expect(toListItemResourceType('email-address')).toBe('list-item/email-address');
    expect(toImporterResourceType('email-address')).toBe('importer/list-item/email-address');
  });
});

describe('the list vocabularies (C97-C100)', () => {
  it('holds the plan limits (C97.5, C100.2, decision 31)', () => {
    expect(LIST_LIMITS).toMatchObject({
      activeListsPerEnvironment: 1000,
      itemsPerList: 1_000_000,
      itemsPerBiometricList: 10_000,
      radiusMeters: 500_000,
      itemRetentionDays: 3650,
      matchProbes: 20,
      screenedLists: 50,
      reportLists: 20,
    });
    expect(IMPORT_LIMITS).toMatchObject({
      fileBytes: 20_000_000,
      rows: 100_000,
      recordCharacters: 4096,
      errorsPerImport: 1000,
      objectRetentionDays: 7,
      fileIdempotencyHours: 24,
    });
  });

  it('closes the importer vocabularies (C100.1, C100.4)', () => {
    expect(IMPORTER_MODES).toEqual(['all-or-nothing', 'skip-invalid']);
    expect(IMPORT_ERROR_CODES).toEqual([
      'invalid_encoding',
      'missing_column',
      'unknown_column',
      'duplicate_column',
      'row_limit_exceeded',
      'record_too_large',
      'field_count_mismatch',
      'invalid_value',
      'unparseable_phone',
      'host_bits_set',
      'out_of_range',
      'unsupported_class',
    ]);
  });

  it('closes the matching vocabularies, so nothing reads as "no match" (C99.1, H11, H16, V21)', () => {
    expect(LIST_MATCH_METHODS).toEqual([
      'exact',
      'cidr',
      'radius',
      'fuzzy_name',
      'face_cosine',
      'background',
    ]);
    expect(LIST_UNSCREENED_REASONS).toEqual([
      'list_items_pending',
      'probe_unavailable',
      'probe_too_coarse',
      'consent_not_given',
      'normaliser_outdated',
      'key_rotated',
      'limit_exceeded',
      'list_archived',
      'method_not_on_demand',
      'kind_not_collected',
      'client_address_untrusted',
    ]);
    expect(LIST_NOT_APPLICABLE_REASONS).toEqual(['subject_has_no_value']);
    expect(LIST_ITEM_STATUSES).toEqual(['pending', 'active', 'archived']);
    expect(LIST_SCREENING_STATUSES).toEqual(['pending', 'completed', 'partial', 'errored']);
    expect(LIST_REVIEW_CAUSES).toEqual([
      'list_match',
      'list_unscreened',
      'inquiry_already_decided',
    ]);
  });

  it('names the probe sources of C99.5, the C99.9 source among them', () => {
    expect(LIST_PROBE_SOURCES).toContain('government-id.identification-number');
    expect(LIST_PROBE_SOURCES).toContain('session.ip-address');
    expect(LIST_PROBE_SOURCES).toContain('selfie.center');
    for (const source of LIST_PROBE_SOURCES) {
      expect(source).toMatch(/^(?:[a-z-]+\.[a-z-]+|request)$/);
    }
  });

  it('labels each list key kind as identifierKey will (C98.2)', () => {
    expect(LIST_KEY_KINDS).toHaveLength(14);
    for (const kind of LIST_KEY_KINDS) {
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      expect(kind).toMatch(/^identifier-[a-z]+(?:-[a-z]+)*$/);
    }
  });

  // Workflow 11D review (fix-11d; owner decisions 3 and 4 after Workflow 7B): the list
  // calibration (docs/calibration/lists-phase11.md) recommended a fuzzy-name cap of 5,000 and a
  // face-list threshold of 0.72 by rules fixed before its seed; each now rests on that report.
  it('takes the calibrated fuzzy-name cap and face-list threshold from the 11D list calibration', () => {
    const cap = LIST_MATCH_CONSTANTS['fuzzy-name-candidate-cap'];
    expect(cap?.value).toBe(5000);
    expect(cap?.basis).toBe('calibrated');
    expect(cap?.source).toContain('docs/calibration/lists-phase11.md (h)');
    const face = LIST_MATCH_CONSTANTS['face-list-threshold'];
    expect(face?.value).toBe(0.72);
    expect(face?.basis).toBe('calibrated');
    expect(face?.source).toContain('docs/calibration/lists-phase11.md (i)');
    expect(face?.source).toContain('FNIR 25.3%');
  });

  it('keeps every other list constant provisional with a basis (ADR 0002 §3f)', () => {
    const calibrated = ['fuzzy-name-candidate-cap', 'face-list-threshold'];
    for (const [name, constant] of Object.entries(LIST_MATCH_CONSTANTS)) {
      if (!calibrated.includes(name)) {
        expect(constant.basis).toBe('provisional');
      }
    }
  });
});
