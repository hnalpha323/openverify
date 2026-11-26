/**
 * The report documents the console reads (C72.3), as the contracts parse them, in a module client
 * components may import (no server-only imports).
 */
import type {
  dashboardReportDocumentSchema,
  dashboardReportListDocumentSchema,
} from '@openverify/contracts';
import type { z } from 'zod';

/** `GET /dashboard/reports/:id`: the report, with its runs and actions in `included`. */
export type DashboardReportDocument = z.infer<typeof dashboardReportDocumentSchema>;
/** `GET /dashboard/reports`. */
export type DashboardReportListDocument = z.infer<typeof dashboardReportListDocumentSchema>;
/** One report of any type. */
export type Report = DashboardReportDocument['data'];
/** One run or action of a report's history. */
export type ReportHistoryEntry = NonNullable<DashboardReportDocument['included']>[number];
