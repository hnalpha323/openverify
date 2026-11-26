/**
 * `dashboard-analytics`' console strings (C155.9, decision 33): the Analytics section (C164.9),
 * saved views (C165), exports and bulk reports (C166), in English, so translating the console later
 * is a data change. A `{name}` is filled by `fillCopy`; every other word is literal. The metric
 * definitions are not here: they are `ANALYTICS_METRICS`' own words (`@openverify/core`), shown as
 * they are, so the console, the API docs and `docs/analytics/README.md` say the same thing.
 */
import { defineCopy } from './catalog';

export const ANALYTICS_COPY = defineCopy({
  section: {
    title: 'Analytics',
    description:
      'Counts of this environment only, after small-count suppression. Each view states what it counts, over what, in which time zone and how fresh it is.',
    tabsLabel: 'Analytics views',
  },
  views: {
    overview: { label: 'Overview', title: 'Inquiries' },
    funnel: { label: 'Funnel', title: 'Funnel' },
    verifications: { label: 'Verifications', title: 'Verifications' },
    checks: { label: 'Checks', title: 'Checks' },
    cases: { label: 'Cases', title: 'Cases' },
    signals: { label: 'Signals', title: 'Signals' },
  },
  filters: {
    formLabel: 'Filter the analytics',
    from: 'From (local date)',
    to: 'To (local date)',
    bucket: 'Group by',
    template: 'Template ID',
    version: 'Template version ID',
    platform: 'Platform',
    device: 'Device kind',
    tag: 'Tag',
    caseTemplate: 'Case template ID',
    any: 'Any',
    apply: 'Apply',
    reset: 'Reset to the last 30 days',
    windowHint: 'Whole local days in the reporting time zone, both included, at most {days} days.',
    notTaken: 'Not applied: this view does not take {names}.',
    refusedDevice:
      'This view cannot filter by platform or device kind: its counts do not record them.',
    checkFilters: 'Check the filters',
    checkFiltersBody: 'Some values cannot be used. Correct them to see the figures.',
  },
  buckets: { day: 'Day', week: 'Week (from Monday)', month: 'Month' },
  errors: {
    date: 'Enter a date as YYYY-MM-DD.',
    order: 'The end must not be before the start.',
    range: 'The window is at most {days} days.',
    template: 'Enter a template ID: itmpl_ followed by 26 letters and digits.',
    version: 'Enter a version ID: itmplv_ followed by 26 letters and digits.',
    caseTemplate: 'Enter a case template ID: ctmpl_ followed by 26 letters and digits.',
    tag: 'Enter one tag as the inquiry list shows it.',
    choice: 'Choose a value from the list.',
  },
  download: {
    button: 'Download this view as CSV',
    description:
      'The tables of this view as shown here, small and hidden counts as their marks, with what the figures mean first. Made in your browser; nothing is read again.',
    title: 'OpenVerify analytics: {view}',
    definition: 'Definition',
    leftOut: 'Left out',
    leftOutReason: 'It names people, so it is not in the download.',
  },
  about: {
    heading: 'About these figures',
    zone: 'Time zone: {zone}. Days are local days in it.',
    mixedZones:
      'This range mixes time zones ({zones}): the reporting zone changed, and days built before the change keep the zone they were counted in.',
    window: 'Window: {from} to {to}, both included.',
    rolledUp: 'Counted up to {time} UTC.',
    notRolledUp: 'Not counted yet: the first count runs within 5 minutes of activity.',
    outcomes: 'Outcomes of open days as of {time} UTC (refreshed once a local day).',
    outcomesNever: 'Outcomes of open days not refreshed yet.',
    live: 'Today ({day}) is live: it shows created and started only, never an outcome, until it closes.',
    settle:
      'A day is recounted for {days} days after it, then frozen: a decision made later does not change its day.',
    threshold:
      'Counts from 1 to {max} show as "fewer than {threshold}", and some other cells are hidden so a hidden one cannot be worked out by subtraction ({hidden} hidden in this answer).',
    limits:
      'Suppression does not stop someone comparing two overlapping windows, a filtered answer with an unfiltered one, or one day read on two different days; nor someone who can also list inquiries, or who adds outside knowledge. A hidden cell is still at least 1, and a cell hidden to protect another is at least {threshold}.',
    settled:
      'Created equals started plus expired before start, and started equals finished plus expired after start, only once every started inquiry has finished or expired.',
    definitions: 'Definitions',
  },
  cells: {
    fewerThan: 'fewer than {threshold}',
    hidden: 'hidden',
    under: 'under {value}%',
    over: 'over {value}%',
    rateHidden: 'not shown (too few)',
    durationHidden: 'not shown (too few)',
    durationNone: 'none counted',
    duration: 'between {bounds} (approximate)',
    notCounted: 'not counted',
    notLive: 'not shown live',
    notDefined: 'not defined',
    rateTerms: '{numerator} over {denominator}, counted in {unit}',
    notRun: 'not run',
    noStepData: 'no step data',
    live: 'live',
    notEvaluated: 'not evaluated',
  },
  tables: {
    period: 'Period',
    metric: 'Figure',
    value: 'Value',
    meaning: 'What it counts',
    byPeriod: '{name} by {bucket}',
    totals: '{name} over the window',
    liveMark: '(live)',
    zoneMark: 'counted in {zone}',
  },
  chart: {
    tableFirst: 'Table',
    chartToggle: 'Chart',
    viewsLabel: 'Show as',
    seriesLabel: '{name} by {bucket}',
    suppressedMark: 'Hatched: hidden or fewer than {threshold}',
    noData: 'Nothing to draw: every figure in this range is zero or hidden.',
    legendNote:
      'The table holds every figure of the chart. A hatched mark is a hidden cell: fewer than the threshold, or hidden so another cannot be worked out.',
  },
  overview: {
    countsTitle: 'Inquiries by outcome',
    ratesTitle: 'Rates',
    successSplit:
      'Success is split three ways: completed with every verification on the path passed, through a fallback, and with no verification.',
    tagOnly: 'With a tag filter only created, started, finished and completed are counted.',
  },
  funnel: {
    noStepDataYet:
      'No step data yet: the server has not recorded a step in this environment. Earlier days show "no step data", never 0.',
    stepDataFrom: 'Step data from {day}; earlier days show "no step data".',
    versionTitle: 'Version {id}',
    paths: 'Most frequent paths',
    transitions: 'Transitions',
    entryShare: 'Its overall share stands for the entry step: no transition leads into it.',
  },
  verifications: {
    perAttempt: 'Pass rate per attempt',
    perPerson: 'Pass rate per person and step',
    captureClientReported: 'Capture method as the client reported it',
    captureUnknown: 'not reported',
    countryUnknown: 'unknown',
  },
  checks: {
    beta: 'beta',
    notRunBody: 'No result in this window.',
    reasons: 'Reasons',
  },
  cases: {
    assignees: 'Cases per reviewer',
    assigneesHidden:
      'Cases per reviewer are shown only to readers who also hold users:write: reviewers are people too.',
    formerUser: 'Former user',
    noAvailability: 'No availability figures are counted.',
  },
  signals: {
    notEvaluated:
      'An inquiry whose signal was never computed counts as "not evaluated", never in a bin.',
  },
  exports: {
    title: 'Exports',
    description:
      'Only you can see and download your exports. Each file is kept 24 hours after it is written, then deleted; every export and download is recorded in the audit log.',
    newTitle: 'New export',
    listTitle: 'Your exports',
    empty: 'No exports yet.',
    noPermission:
      'Exporting needs one of these permissions, one for each kind of record: {permissions}.',
    redactionNote:
      'An export cut before a person was redacted keeps their data until the file is deleted, at most 24 hours later.',
    tooLarge:
      'An export of more than {rows} rows is refused, never cut short: narrow the filter and ask again.',
  },
  bulk: {
    title: 'Bulk reports',
    description:
      'Create up to 1,000 reports from one CSV file of at most 2 MiB: one report per row, each with its outcome.',
    noPermission: 'Creating reports in bulk needs reports:write.',
    formLabel: 'Upload a bulk report file',
    template: 'Report template',
    templateId: 'Report template ID',
    templateIdHint:
      'You cannot read the report templates, so enter the ID of an active report template (rptp_…), as the template’s page shows it.',
    templateIdInvalid:
      'Enter a report template ID: rptp_ and 26 letters and digits, as the template’s page shows it.',
    file: 'CSV file',
    fileHint:
      'The header names the template’s query fields, and may add account-id and inquiry-id to link each report; separate the members of a list with |. At most 1,000 rows and 2 MiB.',
    noTemplates: 'No active report template: create one before uploading.',
    upload: 'Upload and create the reports',
    uploading: 'Uploading…',
    jobTitle: 'Job {id}',
    jobPending: 'The job is waiting or running: reload the page to see the rows done so far.',
    jobSummary: '{created} created, {failed} failed, of {rows} rows.',
    jobRefused: 'The whole file was refused: {code}',
    rows: 'Rows and their outcomes',
    created: 'Created',
    failed: 'Failed',
    personalData:
      'The file holds the personal data of the people the reports search for. It is kept encrypted only while the job runs, and deleted when it ends or after 24 hours.',
    answers: {
      accepted: 'The file was accepted: its reports are being created.',
      unreadable: 'The upload could not be read: choose the file again.',
      signedOut: 'Your session ended: sign in again to upload.',
      forbidden:
        'Your role cannot create these reports: it needs reports:write, and accounts:read or inquiries:write for a link column.',
      notFound: 'This report template was not found.',
      tooLarge: 'The file is larger than 2 MiB.',
      notCsv: 'Only a CSV file is accepted.',
      refused: 'The file was refused: check its header and rows.',
      tooMany: 'Too many uploads: five an hour per environment. Try again later.',
      failed: 'The upload failed: try again.',
      notPublished: 'This report template has no published version yet.',
      otherOrigin: 'The upload must come from this dashboard.',
      notForm: 'The upload must be a form with one file.',
    },
  },
  savedViews: {
    title: 'Saved views',
    none: 'No saved views of this list yet.',
    saveTitle: 'Save these filters as a view',
    name: 'Name',
    share: 'Share with everyone in this environment who can read this list',
    save: 'Save view',
    saved: 'Saved the view.',
    apply: 'Apply',
    yours: 'yours',
    sharedYours: 'yours, shared',
    sharedOther: 'shared by another user',
    rename: 'Rename',
    shareOn: 'Share',
    shareOff: 'Stop sharing',
    delete: 'Delete',
    copy: 'Copy to change',
    copied: 'Copied the view: change your copy.',
    exportView: 'Export its rows',
    invalid:
      'Its filters are no longer accepted by this list ({keys}), so it is not applied: the list would otherwise be wider than the view.',
    dropped:
      'This page cannot show its filters {keys}, so it is not applied: the list would otherwise be wider than the view.',
    notKept: 'Not kept in a view: {params}.',
    noFilters: 'No filter is set: a view of the whole list.',
    piiTitle: 'A saved view never holds personal data',
    piiDetail:
      'Remove the filters {keys} first: they can name a person, so a view cannot keep them.',
    gone: 'This view no longer exists.',
    loadFailed: 'Saved views could not be loaded.',
    eachReader: 'A shared view shows each reader only what their own role and masking allow.',
  },
});

/** `template` with each `{name}` replaced by `values[name]`; an unknown name stays as written. */
export function fillCopy(template: string, values: Readonly<Record<string, string | number>>) {
  return template.replace(/\{([a-z-]+)\}/gi, (whole, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : whole,
  );
}
