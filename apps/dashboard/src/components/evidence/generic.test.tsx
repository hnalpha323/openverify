import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  COMMON_ATTRIBUTES,
  PHASE5_RESOURCE_TYPES,
  phase5Verification,
} from '../../testing/phase5-fixtures';
import { GenericEvidence, type EvidenceProps } from './generic';

function evidence(
  type: EvidenceProps['verification']['type'],
  { state = 'visible', masked = false }: { state?: EvidenceProps['state']; masked?: boolean } = {},
) {
  return render(
    <GenericEvidence
      verification={phase5Verification(type, { masked })}
      label="Synthetic"
      state={state}
    />,
  );
}

/** The value a term of the evidence names, at the top level. */
function value(term: string, scope: HTMLElement = screen.getByRole('group')): HTMLElement {
  const dd = within(scope).getByText(term, { selector: 'dt' }).nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`No value for ${term}`);
  return dd;
}

/** The terms directly under the evidence's list, in order. */
const topTerms = () =>
  [...screen.getByRole('group').querySelectorAll(':scope > dl > div > dt')].map(
    (term) => term.textContent,
  );

describe('GenericEvidence (C54.5)', () => {
  it('is a group named after the verification, listing its type attributes in API order', () => {
    evidence('verification/database');

    expect(screen.getByRole('group', { name: 'Synthetic evidence' })).toBeVisible();
    expect(topTerms()).toEqual([
      'Name first',
      'Name middle',
      'Name last',
      'Birthdate',
      'Address street 1',
      'Address street 2',
      'Address city',
      'Address subdivision',
      'Address postal code',
      'Address country code',
      'Identification number',
      'Phone number',
      'Email address',
    ]);
    expect(value('Name first')).toHaveTextContent(/^Avery$/);
    expect(value('Birthdate')).toHaveTextContent(/^1990-04-12$/);
    // A value the type did not record is missing, not hidden.
    expect(value('Name middle')).toHaveTextContent('None');
  });

  it('says acronyms in capitals', () => {
    evidence('verification/database-business');
    expect(value('LEI')).toHaveTextContent('None');
    expect(value('Registry record ID')).toHaveTextContent('01234567');
  });

  it('shows the personal values as "Hidden" when the API masked them, and the rest as they are', () => {
    evidence('verification/crypto-wallet', { state: 'hidden', masked: true });

    expect(within(value('Wallet address')).getByText('Hidden')).toHaveAccessibleDescription(
      'Your role cannot see personal data (the pii:view permission).',
    );
    expect(value('Expected address')).toHaveTextContent('Hidden');
    expect(value('Chain ID')).toHaveTextContent(/^eip155:1$/);
    expect(value('Signature scheme')).toHaveTextContent(/^eip191$/);
  });

  it('shows the personal values as "Redacted" once the inquiry was redacted', () => {
    evidence('verification/phone-number', { state: 'redacted', masked: true });

    expect(value('Phone number')).toHaveTextContent(/^Redacted$/);
    expect(value('Sends')).toHaveTextContent(/^2$/);
  });

  it('lists the members of a nested object, masked member-wise like the API', () => {
    evidence('verification/document', { state: 'hidden', masked: true });

    const fields = value('Fields');
    expect(within(fields).getAllByText('Hidden', { exact: true })).toHaveLength(10);
    expect(value('Address postal code', fields)).toHaveTextContent('Hidden');
    expect(value('Page count')).toHaveTextContent(/^2$/);
  });

  it('lists the members of a nested object that is not personal data', () => {
    evidence('verification/government-id-nfc');

    const passive = value('Passive authentication');
    expect(value('Anchor source', passive)).toHaveTextContent(/^openverify-sandbox$/);
    expect(value('Outcome', value('Active authentication'))).toHaveTextContent(/^passed$/);
    expect(value('ID class')).toHaveTextContent(/^passport$/);
  });

  it('lists each entry of a list', () => {
    render(
      <GenericEvidence
        verification={phase5Verification('verification/database-business', {
          attributes: {
            'associated-persons': [
              { 'name-first': 'Avery', 'name-last': 'Example' },
              { 'name-first': 'Blair', 'name-last': 'Sample' },
            ],
          },
        })}
        label="Synthetic"
        state="visible"
      />,
    );

    const persons = within(value('Associated persons')).getAllByRole('listitem');
    expect(persons).toHaveLength(2);
    const [, second] = persons;
    if (second === undefined) throw new Error('two persons');
    expect(value('Name last', second)).toHaveTextContent(/^Sample$/);
  });

  it('says when the type recorded nothing yet', () => {
    render(
      <GenericEvidence
        verification={phase5Verification('verification/aamva', { attributes: {} })}
        label="Synthetic"
        state="visible"
      />,
    );

    expect(screen.getByText('Nothing recorded yet.')).toBeVisible();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it.each(PHASE5_RESOURCE_TYPES)('lists every type attribute of a %s verification', (type) => {
    const verification = phase5Verification(type);
    render(<GenericEvidence verification={verification} label="Synthetic" state="visible" />);

    expect(topTerms()).toHaveLength(
      Object.keys(verification.attributes).filter((name) => !COMMON_ATTRIBUTES.has(name)).length,
    );
  });
});
