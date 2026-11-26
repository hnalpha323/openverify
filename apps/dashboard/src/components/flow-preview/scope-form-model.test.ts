import { describe, expect, it } from 'vitest';
import { PREVIEW_COPY } from '../../lib/copy/preview';
import {
  emptyScopeForm,
  formOfScope,
  scopeOfForm,
  type ScopeForm,
  type ScopeSubjects,
} from './scope-form-model';

const SUBJECTS: ScopeSubjects = {
  verifications: [
    { id: 'id_card', type: 'government_id' },
    { id: 'face', type: 'selfie' },
  ],
  workflows: [{ id: 'risk_run' }],
  signals: [
    { name: 'inquiry/bot_score', valueType: 'integer' },
    { name: 'inquiry/ip_country_mismatch', valueType: 'boolean' },
  ],
  lists: ['blocklist_main'],
};

const edit = (change: (form: ScopeForm) => void): ScopeForm => {
  const form = emptyScopeForm(SUBJECTS);
  change(form);
  return form;
};

describe('the simulated scope form (C156.4)', () => {
  it('sends nothing the operator left unset', () => {
    expect(scopeOfForm(emptyScopeForm(SUBJECTS))).toEqual({ ok: true, scope: {} });
  });

  it('builds each verification from its status, check overrides and extracted values', () => {
    const form = edit((draft) => {
      draft.verifications.id_card = {
        status: 'passed',
        checks: 'id_expired, failed\nid_barcode_detection, null\n\n',
        extractions: '{"age-years": 16}',
      };
      draft.verifications.face = { status: 'null', checks: '', extractions: '' };
    });

    expect(scopeOfForm(form)).toEqual({
      ok: true,
      scope: {
        verifications: {
          id_card: {
            status: 'passed',
            checks: { id_expired: 'failed', id_barcode_detection: null },
            extractions: { 'age-years': 16 },
          },
          face: { status: null },
        },
      },
    });
  });

  it('builds signals by their value type, null for unknown, and only the flow-provisional ones', () => {
    const form = edit((draft) => {
      draft.signals['inquiry/bot_score'] = { mode: 'set', value: '87' };
      draft.signals['inquiry/ip_country_mismatch'] = { mode: 'null', value: '' };
    });

    expect(scopeOfForm(form)).toEqual({
      ok: true,
      scope: { signals: { 'inquiry/bot_score': 87, 'inquiry/ip_country_mismatch': null } },
    });
  });

  it('builds lists, the device, workflows, tags and fields', () => {
    const form = edit((draft) => {
      draft.lists.blocklist_main = 'null';
      draft.device = { kind: 'mobile-web', platform: 'null' };
      draft.workflows.risk_run = {
        status: 'errored',
        errorType: 'timeout',
        outputs: '{"risk-level": "high"}',
      };
      draft.tags = ' vip ,  , retry ';
      draft.fields = '{"name_first": "Synthetic"}';
    });

    expect(scopeOfForm(form)).toEqual({
      ok: true,
      scope: {
        lists: { blocklist_main: { matched: null } },
        device: { kind: 'mobile-web', platform: null },
        workflows: {
          risk_run: {
            status: 'errored',
            'error-type': 'timeout',
            outputs: { 'risk-level': 'high' },
          },
        },
        inquiry: { tags: ['vip', 'retry'] },
        fields: { name_first: 'Synthetic' },
      },
    });
  });

  it('refuses malformed JSON, check lines and signal values, naming each', () => {
    const form = edit((draft) => {
      draft.verifications.id_card = { status: '', checks: 'id_expired maybe', extractions: '[1]' };
      draft.signals['inquiry/bot_score'] = { mode: 'set', value: 'high' };
      draft.signals['inquiry/ip_country_mismatch'] = { mode: 'set', value: 'yes' };
      draft.fields = '{';
    });

    const result = scopeOfForm(form);

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors.map(({ message }) => message)).toEqual([
      `id_card: ${PREVIEW_COPY.simulate.checkLineInvalid(1)}`,
      `id_card: ${PREVIEW_COPY.simulate.jsonInvalid(PREVIEW_COPY.simulate.extractions)}`,
      'inquiry/bot_score: a whole number is expected.',
      'inquiry/ip_country_mismatch: true or false is expected.',
      PREVIEW_COPY.simulate.jsonInvalid(PREVIEW_COPY.simulate.fields),
    ]);
  });

  it('loads a preset’s scope back into the form, and builds the same scope from it', () => {
    const scope = {
      verifications: {
        id_card: { status: 'failed' as const, checks: { id_expired: 'passed' as const } },
      },
      signals: { 'inquiry/bot_score': 12 },
      lists: { blocklist_main: { matched: true } },
      device: { kind: null },
      inquiry: { tags: ['vip'] },
    };

    expect(scopeOfForm(formOfScope(scope, SUBJECTS))).toEqual({ ok: true, scope });
  });
});
