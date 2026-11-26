import { verificationConfigSchema, API_VERIFICATION_TYPES } from '@openverify/contracts';
import { defaultTemplateConfig, getCheckDefinition, listChecks } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import { CHECK_READING_FLOW } from '../../testing/routes/template-forms';
import { jsonSchemaOf } from '../schema-form/model';
import {
  apiTypeOfStep,
  branchesReadingChecks,
  checkDecision,
  checkRowsOf,
  typeOptionsSchema,
  withCheck,
  type CheckRow,
} from './check-panel-model';

const GOVERNMENT_ID = defaultTemplateConfig('government_id');

describe('checkRowsOf (C153.1): every check of a type, from the registry', () => {
  it('lists each registry check of the type in its order, with tier, type, stage and default', () => {
    const rows = checkRowsOf('government-id', GOVERNMENT_ID);

    expect(rows.map((row) => row.id)).toEqual(listChecks('government_id').map((check) => check.id));
    for (const row of rows) {
      const check = getCheckDefinition(row.id);
      expect(row).toMatchObject({
        tier: check?.tier,
        alternateTier: check?.alternateTier ?? null,
        checkType: check?.checkType,
        stage: check?.stage,
        defaultRequirement: !check?.defaultEnabled
          ? 'disabled'
          : check.defaultRequired
            ? 'required'
            : 'advisory',
      });
    }
  });

  it('reads a check the config does not list as not run', () => {
    const rows = checkRowsOf('government-id', { checks: {} });

    expect(rows.every((row) => !row.enabled && !row.required)).toBe(true);
  });

  it('takes the enabled, required and config the config sets', () => {
    const rows = checkRowsOf('government-id', {
      checks: { id_expired_detection: { enabled: true, required: false } },
    });

    expect(rows.find((row) => row.id === 'id_expired_detection')).toMatchObject({
      enabled: true,
      required: false,
      config: undefined,
    });
  });
});

describe('branchesReadingChecks (review H07)', () => {
  it('names the branches and routes of the draft that read each check of the type', () => {
    const reads = branchesReadingChecks(CHECK_READING_FLOW, 'government-id');

    expect(reads.get('id_expired_detection')).toEqual([
      {
        stepId: 'expiry_route',
        stepName: 'Expired ID route',
        routeKey: 'expired',
        routeLabel: 'Expired ID',
      },
    ]);
    expect(reads.get('id_glare_detection')).toBeUndefined();
  });

  it('finds none for another type, nor in a flow-spec 1 flow', () => {
    expect(branchesReadingChecks(CHECK_READING_FLOW, 'selfie').size).toBe(0);
    expect(
      branchesReadingChecks(
        {
          metadata: { specVersion: 1, id: 'v1', version: 1, name: 'v1' },
          steps: [],
          transitions: [],
        },
        'government-id',
      ).size,
    ).toBe(0);
  });
});

describe('checkDecision (ADR 0002 section 3c)', () => {
  const row = (enabled: boolean, required: boolean): CheckRow => ({
    id: 'id_expired_detection',
    description: 'A synthetic check row.',
    tier: 'R',
    alternateTier: null,
    checkType: 'user_behavior',
    stage: 'ga',
    defaultRequirement: 'required',
    enabled,
    required,
    config: undefined,
    configSchema: undefined,
  });

  it('says whether a check decides, runs without deciding, is read by a branch, or does not run', () => {
    const read = [{ stepId: 'b', stepName: 'b', routeKey: 'r', routeLabel: 'r' }];

    expect(checkDecision(row(true, true), [])).toBe('decides');
    expect(checkDecision(row(true, false), [])).toBe('runs-not-deciding');
    expect(checkDecision(row(true, false), read)).toBe('read-by-branch');
    expect(checkDecision(row(false, false), read)).toBe('not-run');
    expect(checkDecision(row(false, true), [])).toBe('not-run');
  });
});

describe('typeOptionsSchema (C153.5): only the options the contract lets a type set', () => {
  it('offers each type exactly the options the contract takes from it', () => {
    for (const apiType of API_VERIFICATION_TYPES) {
      const options = Object.keys(jsonSchemaOf(typeOptionsSchema(apiType)).properties ?? {});
      for (const option of options) {
        const value = option === 'accept-review-without-provider' ? true : ['XX'];
        const issues =
          verificationConfigSchema
            .safeParse({ [apiType]: { checks: {}, [option]: value } })
            .error?.issues.filter(
              (issue) =>
                issue.path.length === 2 && issue.path[1] === option && issue.code === 'custom',
            ) ?? [];
        expect(issues, `${apiType} ${option}`).toEqual([]);
      }
    }
    expect(Object.keys(jsonSchemaOf(typeOptionsSchema('government-id')).properties ?? {})).toEqual([
      'allowed-countries',
      'allowed-id-classes',
    ]);
    expect(Object.keys(jsonSchemaOf(typeOptionsSchema('selfie')).properties ?? {})).toEqual([]);
  });
});

describe('withCheck', () => {
  it('changes one check and keeps the rest, the config left out when cleared', () => {
    const next = withCheck(
      { checks: { id_expired_detection: { enabled: true, required: true, config: { a: 1 } } } },
      'id_expired_detection',
      { required: false, config: undefined },
    );

    expect(next).toEqual({ checks: { id_expired_detection: { enabled: true, required: false } } });
  });

  it('adds a check the config did not list', () => {
    expect(withCheck({ checks: {} }, 'id_glare_detection', { enabled: true })).toEqual({
      checks: { id_glare_detection: { enabled: true, required: false } },
    });
  });
});

describe('apiTypeOfStep', () => {
  it('maps a verification step to its API type, and anything else to null', () => {
    expect(apiTypeOfStep('government_id')).toBe('government-id');
    expect(apiTypeOfStep('phone_otp')).toBe('phone-number');
    expect(apiTypeOfStep('branch')).toBeNull();
    expect(apiTypeOfStep('screen')).toBeNull();
  });
});
