/**
 * Workflow 11A Stage 1b (C): the Connect tables' value lists (`packages/db/src/tables/connect.ts`,
 * which cannot import the contracts) equal the frozen contracts' lists, so a CHECK constraint never
 * refuses a value the API serves, nor admits one it does not.
 */
import {
  CONNECTION_STATUSES,
  CONNECT_SIDES,
  SHARE_REDEEM_MODES,
  SHARE_SOURCE_TYPES,
  SHARE_TOKEN_EXPIRY_REASONS,
  SHARE_TOKEN_FAILURE_REASONS,
  SHARE_TOKEN_STATUSES,
} from '@openverify/contracts';
import {
  CONNECTION_STATUS_VALUES,
  CONNECT_SIDE_VALUES,
  SHARE_REDEEM_MODE_VALUES,
  SHARE_SOURCE_TYPE_VALUES,
  SHARE_TOKEN_EXPIRY_REASON_VALUES,
  SHARE_TOKEN_FAILURE_REASON_VALUES,
  SHARE_TOKEN_STATUS_VALUES,
} from '@openverify/db';
import { describe, expect, it } from 'vitest';

describe('the Connect tables hold the contracts’ value lists (C230.5, C232.6)', () => {
  it.each([
    ['connection statuses', CONNECTION_STATUS_VALUES, CONNECTION_STATUSES],
    ['sides', CONNECT_SIDE_VALUES, CONNECT_SIDES],
    ['token statuses', SHARE_TOKEN_STATUS_VALUES, SHARE_TOKEN_STATUSES],
    ['failure reasons', SHARE_TOKEN_FAILURE_REASON_VALUES, SHARE_TOKEN_FAILURE_REASONS],
    ['expiry reasons', SHARE_TOKEN_EXPIRY_REASON_VALUES, SHARE_TOKEN_EXPIRY_REASONS],
    ['source types', SHARE_SOURCE_TYPE_VALUES, SHARE_SOURCE_TYPES],
    ['redeem modes', SHARE_REDEEM_MODE_VALUES, SHARE_REDEEM_MODES],
  ])('the %s', (_name, table, contract) => {
    expect([...table].sort()).toEqual([...contract].sort());
  });
});
