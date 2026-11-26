/**
 * C81.3 (H13): the `business-adverse-media` report job (Workflow 6A Stage 3, owner
 * `api-providers`), behind the frozen `ReportTypeJob` of `jobs/report-types/index.ts`: a business
 * name without its legal form screened against the `adverseMedia` provider's titles
 * (`media-screening.ts`); an article matches only with the whole distinctive phrase plus the
 * country or a second distinctive word.
 */
import type { ReportTypeJob } from './job.js';
import { runMediaScreening } from './media-screening.js';

export const businessAdverseMediaReportJob: ReportTypeJob = {
  type: 'business-adverse-media',
  run: (ctx) => runMediaScreening(ctx, 'business'),
};
