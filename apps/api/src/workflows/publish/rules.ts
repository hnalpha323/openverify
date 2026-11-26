/**
 * C116.4: the publish rules that need more than a definition: what an environment holds and allows.
 * Pure over {@link PublishFacts}, which `facts.ts` loads, so each rule has a golden test. The graph,
 * typing, null and taint rules are `checkDefinition`'s, and the grant is `grant.ts`'s.
 *
 * In production an adverse step without its basis is an error; a sandbox gets the same findings as
 * warnings (C128.3). A fact nobody can state fails closed: a list of unknown purpose blocks.
 */
import { secretKeysOf, type WorkflowDefinition, type WorkflowStep } from '@openverify/contracts';
import type { ListPurpose } from '@openverify/core';
import { indexGraph, reaching } from '@openverify/workflow-engine';
import type {
  AdverseStepAnalysis,
  DefinitionCheck,
  DefinitionIssue,
} from '@openverify/workflow-engine';
import {
  SLACK_WEBHOOK_HOST,
  httpsLiteralHost,
  type ActionAdapter,
  type ActionRegistry,
  type AnyActionRegistryEntry,
} from '@openverify/workflow-engine/actions';
import type { EnvironmentKind } from '../../ports.js';
import { normalizeHostOf } from '../actions/https/hosts.js';
import { placeholderReferencesIn, referencesIn } from './references.js';
import { caseTemplateContestRouteIssues } from '../actions/cases/contest-route.js';

export interface SecretFacts {
  allowedHosts: readonly string[];
  headers: readonly string[];
  bodyPointers: readonly string[];
  hasValue: boolean;
}

export interface PublishFacts {
  environmentKind: EnvironmentKind;
  flowHost: string | null;
  linkHosts: readonly string[];
  emailRecipients: readonly string[];
  smsRecipients: readonly string[];
  boundAdapters: ReadonlySet<ActionAdapter>;
  listPurposes: ReadonlyMap<string, ListPurpose>;
  transactionAdverseStatuses: ReadonlySet<string>;
  /** Whether every active type has a contest route of its own (C128.3). */
  transactionTypesContest: boolean;
  accountTypesContest: boolean;
  secrets: ReadonlyMap<string, SecretFacts>;
  /** The active objects of this environment a definition may name. */
  knownReferences: ReadonlySet<string>;
  exposeSignals: boolean;
}

export interface RequiredAcknowledgement {
  key: string;
  pointer: string;
}

export interface PublishRuleReport {
  errors: DefinitionIssue[];
  warnings: DefinitionIssue[];
  acknowledgements: RequiredAcknowledgement[];
  secretsUnknown: DefinitionIssue[];
  secretsWithoutValue: DefinitionIssue[];
}

export interface PublishRuleInputs {
  definition: WorkflowDefinition;
  analyses: readonly AdverseStepAnalysis[];
  egress: DefinitionCheck['egress'];
  registry: ActionRegistry;
  facts: PublishFacts;
}

type ActionStep = Extract<WorkflowStep, { type: 'action' }>;

interface IndexedAction {
  step: ActionStep;
  index: number;
  entry: AnyActionRegistryEntry;
}

function actionsOf(definition: WorkflowDefinition, registry: ActionRegistry): IndexedAction[] {
  return definition.steps.flatMap((step, index) => {
    const entry =
      step.type === 'action' ? registry.get(step['action-key'], step['action-version']) : undefined;
    return step.type === 'action' && entry !== undefined ? [{ step, index, entry }] : [];
  });
}

const isTemplate = (value: unknown): boolean => typeof value !== 'string' || value.includes('{{');

/** The host of a URL as every allowlist compares it (C124.3), or `null` for no `https:` URL. */
function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? normalizeHostOf(parsed) : null;
  } catch {
    return null;
  }
}

/** C122.1: a `by-config` step is adverse unless what it names says otherwise. */
function isAdverse({ step, entry }: IndexedAction, facts: PublishFacts): boolean {
  const { config } = step;
  switch (entry.adverseRule) {
    case 'list-purpose': {
      const purpose = isTemplate(config['list-id'])
        ? undefined
        : facts.listPurposes.get(config['list-id'] as string);
      return purpose !== 'allow' && purpose !== 'watch';
    }
    case 'transaction-adverse-status':
      return facts.transactionAdverseStatuses.has(config.status as string);
    case 'account-archive':
      return (
        config['object-type'] === 'account' &&
        config.field === 'status' &&
        (isTemplate(config.value) || config.value === 'archived')
      );
    case null:
      return entry.adverse === 'always';
  }
}

