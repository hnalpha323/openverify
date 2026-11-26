/**
 * Template versions (contract C11): a draft is edited, then published; publishing supersedes
 * the previous published version and makes the new one the template's current version.
 * Inquiries pin the version that was current when they were created.
 */
import {
  reportConfigSchema,
  resolveReportConfig,
  resolvedReportConfigSchema,
  type ReportConfig,
} from './inquiry-report-config.js';
import {
  resolveSignalConfig,
  resolvedSignalConfigSchema,
  signalConfigSchema,
  type SignalConfig,
} from './flow-signals.js';
import { type AnyFlow } from '@openverify/flow-spec';
import { z } from 'zod';
import {
  listConfigSchema,
  resolveListConfig,
  resolvedListConfigSchema,
  type ListConfig,
} from './lists.js';
import { optionalActionBodySchema } from './actions.js';
import { idSchema } from './ids.js';
import { inquiryTemplateIdentifierSchema } from './identifiers.js';
import {
  anyFlowSchema,
  checkFlowMatchesConfig,
  checkFlowPublishable,
  verificationConfigSchema,
  type VerificationConfig,
} from './inquiry-templates.js';
import {
  listDocumentSchema,
  requestDocumentSchema,
  resourceWithRelationshipsSchema,
  singleDocumentSchema,
  timestampSchema,
  toNullableTimestamp,
  toOneRelationshipSchema,
  toTimestamp,
} from './json-api.js';
import { filterListSchema, listQuerySchema } from './list-filters.js';
import {
  resolveTemplateSettings,
  resolvedTemplateSettingsSchema,
  templateSettingsSchema,
  type TemplateSettings,
} from './template-settings.js';
import {
  fieldSchemasSchema,
  lastUpdaterSchema,
  sha256HexSchema,
  templateCopySchema,
  templateLinkSchema,
  templateLocaleSchema,
  templateValidationSchema,
  type FieldSchemas,
  type LastUpdater,
  type TemplateCopy,
  type TemplateLocale,
  type TemplateValidation,
} from './template-fields.js';

export const INQUIRY_TEMPLATE_VERSION_STATUSES = ['draft', 'published', 'superseded'] as const;
export const inquiryTemplateVersionStatusSchema = z.enum(INQUIRY_TEMPLATE_VERSION_STATUSES);
export type InquiryTemplateVersionStatus = z.infer<typeof inquiryTemplateVersionStatusSchema>;

/** A version's content, validated as Phase 1 validates a new template. */
export const inquiryTemplateVersionContentSchema = z
  .strictObject({
    flow: anyFlowSchema,
    'verification-config': verificationConfigSchema,
    settings: templateSettingsSchema,
  })
  .superRefine(checkFlowMatchesConfig)
  .superRefine(checkFlowPublishable);

/**
 * C154.1 (Workflow 9A): the acknowledgement kinds a template publish names, each `<kind>:<target>`
 * (a step id, a copy key or a locale): C150.6 `fallback`, C150.7 `adverse-path` and `heuristic`,
 * C150.10 `asserted-fact`, C151.13 `unverified-path`, C152.2 `egress`, C161.5 `locale-unreviewed`,
 * C162.2 `legal-copy`, C207.9 `client-unable` (Phase 10), and C235.3, C235.8 and C238.10's three
 * Connect kinds (Phase 11). Missing ones answer Phase 8's `publish_acknowledgement_missing`.
 */
export const TEMPLATE_ACKNOWLEDGEMENT_KINDS = [
  'adverse-path',
  'fallback',
  'heuristic',
  'asserted-fact',
  'unverified-path',
  'egress',
  'legal-copy',
  'locale-unreviewed',
  // C207.9 (Workflow 10C; C150.6 and C154.9 amended): `client-unable:<nfc step id>`, without which
  // a client-unable exit always sends the inquiry to review.
  'client-unable',
  // C235.3, C235.8, C238.10 (Phase 11, Workflow 11A): `cloned-results:<verification type>` for each
  // type `accept-cloned-results` lists; `cloned-results-unbound:<verification type>` for a version
  // that relies on clones with no live selfie bound to the cloned portrait (and for `selfie` itself);
  // `share-consent-default-text:<share_consent step id>` for a step showing the built-in texts
  // counsel has not reviewed. Each is audited with the publish.
  'cloned-results',
  'cloned-results-unbound',
  'share-consent-default-text',
] as const;

export const templateAcknowledgementKeySchema = z
  .string()
  .max(240)
  .refine((key) => {
    const separator = key.indexOf(':');
    return (
      separator > 0 &&
      (TEMPLATE_ACKNOWLEDGEMENT_KINDS as readonly string[]).includes(key.slice(0, separator)) &&
      /^[A-Za-z0-9_.-]{1,200}$/.test(key.slice(separator + 1))
    );
  }, 'must be an acknowledgement kind and its target');

