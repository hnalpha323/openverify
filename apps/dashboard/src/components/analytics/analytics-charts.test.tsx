import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { chartPoint } from './analytics-cells';
import { BarChart, LineChart } from './analytics-charts';

const series = [
  {
    name: 'Entered',
    points: [
      chartPoint('consent', 40, 11),
      chartPoint('document', { suppressed: 'small-count' }, 11),
      chartPoint('selfie', { suppressed: 'complementary' }, 11),
    ],
  },
  {
    name: 'Passed',
    points: [
      chartPoint('consent', 30, 11),
      chartPoint('document', 0, 11),
      chartPoint('selfie', 12, 11),
    ],
  },
];

describe('the charts (C164.9; B9 (b))', () => {
  it('draw a named image in a figure whose caption states the finding', () => {
    const { container } = render(
      <BarChart
        title="Steps entered"
        caption="40 entered consent."
        series={series}
        threshold={11}
      />,
    );

    expect(screen.getByRole('img', { name: 'Steps entered' })).toBeInTheDocument();
    expect(screen.getByRole('figure')).toHaveTextContent('40 entered consent.');
    expect(container.querySelector('figcaption')?.textContent).toBe('40 entered consent.');
  });

  it('label every bar directly, hidden cells in words and hatched, series by pattern too', () => {
    const { container } = render(
      <BarChart title="Steps entered" caption="c" series={series} threshold={11} />,
    );
    const texts = [...container.querySelectorAll('svg[role="img"] text')].map((t) => t.textContent);

    expect(texts).toEqual(
      expect.arrayContaining([
        'Entered: 40',
        'Entered: fewer than 11',
        'Entered: hidden',
        'Passed: 12',
      ]),
    );
    const fills = [...container.querySelectorAll('svg[role="img"] rect')].map((rect) =>
      rect.getAttribute('fill'),
    );
    expect(fills.filter((fill) => fill?.endsWith('-hatch)'))).toHaveLength(2);
    expect(fills.filter((fill) => fill?.endsWith('-stripes)')).length).toBeGreaterThan(0);
    expect(screen.getByText('Passed')).toBeInTheDocument();
  });

  it('draw lines with a gap at a hidden cell and a hatched mark there', () => {
    const { container } = render(
      <LineChart
        title="Created by day"
        caption="Created."
        threshold={11}
        series={[
          {
            name: 'Created',
            points: [
              chartPoint('2026-10-01', 25, 11),
              chartPoint('2026-10-02', { suppressed: 'small-count' }, 11),
              chartPoint('2026-10-03', 30, 11),
            ],
          },
        ]}
      />,
    );

    expect(screen.getByRole('img', { name: 'Created by day' })).toBeInTheDocument();
    const d = container.querySelector('svg[role="img"] path[fill="none"]')?.getAttribute('d') ?? '';
    expect(d.match(/M/g)).toHaveLength(2);
    expect(container.querySelectorAll('rect[fill$="-hatch)"]')).toHaveLength(1);
    expect(screen.getByText('Created: 30')).toBeInTheDocument();
  });

  it('send only the figure and its caption from the server: the chart is drawn in the browser', () => {
    const html = renderToString(
      <BarChart
        title="Steps entered"
        caption="40 entered consent."
        series={series}
        threshold={11}
      />,
    );

    expect(html).toContain('40 entered consent.');
    expect(html).not.toContain('<svg role="img"');
  });
});