/** C128.3: a subject's own type can hold the route, when every such type does. */
function routeFromType({ entry }: IndexedAction, facts: PublishFacts): boolean {
  switch (entry.adverseRule) {
    case 'transaction-adverse-status':
      return facts.transactionTypesContest;
    case 'account-archive':
      return facts.accountTypesContest;
    default:
      return false;
  }
}

class Report implements PublishRuleReport {
  errors: DefinitionIssue[] = [];
  warnings: DefinitionIssue[] = [];
  acknowledgements: RequiredAcknowledgement[] = [];
  secretsUnknown: DefinitionIssue[] = [];
  secretsWithoutValue: DefinitionIssue[] = [];

  constructor(private readonly production: boolean) {}

  /** C128.3: an error in production and a warning in a sandbox. */
  gate(issue: DefinitionIssue): void {
    (this.production ? this.errors : this.warnings).push(issue);
  }

  acknowledge(key: string, pointer: string): void {
    this.acknowledgements.push({ key, pointer });
  }
}

const configPointer = (index: number, member: string) => `/steps/${String(index)}/config/${member}`;

function checkContestRoute(action: IndexedAction, facts: PublishFacts, report: Report): void {
  const pointer = configPointer(action.index, 'contest-route');
  const route = action.step.config['contest-route'] as
    { url?: string; contact?: string; 'case-template-id'?: string } | undefined;
  if (route === undefined) {
    if (!routeFromType(action, facts)) {
      report.gate({ pointer, code: 'contest_route_missing', detail: 'Says how to contest this.' });
    }
    return;
  }
  const caseTemplateId = route['case-template-id'];
  if (caseTemplateId !== undefined) {
    // C128.7 (Workflow 8B): `api-case-workflows` says what such a route needs, and refuses it until
    // the review request can open that case.
    report.errors.push(...caseTemplateContestRouteIssues(pointer, caseTemplateId));
  }
  if (route.url !== undefined) {
    const host = hostOf(route.url);
    const allowed = [...facts.linkHosts, ...(facts.flowHost === null ? [] : [facts.flowHost])];
    if (host === null || !allowed.includes(host)) {
      report.gate({
        pointer: `${pointer}/url`,
        code: 'contest_route_host_refused',
        detail: 'Its host is neither on workflow-link-hosts nor the flow’s own.',
      });
    }
  }
}

/** C128.3, C128.4: every adverse step, with no static exemption. */
function checkAdverseSteps(
  actions: readonly IndexedAction[],
  analyses: readonly AdverseStepAnalysis[],
  facts: PublishFacts,
  report: Report,
): void {
  for (const analysis of analyses) {
    const action = actions.find(({ step }) => step.id === analysis.stepId);
    if (action !== undefined && isAdverse(action, facts)) {
      const { config } = action.step;
      if (config['decision-basis'] === undefined) {
        report.gate({
          pointer: configPointer(action.index, 'decision-basis'),
          code: 'decision_basis_missing',
          detail: 'An adverse step declares its basis.',
        });
      }
      checkContestRoute(action, facts, report);
      if (analysis.biometric && config['biometric-basis'] === undefined) {
        report.gate({
          pointer: configPointer(action.index, 'biometric-basis'),
          code: 'biometric_basis_missing',
          detail: 'This step depends on a biometric result, so it declares a biometric basis.',
        });
      }
      // C210.5 (Workflow 10B): a signal that is never decisive alone asks the acknowledgement whatever
      // its tier, and one read by a route that decides this step with no verification outcome in
      // between refuses it in every environment, not only warns.
      if (
        (analysis.heuristicSteps.length > 0 || analysis.nonDecisiveSignals.length > 0) &&
        facts.environmentKind === 'production'
      ) {
        report.acknowledge(`heuristic:${analysis.stepId}`, `/steps/${String(action.index)}`);
      }
      if (analysis.undecidedSignals.length > 0) {
        report.errors.push({
          pointer: `/steps/${String(action.index)}`,
          code: 'signal_not_decisive_alone',
          detail:
            `A route on ${analysis.undecidedSignals.join(', ')}, never decisive alone, reaches this ` +
            'step with no run_verification and no route on its outcome in between; flag it for ' +
            'review instead.',
        });
      }
    }
  }
}