/** C154.9: stored on the version with the publisher's id and time (Phase 8 C116.4's form). */
export const templateAcknowledgementSchema = z.strictObject({
  key: templateAcknowledgementKeySchema,
  'acknowledged-by': idSchema('usr'),
  'acknowledged-at': timestampSchema,
});
export type TemplateAcknowledgement = z.infer<typeof templateAcknowledgementSchema>;

/** C158.4: custom redirect schemes, never a denylisted one (`http` and `https` are not custom). */
export const REDIRECT_SCHEME_DENYLIST = [
  'javascript',
  'data',
  'vbscript',
  'file',
  'blob',
  'about',
  'filesystem',
  'intent',
  'http',
  'https',
] as const;
export const redirectSchemeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9+.-]*$/, 'must be a URI scheme')
  .max(64)
  .refine(
    (scheme) => !(REDIRECT_SCHEME_DENYLIST as readonly string[]).includes(scheme),
    'this scheme is refused',
  );

/** A redirect URI: an absolute URI with no userinfo; its origin and scheme are checked by the API. */
export const redirectUriSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.username === '' && url.password === '';
    } catch {
      return false;
    }
  }, 'must be an absolute URI without userinfo');

/**
 * C154.1, C149, C158, C160.7, C162 (Workflow 9A): the members a version gains. Optional in the
 * resource, so versions served before Phase 9 still parse; servers since Workflow 9A send them.
 */
const versionMembers = {
  'field-schemas': fieldSchemasSchema,
  copy: templateCopySchema,
  'enabled-locales': z.array(templateLocaleSchema).min(1).max(5),
  'default-locale': templateLocaleSchema,
  'theme-set-id': idSchema('theset').nullable(),
  /** C158.2: a subset of the environment's `allowed-embed-origins`; empty or absent, all of them. */
  'embed-origins': z.array(z.string().min(1).max(300)).max(50),
  'redirect-uri': redirectUriSchema.nullable(),
  'redirect-uri-schemes': z.array(redirectSchemeSchema).max(10),
  /** C158.5 (P32): `status` is appended to the redirect only when this is true. */
  'redirect-include-status': z.boolean(),
  'help-url': templateLinkSchema.nullable(),
  'privacy-url': templateLinkSchema.nullable(),
  /** C154.1: editable on every version. */
  description: z.string().max(2000).nullable(),
} as const;

export const inquiryTemplateVersionAttributesSchema = z
  .strictObject({
    'version-number': z.int().min(1),
    status: inquiryTemplateVersionStatusSchema,
    flow: anyFlowSchema,
    'verification-config': verificationConfigSchema,
    /** Resolved: the defaults apply to what the version leaves out. */
    settings: resolvedTemplateSettingsSchema,
    /** C84.1: the reports run on completion, resolved; servers since Phase 6 always send it. */
    'report-config': resolvedReportConfigSchema.optional(),
    /** C90.6 (Phase 7): the signals collected and the review rules, resolved. */
    'signal-config': resolvedSignalConfigSchema.optional(),
    /** C99.5 (Workflow 7B): the lists screened at completion and the review rule, resolved. */
    'list-config': resolvedListConfigSchema.optional(),
    'created-at': timestampSchema,
    /** Null while the version is a draft. */
    'published-at': timestampSchema.nullable(),
    // C154.1 (Workflow 9A), each optional in the resource; servers since 9A send them.
    'field-schemas': versionMembers['field-schemas'].optional(),
    copy: versionMembers.copy.optional(),
    'enabled-locales': versionMembers['enabled-locales'].optional(),
    'default-locale': versionMembers['default-locale'].optional(),
    'theme-set-id': versionMembers['theme-set-id'].optional(),
    'embed-origins': versionMembers['embed-origins'].optional(),
    'redirect-uri': versionMembers['redirect-uri'].optional(),
    'redirect-uri-schemes': versionMembers['redirect-uri-schemes'].optional(),
    'redirect-include-status': versionMembers['redirect-include-status'].optional(),
    'help-url': versionMembers['help-url'].optional(),
    'privacy-url': versionMembers['privacy-url'].optional(),
    description: versionMembers.description.optional(),
    /** C154.1 (public): at most 255 characters, locked at publish. */
    'publish-note': z.string().max(255).nullable().optional(),
    'last-updater': lastUpdaterSchema.nullable().optional(),
    /** C154.2 (ours): a draft saved with problems says so; a published version is valid. */
    validation: templateValidationSchema.optional(),
    /** C147.7: the SHA-256 of the RFC 8785 canonical flow without `layout`. */
    'flow-sha256': sha256HexSchema.optional(),
    acknowledgements: z.array(templateAcknowledgementSchema).max(400).optional(),
  })
  .superRefine(checkFlowMatchesConfig)
  .refine(
    (attributes) => (attributes.status === 'draft') === (attributes['published-at'] === null),
    {
      message: 'a version has a publication time exactly when it was published',
      path: ['published-at'],
    },
  );

