/**
 * C154.9 (Workflow 9A, `api-templates`): the publish rules of a template version beyond Phase 1-8's.
 *
 * - Every save rule (`saveRuleProblems`), and for a flow-spec 2 flow `checkFlowGraph` in publish mode
 *   (C147.6, C148.3, C148.4, C149.2) and `analyzeFlowForPublish` (C150.3, C150.6, C150.7, C150.9,
 *   C150.10, C151.13): every route typed over the flow scope by `@openverify/workflow-engine`'s
 *   `typeFlowCondition`, with the version's resolved signal-config `collect`, the field schemas, the
 *   checks, and each `run_workflow` target's declared outputs.
 * - The acknowledgements the version needs (`<kind>:<target>`): the analyses' (`fallback`,
 *   `heuristic`, `adverse-path`, `asserted-fact`, `unverified-path`), the copy's `legal-copy`
 *   (production), `locale-unreviewed:<locale>` for an enabled locale that is neither the source nor
 *   reviewed while a built-in legal text is shown (production; C161.5), and `egress:<step id>` for a
 *   `run_workflow` target with egress marks (`flowActionAcknowledgements`, `api-flow-actions`).
 * - Whether the template is biometric (C128.4), for the analyses: Phase 8's own `biometricTemplates`
 *   of its published version (a selfie, or a face list it screens), OR'd with whether the draft's own
 *   flow holds a selfie; a template with no published version and a draft without a selfie stays
 *   unknown (`null`), which fails closed (Workflow 9B, `api-templates-carry`; 9A amendment 42).
 * - The embedding members (C158.2, C158.4; Workflow 9B): every `embed-origins` entry in the origin
 *   grammar for the environment's kind and on the environment's `allowed-embed-origins` (exactly, as
 *   the embed policy narrows them on every use), else 422 `embed_origin_invalid` at its position; the
 *   `redirect-uri` on the environment's redirect origins (`allowed-redirect-origins`, else the embed
 *   origins) or a custom scheme the version lists, and every `redirect-uri-schemes` entry outside the
 *   denylist, else 422 `redirect_uri_not_allowed`. Both stay stored and served as sent, and are checked
 *   again on every use (`services/embed-origins.ts`). No problem echoes an origin or a URI.
 * - Workflow 10B (`api-integrity`): the analyses' device-integrity rules (`signal_not_decisive_alone`
 *   always; `provider_not_bound` on a branch and `play_integrity_notice_missing` when the caller says
 *   whether the environment kind binds a `deviceIntegrity` provider, `deviceIntegrityBound`).
 * - Workflow 10C (`api-nfc`, C207.9): the analyses' two `nfc` rules reach the report through the
 *   same calls: the acknowledgement `client-unable:<step id>` beside `fallback:<step id>` for an
 *   `nfc` step whose fallback continues (stored with the version, it is what lets a client-unable
 *   exit complete without review), and the warning `nfc_fallback_missing` for an `nfc` step without
 *   an `exhausted` edge.
 */
import {
  checkOriginEntry,
  resolveSignalConfig,
  signalConfigSchema,
  verificationConfigSchema,
  API_VERIFICATION_TYPES,
  fromApiVerificationType,
  REDIRECT_SCHEME_DENYLIST,
  type TemplateLocale,
} from '@openverify/contracts';
import {
  getEnvironment,
  getWorkflowVersion,
  type Db,
  type InquiryTemplateVersion,
} from '@openverify/db';
import {
  analyzeFlowForPublish,
  checkFlowGraph,
  COPY_KEYS,
  isFlowV2,
  safeParseAnyFlow,
  type FlowV2,
  type ScopeValueType,
} from '@openverify/flow-spec';
import { typeFlowCondition } from '@openverify/workflow-engine';
import { flowActionAcknowledgements } from '../../flow-actions/grants.js';
import { resolveFlowRunTarget } from '../../flow-actions/target.js';
import { biometricTemplates } from '../../workflows/publish/facts.js';
import { redirectUriRefusal, type RedirectRefusal } from '../embed-origins.js';
import { copyRuleProblems } from '../templates/copy-rules.js';
import { servedLocaleReviewStatus } from '../templates/locale-review.js';
import {
  saveRuleProblems,
  storedCopy,
  storedFieldSchemas,
  type TemplateRuleProblem,
} from '../templates/versions.js';
import { connectPublishChecks } from '../connect/publish-checks.js';