const eventsOfTrigger = ({ trigger }: WorkflowDefinition): readonly string[] =>
  trigger?.type === 'trigger-event' || trigger?.type === 'trigger-verification'
    ? trigger.config.events
    : [];

/** What counts as a report or a list wait on the way to an approve (C127.1). */
const EVIDENCE_ACTIONS: ReadonlySet<string> = new Set([
  'run_report',
  'rerun_report',
  'get_list_match',
]);

function checkApprovals(
  definition: WorkflowDefinition,
  actions: readonly IndexedAction[],
  report: Report,
): void {
  const events = eventsOfTrigger(definition);
  const approvals = actions.filter(({ step }) => step['action-key'] === 'approve_inquiry');
  if (approvals.length === 0) {
    return;
  }
  const graph = indexGraph(definition);
  for (const { step, index } of approvals) {
    if (events.includes('inquiry.failed')) {
      report.acknowledge(`override-failed:${step.id}`, `/steps/${String(index)}`);
    }
    if (events.includes('inquiry.completed')) {
      const before = reaching(graph, [step.id]);
      const evidence = definition.steps.some(
        (other) =>
          other.type === 'action' &&
          before.has(other.id) &&
          EVIDENCE_ACTIONS.has(other['action-key']),
      );
      if (!evidence) {
        report.warnings.push({
          pointer: `/steps/${String(index)}`,
          code: 'approve_without_evidence',
          detail: 'Nothing on the way here waits for a report or a list.',
        });
      }
    }
  }
}

function emailAllowed(recipient: string, allowed: readonly string[]): boolean {
  const address = recipient.toLowerCase();
  const domain = address.slice(address.lastIndexOf('@') + 1);
  return allowed.some((entry) => {
    const lowered = entry.toLowerCase();
    return lowered === address || lowered === domain;
  });
}

/** C114.5, C126.1, C126.2: a literal recipient must be on its allowlist. */
function checkRecipient({ step, index }: IndexedAction, facts: PublishFacts, report: Report): void {
  const recipient = step.config.recipient;
  if (isTemplate(recipient)) {
    return;
  }
  const allowed =
    step['action-key'] === 'send_email'
      ? emailAllowed(recipient as string, facts.emailRecipients)
      : step['action-key'] === 'send_sms'
        ? facts.smsRecipients.includes(recipient as string)
        : true;
  if (!allowed) {
    report.errors.push({
      pointer: configPointer(index, 'recipient'),
      code: 'recipient_not_allowed',
      detail: 'A literal recipient must be on this environment’s allowlist.',
    });
  }
}

/** C116.4: what each action asks for by itself. */
function checkActions(
  actions: readonly IndexedAction[],
  facts: PublishFacts,
  report: Report,
): void {
  for (const action of actions) {
    const { step, index, entry } = action;
    if (entry.irreversible) {
      report.acknowledge(`irreversible:${step.id}`, `/steps/${String(index)}`);
    }
    if (step.config['allow-unconfirmed'] === true) {
      report.acknowledge(`unconfirmed:${step.id}`, configPointer(index, 'allow-unconfirmed'));
    }
    if (!facts.boundAdapters.has(entry.availability)) {
      report.warnings.push({
        pointer: `/steps/${String(index)}`,
        code: 'provider_not_configured',
        detail: 'Its adapter is not bound here, so a run that reaches it ends with an error.',
      });
    }
    checkRecipient(action, facts, report);
  }
}

interface Placement {
  pointer: string;
  key: string;
  host: string | null;
  /** The lower-cased header, or the body pointer, that a secret's list must name. */
  header?: string;
  bodyPointer?: string;
}

function bodyPlacements(
  value: unknown,
  bodyPointer: string,
  stepPointer: string,
  host: string | null,
): Placement[] {
  if (typeof value === 'string') {
    return secretKeysOf(value).map((key) => ({
      pointer: `${stepPointer}${bodyPointer}`,
      key,
      host,
      bodyPointer,
    }));
  }
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown, index) =>
      bodyPlacements(item, `${bodyPointer}/${String(index)}`, stepPointer, host),
    );
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      bodyPlacements(item, `${bodyPointer}/${key}`, stepPointer, host),
    );
  }
  return [];
}

