import { describe, expect, it } from 'vitest';
import { paletteOf, type CatalogueAction } from './palette-model';

const action = (key: string, more: Partial<CatalogueAction> = {}): CatalogueAction => ({
  key,
  version: 1,
  kind: 'internal',
  stage: 'ga',
  delivery: 'exactly-once',
  adverse: 'never',
  triggers: null,
  available: true,
  reason: null,
  ...more,
});

describe('the palette (C141.4, C122.4)', () => {
  it('offers the step types first, then every catalogue action in the order the API served them', () => {
    const entries = paletteOf(
      [
        action('send_slack_message', { kind: 'egress', delivery: 'at-most-once' }),
        action('calculate'),
      ],
      'trigger-api',
    );
    expect(entries.map((entry) => [entry.group, entry.label])).toEqual([
      ['steps', 'Wait for a time'],
      ['steps', 'Wait for an event'],
      ['steps', 'Conditional'],
      ['steps', 'Parallel'],
      ['steps', 'Loop over a list'],
      ['steps', 'Loop while a condition holds'],
      ['steps', 'Map a list'],
      ['steps', 'Module (another workflow)'],
      ['actions', 'Send slack message'],
      ['actions', 'Calculate'],
    ]);
    expect(entries[8]?.template).toEqual({ kind: 'action', key: 'send_slack_message', version: 1 });
    expect(entries[2]?.template).toEqual({ kind: 'conditional' });
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
  });

  it('says what each action is, how it delivers and whether it is adverse, in words', () => {
    const [, , , , , , , , slack, decline, update] = paletteOf(
      [
        action('send_slack_message', { kind: 'egress', delivery: 'at-most-once' }),
        action('decline_inquiry', { adverse: 'always' }),
        action('update_transaction_status', { adverse: 'by-config', delivery: 'exactly-once' }),
      ],
      null,
    );
    expect(slack?.detail).toBe(
      'send_slack_message, version 1. Sends data out of OpenVerify. At most once.',
    );
    expect(decline?.detail).toBe(
      'decline_inquiry, version 1. Changes an OpenVerify object. Exactly once. Adverse: recorded and gated as a decision.',
    );
    expect(update?.detail).toContain('Adverse when its settings make it so.');
  });

  it('lists an action the environment cannot run as not configured, with its reason, never hides it', () => {
    const entries = paletteOf(
      [
        action('send_email', { available: false, reason: 'provider_not_configured' }),
        action('evaluate_code', { kind: 'compute', available: false, reason: 'code_disabled' }),
      ],
      'trigger-api',
    );
    expect(
      entries.slice(8).map((entry) => [entry.label, entry.notConfigured, entry.refusal]),
    ).toEqual([
      ['Send email', 'Not configured: no provider is bound for it in this environment.', null],
      ['Evaluate code', 'Not configured: Evaluate Code is turned off for this install.', null],
    ]);
  });

  it('refuses an action that does not serve the trigger, and refuses none before a trigger is set', () => {
    const rows = [action('add_face_list_item', { triggers: ['trigger-event'] })];
    expect(paletteOf(rows, 'trigger-api')[8]?.refusal).toBe(
      'Does not serve the trigger The API, so it cannot be added here.',
    );
    expect(paletteOf(rows, 'trigger-event')[8]?.refusal).toBeNull();
    expect(paletteOf(rows, null)[8]?.refusal).toBeNull();
  });

  it('refuses, under a flow trigger, every action that does not list it (C152.2, Stage 1a amendment 3)', () => {
    const rows = [action('tag_object', { triggers: null })];
    expect(paletteOf(rows, 'trigger-flow')[8]?.refusal).toMatch(/^Does not serve the trigger /);
    expect(paletteOf(rows, 'trigger-api')[8]?.refusal).toBeNull();
  });

  it('marks beta actions, and names the version when an action has more than one', () => {
    const entries = paletteOf(
      [
        action('run_report', { stage: 'beta' }),
        action('run_report', { version: 2, stage: 'beta' }),
      ],
      null,
    );
    expect(entries.slice(8).map((entry) => [entry.label, entry.beta])).toEqual([
      ['Run report (version 1)', true],
      ['Run report (version 2)', true],
    ]);
    expect(entries[0]?.beta).toBe(false);
  });
});

describe('the module entries follow the trigger the draft has now (KP10-15)', () => {
  const modules = [{ id: 'wfl_01JM0000000000000000000001', name: 'Synthetic address module' }];
  const moduleEntry = (triggerType: string | null) =>
    paletteOf([], triggerType, modules).find((entry) => entry.template.kind === 'module');

  it.each([
    ['trigger-account', 'An account action'],
    ['trigger-case', 'A case action'],
  ])(
    'refuses a module while the trigger is %s, which runs none (module_refused_for_trigger)',
    (type, words) => {
      expect(moduleEntry(type)?.refusal).toBe(
        `${words} runs no module (another workflow), so it cannot be added here.`,
      );
    },
  );

  it.each(['trigger-api', 'trigger-event', null])(
    'offers the module while the trigger is %s',
    (type) => {
      expect(moduleEntry(type)?.refusal).toBeNull();
    },
  );
});
