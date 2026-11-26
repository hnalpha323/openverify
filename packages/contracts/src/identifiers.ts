/** Resource linkage (`{ type, id }`) shared by the resource schemas. */
import {
  IMPORTER_LIST_KINDS,
  LIST_KINDS,
  LIST_KIND_REGISTRY,
  toImporterResourceType,
  toListItemResourceType,
  toListResourceType,
  type ImporterResourceType,
  type ListItemResourceType,
  type ListResourceType,
} from '@openverify/core';
import { z } from 'zod';
import { anyIdSchema, idSchema } from './ids.js';
import { resourceIdentifierSchema } from './json-api.js';
import { reportResourceTypeSchema } from './report-types.js';
import { verificationResourceTypeSchema } from './verification-types.js';

export const inquiryIdentifierSchema = resourceIdentifierSchema('inquiry', 'inq');
export const inquiryTemplateIdentifierSchema = resourceIdentifierSchema(
  'inquiry-template',
  'itmpl',
);
export const inquiryTemplateVersionIdentifierSchema = resourceIdentifierSchema(
  'inquiry-template-version',
  'itmplv',
);
export const fileIdentifierSchema = resourceIdentifierSchema('file', 'file');
export const verificationIdentifierSchema = z.strictObject({
  type: verificationResourceTypeSchema,
  id: idSchema('ver'),
});
export const accountIdentifierSchema = resourceIdentifierSchema('account', 'acc');
export const accountTypeIdentifierSchema = resourceIdentifierSchema('account-type', 'acctp');
export const roleIdentifierSchema = resourceIdentifierSchema('role', 'role');

/**
 * Customer-chosen reference such as a user ID (C13): 1 to 255 characters, no control characters.
 * Here rather than in `inquiries.ts` (which re-exports it) so the report contracts, which inquiries
 * include, can use it without an import cycle (Phase 6).
 */
export const referenceIdSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^\P{Cc}+$/u, 'must not contain control characters');

/** C70.2: a report, of any `report/<type>`. */
export const reportIdentifierSchema = z.strictObject({
  type: reportResourceTypeSchema,
  id: idSchema('rep'),
});
export const reportTemplateIdentifierSchema = resourceIdentifierSchema('report-template', 'rptp');
export const reportTemplateVersionIdentifierSchema = resourceIdentifierSchema(
  'report-template-version',
  'rptpv',
);

/** Phase 7 (C91): an inquiry session, the network row of its address, and its device. */
export const inquirySessionIdentifierSchema = resourceIdentifierSchema('inquiry-session', 'iqse');
export const networkIdentifierSchema = resourceIdentifierSchema('network', 'net');
export const deviceIdentifierSchema = resourceIdentifierSchema('device', 'dev');

/** C97.1: the JSON:API types of the lists, items and importers, in `LIST_KINDS` order. */
export const LIST_RESOURCE_TYPES = LIST_KINDS.map(toListResourceType) as [
  ListResourceType,
  ...ListResourceType[],
];
export const LIST_ITEM_RESOURCE_TYPES = LIST_KINDS.map(toListItemResourceType) as [
  ListItemResourceType,
  ...ListItemResourceType[],
];
export const IMPORTER_RESOURCE_TYPES = IMPORTER_LIST_KINDS.map(toImporterResourceType) as [
  ImporterResourceType,
  ...ImporterResourceType[],
];
export const listResourceTypeSchema = z.enum(LIST_RESOURCE_TYPES);
export const listItemResourceTypeSchema = z.enum(LIST_ITEM_RESOURCE_TYPES);
export const importerResourceTypeSchema = z.enum(IMPORTER_RESOURCE_TYPES);

/** C97: a list, of any kind. */
export const listIdentifierSchema = z.strictObject({
  type: listResourceTypeSchema,
  id: idSchema('lst'),
});

/** C97.1: an item, whose id prefix follows its kind. */
export const listItemIdentifierSchema = z
  .strictObject({ type: listItemResourceTypeSchema, id: anyIdSchema })
  .refine(
    ({ type, id }) => {
      const kind = LIST_KINDS.find((name) => toListItemResourceType(name) === type);
      return kind !== undefined && id.startsWith(`${LIST_KIND_REGISTRY[kind].itemPrefix}_`);
    },
    { message: 'the id does not belong to the item type', path: ['id'] },
  );

/** C100.1: an importer, of any kind that has one. */
export const importerIdentifierSchema = z.strictObject({
  type: importerResourceTypeSchema,
  id: idSchema('mprt'),
});

/** C97.2, C121.1: who created an item: a user, an API key, an importer or a workflow run. */
export const listItemCreatorIdentifierSchema = z.union([
  resourceIdentifierSchema('user', 'usr'),
  resourceIdentifierSchema('api-key', 'key'),
  importerIdentifierSchema,
  resourceIdentifierSchema('workflow-run', 'wfr'),
]);
export type ListItemCreator = z.infer<typeof listItemCreatorIdentifierSchema>;

/** C105.7 (Workflow 7B): a transaction. */
export const transactionIdentifierSchema = resourceIdentifierSchema('transaction', 'txn');

/** C129 (Workflow 8B): a case, and a queue, which a case names and (Q) describes. */
export const caseIdentifierSchema = resourceIdentifierSchema('case', 'case');
export const caseQueueIdentifierSchema = resourceIdentifierSchema('case-queue', 'cqueue');
