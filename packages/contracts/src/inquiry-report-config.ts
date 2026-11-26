/**
 * The report list of an inquiry template version (plan C84.1): `report-config`, which runs
 * reports when an inquiry completes (C84.2) and can send it to review on a match (`on-report-match`,
 * ours, off by default; C84.3, decision 28). Pinned per version, so an inquiry keeps the list it
 * started with.
 *
 * Stored in `inquiry_template_versions.report_config` (Workflow 6A Stage 1b, which adds the member
 * to the version bodies and resource when it stores the column). The publish rule (each template
 * exists, is active and published) is `services/publish/report-config.ts`, answering 422
 * `report_template_not_published` at {@link reportConfigEntryPointer}.
 */
import { z } from 'zod';
import { idSchema } from './ids.js';

export const INQUIRY_REPORT_CONFIG_LIMITS = Object.freeze({ maxOnCompletion: 10 });

/** C84.3: what a report's match (or error) does to its inquiry. */
export const ON_REPORT_MATCH_ACTIONS = ['none', 'needs_review'] as const;

/** C84.2: where a completion report's query comes from; the inquiry (with its verified data). */
export const INQUIRY_REPORT_QUERY_SOURCES = ['inquiry'] as const;

const entrySchema = z.strictObject({
  'report-template-id': idSchema('rptp'),
  'query-source': z.enum(INQUIRY_REPORT_QUERY_SOURCES).optional(),
});

/** C84.1: the version member as sent; each template at most once. */
export const reportConfigSchema = z
  .strictObject({
    'on-completion': z
      .array(entrySchema)
      .max(INQUIRY_REPORT_CONFIG_LIMITS.maxOnCompletion)
      .optional(),
    'on-report-match': z.enum(ON_REPORT_MATCH_ACTIONS).optional(),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    (config['on-completion'] ?? []).forEach((entry, index) => {
      if (seen.has(entry['report-template-id'])) {
        ctx.addIssue({
          code: 'custom',
          message: 'a report template runs at most once on completion',
          path: ['on-completion', index, 'report-template-id'],
        });
      }
      seen.add(entry['report-template-id']);
    });
  });
export type ReportConfig = z.infer<typeof reportConfigSchema>;

/** C84.1: the member a version serves, with the defaults applied. */
export const resolvedReportConfigSchema = z.strictObject({
  'on-completion': z
    .array(
      z.strictObject({
        ...entrySchema.shape,
        'query-source': z.enum(INQUIRY_REPORT_QUERY_SOURCES),
      }),
    )
    .max(INQUIRY_REPORT_CONFIG_LIMITS.maxOnCompletion),
  'on-report-match': z.enum(ON_REPORT_MATCH_ACTIONS),
});
export type ResolvedReportConfig = z.infer<typeof resolvedReportConfigSchema>;

/** C84.1: nothing runs on completion and nothing changes the inquiry (C69.4). */
export const INQUIRY_REPORT_CONFIG_DEFAULTS: ResolvedReportConfig = Object.freeze({
  'on-completion': [],
  'on-report-match': 'none',
});

/** The stored member with the defaults applied. */
export function resolveReportConfig(config: ReportConfig): ResolvedReportConfig {
  return {
    'on-completion': (config['on-completion'] ?? []).map((entry) => ({
      'report-template-id': entry['report-template-id'],
      'query-source': entry['query-source'] ?? 'inquiry',
    })),
    'on-report-match':
      config['on-report-match'] ?? INQUIRY_REPORT_CONFIG_DEFAULTS['on-report-match'],
  };
}

/** The JSON Pointer of an `on-completion` entry the publish rule refuses (C84.1, F07). */
export function reportConfigEntryPointer(index: number): string {
  return `/data/attributes/report-config/on-completion/${String(index)}`;
}
