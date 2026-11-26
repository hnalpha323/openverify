import { checkFlowGraph, flowV2Schema, type FlowV2 } from '@openverify/flow-spec';
import { describe, expect, it } from 'vitest';
import { edgeOnPort, stepOf, stepTemplate } from './flow-model';
import { FLOW_MODULE_KEYS, insertModule, moduleOffers, type IdSource } from './flow-modules';
import { builderFlow } from './test-flows';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** Deterministic opaque ids for the tests: `s_t` or `e_t` and 7 base32 digits of a counter. */
function counter(): IdSource {
  let count = 0;
  return (prefix) => {
    count += 1;
    let digits = '';
    for (let rest = count, index = 0; index < 7; index += 1, rest = Math.floor(rest / 32)) {
      digits = (BASE32[rest % 32] ?? 'a') + digits;
    }
    return `${prefix}_t${digits}`;
  };
}

/** A flow whose entry is a screen before the consent, so nothing there may upload data. */
function screenFirst(): FlowV2 {
  return flowV2Schema.parse({
    metadata: { specVersion: 2, id: 'synthetic', version: 1, name: 'Synthetic' },
    entry: 's_screen00',
    steps: [
      { ...stepTemplate('screen', 's_screen00'), name: 'Welcome' },
      stepTemplate('consent', 's_consent0'),
      stepTemplate('completion', 's_done0000'),
    ],
    edges: [
      { id: 'e_1', from: 's_screen00', port: 'next', to: 's_consent0' },
      { id: 'e_2', from: 's_consent0', port: 'next', to: 's_done0000' },
    ],
  });
}

const errorsInside = (flow: FlowV2, ids: readonly string[]) =>
  checkFlowGraph(flow, { mode: 'save' }).filter((problem) => {
    const match = /^\/steps\/(\d+)/.exec(problem.pointer);
    const step = match === null ? undefined : flow.steps[Number(match[1])];
    return problem.severity === 'error' && step !== undefined && ids.includes(step.id);
  });

const AFTER_CONSENT = { from: 's_consent0', port: 'next' } as const;

