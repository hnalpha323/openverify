import { describe, expect, it } from 'vitest';
import {
  REPORT_EVENT_ACTIONS,
  REPORT_EVENT_NAMES,
  REPORT_PROVIDER_KINDS,
  REPORT_REGISTRY,
  REPORT_TYPES,
  fromReportResourceType,
  getReportTypeDefinition,
  isReportType,
  reportEventName,
  reportTypeSchema,
  type ReportType,
  toReportResourceType,
} from './report-registry.js';

const MATCH_EVENTS = ['ready', 'errored', 'matched', 'dismissed', 'reviewed', 'redacted'];
const PLAIN_EVENTS = ['ready', 'errored', 'redacted'];

describe('REPORT_TYPES (C69.1)', () => {
  it('lists the nine Phase 6 types in the plan order, then ip-address and custom-list of Phase 7 (C106)', () => {
    expect(REPORT_TYPES).toEqual([
      'watchlist',
      'business-watchlist',
      'crypto-address-watchlist',
      'politically-exposed-person',
      'adverse-media',
      'business-adverse-media',
      'email-address',
      'phone-number',
      'address-lookup',
      'ip-address',
      'custom-list',
    ]);
    expect(Object.isFrozen(REPORT_TYPES)).toBe(true);
    expect(reportTypeSchema.options).toEqual([...REPORT_TYPES]);
  });

  it('maps each type to report/<type> and back', () => {
    for (const type of REPORT_TYPES) {
      expect(toReportResourceType(type)).toBe(`report/${type}`);
      expect(fromReportResourceType(`report/${type}`)).toBe(type);
      expect(isReportType(type)).toBe(true);
    }
    expect(fromReportResourceType('report/screening')).toBeNull();
    expect(fromReportResourceType('verification/watchlist')).toBeNull();
    expect(fromReportResourceType('report/')).toBeNull();
    expect(isReportType('screening')).toBe(false);
    expect(isReportType('toString')).toBe(false);
    expect(isReportType(7)).toBe(false);
  });
});

