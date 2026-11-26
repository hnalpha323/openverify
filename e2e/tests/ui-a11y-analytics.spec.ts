/**
 * C171.3 (Workflow 9D, `a11y-audit`): the analytics charts at 320 CSS px and under a dark
 * preference, on the full stack (`dashboard-analytics`' followup). Budget: 90 s per test.
 *
 * Over a synthetic population of the spec's own (3 and 12 inquiries today, `seedAnalyticsPopulation`),
 * each view with a chart, at 320 CSS px in light and in the browser's dark preference (the console
 * keeps its light look, `packages/ui/src/styles.css`): axe passes; the page does not scroll sideways
 * (1.4.10); every chart fits the width, is a named image inside a figure with a caption (1.1.1); and
 * the overview's table holds every day of the window, since its line chart labels only the last
 * point of each series.
 *
 * Signs in only through `signInAs`; changes no setting; sends no OTP.
 */
import { expect, test, type Page } from '@playwright/test';
import { readStackInfo } from '../src/stack-info.js';
import { expectAccessible } from './support/accessible.js';
import { todayUtc } from './support/platform-9b.js';
import { sidewaysScroll } from './support/ui-a11y.js';
import { seedAnalyticsPopulation } from './support/ui-analytics.js';
import { signInAs } from './support/ui.js';

const VIEWS = ['', '/funnel', '/checks', '/cases', '/signals'] as const;

/** The day `days` before `day` (YYYY-MM-DD, UTC). */
function daysBefore(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

async function checkCharts(page: Page, where: string): Promise<void> {
  expect(await sidewaysScroll(page), `${where}: sideways scroll`).toBe(0);
  const figures = page.getByRole('figure');
  for (const figure of await figures.all()) {
    await expect(figure.locator('figcaption')).not.toBeEmpty();
    const chart = figure.locator('svg[role="img"]');
    await expect(chart).toHaveAttribute('aria-label', /.+/u);
    const fits = await chart.evaluate(
      (svg) => svg.getBoundingClientRect().right <= window.innerWidth,
    );
    expect(fits, `${where}: a chart wider than the page`).toBe(true);
  }
  await expectAccessible(page, { where });
}

test('the charts at 320 CSS px, light and under a dark preference (C171.3, 1.4.10, 1.1.1)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const stack = readStackInfo();
  const population = await seedAnalyticsPopulation(stack);
  const day = todayUtc();
  const window = `from=${daysBefore(day, 2)}&to=${day}&template=${population.largeTemplateId}`;
  await page.setViewportSize({ width: 320, height: 800 });
  await signInAs(page, stack, 'admin');

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const view of VIEWS) {
      await page.goto(`${stack.dashboardUrl}/analytics${view}?${window}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await checkCharts(page, `/analytics${view} (320 px, ${scheme})`);
    }
  }

  // The overview's line chart labels only each series' last point; its table holds every day.
  await page.goto(`${stack.dashboardUrl}/analytics?${window}`);
  const byDay = page.getByRole('table', { name: 'Inquiries by day' });
  for (const each of [daysBefore(day, 2), daysBefore(day, 1), day]) {
    await expect(byDay.getByRole('row', { name: new RegExp(`^${each}`, 'u') })).toHaveCount(1);
  }
  await expect(
    page
      .getByRole('figure')
      .first()
      .getByRole('img', { name: 'Inquiries created and started by day' }),
  ).toBeVisible();
});