function placementsOf({ step, index }: IndexedAction): Placement[] {
  const { config } = step;
  if (step['action-key'] === 'send_slack_message') {
    const webhook = config['webhook-secret'] as string;
    return secretKeysOf(webhook).map((key) => ({
      pointer: configPointer(index, 'webhook-secret'),
      key,
      host: SLACK_WEBHOOK_HOST,
    }));
  }
  if (step['action-key'] !== 'make_https_request') {
    return [];
  }
  const host = hostOf(`https://${httpsLiteralHost(config.url as string) ?? ''}/`);
  const headers = (config.headers ?? []) as unknown as readonly {
    name: string;
    value: string;
  }[];
  const signing = (config.signing as { secret: string } | undefined)?.secret ?? '';
  return [
    ...headers.flatMap(({ name, value }, position) =>
      secretKeysOf(value).map((key) => ({
        pointer: configPointer(index, `headers/${String(position)}/value`),
        key,
        host,
        header: name.toLowerCase(),
      })),
    ),
    ...bodyPlacements(config.body, '', configPointer(index, 'body'), host),
    ...secretKeysOf(signing).map((key) => ({
      pointer: configPointer(index, 'signing/secret'),
      key,
      host,
    })),
  ];
}

const refused = (pointer: string, detail: string): DefinitionIssue => ({
  pointer,
  code: 'secret_placement_refused',
  detail,
});

/** C125.3, C125.4: each reference names a key with a value, bound to this host and placement. */
function checkSecrets(
  actions: readonly IndexedAction[],
  facts: PublishFacts,
  report: Report,
): void {
  for (const action of actions) {
    const seen = new Set<string>();
    for (const placement of placementsOf(action)) {
      const { pointer, key, host, header, bodyPointer } = placement;
      const secret = facts.secrets.get(key);
      // eslint-disable-next-line security/detect-possible-timing-attacks -- a presence check against null or undefined, not a comparison of two secrets
      if (secret === undefined) {
        report.secretsUnknown.push({
          pointer,
          code: 'secret_reference_invalid',
          detail: 'No workflow secret has this key.',
        });
      } else if (!secret.hasValue) {
        report.secretsWithoutValue.push({
          pointer,
          code: 'secret_value_missing',
          detail: 'This secret has no value in this environment.',
        });
      } else if (host === null || !secret.allowedHosts.includes(host)) {
        report.errors.push(refused(pointer, 'This secret is not bound to this host.'));
      } else if (header !== undefined && !secret.headers.includes(header)) {
        report.errors.push(refused(pointer, 'This secret may not go in this header.'));
      } else if (bodyPointer !== undefined && !secret.bodyPointers.includes(bodyPointer)) {
        report.errors.push(refused(pointer, 'This secret may not go at this place in the body.'));
      } else if (seen.has(key)) {
        report.errors.push(refused(pointer, 'A secret appears at most once per request.'));
      }
      seen.add(key);
    }
  }
}

/** C121.6, C140.5: a literal reference names an active object of this environment. */
function checkReferences(
  definition: WorkflowDefinition,
  facts: PublishFacts,
  report: Report,
): void {
  const detail = 'This environment holds no such active object.';
  for (const { pointer, id } of referencesIn(definition)) {
    if (!facts.knownReferences.has(id)) {
      report.errors.push({ pointer, code: 'reference_unknown', detail });
    }
  }
  for (const pointer of placeholderReferencesIn(definition)) {
    report.errors.push({ pointer, code: 'reference_unknown', detail });
  }
}

/** Stage 1a amendment 10: a signal path reads `null` for a run while signals are not exposed. */
function checkSignals(definition: WorkflowDefinition, facts: PublishFacts, report: Report): void {
  const { trigger, steps } = definition;
  if (!facts.exposeSignals && JSON.stringify({ trigger, steps }).includes('trigger.signals.')) {
    report.warnings.push({
      pointer: '',
      code: 'signal_not_exposed',
      detail: 'This version reads a signal, and this environment does not expose signals.',
    });
  }
}

export function evaluatePublishRules(inputs: PublishRuleInputs): PublishRuleReport {
  const { definition, analyses, egress, registry, facts } = inputs;
  const report = new Report(facts.environmentKind === 'production');
  const actions = actionsOf(definition, registry);
  checkReferences(definition, facts, report);
  checkAdverseSteps(actions, analyses, facts, report);
  checkApprovals(definition, actions, report);
  checkActions(actions, facts, report);
  checkSecrets(actions, facts, report);
  checkSignals(definition, facts, report);
  for (const { stepId } of egress) {
    report.acknowledge(`egress:${stepId}`, `/egress/${stepId}`);
  }
  return report;
}