describe('REPORT_REGISTRY (C69.1)', () => {
  it('has exactly one frozen entry per type, keyed by it', () => {
    expect(Object.keys(REPORT_REGISTRY)).toEqual([...REPORT_TYPES]);
    for (const type of REPORT_TYPES) {
      const entry = getReportTypeDefinition(type);
      expect(entry.type).toBe(type);
      expect(entry.resourceType).toBe(`report/${type}`);
      expect(Object.isFrozen(entry)).toBe(true);
      expect(entry.tierNote.length).toBeGreaterThan(0);
      expect(entry.gaCondition.length).toBeGreaterThan(0);
    }
    expect(Object.isFrozen(REPORT_REGISTRY)).toBe(true);
  });

  it('records the plan table: tiers, recurrence, review and needs', () => {
    const row = (type: ReportType) => {
      const entry = REPORT_REGISTRY[type];
      return [
        entry.tiers.join('+'),
        entry.recurrable,
        entry.review,
        entry.sourceKind,
        entry.requiredProviderKind,
        entry.optionalProviderKinds,
      ];
    };
    expect(row('watchlist')).toEqual(['R+H', true, 'matches', 'sanctions', null, []]);
    expect(row('business-watchlist')).toEqual(['R+H', true, 'matches', 'sanctions', null, []]);
    expect(row('crypto-address-watchlist')).toEqual([
      'R',
      true,
      'matches',
      'sanctions',
      null,
      ['cryptoExposure'],
    ]);
    expect(row('politically-exposed-person')).toEqual(['H', true, 'matches', 'pep', null, []]);
    expect(row('adverse-media')).toEqual(['H+A', true, 'matches', null, 'adverseMedia', []]);
    expect(row('business-adverse-media')).toEqual([
      'H+A',
      true,
      'matches',
      null,
      'adverseMedia',
      [],
    ]);
    expect(row('email-address')).toEqual([
      'R+H+A',
      false,
      'none',
      null,
      null,
      ['emailIntelligence'],
    ]);
    expect(row('phone-number')).toEqual([
      'R+H+A',
      false,
      'none',
      null,
      null,
      ['phoneIntelligence'],
    ]);
    expect(row('address-lookup')).toEqual([
      'R+A',
      false,
      'none',
      null,
      null,
      ['addressVerification'],
    ]);
    // C106.1 (Phase 7): R for Tor, provider ranges, geolocation and ASN; H for the VPN and
    // hosting-ASN flags; A for the proxy flag. Review model none, so has-match is always false.
    expect(row('ip-address')).toEqual(['R+H+A', false, 'none', null, null, ['ipReputation']]);
    expect(row('custom-list')).toEqual(['R+H', true, 'matches', null, null, []]);
  });

  it('keeps every type beta until its promotion condition is met (ADR 0002 §3f)', () => {
    for (const type of REPORT_TYPES.filter((each) => each !== 'crypto-address-watchlist')) {
      expect(REPORT_REGISTRY[type].stage, type).toBe('beta');
    }
    expect(REPORT_REGISTRY['crypto-address-watchlist'].gaCondition).toMatch(/C79\.3/);
    expect(REPORT_REGISTRY.watchlist.gaCondition).toMatch(/calibration report/);
  });

  it('ships the crypto address watchlist ga: exact matching only, its C79.3 format vectors passing (C69.1, Stage 1a amendment 11)', () => {
    expect(REPORT_REGISTRY['crypto-address-watchlist'].stage).toBe('ga');
    expect(REPORT_REGISTRY['crypto-address-watchlist'].tiers).toEqual(['R']);
  });

  it('asks crypto addresses only of the crypto type, and DNS only of the email type', () => {
    expect(REPORT_TYPES.filter((type) => REPORT_REGISTRY[type].needsCryptoAddresses)).toEqual([
      'crypto-address-watchlist',
    ]);
    expect(REPORT_TYPES.filter((type) => REPORT_REGISTRY[type].usesDns)).toEqual(['email-address']);
  });

  it('names only the C83 provider kinds and ipReputation (C93.5), each used by a type', () => {
    const used = new Set(
      REPORT_TYPES.flatMap((type) => [
        ...REPORT_REGISTRY[type].optionalProviderKinds,
        ...(REPORT_REGISTRY[type].requiredProviderKind === null
          ? []
          : [REPORT_REGISTRY[type].requiredProviderKind]),
      ]),
    );
    expect([...used].sort()).toEqual([...REPORT_PROVIDER_KINDS].sort());
  });

  it('gives a type with review the match events, and the others ready, errored and redacted (C70.4)', () => {
    for (const type of REPORT_TYPES) {
      const entry = REPORT_REGISTRY[type];
      expect(entry.events, type).toEqual(entry.review === 'matches' ? MATCH_EVENTS : PLAIN_EVENTS);
    }
  });
});

describe('report event names (C70.4)', () => {
  it('spells report/<type>.<action>, with one slash and no digit, as the events table allows', () => {
    expect(reportEventName('watchlist', 'matched')).toBe('report/watchlist.matched');
    for (const name of REPORT_EVENT_NAMES) {
      // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex counts star height; eslint-plugin-regexp's ReDoS analysis finds no super-linear path
      expect(name).toMatch(/^[a-z][a-z_-]*(\/[a-z][a-z_-]*)?(\.[a-z][a-z_-]*)+$/);
    }
  });

  it('lists each type in order with its own actions, 54 names in all, never .submitted', () => {
    expect(REPORT_EVENT_NAMES).toEqual(
      REPORT_TYPES.flatMap((type) =>
        REPORT_REGISTRY[type].events.map((action) => `report/${type}.${action}`),
      ),
    );
    expect(REPORT_EVENT_NAMES).toHaveLength(7 * 6 + 4 * 3);
    expect(new Set(REPORT_EVENT_NAMES).size).toBe(REPORT_EVENT_NAMES.length);
    expect(REPORT_EVENT_NAMES.some((name) => name.endsWith('.submitted'))).toBe(false);
    expect(REPORT_EVENT_ACTIONS).not.toContain('submitted');
    expect(Object.isFrozen(REPORT_EVENT_NAMES)).toBe(true);
  });
});
