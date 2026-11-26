/**
 * C208.1 (Workflow 10C, `contracts-10c`): the sandbox test chip's scenarios are one list: the
 * contract's (`SANDBOX_CHIP_SCENARIOS`), which the route takes, and the database's
 * (`CHIP_SANDBOX_SCENARIO_VALUES`), which `chip_challenges.sandbox_scenario` holds.
 */
import { SANDBOX_CHIP_SCENARIOS } from '@openverify/contracts';
import { CHIP_SANDBOX_SCENARIO_VALUES } from '@openverify/db';
import { describe, expect, it } from 'vitest';

describe('the sandbox chip scenarios (C208.1)', () => {
  it('are the same list in the contract and in the database', () => {
    expect([...CHIP_SANDBOX_SCENARIO_VALUES]).toEqual([...SANDBOX_CHIP_SCENARIOS]);
  });
});
