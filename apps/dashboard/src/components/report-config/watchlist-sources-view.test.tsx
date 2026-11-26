import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  KEYS_VERSION,
  MEDIA_ATTRIBUTION,
  RECENT_SYNCS,
  REPORT_CONFIG_IDS as IDS,
  SOURCE_STATES,
  syntheticSha256,
  watchlistSources,
  type SourcesOptions,
} from '../../testing/report-config-fixtures';
import { WatchlistSourcesView } from './watchlist-sources-view';

function show(
  options: SourcesOptions = {},
  canReadTemplates = true,
  environmentKind: 'sandbox' | 'production' = 'sandbox',
) {
  render(
    <WatchlistSourcesView
      sources={watchlistSources(options)}
      canReadTemplates={canReadTemplates}
      environmentKind={environmentKind}
    />,
  );
}

const region = (name: string) => screen.getByRole('region', { name });

/** The row of `table` whose row header holds `name`. */
function rowOf(table: HTMLElement, name: string | RegExp): HTMLElement {
  const header = within(table).getByRole('rowheader', { name });
  const row = header.closest('tr');
  if (row === null) {
    throw new Error(`no row for ${String(name)}`);
  }
  return row;
}

/** The cell of `row` under the column headed `column` of `table`. */
function cellOf(table: HTMLElement, row: HTMLElement, column: string): HTMLElement {
  const headers = within(table)
    .getAllByRole('columnheader')
    .map((header) => header.textContent);
  const index = headers.indexOf(column);
  const cell = row.querySelectorAll('th, td')[index];
  if (!(cell instanceof HTMLElement)) {
    throw new Error(`no ${column} cell`);
  }
  return cell;
}

