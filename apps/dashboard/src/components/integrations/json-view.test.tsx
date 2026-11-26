import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { JsonView, LoggedJson } from './json-view';

const regionText = (name: string) => screen.getByRole('region', { name }).textContent;

describe('JsonView', () => {
  it('shows the document as indented JSON in a scrollable, named region', () => {
    render(
      <JsonView
        label="Payload"
        masked={false}
        value={{ data: { id: 'inq_1', tags: ['vip', 'new'], empty: {}, none: [], ok: true, n: 3 } }}
      />,
    );

    const region = screen.getByRole('region', { name: 'Payload' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(region.textContent).toBe(
      [
        '{',
        '  "data": {',
        '    "id": "inq_1",',
        '    "tags": [',
        '      "vip",',
        '      "new"',
        '    ],',
        '    "empty": {},',
        '    "none": [],',
        '    "ok": true,',
        '    "n": 3',
        '  }',
        '}',
      ].join('\n'),
    );
  });

  it('escapes strings as JSON does', () => {
    render(<JsonView label="Body" masked={false} value={{ text: 'say "hi"\n' }} />);

    expect(regionText('Body')).toBe('{\n  "text": "say \\"hi\\"\\n"\n}');
  });

  it('shows the values the API masked as Hidden, and explains why', () => {
    render(
      <JsonView
        label="Payload"
        masked
        value={{
          attributes: {
            fields: { name_first: null, age: null },
            note: null,
            'ip-address': null,
            'redacted-at': null,
            status: 'approved',
          },
        }}
      />,
    );

    const region = screen.getByRole('region', { name: 'Payload' });
    expect(within(region).getAllByText('Hidden')).toHaveLength(4);
    expect(region.textContent).toContain('"redacted-at": null');
    expect(region.textContent).toContain('"status": "approved"');
    expect(
      screen.getByText('Hidden: your role cannot see personal data (the pii:view permission).'),
    ).toBeVisible();
  });

  it('shows the government ID extraction the API masked in a resource as Hidden, its sources as sent (G001)', () => {
    render(
      <JsonView
        label="Response body"
        masked
        value={{
          data: {
            attributes: {
              status: 'passed',
              'name-last': null,
              birthdate: null,
              'address-city': null,
              'name-middle': null,
              'extraction-sources': { 'name-last': ['mrz', 'viz'] },
              payload: { data: { attributes: { 'identification-number': null } } },
            },
          },
          meta: { birthdate: null },
        }}
      />,
    );

    const region = screen.getByRole('region', { name: 'Response body' });
    expect(within(region).getAllByText('Hidden')).toHaveLength(5);
    expect(region.textContent).toContain('"meta": {\n    "birthdate": null');
    expect(region.textContent).toContain('"name-last": [');
    expect(
      screen.getByText('Hidden: your role cannot see personal data (the pii:view permission).'),
    ).toBeVisible();
  });

  it('shows null as null to an operator who sees personal data', () => {
    render(<JsonView label="Payload" masked={false} value={{ fields: { name_first: null } }} />);

    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(regionText('Payload')).toContain('"name_first": null');
    expect(screen.queryByText(/your role cannot see personal data/)).not.toBeInTheDocument();
  });

  it('needs no explanation when nothing is hidden', () => {
    render(<JsonView label="Payload" masked value={{ status: 'approved', list: [null] }} />);

    expect(screen.queryByText(/your role cannot see personal data/)).not.toBeInTheDocument();
  });
});

describe('LoggedJson', () => {
  it('says when there was nothing', () => {
    render(<LoggedJson label="Request body" masked={false} value={null} />);

    expect(screen.getByText('None')).toBeVisible();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('shows a value that was kept whole as JSON', () => {
    render(<LoggedJson label="Request body" masked={false} value={{ name: 'CI' }} />);

    expect(regionText('Request body')).toBe('{\n  "name": "CI"\n}');
  });

  it('shows the size and the preview of a value too large to keep whole', () => {
    render(
      <LoggedJson
        label="Response body"
        masked={false}
        value={{ truncated: true, 'byte-length': 70_123, preview: '{"data":[{"id":"inq_1"' }}
      />,
    );

    expect(
      screen.getByText(
        'Too large to keep whole: 70,123 bytes. The start of it follows, with personal data masked.',
      ),
    ).toBeVisible();
    expect(regionText('Response body (start)')).toBe('{"data":[{"id":"inq_1"');
  });
});