export const inquiryTemplateVersionResourceSchema = resourceWithRelationshipsSchema(
  'inquiry-template-version',
  'itmplv',
  inquiryTemplateVersionAttributesSchema,
  z.strictObject({ 'inquiry-template': toOneRelationshipSchema(inquiryTemplateIdentifierSchema) }),
);
export type InquiryTemplateVersionResource = z.infer<typeof inquiryTemplateVersionResourceSchema>;

export const inquiryTemplateVersionDocumentSchema = singleDocumentSchema(
  inquiryTemplateVersionResourceSchema,
);
export const inquiryTemplateVersionListDocumentSchema = listDocumentSchema(
  inquiryTemplateVersionResourceSchema,
);

/** The C154.1 members a request may set, each optional. */
function optionalMembers() {
  return {
    'field-schemas': versionMembers['field-schemas'].optional(),
    copy: versionMembers.copy.optional(),
    'enabled-locales': versionMembers['enabled-locales'].optional(),
    'default-locale': versionMembers['default-locale'].optional(),
    'theme-set-id': versionMembers['theme-set-id'].optional(),
    'embed-origins': versionMembers['embed-origins'].optional(),
    'redirect-uri': versionMembers['redirect-uri'].optional(),
    'redirect-uri-schemes': versionMembers['redirect-uri-schemes'].optional(),
    'redirect-include-status': versionMembers['redirect-include-status'].optional(),
    'help-url': versionMembers['help-url'].optional(),
    'privacy-url': versionMembers['privacy-url'].optional(),
    description: versionMembers.description.optional(),
  };
}

/** `POST /api/v1/inquiry-template-versions`: a new draft with `version-number = max + 1`. */
export const createInquiryTemplateVersionBodySchema = requestDocumentSchema(
  'inquiry-template-version',
  z
    .strictObject({
      'inquiry-template-id': idSchema('itmpl'),
      flow: anyFlowSchema,
      'verification-config': verificationConfigSchema,
      settings: templateSettingsSchema.optional(),
      /** C84.1: the reports run on completion. */
      'report-config': reportConfigSchema.optional(),
      /** C90.6 (Phase 7): the signals collected and the review rules. */
      'signal-config': signalConfigSchema.optional(),
      /** C99.5 (Workflow 7B): the lists screened at completion and the review rule. */
      'list-config': listConfigSchema.optional(),
      ...optionalMembers(),
    })
    .superRefine(checkFlowMatchesConfig)
    .superRefine(checkFlowPublishable),
);
export type CreateInquiryTemplateVersionBody = z.infer<
  typeof createInquiryTemplateVersionBodySchema
>;

/**
 * `PATCH /api/v1/inquiry-template-versions/:id` (drafts only). Members replace the stored ones;
 * when both `flow` and `verification-config` are sent they must agree, and the server checks
 * the merged result with `inquiryTemplateVersionContentSchema`.
 */
export const updateInquiryTemplateVersionAttributesSchema = z
  .strictObject({
    flow: anyFlowSchema.optional(),
    'verification-config': verificationConfigSchema.optional(),
    settings: templateSettingsSchema.optional(),
    /** C84.1: replaces the stored report list. */
    'report-config': reportConfigSchema.optional(),
    /** C90.6 (Phase 7): replaces the stored signal configuration. */
    'signal-config': signalConfigSchema.optional(),
    /** C99.5 (Workflow 7B): replaces the stored list configuration. */
    'list-config': listConfigSchema.optional(),
    ...optionalMembers(),
  })
  .refine((attributes) => Object.keys(attributes).length > 0, 'nothing to update')
  .superRefine((attributes, ctx) => {
    const { flow, 'verification-config': verificationConfig } = attributes;
    if (flow !== undefined && verificationConfig !== undefined) {
      checkFlowMatchesConfig({ flow, 'verification-config': verificationConfig }, ctx);
    }
    if (flow !== undefined) {
      checkFlowPublishable({ flow }, ctx);
    }
  });

/**
 * `PATCH /api/v1/inquiry-template-versions/:id`. C154.2 (decision 11): with `meta.allow-invalid:
 * true` (the console always sends it) a draft whose members pass their shape schemas is stored even
 * when it breaks a coherence, graph, field or publish rule, with `validation.status: invalid`;
 * without it the 422 stays. C154.3: `If-Match` (`ifMatchHeadersSchema`) or last-write-wins.
 */
