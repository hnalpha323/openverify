import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocaleStatusList } from './locale-status';

describe('LocaleStatusList (C161.5)', () => {
  it('shows every enabled locale with its base tag, the default mark and its review status in words', () => {
    render(
      <LocaleStatusList
        enabledLocales={['en', 'ar', 'fr', 'es']}
        defaultLocale="ar"
        reviewStatus={{
          en: { status: 'source' },
          ar: { status: 'machine-drafted' },
          fr: { status: 'partially-reviewed', unreviewedKeys: ['consent.title', 'screen.help'] },
          es: {
            status: 'reviewed',
            by: 'Synthetic Reviewer',
            date: '2026-10-30',
            catalogSha256: 'a',
          },
        }}
      />,
    );

    const table = screen.getByRole('table', { name: 'Review status of the built-in texts' });
    const row = (name: string) => {
      const header = within(table).getByRole('rowheader', { name: new RegExp(name) });
      return within(header.closest('tr') ?? table);
    };
    expect(row('English').getByText(/Source language/)).toBeVisible();
    expect(row('Arabic').getByText(/Machine-drafted/)).toBeVisible();
    expect(row('Arabic').getByText('default')).toBeVisible();
    expect(row('French').getByText(/consent\.title, screen\.help/)).toBeVisible();
    expect(row('Spanish').getByText('Reviewed by Synthetic Reviewer on 2026-10-30.')).toBeVisible();
    expect(within(table).getByText('ar')).toBeVisible();
    expect(screen.getByText(/locale-unreviewed:<language>/)).toBeVisible();
  });

  it('never calls a locale reviewed without a record: an unknown status is machine-drafted', () => {
    render(<LocaleStatusList enabledLocales={['de']} defaultLocale="de" reviewStatus={{}} />);

    expect(screen.getByText(/Machine-drafted/)).toBeVisible();
    expect(screen.queryByText(/Reviewed by/)).toBeNull();
  });
});
