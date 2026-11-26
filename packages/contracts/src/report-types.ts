/**
 * Report types as the API names them (plan C69.1, C70): `report/<type>`, the JSON:API type of a
 * report. The types themselves live in `@openverify/core` (`REPORT_TYPES`, `REPORT_REGISTRY`).
 */
import { z } from 'zod';

export {
  REPORT_REGISTRY,
  REPORT_TYPES,
  fromReportResourceType,
  getReportTypeDefinition,
  isReportType,
  reportTypeSchema,
  toReportResourceType,
  type ReportResourceType,
  type ReportType,
  type ReportTypeDefinition,
} from '@openverify/core';

/** C70: the JSON:API types of reports, in `REPORT_TYPES` order. */
export const REPORT_RESOURCE_TYPES = [
  'report/watchlist',
  'report/business-watchlist',
  'report/crypto-address-watchlist',
  'report/politically-exposed-person',
  'report/adverse-media',
  'report/business-adverse-media',
  'report/email-address',
  'report/phone-number',
  'report/address-lookup',
  'report/ip-address',
  'report/custom-list',
] as const;
export const reportResourceTypeSchema = z.enum(REPORT_RESOURCE_TYPES);
