/**
 * C90.6, C90.7, C94.6 (Workflow 7A): the `signal-config` publish rules of an inquiry template
 * version, which `assertPublishable` (`services/inquiry-templates.ts`) runs when a template is
 * created and when a version is published, with the flow (its consent step's text keys) and the
 * environment (its `signal-collection` setting and its `ipReputation` binding). The rules:
 *
 * - an unknown name in `collect`: 422 `unknown_signal` at `/data/attributes/signal-config/collect/<i>`;
 * - a review rule on a signal outside `collect`, or a comparison that does not fit the signal's
 *   value type: 422 `signal_rule_invalid`;
 * - a rule on a signal registered `review-rule: false`: 422 `signal_not_reviewable`;
 * - a `proxy_detected` rule without an `ipReputation` adapter bound: 422 `provider_not_bound`;
 * - a rule on either Play Integrity signal (the signals the integrity verdict feeds) without a
 *   `deviceIntegrity` provider bound: 422 `provider_not_bound` (Workflow 10B, C211.5);
 * - device recognition in `consent` mode without `consent.device-recognition`: 422
 *   `consent_text_missing`; in `exempt` mode beside that optional key: 422
 *   `consent_key_conflicts_with_exempt`.
 *
 * Owner: `api-signals` (Workflow 7A Stage 3); the signature is frozen by `foundation-7a`
 * (Stage 1b (S)).
 */
import {
  DEVICE_RECOGNITION_CONSENT_TEXT_KEY,
  DEVICE_RECOGNITION_NOTICE_TEXT_KEY,
  resolveSignalConfig,
  type SignalConfig,
  type SignalProblemCode,
  type SignalReviewRule,
} from '@openverify/contracts';
import { DEFAULT_SIGNAL_NAMES, getSignalDefinition, type SignalDefinition } from '@openverify/core';
import { getEnvironment, resolveSignalSettings, type Db } from '@openverify/db';
import type { Flow } from '@openverify/flow-spec';
import type { ApiDependencies } from '../context.js';
import type { EnvironmentKind } from '../../ports.js';

const BASE = '/data/attributes/signal-config';

export interface SignalConfigPublishContext {
  deps: ApiDependencies;
  /** The request's database, or the transaction that publishes. */
  db: Db;
  environment: { id: string; kind: EnvironmentKind };
  flow: Flow;
  signalConfig: SignalConfig;
}

/** One refusal: its code and a JSON Pointer into the request (`/data/attributes/...`). */
export interface SignalConfigProblem {
  code: SignalProblemCode;
  pointer: string;
  detail: string;
}

export type SignalConfigPublishProblems = (
  ctx: SignalConfigPublishContext,
) => Promise<SignalConfigProblem[]>;

export const signalConfigPublishProblems: SignalConfigPublishProblems = async (ctx) => {
  const config = resolveSignalConfig(ctx.signalConfig);
  const problems: SignalConfigProblem[] = [];
  const collected =
    config.collect === 'default'
      ? [...DEFAULT_SIGNAL_NAMES]
      : config.collect.filter((name, index) => {
          if (getSignalDefinition(name) === undefined) {
            problems.push({
              code: 'unknown_signal',
              pointer: `${BASE}/collect/${String(index)}`,
              detail: `${name} is not a signal of the catalogue.`,
            });
            return false;
          }
          return true;
        });
  problems.push(...reviewRuleProblems(config['review-rules'], collected, getSignalDefinition));
  const ipReputationBound = ctx.deps.providers[ctx.environment.kind].ipReputation !== undefined;
  config['review-rules'].forEach((rule, index) => {
    if (rule.signal === 'inquiry/proxy_detected' && collected.includes(rule.signal) && !ipReputationBound) {
      problems.push({
        code: 'provider_not_bound',
        pointer: `${BASE}/review-rules/${String(index)}/signal`,
        detail:
          'A proxy_detected rule needs an ipReputation adapter bound in this environment: ' +
          'without one every inquiry would go to review.',
      });
    }
  });
  // C211.5 (Workflow 10B, api-integrity): unbound, every inquiry would read them as a gap.
  const deviceIntegrityBound =
    ctx.deps.providers[ctx.environment.kind].deviceIntegrity !== undefined;
  config['review-rules'].forEach((rule, index) => {
    if (
      !deviceIntegrityBound &&
      collected.includes(rule.signal) &&
      getSignalDefinition(rule.signal)?.inputs.includes('integrity-verdict') === true
    ) {
      problems.push({
        code: 'provider_not_bound',
        pointer: `${BASE}/review-rules/${String(index)}/signal`,
        detail:
          `A ${rule.signal} rule needs a deviceIntegrity provider bound in this environment: ` +
          'without one every inquiry would go to review.',
      });
    }
  });
  problems.push(...(await recognitionKeyProblems(ctx)));
  return problems;
};

/** The comparison members of a rule, in the order a problem names the first that does not fit. */
const COMPARISONS = ['gte', 'lte', 'eq', 'in'] as const;

const ISO_ALPHA_2 = /^[A-Z]{2}$/;

