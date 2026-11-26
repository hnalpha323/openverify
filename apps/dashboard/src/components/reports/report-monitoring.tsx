/**
 * A report's monitoring (C74.5, C86), for the types that recur: whether it recurs, is paused (by
 * an operator, or on a match) or runs only when asked, its next run, and Pause (a recurring
 * report), Resume (a paused one) and Run now (also while paused), each only for an operator with
 * `reports:write` on a report that is not redacted. The API checks each again (409
 * `report_no_scheduled_run`, said in words).
 */
import { REPORT_REGISTRY } from '@openverify/core';
import type { ActionResult, ActionState } from '../../lib/action-state';
import type { Report } from '../../lib/report-documents';
import { Detail } from '../detail';
import { InstantActionButton } from '../integrations/instant-action-button';
import { PageSection } from '../lifecycle/page-section';
import { TimeOrNone } from './report-parts';
import { typeOf } from './report-summary';

type Action = (state: ActionState, formData: FormData) => Promise<ActionResult>;

export interface ReportMonitoringProps {
  readonly report: Report;
  /** `reports:write`, on a report that is not redacted. */
  readonly canAct: boolean;
  readonly pause: Action;
  readonly resume: Action;
  readonly run: Action;
}

function stateText(attributes: Report['attributes']): string {
  if (attributes['paused-at'] !== null) {
    switch (attributes['paused-reason']) {
      case 'match':
        return 'Paused on a match: it resumes once every open match is reviewed.';
      case 'operator':
        return 'Paused by an operator: nothing runs on schedule until it resumes.';
      default:
        return 'Paused.';
    }
  }
  return attributes['is-recurring']
    ? 'Recurring: the next run is scheduled.'
    : 'Not recurring: it runs only when asked.';
}

function runsText(attributes: Report['attributes']): string {
  if (attributes['is-continuous']) {
    return 'More than one';
  }
  return attributes['completed-at'] === null ? 'None yet' : 'One';
}

/** The "Monitoring" section of a report whose type recurs. */
export function ReportMonitoring({ report, canAct, pause, resume, run }: ReportMonitoringProps) {
  if (!REPORT_REGISTRY[typeOf(report)].recurrable) {
    return null;
  }
  const { attributes } = report;
  const fields = { 'report-id': report.id };
  return (
    <PageSection
      id="report-monitoring"
      title="Monitoring"
      description="A recurring report runs again on its schedule, and after a list update that may match it."
    >
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Detail term="Monitoring">{stateText(attributes)}</Detail>
        <Detail term="Next run (UTC)">
          <TimeOrNone value={attributes['next-run-at']} />
        </Detail>
        <Detail term="Paused (UTC)">
          <TimeOrNone value={attributes['paused-at']} />
        </Detail>
        <Detail term="Runs so far">{runsText(attributes)}</Detail>
      </dl>
      {canAct && (
        <div className="flex flex-wrap items-start gap-3">
          {attributes['is-recurring'] && (
            <InstantActionButton
              label="Pause"
              pendingLabel="Pausing…"
              action={pause}
              fields={fields}
              successMessage="Monitoring paused."
            />
          )}
          {attributes['paused-at'] !== null && (
            <InstantActionButton
              label="Resume"
              pendingLabel="Resuming…"
              action={resume}
              fields={fields}
              successMessage="Monitoring resumed."
            />
          )}
          <InstantActionButton
            label="Run now"
            pendingLabel="Requesting…"
            action={run}
            fields={fields}
            successMessage="A run was requested."
          />
        </div>
      )}
    </PageSection>
  );
}