describe('the flow builder’s modules (C155.4): editor macros of plain steps', () => {
  it('offers every module, each saying what it inserts before it is inserted (C155.11)', () => {
    const offers = moduleOffers(builderFlow(), AFTER_CONSENT, { explanation: true });

    expect(offers.map((offer) => offer.key)).toEqual([...FLOW_MODULE_KEYS]);
    for (const offer of offers) {
      expect(offer.label).not.toBe('');
      expect(offer.inserts).toMatch(/^Inserts /);
    }
    expect(offers.find((offer) => offer.key === 'selfie')?.inserts).toMatch(
      /explanation screen, a Selfie step and, when its attempts run out, a fallback screen/,
    );
  });

  it('inserts a verification module as its step, an explanation screen and an exhausted fallback, wired through the port rules', () => {
    const before = builderFlow();
    const result = insertModule(before, AFTER_CONSENT, 'selfie', { explanation: true }, counter());

    expect(result).not.toBeNull();
    const flow = result?.flow ?? before;
    const inserted = result?.inserted ?? [];
    expect(inserted).toHaveLength(3);
    const [explain, selfie, fallback] = inserted.map((id) => stepOf(flow, id));
    expect([explain?.type, selfie?.type, fallback?.type]).toEqual(['screen', 'selfie', 'screen']);
    expect(result?.select).toBe(selfie?.id);
    expect(flow.steps).toHaveLength(before.steps.length + 3);
    expect(edgeOnPort(flow, 's_consent0', 'next')?.to).toBe(explain?.id);
    expect(edgeOnPort(flow, explain?.id ?? '', 'next')?.to).toBe(selfie?.id);
    expect(edgeOnPort(flow, selfie?.id ?? '', 'next')?.to).toBe('s_screen00');
    expect(edgeOnPort(flow, selfie?.id ?? '', 'exhausted')?.to).toBe(fallback?.id);
    expect(edgeOnPort(flow, fallback?.id ?? '', 'next')?.to).toBe('s_screen00');
    expect(flow.edges).toHaveLength(before.edges.length + 4);
    expect(errorsInside(flow, inserted)).toEqual([]);
  });

  it('leaves the explanation screen out when it is not asked for', () => {
    const result = insertModule(
      builderFlow(),
      AFTER_CONSENT,
      'phone',
      { explanation: false },
      counter(),
    );

    const flow = result?.flow;
    const types = (result?.inserted ?? []).map((id) => (flow ? stepOf(flow, id)?.type : null));
    expect(types).toEqual(['phone_otp', 'screen']);
    expect(flow && edgeOnPort(flow, 's_consent0', 'next')?.to).toBe(result?.inserted[0]);
  });

  it('inserts the email module as an email code step', () => {
    const result = insertModule(
      builderFlow(),
      AFTER_CONSENT,
      'email',
      { explanation: false },
      counter(),
    );

    expect(result?.flow.steps.some((step) => step.type === 'email_otp')).toBe(true);
  });

  it('refuses a second verification of a type, with the reason, and inserts nothing', () => {
    const flow = builderFlow();
    const offer = moduleOffers(flow, AFTER_CONSENT, { explanation: false }).find(
      (candidate) => candidate.key === 'government_id',
    );

    expect(offer?.refusal).toMatch(/at most one step of each verification type/);
    expect(
      insertModule(flow, AFTER_CONSENT, 'government_id', { explanation: false }, counter()),
    ).toBeNull();
  });

  it('refuses where the format’s graph rules would refuse it: an upload before any consent', () => {
    const flow = screenFirst();
    const place = { from: 's_screen00', port: 'next' } as const;
    const offer = moduleOffers(flow, place, { explanation: false }).find(
      (candidate) => candidate.key === 'selfie',
    );

    expect(offer?.refusal).toMatch(/^The format’s rules refuse it here: .*consent/i);
    expect(insertModule(flow, place, 'selfie', { explanation: false }, counter())).toBeNull();
    expect(
      moduleOffers(flow, place, { explanation: false }).find(
        (candidate) => candidate.key === 'success',
      )?.refusal,
    ).not.toBeNull();
  });

  it('ends the flow with a success or failed screen only where nothing follows yet', () => {
    const flow = builderFlow();
    const unset = { from: 's_doc00000', port: 'exhausted' } as const;
    const connected = moduleOffers(flow, AFTER_CONSENT, { explanation: false });

    expect(connected.find((offer) => offer.key === 'success')?.refusal).toMatch(
      /already leads to Screen: Your details/,
    );
    const success = insertModule(flow, unset, 'success', { explanation: false }, counter());
    const failed = insertModule(flow, unset, 'failed', { explanation: false }, counter());
    expect(success?.inserted.map((id) => stepOf(success.flow, id)?.type)).toEqual(['completion']);
    expect(failed?.inserted.map((id) => stepOf(failed.flow, id)?.type)).toEqual(['failure']);
    expect(success && edgeOnPort(success.flow, 's_doc00000', 'exhausted')?.to).toBe(
      success?.select,
    );
  });

  it('inserts country select with branching: a screen with a country_select and a branch on it', () => {
    const before = builderFlow();
    const result = insertModule(
      before,
      AFTER_CONSENT,
      'country_select',
      { explanation: false },
      counter(),
    );

    const flow = result?.flow ?? before;
    const [screen, branch] = (result?.inserted ?? []).map((id) => stepOf(flow, id));
    expect(screen?.type).toBe('screen');
    expect(
      screen?.type === 'screen'
        ? screen.components.map((component) => [
            component.kind,
            'field' in component ? component.field : null,
          ])
        : [],
    ).toEqual([
      ['country_select', 'address_country_code'],
      ['button', null],
    ]);
    expect(branch?.type).toBe('branch');
    const route = branch?.type === 'branch' ? branch.routes[0] : undefined;
    expect(route?.condition).toEqual({
      '===': [{ var: 'inquiry.fields.address_country_code' }, 'US'],
    });
    expect(route?.onNull).toBe('else');
    expect(edgeOnPort(flow, screen?.id ?? '', 'next')?.to).toBe(branch?.id);
    expect(edgeOnPort(flow, branch?.id ?? '', `route:${route?.key ?? ''}`)?.to).toBe('s_screen00');
    expect(edgeOnPort(flow, branch?.id ?? '', 'else')?.to).toBe('s_screen00');
    expect(errorsInside(flow, result?.inserted ?? [])).toEqual([]);
  });
});