/** One acknowledgement a publish needs, with where and why. */
export interface PublishAcknowledgement {
  key: string;
  pointer: string;
  reason: string;
}

export interface FlowPublishReport {
  problems: TemplateRuleProblem[];
  acknowledgements: PublishAcknowledgement[];
}

export interface FlowPublishInput {
  environment: { id: string; kind: 'sandbox' | 'production' };
  templateId: string;
  version: InquiryTemplateVersion;
  /**
   * C211.5, C211.9 (Workflow 10B): whether the environment kind binds a `deviceIntegrity` provider
   * (`deps.providers[kind].deviceIntegrity`); left out, the two rules that depend on it are skipped.
   */
  deviceIntegrityBound?: boolean | undefined;
  /**
   * C231.10 (Workflow 11A Stage 1b (K)): whether the install allows Connect (`config.connect`); left
   * out, it does not, and a `share_consent` step fails publish (`share_consent_connect_disabled`).
   */
  connectEnabled?: boolean | undefined;
  /**
   * C235.8 (Workflow 11A, `api-consent`'s named borrowed edit): the publish's `meta.acknowledgements`,
   * which the Connect hook reads (`cloned_results_without_binding` unless `cloned-results-unbound`
   * is given); left out by a draft's validation, which then shows the problem.
   */
  givenAcknowledgements?: readonly string[] | undefined;
}

/** The checks of `verification-config` by verification type (core's names). */
function checksOf(config: unknown) {
  const parsed = verificationConfigSchema.safeParse(config);
  const checks: Record<string, Record<string, { enabled: boolean; required: boolean }>> = {};
  if (!parsed.success) return checks;
  for (const apiType of API_VERIFICATION_TYPES) {
    const typeConfig = parsed.data[apiType];
    if (typeConfig !== undefined) {
      checks[fromApiVerificationType(apiType)] = typeConfig.checks;
    }
  }
  return checks;
}

/**
 * Each `run_workflow` step's declared outputs, from the target version's definition. A Phase 8
 * output declares its name and PII mark, not a type: a PII output reads as a string, and a non-PII
 * one, which Phase 8 shows only as a number or a boolean, as a number (ours, provisional).
 */
async function workflowOutputsOf(
  db: Db,
  environmentId: string,
  flow: FlowV2,
): Promise<Record<string, { name: string; type: ScopeValueType; pii: boolean }[]>> {
  const outputs: Record<string, { name: string; type: ScopeValueType; pii: boolean }[]> = {};
  for (const step of flow.steps) {
    if (step.type !== 'action' || step.action.kind !== 'run_workflow') continue;
    const target = await resolveFlowRunTarget(db, environmentId, step.action, { running: false });
    if (typeof target === 'string') continue;
    const version = await getWorkflowVersion(db, environmentId, target.versionId);
    const declared = (version?.definition as { outputs?: unknown } | undefined)?.outputs;
    outputs[step.id] = (Array.isArray(declared) ? declared : []).flatMap((output: unknown) => {
      const { name, pii } = (output ?? {}) as { name?: unknown; pii?: unknown };
      return typeof name === 'string' && typeof pii === 'boolean'
        ? [{ name, pii, type: pii ? ('string' as const) : ('number' as const) }]
        : [];
    });
  }
  return outputs;
}

/**
 * C161.5: the enabled locales whose built-in legal texts a person may read unreviewed, by the
 * status each is served with (R004: a reviewed locale whose catalog changed is not reviewed).
 */
function unreviewedLocales(enabled: readonly TemplateLocale[]): TemplateLocale[] {
  return enabled.filter((locale) => {
    const status = servedLocaleReviewStatus(locale).status;
    return status !== 'source' && status !== 'reviewed';
  });
}