describe('WatchlistSourcesView (C72.3, C76, C86)', () => {
  it('has one region per part, each named by its heading, and no control', () => {
    show();

    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([
      'Summary',
      'Sources',
      'Last applied sync per source',
      'Templates to review',
      'Adverse media budget',
      'Recent syncs',
      'Attribution',
    ]);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('sums up what is enabled, what screens now and what needs attention', () => {
    show();

    const summary = region('Summary');
    expect(within(summary).getByText('Enabled sources').nextSibling).toHaveTextContent('6 of 7');
    expect(within(summary).getByText('Screenable now').nextSibling).toHaveTextContent('2');
    expect(within(summary).getByText('Need attention').nextSibling).toHaveTextContent('4');
    expect(within(summary).getByText('Re-screens pending').nextSibling).toHaveTextContent('1');
    expect(summary).toHaveTextContent('errors (not screened) instead of answering no match');
  });

  it('in a production environment, counts no sandbox list as screenable and says it is not screened there', () => {
    show({}, true, 'production');

    const summary = region('Summary');
    expect(within(summary).getByText('Screenable now').nextSibling).toHaveTextContent('1');
    const table = screen.getByRole('table', { name: 'Watchlist sources' });
    expect(rowOf(table, /openverify-sandbox/)).toHaveTextContent('Sandbox list, not screened here');
  });

  it('shows each source with its kind, whether it is enabled, its state in words and its last error', () => {
    show();

    const table = screen.getByRole('table', { name: 'Watchlist sources' });
    const fresh = rowOf(table, /ofac-sdn/);
    expect(cellOf(table, fresh, 'Source')).toHaveTextContent('US Treasury OFAC');
    expect(cellOf(table, fresh, 'Kind')).toHaveTextContent('Sanctions');
    expect(within(cellOf(table, fresh, 'Enabled')).getByText('Enabled')).toHaveAttribute(
      'data-status',
      'enabled',
    );
    expect(within(cellOf(table, fresh, 'State')).getByText('Fresh')).toBeVisible();
    expect(cellOf(table, fresh, 'Entries')).toHaveTextContent('120 entries, 340 names');
    expect(cellOf(table, fresh, 'Last error')).toHaveTextContent('None');

    const stale = rowOf(table, /ofac-consolidated/);
    expect(within(cellOf(table, stale, 'State')).getByText('Stale')).toBeVisible();
    expect(cellOf(table, stale, 'State')).toHaveTextContent('list_stale');
    expect(cellOf(table, stale, 'Last error')).toHaveTextContent('The download failed');

    const eu = rowOf(table, /eu-fsf/);
    expect(within(cellOf(table, eu, 'State')).getByText('Not configured')).toBeVisible();
    expect(cellOf(table, eu, 'Last check (UTC)')).toHaveTextContent('Never');

    const uk = rowOf(table, /uk-sanctions-list/);
    expect(within(cellOf(table, uk, 'State')).getByText('Needs re-key')).toBeVisible();
    expect(within(cellOf(table, uk, 'State')).getByText('Re-screen pending')).toBeVisible();

    const un = rowOf(table, /un-sc/);
    expect(within(cellOf(table, un, 'Enabled')).getByText('Disabled')).toBeVisible();

    expect(
      within(cellOf(table, rowOf(table, /wikidata-pep/), 'State')).getByText('Never checked'),
    ).toBeVisible();
    expect(cellOf(table, rowOf(table, /wikidata-pep/), 'Kind')).toHaveTextContent(
      'Politically exposed persons',
    );
  });

  it('says the API has no variant groups instead of asking for a re-key, and that it cannot say what screens now (owner decision 17)', () => {
    show({ matcher: { loaded: false, 'keys-version': null } });

    const table = screen.getByRole('table', { name: 'Watchlist sources' });
    expect(within(table).queryByText('Needs re-key')).toBeNull();
    expect(
      within(cellOf(table, rowOf(table, /uk-sanctions-list/), 'State')).getByText(
        'The API has no variant groups',
      ),
    ).toBeVisible();
    expect(
      within(cellOf(table, rowOf(table, /ofac-sdn/), 'State')).getByText(
        'The API has no variant groups',
      ),
    ).toBeVisible();
    const summary = region('Summary');
    expect(within(summary).getByText('Matcher data').nextSibling).toHaveTextContent(
      'The API has no variant groups',
    );
    expect(within(summary).getByText('Screenable now').nextSibling).toHaveTextContent('Not known');
  });

  it('gives the API’s matcher keys version when it holds the variant groups (owner decision 17)', () => {
    show();

    const summary = region('Summary');
    expect(within(summary).getByText('Matcher data').nextSibling).toHaveTextContent(KEYS_VERSION);
  });

  it('never counts a source keyed by another matcher version as screenable, a sandbox list included', () => {
    show({ sources: [{ ...SOURCE_STATES.sandbox, 'keys-current': false }] });

    const summary = region('Summary');
    expect(within(summary).getByText('Screenable now').nextSibling).toHaveTextContent('0');
    expect(within(summary).getByText('Need attention').nextSibling).toHaveTextContent('1');
  });

  it('labels a sandbox list as sandbox and never stale, even when the flag says stale (V03)', () => {
    show({ sources: [{ ...SOURCE_STATES.sandbox, stale: true }] });

    const table = screen.getByRole('table', { name: 'Watchlist sources' });
    const sandbox = rowOf(table, /openverify-sandbox/);
    expect(within(cellOf(table, sandbox, 'Source')).getByText('Sandbox list')).toBeVisible();
    expect(cellOf(table, sandbox, 'State')).toHaveTextContent('Sandbox list, never stale');
    expect(within(table).queryByText('Stale')).toBeNull();
  });

  it('gives the provenance of each last applied sync: id, times, origin, SHA-256 and any override', () => {
    show();

    const table = screen.getByRole('table', { name: 'Last applied sync per source' });
    const sdn = rowOf(table, /ofac-sdn/);
    expect(cellOf(table, sdn, 'Sync')).toHaveTextContent('41');
    expect(cellOf(table, sdn, 'Origin')).toHaveTextContent('Publisher');
    expect(cellOf(table, sdn, 'SHA-256')).toHaveTextContent(syntheticSha256('ofac-sdn'));
    expect(cellOf(table, sdn, 'Override')).toHaveTextContent('None');

    const uk = rowOf(table, /uk-sanctions-list/);
    expect(cellOf(table, uk, 'Origin')).toHaveTextContent('Import');
    expect(cellOf(table, uk, 'Origin')).toHaveTextContent('never cited as the publisher');
    expect(cellOf(table, uk, 'Override')).toHaveTextContent('--accept-older-publication');

    const eu = rowOf(table, /eu-fsf/);
    expect(cellOf(table, eu, 'Sync')).toHaveTextContent('Never applied');
    expect(cellOf(table, eu, 'SHA-256')).toHaveTextContent('None');
  });

  it('names the templates whose pinned lists differ, linking them for a reader of templates (C76.4)', () => {
    show();

    const table = screen.getByRole('table', {
      name: 'Templates whose pinned lists differ from the enabled sources',
    });
    const row = rowOf(table, /Synthetic sanctions screening/);
    expect(
      within(row).getByRole('link', { name: 'Synthetic sanctions screening' }),
    ).toHaveAttribute('href', `/report-templates/${IDS.template}`);
    expect(cellOf(table, row, 'Pins disabled sources')).toHaveTextContent('un-sc');
    expect(cellOf(table, row, 'Leaves out enabled sources')).toHaveTextContent(
      'eu-fsf, ofac-consolidated',
    );
    expect(region('Templates to review')).toHaveTextContent('error list_unavailable');
  });

  it('names the templates without a link for a principal that cannot read templates', () => {
    show({}, false);

    const table = screen.getByRole('table', {
      name: 'Templates whose pinned lists differ from the enabled sources',
    });
    expect(within(table).queryByRole('link')).toBeNull();
    expect(within(table).getByText('Synthetic sanctions screening')).toBeVisible();
    expect(within(table).getByText(IDS.template)).toBeVisible();
  });

  it('names each warned template and its report type, as the API serves them (owner decision 17)', () => {
    show({
      templateWarnings: [
        {
          'report-template-id': IDS.template,
          name: 'Synthetic sanctions screening',
          'report-type': 'watchlist',
          'disabled-sources': ['un-sc'],
          'omitted-sources': [],
        },
        {
          'report-template-id': IDS.otherTemplate,
          name: 'Synthetic company screening',
          'report-type': 'business-watchlist',
          'disabled-sources': [],
          'omitted-sources': ['eu-fsf'],
        },
      ],
    });

    const table = screen.getByRole('table', {
      name: 'Templates whose pinned lists differ from the enabled sources',
    });
    const person = rowOf(table, /Synthetic sanctions screening/);
    expect(cellOf(table, person, 'Template')).toHaveTextContent(IDS.template);
    expect(cellOf(table, person, 'Type')).toHaveTextContent('Watchlist');
    const company = rowOf(table, /Synthetic company screening/);
    expect(
      within(company).getByRole('link', { name: 'Synthetic company screening' }),
    ).toHaveAttribute('href', `/report-templates/${IDS.otherTemplate}`);
    expect(cellOf(table, company, 'Type')).toHaveTextContent('Business watchlist');
  });

  it('says when every template pins the enabled sources', () => {
    show({ templateWarnings: [] });

    expect(region('Templates to review')).toHaveTextContent(
      'Every template pins exactly the enabled sources of its kind.',
    );
  });

  it('states the scheduled media runs against the GDELT budget, without a warning under 80% (C81.2)', () => {
    show();

    const media = region('Adverse media budget');
    expect(media).toHaveTextContent('12.5 scheduled adverse-media runs a day');
    expect(media).toHaveTextContent('17,280');
    expect(media).toHaveTextContent('0.07%');
    expect(within(media).queryByText('The install is above 80% of the budget')).toBeNull();
    expect(media).toHaveTextContent('https://www.gdeltproject.org/');
  });

  it('warns in words above 80% of the GDELT budget', () => {
    show({ scheduledRunsPerDay: 15000 });

    const media = region('Adverse media budget');
    expect(within(media).getByText('The install is above 80% of the budget')).toHaveAttribute(
      'data-status',
      'over-budget-share',
    );
    expect(media).toHaveTextContent('86.81%');
    expect(media).toHaveTextContent('provider_error');
  });

  it('says the runs are this environment’s own, never a figure for the install or another tenant (owner decision 18, R004)', () => {
    show({ scheduledRunsPerDay: 12.5 });

    const media = region('Adverse media budget');
    expect(media).toHaveTextContent(
      '12.5 scheduled adverse-media runs a day in this environment: 0.07% of the install’s GDELT budget of 17,280 requests a day',
    );
    expect(media).not.toHaveTextContent('across the install');
  });

  it('warns when the install is above 80% of the budget, even when this environment’s own share is small (owner decision 18)', () => {
    show({ scheduledRunsPerDay: 12.5, installAboveWarnShare: true });

    const media = region('Adverse media budget');
    expect(within(media).getByText('The install is above 80% of the budget')).toHaveAttribute(
      'data-status',
      'over-budget-share',
    );
    expect(media).toHaveTextContent('0.07%');
    expect(media).toHaveTextContent(
      'Across every environment of the install, scheduled adverse-media runs take more than 80% of the GDELT budget',
    );
    expect(media).toHaveTextContent('provider_error');
  });

  it('shows the GDELT citation the API serves, not a line of the console’s own (owner decision 17)', () => {
    show({ mediaAttribution: 'Synthetic citation of the GDELT Project served by the API.' });

    const media = region('Adverse media budget');
    expect(media).toHaveTextContent('Synthetic citation of the GDELT Project served by the API.');
    expect(media).not.toHaveTextContent(MEDIA_ATTRIBUTION);
    expect(media).not.toHaveTextContent('When adverse media is bound to gdelt-doc');
  });

  it('lists the recent syncs with each outcome, override and actor in words', () => {
    show();

    const table = screen.getByRole('table', { name: 'Recent syncs' });
    expect(within(table).getAllByRole('row')).toHaveLength(RECENT_SYNCS.length + 1);
    const refused = rowOf(table, '44');
    expect(cellOf(table, refused, 'Outcome')).toHaveTextContent('Refused: mass removal');
    expect(cellOf(table, refused, 'Run by')).toHaveTextContent('Refresh job');
    const override = rowOf(table, '43');
    expect(cellOf(table, override, 'Override')).toHaveTextContent('--accept-older-publication');
    expect(cellOf(table, override, 'Changes')).toHaveTextContent('3 added, 1 changed, 0 removed');
    expect(cellOf(table, rowOf(table, '42'), 'Outcome')).toHaveTextContent('Busy');
  });

  it('shows each source’s attribution line, and the terms note of a source that ships disabled', () => {
    show();

    const attribution = region('Attribution');
    expect(attribution).toHaveTextContent('Synthetic attribution line of ofac-sdn');
    expect(attribution).toHaveTextContent(
      'Synthetic terms note: personal, non-commercial use only.',
    );
  });
});