/** Whether `operand` is a value `definition` can take, for `eq` and `in`. */
function fitsValue(definition: SignalDefinition, operand: unknown): boolean {
  switch (definition.valueType) {
    case 'boolean':
      // C90.3: a never-false flag is `true` or `null`, so a rule on `false` could never match.
      return typeof operand === 'boolean' && (operand || !definition.neverFalse);
    case 'integer':
      return Number.isInteger(operand) && fitsRange(definition, operand as number);
    case 'number':
      return typeof operand === 'number' && fitsRange(definition, operand);
    case 'enum':
      return typeof operand === 'string' && (definition.values ?? []).includes(operand);
    case 'string':
      return (
        typeof operand === 'string' &&
        (definition.values?.includes('iso-3166-1-alpha-2') !== true || ISO_ALPHA_2.test(operand))
      );
  }
}

function fitsRange(definition: SignalDefinition, value: number): boolean {
  const range = definition.range;
  return range === null || (value >= range.min && (range.max === null || value <= range.max));
}

/** Whether `gte` or `lte` can be applied to `definition` with `bound`. */
function fitsBound(definition: SignalDefinition, bound: number): boolean {
  return (
    (definition.valueType === 'integer' || definition.valueType === 'number') &&
    fitsRange(definition, bound)
  );
}

/**
 * The review rules' own problems (C90.6, F31), against the collected names and a registry lookup
 * (`getSignalDefinition` in production; a test may pass its own). Pure.
 */
export function reviewRuleProblems(
  rules: readonly SignalReviewRule[],
  collected: readonly string[],
  definitionOf: (name: string) => SignalDefinition | undefined,
): SignalConfigProblem[] {
  const problems: SignalConfigProblem[] = [];
  rules.forEach((rule, index) => {
    const at = `${BASE}/review-rules/${String(index)}`;
    const definition = definitionOf(rule.signal);
    if (definition === undefined) {
      problems.push({
        code: 'unknown_signal',
        pointer: `${at}/signal`,
        detail: `${rule.signal} is not a signal of the catalogue.`,
      });
      return;
    }
    if (!definition.reviewRule) {
      problems.push({
        code: 'signal_not_reviewable',
        pointer: `${at}/signal`,
        detail: `${rule.signal} may not be tested by a review rule.`,
      });
      return;
    }
    if (!collected.includes(rule.signal)) {
      problems.push({
        code: 'signal_rule_invalid',
        pointer: `${at}/signal`,
        detail: `${rule.signal} is not in the collected set, so the rule could never apply.`,
      });
      return;
    }
    for (const comparison of COMPARISONS) {
      const operand = rule[comparison];
      if (operand === undefined) {
        continue;
      }
      const invalid = (pointer: string) =>
        problems.push({
          code: 'signal_rule_invalid',
          pointer,
          detail: `The comparison does not fit ${rule.signal}, a ${definition.valueType} signal.`,
        });
      if (comparison === 'gte' || comparison === 'lte') {
        if (!fitsBound(definition, operand as number)) {
          invalid(`${at}/${comparison}`);
        }
      } else if (comparison === 'in') {
        const position = (operand as unknown[]).findIndex((value) => !fitsValue(definition, value));
        if (position !== -1) {
          invalid(`${at}/in/${String(position)}`);
        }
      } else if (!fitsValue(definition, operand)) {
        invalid(`${at}/eq`);
      }
    }
  });
  return problems;
}

/**
 * C94.6: the consent step's keys for the environment's device-recognition mode. A flow without a
 * consent step records no consent, so it collects nothing and needs no key.
 */
async function recognitionKeyProblems(ctx: SignalConfigPublishContext): Promise<SignalConfigProblem[]> {
  const index = ctx.flow.steps.findIndex((step) => step.type === 'consent');
  const step = ctx.flow.steps[index];
  if (step?.type !== 'consent') {
    return [];
  }
  const environment = await getEnvironment(ctx.db, ctx.environment.id);
  const mode = resolveSignalSettings(environment?.settings ?? {})['signal-collection'][
    'device-recognition'
  ];
  const at = `/data/attributes/flow/steps/${String(index)}`;
  const offered = (step.optionalTextKeys ?? []).includes(DEVICE_RECOGNITION_CONSENT_TEXT_KEY);
  if (mode === 'consent' && !offered) {
    return [
      {
        code: 'consent_text_missing',
        pointer: `${at}/optionalTextKeys`,
        detail:
          'Device recognition is collected on consent here: the consent step must offer ' +
          `${DEVICE_RECOGNITION_CONSENT_TEXT_KEY}.`,
      },
    ];
  }
  if (mode !== 'exempt') {
    return [];
  }
  const problems: SignalConfigProblem[] = [];
  if (!step.textKeys.includes(DEVICE_RECOGNITION_NOTICE_TEXT_KEY)) {
    problems.push({
      code: 'consent_text_missing',
      pointer: `${at}/textKeys`,
      detail: `Device recognition is exempt here: the consent step must show ${DEVICE_RECOGNITION_NOTICE_TEXT_KEY}.`,
    });
  }
  if (offered) {
    problems.push({
      code: 'consent_key_conflicts_with_exempt',
      pointer: `${at}/optionalTextKeys`,
      detail:
        'Device recognition is exempt here, so the consent step may not offer a tick that a ' +
        'person could decline.',
    });
  }
  return problems;
}