/** Whether the flow shows a built-in legal text: a consent step or a notice key not overridden. */
function showsBuiltInLegalText(flow: unknown): boolean {
  const steps = (flow as { steps?: readonly { type?: unknown }[] }).steps ?? [];
  return steps.some((step) => step.type === 'consent' || step.type === 'screen');
}

/**
 * C128.4: whether the template is biometric, as the analyses read it: Phase 8's answer for its
 * published version, `true` whenever the draft's own flow holds a selfie, `null` when unknown.
 */
async function templateIsBiometric(
  db: Db,
  input: FlowPublishInput,
  flow: FlowV2,
): Promise<boolean | null> {
  if (flow.steps.some((step) => step.type === 'selfie')) {
    return true;
  }
  const published = await biometricTemplates(db, input.environment.id, [input.templateId]);
  return published.get(input.templateId) ?? null;
}

/** What an embedding refusal says, never echoing the origin or the URI. */
const REDIRECT_DETAIL: Readonly<Record<RedirectRefusal, string>> = {
  not_a_uri: 'Is not an absolute URI of at most 2,048 characters.',
  userinfo: 'Must not carry a user name or password.',
  scheme: 'Uses a scheme the version does not list.',
  origin: 'Is not on the environment’s allowed redirect origins.',
};

/** C158.4: a custom scheme's grammar (`redirectSchemeSchema`'s). */
const CUSTOM_SCHEME = /^[a-z][a-z0-9+.-]*$/;

/** C158.2, C158.4: the embedding members' publish problems, against the environment's lists. */
async function embeddingProblems(db: Db, input: FlowPublishInput): Promise<TemplateRuleProblem[]> {
  const { version, environment } = input;
  const settings = (await getEnvironment(db, environment.id))?.settings ?? {};
  const embedOrigins = settings['allowed-embed-origins'] ?? [];
  const problems: TemplateRuleProblem[] = [];
  version.embedOrigins.forEach((entry, index) => {
    const refusal = checkOriginEntry(entry, environment.kind);
    if (refusal !== null || !embedOrigins.includes(entry)) {
      problems.push({
        pointer: `/embed-origins/${String(index)}`,
        code: 'embed_origin_invalid',
        detail:
          refusal === null
            ? 'Is not on the environment’s allowed embed origins.'
            : `Is outside the origin grammar (${refusal}).`,
        severity: 'error',
      });
    }
  });
  if (version.redirectUri !== null) {
    const refusal = redirectUriRefusal(version.redirectUri, {
      environmentKind: environment.kind,
      allowedOrigins: settings['allowed-redirect-origins'] ?? embedOrigins,
      schemes: version.redirectUriSchemes,
    });
    if (refusal !== null) {
      problems.push({
        pointer: '/redirect-uri',
        code: 'redirect_uri_not_allowed',
        detail: REDIRECT_DETAIL[refusal],
        severity: 'error',
      });
    }
  }
  version.redirectUriSchemes.forEach((scheme, index) => {
    if (
      !CUSTOM_SCHEME.test(scheme) ||
      (REDIRECT_SCHEME_DENYLIST as readonly string[]).includes(scheme)
    ) {
      problems.push({
        pointer: `/redirect-uri-schemes/${String(index)}`,
        code: 'redirect_uri_not_allowed',
        detail: 'Is not a custom scheme a redirect may use.',
        severity: 'error',
      });
    }
  });
  return problems;
}

