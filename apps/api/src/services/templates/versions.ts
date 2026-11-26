/**
 * C154.1-C154.3 (Workflow 9A, `api-templates`): what a template version is beyond its configuration.
 *
 * - The rules a save runs (`saveRuleProblems`): coherence of flow and configuration, every graph,
 *   component and field rule of a flow-spec 2 flow (`checkFlowGraph` in save mode), the field keys'
 *   types against every published version (`checkFieldSchemaChanges`), the 2.2.1 window warnings
 *   (`checkSettingsWindows`), the copy rules and the locales. Pointers are into the attributes.
 * - The stored `validation` (`invalid` while any error stands; warnings never block).
 * - `flow-sha256`, the SHA-256 of the RFC 8785 canonical flow without `layout` (C147.7).
 * - The strong ETag, the SHA-256 of the version's stored content (C154.3).
 */
import { createHash } from 'node:crypto';
import {
  API_VERIFICATION_TYPES,
  fieldSchemasSchema,
  fromApiVerificationType,
  inquiryTemplateVersionContentSchema,
  resolveTemplateSettings,
  templateCopySchema,
  templateSettingsSchema,
  templateValidationSchema,
  templateVersionEtag,
  verificationConfigSchema,
  type FieldSchemas,
  type InquiryTemplateVersionRecord,
  type TemplateCopy,
  type TemplateValidation,
} from '@openverify/contracts';
import {
  canonicalJson,
  checkFieldSchemaChanges,
  checkFlowGraph,
  checkSettingsWindows,
  COPY_KEYS,
  isFlowV2,
  safeParseAnyFlow,
  type AnyFlow,
  type FlowGraphOptions,
  type FlowProblem,
} from '@openverify/flow-spec';
import { listInquiryTemplateVersions, type Db, type InquiryTemplateVersion } from '@openverify/db';
import {
  inquiryTemplateVersionEventResourceSchema,
  type InquiryTemplateVersionEventResource,
} from '@openverify/contracts';
import { copyRuleProblems, type TemplateRuleProblem } from './copy-rules.js';

export type { TemplateRuleProblem } from './copy-rules.js';

