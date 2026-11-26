/**
 * C156 (Workflow 9C, `dashboard-preview`): the preview and simulate answers' types, in a module
 * client components may import (no server-only code).
 */
import type {
  templatePreviewDocumentSchema,
  templateSimulationDocumentSchema,
} from '@openverify/contracts';
import type { z } from 'zod';

export type TemplatePreviewDocument = z.output<typeof templatePreviewDocumentSchema>;
export type TemplateSimulationDocument = z.output<typeof templateSimulationDocumentSchema>;
