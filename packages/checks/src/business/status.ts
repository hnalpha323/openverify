/**
 * The registry status mapping of C61.2 (H12): what a register's own status value says about
 * whether the business is active.
 *
 * | Source value | Answer |
 * |---|---|
 * | GLEIF `ISSUED` with `entity.status` `ACTIVE` | active |
 * | GLEIF `LAPSED`, `PENDING_ARCHIVAL` | not available (flag `lei-lapsed`), or inactive with `fail-on-lapsed-lei` |
 * | GLEIF `RETIRED`, `MERGED`, `entity.status` `INACTIVE` (an entity expiration included) | inactive |
 * | GLEIF `ANNULLED`, `DUPLICATE` | no record |
 * | Companies House `active`, `open`, `registered` (flag `active-proposal-to-strike-off`) | active |
 * | Companies House `dissolved`, `liquidation`, `receivership`, `administration`, `insolvency-proceedings`, `voluntary-arrangement`, `converted-closed`, `closed`, `removed` | inactive |
 * | SEC EDGAR | not available |
 * | the sandbox register: Companies House's values, or `inactive` | as Companies House |
 *
 * Any other value, or none, is not available (review): an unmapped status is never read as
 * active or inactive.
 */
import type { BusinessRegistryRecord } from './inputs.js';

export type BusinessStatusAnswer = 'active' | 'inactive' | 'not_available' | 'no_record';

export interface BusinessStatusReading {
  readonly answer: BusinessStatusAnswer;
  /** Kebab-case flags: `lei-lapsed`, `active-proposal-to-strike-off`, `status-unmapped`. */
  readonly flags: readonly string[];
}

const GLEIF_LAPSED: ReadonlySet<string> = new Set(['LAPSED', 'PENDING_ARCHIVAL']);
const GLEIF_ENDED: ReadonlySet<string> = new Set(['RETIRED', 'MERGED']);
const GLEIF_VOID: ReadonlySet<string> = new Set(['ANNULLED', 'DUPLICATE']);
const COMPANY_ACTIVE: ReadonlySet<string> = new Set(['active', 'open', 'registered']);
const COMPANY_INACTIVE: ReadonlySet<string> = new Set([
  'dissolved',
  'liquidation',
  'receivership',
  'administration',
  'insolvency-proceedings',
  'voluntary-arrangement',
  'converted-closed',
  'closed',
  'removed',
]);
const STRIKE_OFF = 'active-proposal-to-strike-off';

const reading = (
  answer: BusinessStatusAnswer,
  flags: readonly string[] = [],
): BusinessStatusReading => ({
  answer,
  flags,
});
const UNMAPPED = reading('not_available', ['status-unmapped']);

function gleifStatus(
  record: BusinessRegistryRecord,
  failOnLapsedLei: boolean,
): BusinessStatusReading {
  const registration = record.status?.trim().toUpperCase() ?? '';
  const entity = record.statusDetail?.trim().toUpperCase() ?? '';
  if (GLEIF_VOID.has(registration)) {
    return reading('no_record');
  }
  if (entity === 'INACTIVE' || GLEIF_ENDED.has(registration)) {
    return reading('inactive');
  }
  if (GLEIF_LAPSED.has(registration)) {
    return reading(failOnLapsedLei ? 'inactive' : 'not_available', ['lei-lapsed']);
  }
  return registration === 'ISSUED' && entity === 'ACTIVE' ? reading('active') : UNMAPPED;
}

function companyStatus(record: BusinessRegistryRecord, sandbox: boolean): BusinessStatusReading {
  const status = record.status?.trim().toLowerCase() ?? '';
  if (COMPANY_ACTIVE.has(status)) {
    const detail = record.statusDetail?.trim().toLowerCase();
    return reading('active', detail === STRIKE_OFF ? [STRIKE_OFF] : []);
  }
  if (COMPANY_INACTIVE.has(status) || (sandbox && status === 'inactive')) {
    return reading('inactive');
  }
  return UNMAPPED;
}

/** Reads a record's status by the C61.2 table. */
export function businessRegistryStatus(
  record: BusinessRegistryRecord,
  options: { readonly failOnLapsedLei: boolean },
): BusinessStatusReading {
  switch (record.source) {
    case 'gleif':
      return gleifStatus(record, options.failOnLapsedLei);
    case 'companies-house':
      return companyStatus(record, false);
    case 'sandbox':
      return companyStatus(record, true);
    case 'sec-edgar':
      // EDGAR keeps no legal status (docs/research/phase5-libraries.md §5.3).
      return reading('not_available');
  }
}
