import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projection, type ProjectionPosition } from './projection.js';
import { flowV2Schema } from './schemas/flow.js';
import { flowProjectionSchema } from './schemas/projection.js';
import {
  branch,
  completion,
  consent,
  document,
  failure,
  flowOf,
  governmentId,
  handoff,
  route,
  screen,
  selfie,
  submit,
  textInput,
  v,
} from './test-flows.js';

const FIXTURES = new URL('../../../../contracts/fixtures/', import.meta.url);
const readText = (path: string): string => readFileSync(new URL(path, FIXTURES), 'utf8');

interface ProjectionCase {
  readonly projection: string;
  readonly flow: string;
  readonly position: ProjectionPosition;
}

const manifest = JSON.parse(readText('flows/v2/projection-cases.json')) as {
  readonly cases: readonly ProjectionCase[];
};

const at = (current: string, extra: Partial<ProjectionPosition> = {}): ProjectionPosition => ({
  current,
  exited: [],
  verificationStatuses: {},
  consentRecorded: false,
  customConsentCopy: false,
  ...extra,
});

describe('projection: contracts-9a’s golden projections (C151.6, V03)', () => {
  it('reads all sixteen cases of the manifest', () => {
    expect(manifest.cases).toHaveLength(16);
  });

  it.each(manifest.cases.map((entry) => [entry.projection, entry] as const))(
    '%s, byte for byte in its compact form',
    (_name, entry) => {
      const flow = flowV2Schema.parse(JSON.parse(readText(entry.flow)));
      const golden = JSON.parse(readText(entry.projection)) as unknown;
      const projected = projection(flow, entry.position);
      // Member order included: the session builder serves the fixture's bytes (api-flow-engine).
      expect(JSON.stringify(projected)).toBe(JSON.stringify(golden));
      expect(flowProjectionSchema.parse(projected)).toEqual(projected);
    },
  );
});

