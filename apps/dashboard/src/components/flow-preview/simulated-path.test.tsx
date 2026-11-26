import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PREVIEW_COPY } from '../../lib/copy/preview';
import { simulationDocument } from '../../testing/routes/preview';
import { SimulatedPath } from './simulated-path';

const copy = PREVIEW_COPY.path;

describe('a simulated path (C156.4, C156.7)', () => {
  it('is labelled simulated and lists every step in order', () => {
    render(<SimulatedPath simulation={simulationDocument()} />);

    const region = screen.getByRole('region', { name: copy.heading });
    expect(within(region).getByText(PREVIEW_COPY.simulate.simulatedLabel)).toBeVisible();
    const list = within(region).getByRole('list', { name: copy.listLabel });
    const items = within(list)
      .getAllByRole('listitem')
      .filter((item) => item.parentElement === list);
    expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual([
      'consent (consent)',
      'id_card (government id)',
      'age_route (branch)',
      'wait_review (action)',
      'done (completion)',
    ]);
  });

  it('says the route taken, its condition’s result and the onNull used, with the unknown facts', () => {
    render(<SimulatedPath simulation={simulationDocument()} />);

    expect(screen.getByText(copy.route('fallback'))).toBeVisible();
    expect(screen.getByText(copy.conditionResult.null, { exact: false })).toBeVisible();
    expect(screen.getByText(copy.onNull('route:fallback'))).toBeVisible();
    expect(screen.getByText(copy.nullPaths('verifications.id_card.age-years'))).toBeVisible();
    expect(screen.getByText(copy.port('exhausted'))).toBeVisible();
    expect(screen.getByText(copy.waited)).toBeVisible();
    expect(screen.getByText(copy.notes('on-null-route'))).toBeVisible();
  });

  it('gives each fact the route read its tier, stage and source, and a beta badge', () => {
    render(<SimulatedPath simulation={simulationDocument()} />);

    const facts = screen.getByRole('list', { name: copy.facts });
    expect(within(facts).getByText(/verifications\.id_card\.age-years/)).toHaveTextContent(
      'verifications.id_card.age-years: tier R/H, stage beta, verification',
    );
    expect(within(facts).getByText(copy.beta)).toBeVisible();
  });

  it('says the outcome the engine would reach, with the fallbacks and flags', () => {
    render(<SimulatedPath simulation={simulationDocument()} />);

    const outcome = screen.getByRole('region', { name: copy.outcome });
    expect(within(outcome).getByText(copy.outcomeStatus('needs_review'))).toBeVisible();
    expect(within(outcome).getByText('government-id')).toBeVisible();
    expect(within(outcome).getByText('age_route')).toBeVisible();
    expect(within(outcome).getByText('unverified-path:age_route')).toBeVisible();
  });

  it('says where a path stopped, and why it ends before a completion', () => {
    render(
      <SimulatedPath
        simulation={simulationDocument({
          halted: 'flow_loop_limit',
          outcome: {
            status: 'pending',
            'flow-outcome': { 'verification-types-on-path': [], 'fallbacks-taken': [], flags: [] },
          },
        })}
      />,
    );

    expect(screen.getByText(copy.halted('flow_loop_limit'))).toBeVisible();
    expect(screen.getByText(copy.pending)).toBeVisible();
    expect(screen.getAllByText(copy.none).length).toBeGreaterThan(0);
  });

  it('marks a self-asserted and a client-reported fact as such', () => {
    const base = simulationDocument();
    const steps = base.data.attributes.steps.map((step) =>
      step['step-id'] === 'age_route'
        ? {
            ...step,
            facts: [
              { path: 'fields.birthdate', tier: null, stage: null, source: 'person' as const },
              { path: 'device.kind', tier: null, stage: null, source: 'client' as const },
            ],
          }
        : step,
    );

    render(<SimulatedPath simulation={simulationDocument({ steps })} />);

    expect(screen.getByText(/fields\.birthdate/)).toHaveTextContent(
      'no tier, no stage, self-asserted',
    );
    expect(screen.getByText(/device\.kind/)).toHaveTextContent('client-reported');
  });

  it('names, beside the path, the two ways a simulated path can differ from a live inquiry (K9-8)', () => {
    render(<SimulatedPath simulation={simulationDocument()} />);

    const region = screen.getByRole('region', { name: copy.heading });
    const differences = within(region).getByRole('list', {
      name: /how a live inquiry can differ from this simulated path/i,
    });
    const items = within(differences).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/failure step is shown failed/i);
    expect(items[0]).toHaveTextContent(/decision record/i);
    expect(items[0]).toHaveTextContent(/consent .*is not simulated/i);
    expect(items[1]).toHaveTextContent(/unknown \(null\) signal has no reason/i);
    expect(items[1]).toHaveTextContent(/needs review/i);
    expect(items[1]).toHaveTextContent(/errored check/i);
  });
});
