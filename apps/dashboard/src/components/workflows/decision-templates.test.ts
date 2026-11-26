/**
 * The editor's decision templates (C128.5, decision 51): review first. Each marks the inquiry for
 * review and opens a case holding it before anything decides, and a decline is only ever the next
 * step of the case's resolution, carrying its decision basis and contest route when the operator
 * gave them. A template makes a definition, never a publish.
 */
import { workflowDefinitionSchema, type WorkflowDefinition } from '@openverify/contracts';
import { describe, expect, it } from 'vitest';
import {
  CASE_TEMPLATE_PLACEHOLDER,
  DECISION_TEMPLATES,
  DECISION_TEMPLATE_KEYS,
  decisionTemplateDefinition,
} from './decision-templates';

type Step = WorkflowDefinition['steps'][number];

const CASE_TEMPLATE = 'ctmpl_01MB0000000000000000000001';

const stepsOf = (definition: WorkflowDefinition, actionKey: string): Step[] =>
  definition.steps.filter(
    (step) =>
      step.type === 'action' && (step as { 'action-key': string })['action-key'] === actionKey,
  );

/** The node ids reachable from `from`, never passing through `blocked`. */
function reachable(definition: WorkflowDefinition, from: string, blocked: string): Set<string> {
  const seen = new Set<string>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const node = queue.shift() ?? '';
    for (const edge of definition.edges.filter((candidate) => candidate.from === node)) {
      if (edge.to !== blocked && !seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return seen;
}

describe('the decision templates (C128.5)', () => {
  it('names each template in words, one per key', () => {
    expect(DECISION_TEMPLATES.map((template) => template.key)).toEqual([...DECISION_TEMPLATE_KEYS]);
    for (const template of DECISION_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description).toMatch(/review/i);
    }
  });

  it.each(DECISION_TEMPLATE_KEYS)('%s is a valid definition by the contract', (key) => {
    expect(workflowDefinitionSchema.safeParse(decisionTemplateDefinition(key)).success).toBe(true);
    expect(
      workflowDefinitionSchema.safeParse(
        decisionTemplateDefinition(key, {
          caseTemplateId: CASE_TEMPLATE,
          decisionBasis: 'contract',
          contestRoute: { url: 'https://help.example.com/contest' },
          biometricBasis: 'explicit-consent',
        }),
      ).success,
    ).toBe(true);
  });

  it.each(DECISION_TEMPLATE_KEYS)(
    '%s marks the inquiry for review, then opens a case holding it, before anything else',
    (key) => {
      const definition = decisionTemplateDefinition(key, { caseTemplateId: CASE_TEMPLATE });
      const first = definition.edges.filter((edge) => edge.from === 'trigger');
      expect(first).toHaveLength(1);
      const [review] = stepsOf(definition, 'mark_inquiry_for_review');
      expect(first[0]?.to).toBe(review?.id);
      const [open] = stepsOf(definition, 'create_case');
      expect(definition.edges.find((edge) => edge.from === review?.id)?.to).toBe(open?.id);
      const config = (open as { config: Record<string, unknown> }).config;
      expect(config['case-template-id']).toBe(CASE_TEMPLATE);
      expect(config['object-ids']).toContain(
        (review as { config: Record<string, unknown> }).config['inquiry-id'],
      );
    },
  );

  it.each(DECISION_TEMPLATE_KEYS)(
    '%s declines only after a person resolved the case: no path reaches a decline without the wait',
    (key) => {
      const definition = decisionTemplateDefinition(key);
      const wait = definition.steps.find((step) => step.type === 'wait') as
        { id: string; events: string[] } | undefined;
      expect(wait?.events).toEqual(['case.resolved']);
      const declines = stepsOf(definition, 'decline_inquiry');
      expect(declines.length).toBeGreaterThan(0);
      const withoutWait = reachable(definition, 'trigger', wait?.id ?? '');
      for (const decline of declines) {
        expect(withoutWait.has(decline.id)).toBe(false);
      }
    },
  );

  it.each(DECISION_TEMPLATE_KEYS)(
    '%s routes on the resolution with on-null on every route, and leaves an undecided case in review',
    (key) => {
      const definition = decisionTemplateDefinition(key);
      const decide = definition.steps.find((step) => step.type === 'conditional') as
        { id: string; routes: { 'on-null'?: string }[] } | undefined;
      expect(decide?.routes.length).toBeGreaterThan(0);
      for (const route of decide?.routes ?? []) {
        expect(route['on-null']).toBe('skip-route');
      }
      expect(
        definition.edges.find((edge) => edge.from === decide?.id && edge['from-port'] === 'else')
          ?.to,
      ).toBe('output');
    },
  );

  it('puts the decision basis, contest route and biometric basis the operator gave on every decline', () => {
    for (const key of DECISION_TEMPLATE_KEYS) {
      const definition = decisionTemplateDefinition(key, {
        decisionBasis: 'law',
        contestRoute: { contact: 'appeals@example.com' },
        biometricBasis: 'substantial-public-interest',
      });
      for (const decline of stepsOf(definition, 'decline_inquiry')) {
        expect((decline as { config: Record<string, unknown> }).config).toMatchObject({
          'decision-basis': 'law',
          'contest-route': { contact: 'appeals@example.com' },
          'biometric-basis': 'substantial-public-interest',
        });
      }
    }
  });

  it('leaves the basis and route unset, and the case template a placeholder, when none was given', () => {
    const definition = decisionTemplateDefinition('review-completed-inquiry');
    const [decline] = stepsOf(definition, 'decline_inquiry');
    const config = (decline as { config: Record<string, unknown> }).config;
    expect(config).not.toHaveProperty('decision-basis');
    expect(config).not.toHaveProperty('contest-route');
    const [open] = stepsOf(definition, 'create_case');
    expect((open as { config: Record<string, unknown> }).config['case-template-id']).toBe(
      CASE_TEMPLATE_PLACEHOLDER,
    );
  });

  it('never approves a failed inquiry: that template only declines or leaves it in review', () => {
    expect(stepsOf(decisionTemplateDefinition('review-failed-inquiry'), 'approve_inquiry')).toEqual(
      [],
    );
    expect(
      stepsOf(decisionTemplateDefinition('review-completed-inquiry'), 'approve_inquiry'),
    ).toHaveLength(1);
  });

  it('listens to the events its name says', () => {
    const eventsOf = (key: (typeof DECISION_TEMPLATE_KEYS)[number]) =>
      (decisionTemplateDefinition(key).trigger?.config as { events: string[] }).events;
    expect(eventsOf('review-completed-inquiry')).toEqual(['inquiry.completed']);
    expect(eventsOf('review-failed-inquiry')).toEqual(['inquiry.failed']);
    expect(
      eventsOf('review-report-match').every((name) => /^report\/.+\.(matched|errored)$/.test(name)),
    ).toBe(true);
  });
});
