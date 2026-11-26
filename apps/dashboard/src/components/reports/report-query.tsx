/**
 * A report's query (C70.2, C70.3, C84.2, C86): each member with where it came from, exactly as
 * the API served it: masked member by member without `pii:view` ("Hidden"), `null` once redacted
 * ("Redacted"). The console never unmasks.
 */
import { REPORT_QUERY_FIELDS } from '@openverify/contracts';
import type { Report } from '../../lib/report-documents';
import { queryFieldLabel } from '../../lib/report-query-words';
import { REPORT_QUERY_SOURCE_LABELS } from '../../lib/report-words';
import { Detail } from '../detail';
import { PageSection } from '../lifecycle/page-section';
import { RedactedValue } from '../lifecycle/redacted-value';
import { PersonalValue, type PiiState } from './report-parts';
import { typeOf } from './report-summary';

type QueryValue =
  string | readonly Readonly<Record<string, string | undefined>>[] | null | undefined;

/** An additional name as one line ("Ava Quill"). */
function nameText(name: Readonly<Record<string, string | undefined>>): string {
  return ['name-first', 'name-middle', 'name-last', 'term']
    .map((part) => name[part])
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' ');
}

function QueryValueOf({ value, state }: { readonly value: QueryValue; readonly state: PiiState }) {
  if (Array.isArray(value)) {
    const names = value as readonly Readonly<Record<string, string | undefined>>[];
    return (
      <ul className="flex flex-col gap-0.5">
        {names.map((name, index) => (
          <li key={index}>{nameText(name)}</li>
        ))}
      </ul>
    );
  }
  return <PersonalValue value={value as string | null | undefined} state={state} />;
}

/** The "Query" section of a report. */
export function ReportQuery({
  report,
  state,
}: {
  readonly report: Report;
  readonly state: PiiState;
}) {
  const type = typeOf(report);
  const query = report.attributes.query as Readonly<Record<string, QueryValue>> | null;
  const sources = report.attributes['query-sources'];
  const order = REPORT_QUERY_FIELDS[type];
  const members =
    query === null
      ? []
      : Object.keys(query).sort(
          (a, b) =>
            (order.includes(a) ? order.indexOf(a) : order.length) -
            (order.includes(b) ? order.indexOf(b) : order.length),
        );
  return (
    <PageSection
      id="report-query"
      title="Query"
      description="What was screened, and where each value came from."
    >
      {query === null ? (
        <p>
          <RedactedValue />
        </p>
      ) : (
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {members.map((member) => {
            const source = sources[member];
            return (
              <Detail key={member} term={queryFieldLabel(type, member) ?? member}>
                <QueryValueOf value={query[member]} state={state} />
                {source !== undefined && (
                  <span className="block text-xs text-ink-muted">
                    {REPORT_QUERY_SOURCE_LABELS[source]}
                  </span>
                )}
              </Detail>
            );
          })}
        </dl>
      )}
    </PageSection>
  );
}
