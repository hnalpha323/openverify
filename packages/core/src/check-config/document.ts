/**
 * Document and proof-of-address check config (C51.3, C60). Owned by the 5B document checks
 * agent once Workflow 5B starts; amendments to these keys are recorded in the plan.
 */
import { z } from 'zod';
import {
  defaultsTable,
  distinctList,
  graceDaysSchema,
  provisionalDefault,
  unitInterval,
} from './basis.js';
import { minMatchLevelSchema } from './match-groups.js';

/** What `document_extracted_properties_detection` can require (C51.3). */
export const DOCUMENT_PROPERTIES = ['name', 'address', 'issue-date', 'issuer'] as const;

export const documentTypeDetectionConfigSchema = z.strictObject({
  /** The top class probability below which the class is `unknown` (C60.5). */
  'min-confidence': unitInterval.optional(),
});

export const documentExtractedPropertiesDetectionConfigSchema = z.strictObject({
  'required-properties': distinctList(z.enum(DOCUMENT_PROPERTIES)).optional(),
});

export const documentExpiredDetectionConfigSchema = z.strictObject({
  /** Days after the printed expiry or lease end during which the document still passes. */
  'grace-days': graceDaysSchema.optional(),
});

export const documentRecencyDetectionConfigSchema = z.strictObject({
  /** Oldest accepted issue date, in days, for every class but `lease` and `tax_document` (C60.6). */
  'max-age-days': z.int().min(1).max(3650).optional(),
});

export const documentFabricationDetectionConfigSchema = z.strictObject({
  /** The fabrication score above which the check fails (C60.6). */
  'max-fabrication-score': unitInterval.optional(),
});

export const documentNameComparisonConfigSchema = z.strictObject({
  'min-match-level': minMatchLevelSchema.optional(),
});

export const documentAddressComparisonConfigSchema = z.strictObject({
  'min-match-level': minMatchLevelSchema.optional(),
});

const OURS_MATCH =
  'ours: a partial match (nickname, initial, one fuzzy token) passes; no external basis';

/** C51.3: the document check defaults. */
export const DOCUMENT_CHECK_CONFIG_DEFAULTS = defaultsTable({
  document_type_detection: {
    'min-confidence': provisionalDefault(
      0.5,
      'ours: the C60.5 classifier is uncalibrated, so half the top probability; not fitted to the generated set (H23)',
    ),
  },
  document_extracted_properties_detection: {
    'required-properties': provisionalDefault(
      ['name', 'address', 'issue-date'],
      'the public proof-of-address default: name and address extractions marked required (docs/research/phase5-behaviour.md §4.3), plus the issue date recency needs',
    ),
  },
  document_expired_detection: {
    'grace-days': provisionalDefault(0, 'ours: as id_expired_detection (C29.5), no grace'),
  },
  document_recency_detection: {
    'max-age-days': provisionalDefault(
      90,
      'the public default of 90 days; 365 is advised for business papers (docs/research/phase5-behaviour.md §4.5, D4)',
    ),
  },
  document_fabrication_detection: {
    'max-fabrication-score': provisionalDefault(
      0.5,
      'ours: the midpoint of the 0-1 score; weak cues are capped at 0.45 in total, so only a medium or strong cue can fail (C60.6)',
    ),
  },
  document_name_comparison: { 'min-match-level': provisionalDefault('partial', OURS_MATCH) },
  document_address_comparison: { 'min-match-level': provisionalDefault('partial', OURS_MATCH) },
});