describe('projection: the rules beyond the goldens', () => {
  const linear = flowOf(
    [consent(), handoff(), governmentId(), selfie(), completion(), failure()],
    [
      ['consent', 'next', 'handoff'],
      ['handoff', 'next', 'id_card'],
      ['id_card', 'next', 'face'],
      ['face', 'next', 'done'],
    ],
  );

  it('lists an exited verification only when today’s SDK passes it as done', () => {
    for (const status of ['passed', 'skipped', 'needs_review']) {
      const projected = projection(
        linear,
        at('face', {
          exited: [
            { stepId: 'consent', port: 'next' },
            { stepId: 'id_card', port: 'next' },
          ],
          verificationStatuses: { id_card: status },
          consentRecorded: true,
        }),
      );
      expect(projected.steps.map(({ id }) => id)).toEqual(['consent', 'id_card', 'face', 'done']);
    }
    for (const statuses of [{ id_card: 'failed' }, { id_card: 'requires_retry' }, {}]) {
      const projected = projection(
        linear,
        at('face', {
          exited: [{ stepId: 'id_card', port: 'next' }],
          verificationStatuses: statuses,
        }),
      );
      expect(projected.steps.map(({ id }) => id)).toEqual(['face', 'done']);
    }
  });

  it('leaves out a consent not recorded and an exited handoff (the position cannot prove it done)', () => {
    const projected = projection(
      linear,
      at('id_card', {
        exited: [
          { stepId: 'consent', port: 'next' },
          { stepId: 'handoff', port: 'next' },
        ],
      }),
    );
    expect(projected.steps.map(({ id }) => id)).toEqual(['id_card', 'face', 'done']);
  });

  it('serves a handoff as the current step and in the run', () => {
    expect(projection(linear, at('consent')).steps.map(({ id }) => id)).toEqual([
      'consent',
      'handoff',
      'id_card',
      'face',
      'done',
    ]);
  });

  it('serves the failure step without its v2 members, and ends there', () => {
    const flow = flowOf(
      [
        consent(),
        failure('rejected', {
          decisionBasis: 'contract',
          contestRoute: { contact: 'support@example.com' },
        }),
      ],
      [['consent', 'next', 'rejected']],
    );
    const projected = projection(flow, at('rejected', { consentRecorded: true }));
    expect(projected.steps).toEqual([{ id: 'rejected', type: 'failure' }]);
  });

  it('serves a current branch or a waiting branch as a placeholder', () => {
    const flow = flowOf(
      [
        consent(),
        branch(
          'wait_here',
          [route('fast', { '===': [v('signals.inquiry/bot_score'), 1] }, 'else')],
          {
            waitFor: { facts: ['signals.inquiry/bot_score'], maxSeconds: 5 },
          },
        ),
        completion(),
      ],
      [
        ['consent', 'next', 'wait_here'],
        ['wait_here', 'route:fast', 'done'],
        ['wait_here', 'else', 'done'],
      ],
    );
    const projected = projection(
      flow,
      at('wait_here', { exited: [{ stepId: 'consent', port: 'next' }], consentRecorded: true }),
    );
    expect(projected.steps).toEqual([
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      { id: 'continue-1', type: 'server-continuation' },
    ]);
  });

  // Workflow 11A (api-consent's borrowed edit; C238.3, C151.6): `share_consent` is v2-only, so the
  // projection serves it as the placeholder, and a session on it parses (today's SDK stops there).
  it('serves a current share_consent step as a placeholder, it has no v1 form', () => {
    const flow = flowOf(
      [
        consent(),
        {
          id: 'share',
          type: 'share_consent',
          side: 'source',
          connectionId: 'cxn_01M5CN0000000000000011A100',
          withdrawalContact: 'Write to privacy@example.com',
        },
        completion(),
      ],
      [
        ['consent', 'next', 'share'],
        ['share', 'next', 'done'],
      ],
    );
    const projected = projection(
      flow,
      at('share', { exited: [{ stepId: 'consent', port: 'next' }], consentRecorded: true }),
    );
    expect(projected.steps).toEqual([
      { id: 'consent', type: 'consent', textKeys: ['consent.biometric'], required: true },
      { id: 'continue-1', type: 'server-continuation' },
    ]);
    expect(flowProjectionSchema.safeParse(projected).success).toBe(true);
  });

  it('ends the run with a placeholder where a step would repeat (a v1 cycle kept by the migration)', () => {
    const cyclic = flowOf(
      [consent(), governmentId(), completion()],
      [
        ['consent', 'next', 'id_card'],
        ['id_card', 'next', 'consent'],
      ],
    );
    expect(projection(cyclic, at('consent')).steps.map(({ id }) => id)).toEqual([
      'consent',
      'id_card',
      'continue-1',
    ]);
  });

  it('ends with a placeholder where a non-terminal step has no next edge', () => {
    const open = flowOf(
      [consent(), governmentId(), completion()],
      [['consent', 'next', 'id_card']],
    );
    expect(projection(open, at('consent')).steps.map(({ id }) => id)).toEqual([
      'consent',
      'id_card',
      'continue-1',
    ]);
  });

  it('never serves a step whose id is the placeholder’s, and never twice one id', () => {
    const clash = flowOf(
      [consent('continue-1'), document(), completion()],
      [
        ['continue-1', 'next', 'proof'],
        ['proof', 'next', 'done'],
      ],
    );
    expect(projection(clash, at('continue-1')).steps).toEqual([
      { id: 'continue-1', type: 'server-continuation' },
    ]);
    const exited = projection(
      clash,
      at('proof', { exited: [{ stepId: 'continue-1', port: 'next' }], consentRecorded: true }),
    );
    expect(exited.steps.map(({ id }) => id)).toEqual(['proof', 'done']);
    const twice = projection(
      linear,
      at('face', {
        exited: [
          { stepId: 'id_card', port: 'next' },
          { stepId: 'id_card', port: 'next' },
        ],
        verificationStatuses: { id_card: 'passed' },
      }),
    );
    expect(twice.steps.map(({ id }) => id)).toEqual(['id_card', 'face', 'done']);
  });

  it('serves a position on an unknown step as a placeholder, failing safe', () => {
    expect(projection(linear, at('gone')).steps).toEqual([
      { id: 'continue-1', type: 'server-continuation' },
    ]);
  });

  it('never sends a condition, a name or a screen', () => {
    const flow = flowOf(
      [
        consent(),
        screen('details', [textInput('nick', 'nickname'), submit()], { name: 'Sanctions extra' }),
        completion(),
      ],
      [
        ['consent', 'next', 'details'],
        ['details', 'next', 'done'],
      ],
    );
    const text = JSON.stringify(projection(flow, at('details', { consentRecorded: true })));
    expect(text).not.toContain('Sanctions');
    expect(text).not.toContain('nickname');
    expect(text).toContain('"transitions":[]');
  });
});