/** Every problem and acknowledgement a publish of this version meets (C154.9). */
export async function flowPublishReport(
  db: Db,
  input: FlowPublishInput,
): Promise<FlowPublishReport> {
  const { version, environment } = input;
  const problems = await saveRuleProblems(
    db,
    { environmentKind: environment.kind },
    { environmentId: environment.id, templateId: input.templateId, version },
  );
  const acknowledgements: PublishAcknowledgement[] = [];
  const parsed = safeParseAnyFlow(version.flow);
  const fieldSchemas = storedFieldSchemas(version).map(({ key, type, pii }) => ({
    key,
    type,
    pii,
  }));
  const copy = storedCopy(version);
  const enabledLocales = version.enabledLocales;
  if (parsed.success && isFlowV2(parsed.data)) {
    const flow = parsed.data;
    const checks = checksOf(version.verificationConfig);
    const seen = new Set(problems.map(({ pointer, code }) => `${pointer} ${code}`));
    const customConsentCopy = Object.values(copy.messages).some((texts) =>
      Object.keys(texts).some((key) => COPY_KEYS[key]?.consent === true),
    );
    for (const problem of checkFlowGraph(flow, {
      mode: 'publish',
      fieldSchemas,
      linkFields: [
        ...(version.helpUrl === null ? [] : ['help-url']),
        ...(version.privacyUrl === null ? [] : ['privacy-url']),
      ],
      customConsentCopy,
      checks,
    })) {
      const pointer = `/flow${problem.pointer}`;
      if (!seen.has(`${pointer} ${problem.code}`)) {
        problems.push({ ...problem, pointer });
      }
    }
    const signalConfig = signalConfigSchema.safeParse(version.signalConfig);
    // `default` (or a config that does not parse) is the registry's default set.
    const collect = signalConfig.success
      ? resolveSignalConfig(signalConfig.data).collect
      : 'default';
    const analysis = analyzeFlowForPublish(flow, {
      environment: environment.kind,
      typeCondition: typeFlowCondition,
      fieldSchemas,
      checks,
      ...(collect === 'default' ? {} : { signalCollect: collect }),
      workflowOutputs: await workflowOutputsOf(db, environment.id, flow),
      templateIsBiometric: await templateIsBiometric(db, input, flow),
      // C211.5, C211.9 (Workflow 10B): the two rules on the environment's deviceIntegrity binding.
      ...(input.deviceIntegrityBound === undefined
        ? {}
        : { deviceIntegrityBound: input.deviceIntegrityBound }),
    });
    problems.push(
      ...analysis.problems.map((problem) => ({ ...problem, pointer: `/flow${problem.pointer}` })),
    );
    acknowledgements.push(
      ...analysis.acknowledgements.map(({ key, pointer, reason }) => ({
        key,
        pointer: `/flow${pointer}`,
        reason,
      })),
    );
    for (const key of await flowActionAcknowledgements({
      db,
      environmentId: environment.id,
      flow,
    })) {
      acknowledgements.push({
        key,
        pointer: '/flow',
        reason: 'The workflow this step runs sends data out of OpenVerify.',
      });
    }
  }
  // C238.2 (verification V06; Workflow 11A Stage 1b (K), `foundation-11a`'s hook): every Connect
  // publish check and acknowledgement, in one call (`api-consent`'s `services/connect/publish-checks.ts`).
  const connect = await connectPublishChecks(db, {
    environment,
    templateId: input.templateId,
    version,
    connectEnabled: input.connectEnabled === true,
    ...(input.givenAcknowledgements === undefined
      ? {}
      : { givenAcknowledgements: input.givenAcknowledgements }),
  });
  problems.push(...connect.problems);
  acknowledgements.push(...connect.acknowledgements);
  if (parsed.success) {
    for (const key of copyRuleProblems(copy, {
      flow: parsed.data,
      enabledLocales,
      environmentKind: environment.kind,
    }).acknowledgements) {
      acknowledgements.push({
        key,
        pointer: `/copy`,
        reason: 'An overridden text with legal weight.',
      });
    }
  }
  if (showsBuiltInLegalText(version.flow)) {
    for (const locale of unreviewedLocales(enabledLocales)) {
      if (environment.kind === 'production') {
        acknowledgements.push({
          key: `locale-unreviewed:${locale}`,
          pointer: '/enabled-locales',
          reason: 'The built-in legal texts of this locale are machine-drafted and not reviewed.',
        });
      } else {
        problems.push({
          pointer: '/enabled-locales',
          code: 'locale_unreviewed',
          detail: `The built-in texts of ${locale} are not reviewed; production asks locale-unreviewed:${locale}.`,
          severity: 'warning',
        });
      }
    }
  }
  problems.push(...(await embeddingProblems(db, input)));
  const unique = new Map(acknowledgements.map((entry) => [entry.key, entry]));
  return { problems, acknowledgements: [...unique.values()] };
}
