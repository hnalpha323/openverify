/**
 * `database_business_active_business_detection` (R+A, fraud, required; C61.2, H12): the record's
 * status by the C61.2 table: active passes, inactive fails `business_inactive`, a lapsed LEI goes
 * to review (`status_not_available`, flag `lei-lapsed`) unless `fail-on-lapsed-lei`, an annulled or
 * duplicate LEI is `no_registry_record`; EDGAR and any unmapped value are `status_not_available`.
 */
import type { CheckResult } from '@openverify/core';
import { booleanIn, phase5CheckConfig, phase5ResultOptions } from '../contact/phase5-config.js';
import { checkResult } from '../result.js';
import type { DatabaseBusinessContext } from './context.js';
import { businessRegistryStatus } from './status.js';

const ID = 'database_business_active_business_detection';

export function databaseBusinessActiveBusinessDetection(
  context: DatabaseBusinessContext,
): CheckResult {
  const config = phase5CheckConfig(context.template, ID);
  const options = phase5ResultOptions(config, ['fail-on-lapsed-lei']);
  if (context.input.values === null) {
    return checkResult(ID, 'not_applicable', ['input_missing'], {}, options);
  }
  const reading = context.registry;
  switch (reading.kind) {
    case 'not_configured':
      return checkResult(ID, 'not_applicable', ['provider_not_configured'], {}, options);
    case 'error':
      return checkResult(ID, 'not_applicable', ['execution_error'], {}, options);
    case 'unsupported_country':
    case 'not_found':
      return checkResult(
        ID,
        'not_applicable',
        ['no_registry_record'],
        {},
        { ...options, provider: reading.provider },
      );
    case 'found':
      break;
  }
  const { record } = reading;
  const status = businessRegistryStatus(record, {
    failOnLapsedLei: booleanIn(config, 'fail-on-lapsed-lei', false),
  });
  const metadata = { source: record.source, status: record.status, flags: [...status.flags] };
  const withProvider = { ...options, provider: reading.provider };
  switch (status.answer) {
    case 'active':
      return checkResult(ID, 'passed', [], metadata, withProvider);
    case 'inactive':
      return checkResult(ID, 'failed', ['business_inactive'], metadata, withProvider);
    case 'no_record':
      return checkResult(ID, 'not_applicable', ['no_registry_record'], metadata, withProvider);
    case 'not_available':
      return checkResult(ID, 'not_applicable', ['status_not_available'], metadata, withProvider);
  }
}
