/**
 * C171.2 (Workflow 9D, `a11y-audit`): the mocked suite's accessibility matrix
 * (`e2e/support/a11y-matrix.ts`). By default it is exactly C171.2's CI matrix, so CI's cost changes
 * only with the states it covers; with the switch it is exactly the full cross product, run once
 * by the audit (review F16).
 */
import { describe, expect, it } from 'vitest';
import {
  A11Y_STATES,
  CLIENT_STEP_TYPES,
  CROSS_PRODUCT_ENV,
  MATRIX_LOCALES,
  MATRIX_MODES,
  MATRIX_SCHEMES,
  MATRIX_WIDTHS,
  ciConfigurations,
  crossProductConfigurations,
  crossProductRequested,
  matrixRuns,
  runTitle,
  type MatrixConfiguration,
} from '../e2e/support/a11y-matrix';
import { PREVIEWABLE_TYPES, PREVIEW_PLACEHOLDER_TYPES } from './screens/step-registry';

const key = ({ locale, scheme, mode, width }: MatrixConfiguration) =>
  `${locale}/${scheme}/${mode}/${String(width)}`;

const SWITCHED = { [CROSS_PRODUCT_ENV]: '1' };

describe('the state catalog', () => {
  it('names the web flow’s client step types, as the step registry renders them', () => {
    expect([...CLIENT_STEP_TYPES].sort()).toEqual(
      [...PREVIEW_PLACEHOLDER_TYPES, ...PREVIEWABLE_TYPES].sort(),
    );
  });

  it('holds exactly one arrival per client step type, and unique ids', () => {
    const arrivals = A11Y_STATES.filter((state) => state.arrival).map((state) => state.stepType);
    expect([...arrivals].sort()).toEqual([...CLIENT_STEP_TYPES].sort());
    const ids = A11Y_STATES.map((state) => state.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('holds the error, retry and final states beside the arrivals (C171.1)', () => {
    const ids = A11Y_STATES.map((state) => state.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'government_id:retry',
        'screen:errors',
        'database:errors',
        'phone_otp:code-sent',
        'government_id:processing',
        'position:waiting',
        'position:halted',
        'completion:redirect',
        'failure:contest-route',
        'inquiry:expired',
        'session:expired',
      ]),
    );
    expect(A11Y_STATES.length).toBeGreaterThan(CLIENT_STEP_TYPES.length * 2);
  });
});

describe('the switch', () => {
  it('asks for the cross product only when the variable is exactly 1', () => {
    expect(crossProductRequested({})).toBe(false);
    expect(crossProductRequested({ [CROSS_PRODUCT_ENV]: '0' })).toBe(false);
    expect(crossProductRequested({ [CROSS_PRODUCT_ENV]: 'true' })).toBe(false);
    expect(crossProductRequested(SWITCHED)).toBe(true);
  });
});

describe('the full cross product', () => {
  it('is every locale, scheme, mode and width once: 84 configurations', () => {
    const configurations = crossProductConfigurations();
    expect(configurations).toHaveLength(84);
    expect(new Set(configurations.map(key)).size).toBe(84);
    const expected = MATRIX_LOCALES.flatMap((locale) =>
      MATRIX_SCHEMES.flatMap((scheme) =>
        MATRIX_MODES.flatMap((mode) =>
          MATRIX_WIDTHS.map((width) => key({ locale, scheme, mode, width })),
        ),
      ),
    );
    expect(configurations.map(key).sort()).toEqual(expected.sort());
  });

  it('runs every state in all 84 when switched on', () => {
    const runs = matrixRuns(SWITCHED);
    expect(runs).toHaveLength(A11Y_STATES.length * 84);
    for (const state of A11Y_STATES) {
      const mine = runs
        .filter((run) => run.state.id === state.id)
        .map((run) => key(run.configuration));
      expect(mine.sort()).toEqual(crossProductConfigurations().map(key).sort());
    }
    expect(new Set(runs.map(runTitle)).size).toBe(runs.length);
  });
});

describe('C171.2’s CI matrix (the default)', () => {
  const EVERY_STATE = [
    'en/light/hosted/320',
    'ar/dark/hosted/320',
    'en-XA/light/hosted/320',
    'ar-XB/dark/hosted/320',
  ];
  const PER_STEP_TYPE = ['en/light/hosted/768', 'en/light/embedded/375'];

  it('runs every state in en and ar at 320 px and in both pseudo-locales at 320 px, hosted', () => {
    for (const state of A11Y_STATES.filter((candidate) => !candidate.arrival)) {
      expect(ciConfigurations(state).map(key).sort()).toEqual([...EVERY_STATE].sort());
    }
  });

  it('adds one run at 768 px and one embedded run per client step type, on its arrival', () => {
    for (const state of A11Y_STATES.filter((candidate) => candidate.arrival)) {
      expect(ciConfigurations(state).map(key).sort()).toEqual(
        [...EVERY_STATE, ...PER_STEP_TYPE].sort(),
      );
    }
    const embedded = matrixRuns({})
      .filter((run) => run.configuration.mode === 'embedded')
      .map((run) => run.state.stepType);
    expect([...embedded].sort()).toEqual([...CLIENT_STEP_TYPES].sort());
  });

  it('is what runs without the switch, each run titled once', () => {
    const runs = matrixRuns({});
    expect(runs).toHaveLength(
      A11Y_STATES.length * EVERY_STATE.length + CLIENT_STEP_TYPES.length * PER_STEP_TYPE.length,
    );
    expect(runs.map((run) => `${run.state.id} ${key(run.configuration)}`).sort()).toEqual(
      A11Y_STATES.flatMap((state) =>
        ciConfigurations(state).map((configuration) => `${state.id} ${key(configuration)}`),
      ).sort(),
    );
    expect(new Set(runs.map(runTitle)).size).toBe(runs.length);
  });
});