/** Where a version's rules run. */
export interface VersionRuleContext {
  environmentKind: 'sandbox' | 'production';
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** C147.7: the flow's digest; a v1 flow has no `layout`, so it is hashed whole. */
export function flowSha256Of(flow: AnyFlow): string {
  return sha256(canonicalJson(isFlowV2(flow) ? { ...flow, layout: undefined } : flow));
}

/** The stored content a version's ETag covers: everything an edit or a publish changes. */
function storedContent(version: InquiryTemplateVersion): unknown {
  return {
    status: version.status,
    flow: version.flow,
    'verification-config': version.verificationConfig,
    settings: version.settings,
    'report-config': version.reportConfig,
    'signal-config': version.signalConfig,
    'list-config': version.listConfig,
    'field-schemas': version.fieldSchemas,
    copy: version.copy,
    'enabled-locales': version.enabledLocales,
    'default-locale': version.defaultLocale,
    'theme-set-id': version.themeSetId,
    'embed-origins': version.embedOrigins,
    'redirect-uri': version.redirectUri,
    'redirect-uri-schemes': version.redirectUriSchemes,
    'redirect-include-status': version.redirectIncludeStatus,
    'help-url': version.helpUrl,
    'privacy-url': version.privacyUrl,
    description: version.description,
    'publish-note': version.publishNote,
    acknowledgements: version.acknowledgements,
  };
}

/** C154.3: the version's strong ETag, the quoted SHA-256 of its stored content. */
export function versionEtagOf(version: InquiryTemplateVersion): string {
  return templateVersionEtag(sha256(canonicalJson(storedContent(version))));
}

/** The stored copy; `{}` (a version from before Workflow 9A) reads as no copy. */
export function storedCopy(version: Pick<InquiryTemplateVersion, 'copy'>): TemplateCopy {
  const parsed = templateCopySchema.safeParse(version.copy);
  return parsed.success ? parsed.data : { messages: {} };
}

export function storedFieldSchemas(
  version: Pick<InquiryTemplateVersion, 'fieldSchemas'>,
): FieldSchemas {
  const parsed = fieldSchemasSchema.safeParse(version.fieldSchemas);
  return parsed.success ? parsed.data : [];
}

/** C154.2: `invalid` while any error stands. */
export function validationOf(problems: readonly TemplateRuleProblem[]): TemplateValidation {
  return templateValidationSchema.parse({
    status: problems.some((problem) => problem.severity === 'error') ? 'invalid' : 'valid',
    problems: problems.slice(0, 2000).map((problem) => ({
      ...problem,
      pointer: problem.pointer.slice(0, 512),
      detail: problem.detail.slice(0, 500),
    })),
  });
}

/** The checks of `verification-config` by verification type, as the graph rules read them. */
function checksByType(config: unknown): FlowGraphOptions['checks'] {
  const parsed = verificationConfigSchema.safeParse(config);
  if (!parsed.success) return {};
  const checks: Record<string, Record<string, { enabled: boolean; required: boolean }>> = {};
  for (const apiType of API_VERIFICATION_TYPES) {
    const typeConfig = parsed.data[apiType];
    if (typeConfig !== undefined) {
      checks[fromApiVerificationType(apiType)] = typeConfig.checks;
    }
  }
  return checks;
}

const prefixed = (prefix: string, problems: readonly FlowProblem[]): TemplateRuleProblem[] =>
  problems.map(({ pointer, code, detail, severity }) => ({
    pointer: `${prefix}${pointer}`,
    code,
    detail,
    severity,
  }));

/** The field-schemas of every published version of the template, for the key-type rule. */
async function publishedFieldSchemas(
  db: Db,
  environmentId: string,
  templateId: string,
): Promise<FieldSchemas[]> {
  const found: FieldSchemas[] = [];
  let after: string | undefined;
  do {
    const page = await listInquiryTemplateVersions(db, environmentId, {
      inquiryTemplateId: templateId,
      status: ['published', 'superseded'],
      size: 100,
      ...(after === undefined ? {} : { after }),
    });
    found.push(...page.items.map(storedFieldSchemas));
    after = page.next ?? undefined;
  } while (after !== undefined);
  return found;
}

/** What a version's rules read: the stored row, with its template and environment. */
export interface VersionRuleInput {
  environmentId: string;
  templateId: string;
  version: InquiryTemplateVersion;
}

/** Every problem a save of this content meets (C154.2), warnings included. */
export async function saveRuleProblems(
  db: Db,
  context: VersionRuleContext,
  input: VersionRuleInput,
): Promise<TemplateRuleProblem[]> {
  const { version } = input;
  const problems: TemplateRuleProblem[] = [];
  const coherent = inquiryTemplateVersionContentSchema.safeParse({
    flow: version.flow,
    'verification-config': version.verificationConfig,
    settings: version.settings,
  });
  if (!coherent.success) {
    problems.push(
      ...coherent.error.issues.map((issue) => ({
        pointer: `/${issue.path.map(String).join('/')}`,
        code: 'version_incoherent',
        detail: issue.message,
        severity: 'error' as const,
      })),
    );
  }
  const parsedFlow = safeParseAnyFlow(version.flow);
  const fieldSchemas = storedFieldSchemas(version);
  const copy = storedCopy(version);
  const enabledLocales = version.enabledLocales;
  if (parsedFlow.success) {
    const flow = parsedFlow.data;
    if (isFlowV2(flow)) {
      const customConsentCopy = Object.values(copy.messages).some((texts) =>
        Object.keys(texts).some((key) => COPY_KEYS[key]?.consent === true),
      );
      problems.push(
        ...prefixed(
          '/flow',
          checkFlowGraph(flow, {
            mode: 'save',
            fieldSchemas: fieldSchemas.map(({ key, type, pii }) => ({ key, type, pii })),
            linkFields: [
              ...(version.helpUrl === null ? [] : ['help-url']),
              ...(version.privacyUrl === null ? [] : ['privacy-url']),
            ],
            customConsentCopy,
            checks: checksByType(version.verificationConfig) ?? {},
          }),
        ),
      );
    }
    problems.push(
      ...copyRuleProblems(copy, {
        flow,
        enabledLocales,
        environmentKind: context.environmentKind,
      }).problems,
    );
  }
  problems.push(
    ...prefixed(
      '/field-schemas',
      checkFieldSchemaChanges(
        fieldSchemas,
        await publishedFieldSchemas(db, input.environmentId, input.templateId),
      ),
    ),
  );
  const settings = templateSettingsSchema.safeParse(version.settings);
  if (settings.success) {
    problems.push(
      ...prefixed(
        '/settings',
        checkSettingsWindows(
          Object.fromEntries(
            Object.entries(resolveTemplateSettings(settings.data)).filter(
              (entry): entry is [string, number | null] =>
                typeof entry[1] === 'number' || entry[1] === null,
            ),
          ),
        ),
      ),
    );
  }
  if (!enabledLocales.includes(version.defaultLocale)) {
    problems.push({
      pointer: '/default-locale',
      code: 'locale_unsupported',
      detail: 'The default locale must be one of the enabled locales.',
      severity: 'error',
    });
  }
  return problems;
}

/** C154.1: the members a Workflow 9A version serves (`InquiryTemplateVersionRecord.phase9`). */
export function phase9MembersOf(
  version: InquiryTemplateVersion,
  validation: TemplateValidation,
): NonNullable<InquiryTemplateVersionRecord['phase9']> {
  const parsedFlow = safeParseAnyFlow(version.flow);
  return {
    fieldSchemas: storedFieldSchemas(version),
    copy: storedCopy(version),
    enabledLocales: version.enabledLocales,
    defaultLocale: version.defaultLocale,
    themeSetId: version.themeSetId,
    embedOrigins: version.embedOrigins,
    redirectUri: version.redirectUri,
    redirectUriSchemes: version.redirectUriSchemes,
    redirectIncludeStatus: version.redirectIncludeStatus,
    helpUrl: version.helpUrl,
    privacyUrl: version.privacyUrl,
    description: version.description,
    publishNote: version.publishNote,
    lastUpdater: version.lastUpdater,
    validation,
    flowSha256:
      version.flowSha256 ??
      (parsedFlow.success ? flowSha256Of(parsedFlow.data) : sha256(canonicalJson(version.flow))),
    acknowledgements: version.acknowledgements as NonNullable<
      InquiryTemplateVersionRecord['phase9']
    >['acknowledgements'],
  };
}

/** C154.8: the version an `inquiry-template-version.*` event carries: its summary, never its content. */
export function versionEventResourceOf(
  version: InquiryTemplateVersion,
): InquiryTemplateVersionEventResource {
  const parsed = safeParseAnyFlow(version.flow);
  return inquiryTemplateVersionEventResourceSchema.parse({
    type: 'inquiry-template-version',
    id: version.id,
    attributes: {
      'version-number': version.version,
      status: version.status,
      'publish-note': version.publishNote,
      'flow-sha256':
        version.flowSha256 ??
        (parsed.success ? flowSha256Of(parsed.data) : sha256(canonicalJson(version.flow))),
      'spec-version': parsed.success && isFlowV2(parsed.data) ? 2 : 1,
      'created-at': version.createdAt.toISOString(),
      'published-at': version.publishedAt?.toISOString() ?? null,
    },
    relationships: {
      'inquiry-template': { data: { type: 'inquiry-template', id: version.inquiryTemplateId } },
    },
  });
}