export const updateInquiryTemplateVersionBodySchema = z.strictObject({
  data: z.strictObject({
    type: z.literal('inquiry-template-version').optional(),
    attributes: updateInquiryTemplateVersionAttributesSchema,
  }),
  meta: z.strictObject({ 'allow-invalid': z.boolean().optional() }).optional(),
});
export type UpdateInquiryTemplateVersionBody = z.infer<
  typeof updateInquiryTemplateVersionBodySchema
>;

/**
 * `POST /api/v1/inquiry-template-versions/:id/publish` (scope `inquiry-templates:publish`). C154.9:
 * the acknowledgements a rule asks for, and the note locked with the version (C154.1).
 */
export const publishInquiryTemplateVersionBodySchema = optionalActionBodySchema(
  z.strictObject({
    acknowledgements: z.array(templateAcknowledgementKeySchema).max(400).optional(),
    'publish-note': z.string().max(255).optional(),
  }),
);

/** `GET /api/v1/inquiry-template-versions` query. */
export const listInquiryTemplateVersionsQuerySchema = listQuerySchema('itmplv', {
  'filter[inquiry-template-id]': filterListSchema(idSchema('itmpl')).optional(),
  'filter[status]': filterListSchema(inquiryTemplateVersionStatusSchema).optional(),
});

export interface InquiryTemplateVersionRecord {
  id: string;
  inquiryTemplateId: string;
  versionNumber: number;
  status: InquiryTemplateVersionStatus;
  flow: AnyFlow;
  verificationConfig: VerificationConfig;
  /** As stored; the defaults are applied here. */
  settings: TemplateSettings;
  /** C84.1: as stored; the defaults are applied here. Left out, it is `{}`. */
  reportConfig?: ReportConfig;
  /** C90.6 (Phase 7): as stored; left out (a server before Phase 7), the member is not sent. */
  signalConfig?: SignalConfig;
  /** C99.5 (Workflow 7B): as stored; left out, the member is not sent. */
  listConfig?: ListConfig;
  createdAt: Date;
  publishedAt: Date | null;
  /** C154.1 (Workflow 9A): each left out on a record from before it, so the member is not sent. */
  phase9?: {
    fieldSchemas: FieldSchemas;
    copy: TemplateCopy;
    enabledLocales: readonly TemplateLocale[];
    defaultLocale: TemplateLocale;
    themeSetId: string | null;
    embedOrigins: readonly string[];
    redirectUri: string | null;
    redirectUriSchemes: readonly string[];
    redirectIncludeStatus: boolean;
    helpUrl: string | null;
    privacyUrl: string | null;
    description: string | null;
    publishNote: string | null;
    lastUpdater: LastUpdater | null;
    validation: TemplateValidation;
    flowSha256: string;
    acknowledgements: readonly TemplateAcknowledgement[];
  };
}

/**
 * Builds the template version resource.
 * @throws {z.ZodError} when the record does not satisfy the contract.
 */
export function buildInquiryTemplateVersionResource(
  record: InquiryTemplateVersionRecord,
): InquiryTemplateVersionResource {
  return inquiryTemplateVersionResourceSchema.parse({
    type: 'inquiry-template-version',
    id: record.id,
    attributes: {
      'version-number': record.versionNumber,
      status: record.status,
      flow: record.flow,
      'verification-config': record.verificationConfig,
      settings: resolveTemplateSettings(record.settings),
      'report-config': resolveReportConfig(record.reportConfig ?? {}),
      ...(record.signalConfig === undefined
        ? {}
        : { 'signal-config': resolveSignalConfig(record.signalConfig) }),
      ...(record.listConfig === undefined
        ? {}
        : { 'list-config': resolveListConfig(record.listConfig) }),
      'created-at': toTimestamp(record.createdAt),
      'published-at': toNullableTimestamp(record.publishedAt),
      ...(record.phase9 === undefined
        ? {}
        : {
            'field-schemas': record.phase9.fieldSchemas,
            copy: record.phase9.copy,
            'enabled-locales': record.phase9.enabledLocales,
            'default-locale': record.phase9.defaultLocale,
            'theme-set-id': record.phase9.themeSetId,
            'embed-origins': record.phase9.embedOrigins,
            'redirect-uri': record.phase9.redirectUri,
            'redirect-uri-schemes': record.phase9.redirectUriSchemes,
            'redirect-include-status': record.phase9.redirectIncludeStatus,
            'help-url': record.phase9.helpUrl,
            'privacy-url': record.phase9.privacyUrl,
            description: record.phase9.description,
            'publish-note': record.phase9.publishNote,
            'last-updater': record.phase9.lastUpdater,
            validation: record.phase9.validation,
            'flow-sha256': record.phase9.flowSha256,
            acknowledgements: record.phase9.acknowledgements,
          }),
    },
    relationships: {
      'inquiry-template': { data: { type: 'inquiry-template', id: record.inquiryTemplateId } },
    },
  });
}
