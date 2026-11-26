import { DomainError } from '@openverify/core';
import { describe, expect, it } from 'vitest';
import {
  FLOW_SPEC_VERSION,
  FlowSpecError,
  STEP_TYPES,
  parseFlow,
  safeParseFlow,
  type Flow,
} from './flow.js';
import { mutateFlow, stepIndex, validFlow } from './test-fixtures.js';

type Json = Record<string, unknown>;

/** Issues reported for an invalid flow, as "path: message" strings. */
function issuesOf(input: unknown): string[] {
  const result = safeParseFlow(input);
  if (result.success) {
    throw new Error('expected the flow to be invalid');
  }
  return result.issues.map((issue) => `${issue.path}: ${issue.message}`);
}

function setStep(id: string, patch: Json): Json {
  return mutateFlow((flow) => {
    flow.steps[stepIndex(id)] = { ...flow.steps[stepIndex(id)], ...patch };
  });
}

describe('parseFlow: valid flows', () => {
  it('parses a flow that uses every step type', () => {
    const flow: Flow = parseFlow(validFlow());
    expect(flow.metadata).toEqual({
      specVersion: FLOW_SPEC_VERSION,
      id: 'kyc-standard',
      version: 3,
      name: 'Standard KYC',
      description: 'Government ID, selfie and proof of address',
    });
    expect(flow.steps.map((step) => step.type)).toEqual([
      'consent',
      'form',
      'government_id',
      'nfc',
      'selfie',
      'document',
      'phone_otp',
      'email_otp',
      'database',
      'aamva',
      'crypto_wallet',
      'database_business',
      'business_website',
      'device_handoff',
      'completion',
      'failure',
    ]);
    expect(new Set(flow.steps.map((step) => step.type))).toEqual(new Set(STEP_TYPES));
    expect(flow.transitions).toHaveLength(3);
  });

  it('keeps transition conditions as opaque JSON', () => {
    const flow = parseFlow(validFlow());
    expect(flow.transitions[0]?.condition).toEqual({ '==': [{ var: 'platform' }, 'android'] });
    expect(flow.transitions[1]).not.toHaveProperty('condition');
  });

  it('accepts a minimal linear flow without transitions', () => {
    const flow = parseFlow({
      metadata: { specVersion: 1, id: 'minimal', version: 1, name: 'Minimal' },
      steps: [
        {
          id: 'id_front',
          type: 'government_id',
          sides: 'front',
          maxAttempts: 1,
          captureMethods: ['upload'],
        },
        { id: 'done', type: 'completion' },
      ],
      transitions: [],
    });
    expect(flow.steps).toHaveLength(2);
  });

  it('accepts passive liveness with only the center pose', () => {
    expect(() =>
      parseFlow(setStep('selfie', { liveness: 'passive', poses: ['center'] })),
    ).not.toThrow();
  });

  it('allows a step to transition to itself', () => {
    expect(() =>
      parseFlow(
        mutateFlow((flow) => {
          flow.transitions.push({ from: 'phone', to: 'phone', condition: { var: 'resend' } });
        }),
      ),
    ).not.toThrow();
  });
});

describe('parseFlow: invalid flows', () => {
  it('rejects a flow without steps', () => {
    const empty = mutateFlow((flow) => {
      flow.steps = [];
      flow.transitions = [];
    });
    expect(issuesOf(empty)).toEqual(['steps: a flow needs at least one step']);
  });

  it('also reports transitions left dangling by removing every step', () => {
    const issues = issuesOf(mutateFlow((flow) => (flow.steps = [])));
    expect(issues[0]).toBe('steps: a flow needs at least one step');
    expect(issues).toContain('transitions.0.from: unknown step id "gov_id"');
  });

  it('rejects duplicate step ids', () => {
    const issues = issuesOf(
      mutateFlow((flow) => {
        flow.steps.push({ id: 'selfie', type: 'completion' });
      }),
    );
    const appendedIndex = stepIndex('rejected') + 1;
    expect(issues).toEqual([`steps.${String(appendedIndex)}.id: duplicate step id "selfie"`]);
  });

  it('rejects a transition from an unknown step', () => {
    expect(
      issuesOf(mutateFlow((flow) => flow.transitions.push({ from: 'ghost', to: 'done' }))),
    ).toEqual(['transitions.3.from: unknown step id "ghost"']);
  });

  it('rejects a transition to an unknown step', () => {
    expect(
      issuesOf(mutateFlow((flow) => flow.transitions.push({ from: 'consent', to: 'ghost' }))),
    ).toEqual(['transitions.3.to: unknown step id "ghost"']);
  });

  it('rejects transitions out of terminal steps', () => {
    expect(
      issuesOf(mutateFlow((flow) => flow.transitions.push({ from: 'rejected', to: 'consent' }))),
    ).toEqual(['transitions.3.from: terminal step "rejected" cannot have outgoing transitions']);
  });

  it('reports every problem at once', () => {
    const issues = issuesOf(
      mutateFlow((flow) => {
        flow.steps.push({ id: 'done', type: 'completion' });
        flow.transitions.push({ from: 'nowhere', to: 'missing' });
      }),
    );
    expect(issues).toHaveLength(3);
  });

  it.each<[string, Json, RegExp]>([
    [
      'an unknown spec version',
      { metadata: { specVersion: 2, id: 'x', version: 1, name: 'X' } },
      /^metadata\.specVersion/,
    ],
    [
      'a non-positive flow version',
      { metadata: { specVersion: 1, id: 'x', version: 0, name: 'X' } },
      /^metadata\.version/,
    ],
    [
      'an empty flow name',
      { metadata: { specVersion: 1, id: 'x', version: 1, name: '' } },
      /^metadata\.name/,
    ],
    [
      'an invalid flow id',
      { metadata: { specVersion: 1, id: 'Not Valid', version: 1, name: 'X' } },
      /^metadata\.id/,
    ],
    ['missing metadata', { metadata: undefined }, /^metadata/],
    ['missing transitions', { transitions: undefined }, /^transitions/],
    ['an unknown top-level property', { theme: 'dark' }, /^: Unrecognized key/],
  ])('rejects %s', (_label, patch, issue) => {
    const issues = issuesOf({ ...validFlow(), ...patch });
    expect(
      issues.some((message) => issue.test(message)),
      issues.join('\n'),
    ).toBe(true);
  });

  it.each<[string, string, Json, RegExp]>([
    ['an unknown step type', 'email', { type: 'video_call' }, /^steps\.\d+/],
    ['an invalid step id', 'email', { id: 'Email Step' }, /^steps\.\d+\.id/],
    ['an unknown step property', 'email', { colour: 'red' }, /^steps\.\d+: Unrecognized key/],
    ['consent without text keys', 'consent', { textKeys: [] }, /^steps\.0\.textKeys/],
    ['an invalid i18n key', 'consent', { textKeys: ['has space'] }, /^steps\.0\.textKeys\.0/],
    ['a form without fields', 'details', { fields: [] }, /^steps\.1\.fields/],
    ['zero government ID attempts', 'gov_id', { maxAttempts: 0 }, /^steps\.2\.maxAttempts/],
    ['eleven government ID attempts', 'gov_id', { maxAttempts: 11 }, /^steps\.2\.maxAttempts/],
    ['an unknown ID side', 'gov_id', { sides: 'inside' }, /^steps\.2\.sides/],
    ['no capture methods', 'gov_id', { captureMethods: [] }, /^steps\.2\.captureMethods/],
    [
      'a repeated capture method',
      'gov_id',
      { captureMethods: ['camera', 'camera'] },
      /^steps\.2\.captureMethods: must not contain duplicates/,
    ],
    [
      'an alpha-3 country',
      'gov_id',
      { allowedCountries: ['USA'] },
      /^steps\.2\.allowedCountries\.0/,
    ],
    [
      'a lowercase country',
      'gov_id',
      { allowedCountries: ['us'] },
      /^steps\.2\.allowedCountries\.0/,
    ],
    [
      'an unknown ID class',
      'gov_id',
      { allowedIdClasses: ['library_card'] },
      /^steps\.2\.allowedIdClasses\.0/,
    ],
    ['NFC not marked Android-only', 'nfc_chip', { androidOnly: false }, /^steps\.3\.androidOnly/],
    ['no selfie poses', 'selfie', { poses: [] }, /^steps\.4\.poses/],
    [
      'a repeated pose',
      'selfie',
      { poses: ['left', 'left'] },
      /^steps\.4\.poses: must not contain duplicates/,
    ],
    [
      'active liveness facing only forward',
      'selfie',
      { poses: ['center'] },
      /^steps\.4\.poses: active liveness needs a left or right pose/,
    ],
    ['an unknown liveness mode', 'selfie', { liveness: 'semi' }, /^steps\.4\.liveness/],
    ['no document types', 'proof_of_address', { documentTypes: [] }, /^steps\.5\.documentTypes/],
    // C50.3: the recency window moved to config (document_recency_detection's max-age-days).
    ['a document age on the step', 'proof_of_address', { maxAgeDays: 90 }, /^steps\.5: /],
    [
      'no document capture method',
      'proof_of_address',
      { captureMethods: [] },
      /^steps\.5\.captureMethods/,
    ],
    [
      'an unknown document capture method',
      'proof_of_address',
      { captureMethods: ['fax'] },
      /^steps\.5\.captureMethods\.0/,
    ],
    ['11 document attempts', 'proof_of_address', { maxAttempts: 11 }, /^steps\.5\.maxAttempts/],
    ['a 3-digit OTP', 'phone', { codeLength: 3 }, /^steps\.6\.codeLength/],
    // C50.3, C55.2: at least six digits (SP 800-63B-4 §3.1.3.2).
    ['a 5-digit OTP', 'phone', { codeLength: 5 }, /^steps\.6\.codeLength/],
    ['an 11-digit OTP', 'phone', { codeLength: 11 }, /^steps\.6\.codeLength/],
    ['a 5-digit email OTP', 'email', { codeLength: 5 }, /^steps\.7\.codeLength/],
    [
      'a phone step without countries',
      'phone',
      { allowedCountries: undefined },
      /^steps\.6\.allowedCountries/,
    ],
    [
      'a phone step with no country',
      'phone',
      { allowedCountries: [] },
      /^steps\.6\.allowedCountries/,
    ],
    [
      'a phone step with 251 countries',
      'phone',
      {
        allowedCountries: Array.from(
          { length: 251 },
          (_, index) => `A${String.fromCharCode(65 + (index % 26))}`,
        ),
      },
      /^steps\.6\.allowedCountries/,
    ],
    ['a VoIP flag that is not a boolean', 'phone', { allowVoip: 'yes' }, /^steps\.6\.allowVoip/],
    [
      'a database step without the first name',
      'database',
      { fields: ['name_last', 'birthdate', 'address_country_code'], requiredFields: undefined },
      /^steps\.8\.fields: a database step collects name_first, name_last and address_country_code/,
    ],
    [
      'a database step without the country',
      'database',
      { fields: ['name_first', 'name_last', 'birthdate'], requiredFields: undefined },
      /^steps\.8\.fields: a database step collects name_first, name_last and address_country_code/,
    ],
    [
      'a database step with nothing beyond the name and country',
      'database',
      {
        fields: ['name_first', 'name_last', 'address_country_code', 'address_city'],
        requiredFields: undefined,
      },
      /^steps\.8\.fields: a database step also collects one of birthdate, address_street_1, identification_number, phone_number or email_address/,
    ],
    [
      'a required database field the step does not collect',
      'database',
      { requiredFields: ['email_address'] },
      /^steps\.8\.requiredFields: required fields must be collected: email_address/,
    ],
    ['an AAMVA step without a source', 'aamva', { source: undefined }, /^steps\.9\.source/],
    ['an unknown AAMVA source', 'aamva', { source: 'barcode' }, /^steps\.9\.source/],
    ['a crypto step without chains', 'wallet', { chains: [] }, /^steps\.10\.chains/],
    ['an unknown chain', 'wallet', { chains: ['cosmos:cosmoshub-4'] }, /^steps\.10\.chains\.0/],
    [
      'a repeated chain',
      'wallet',
      { chains: ['eip155:1', 'eip155:1'] },
      /^steps\.10\.chains: must not contain duplicates/,
    ],
    ['the hexadecimal TRON id', 'wallet', { chains: ['tron:0x2b6653dc'] }, /^steps\.10\.chains\.0/],
    ['no signing method', 'wallet', { signing: [] }, /^steps\.10\.signing/],
    ['an unknown signing method', 'wallet', { signing: ['qr'] }, /^steps\.10\.signing\.0/],
    [
      'an associated-persons flag that is not a boolean',
      'business',
      { collectAssociatedPersons: 'yes' },
      /^steps\.11\.collectAssociatedPersons/,
    ],
    ['a website step with an unknown key', 'website', { url: 'https://a.example' }, /^steps\.12: /],
    ['zero website attempts', 'website', { maxAttempts: 0 }, /^steps\.12\.maxAttempts/],
    ['an unknown database field', 'database', { fields: ['ssn_full'] }, /^steps\.8\.fields\.0/],
    [
      'a repeated database field',
      'database',
      { fields: ['name_first', 'name_first'] },
      /^steps\.8\.fields: must not contain duplicates/,
    ],
  ])('rejects %s', (_label, step, patch, issue) => {
    const issues = issuesOf(setStep(step, patch));
    expect(
      issues.some((message) => issue.test(message)),
      issues.join('\n'),
    ).toBe(true);
  });

  describe('form fields', () => {
    function withField(field: Json): Json {
      return setStep('details', { fields: [field] });
    }
    const base = { name: 'nickname', labelKey: 'form.nickname', required: false };

    it.each<[string, Json, RegExp]>([
      ['an unknown field type', { ...base, type: 'signature' }, /^steps\.1\.fields\.0/],
      [
        'an invalid field name',
        { ...base, type: 'text', name: 'Nick Name' },
        /^steps\.1\.fields\.0\.name/,
      ],
      [
        'minLength above maxLength',
        { ...base, type: 'text', validation: { minLength: 5, maxLength: 2 } },
        /minLength must not exceed maxLength/,
      ],
      // C252 (Workflow 11B): a pattern's grammar is checked at write (`v1FieldPatternProblems`,
      // operator-patterns.test.ts), not by the schema, so a stored flow still parses.
      [
        'a pattern past 500 characters',
        { ...base, type: 'text', validation: { pattern: 'a'.repeat(501) } },
        /^steps\.1\.fields\.0\.validation\.pattern/,
      ],
      [
        'a non-ISO date bound',
        { ...base, type: 'date', validation: { min: '01/01/1900' } },
        /^steps\.1\.fields\.0\.validation\.min/,
      ],
      [
        'a reversed date range',
        { ...base, type: 'date', validation: { min: '2000-01-01', max: '1999-01-01' } },
        /min must not be after max/,
      ],
      [
        'a select without options',
        { ...base, type: 'select', options: [] },
        /^steps\.1\.fields\.0\.options/,
      ],
      [
        'repeated select values',
        {
          ...base,
          type: 'select',
          options: [
            { value: 'a', labelKey: 'x' },
            { value: 'a', labelKey: 'y' },
          ],
        },
        /option values must be unique/,
      ],
      [
        'an invalid country restriction',
        { ...base, type: 'country', validation: { allowedCountries: ['XX1'] } },
        /^steps\.1\.fields\.0\.validation\.allowedCountries\.0/,
      ],
      [
        'email validation options',
        { ...base, type: 'email', validation: { pattern: '.*' } },
        /Unrecognized key/,
      ],
    ])('rejects %s', (_label, field, issue) => {
      const issues = issuesOf(withField(field));
      expect(
        issues.some((message) => issue.test(message)),
        issues.join('\n'),
      ).toBe(true);
    });

    it('rejects two fields with the same name', () => {
      const issues = issuesOf(
        setStep('details', {
          fields: [
            { ...base, type: 'text' },
            { ...base, type: 'email' },
          ],
        }),
      );
      expect(issues).toEqual(['steps.1.fields.1.name: duplicate field name "nickname"']);
    });
  });

  describe('transition conditions', () => {
    it.each([
      ['an array', [{ var: 'x' }]],
      ['a string', 'x == 1'],
      ['a number', 1],
      ['null', null],
    ])('rejects %s as a condition', (_label, condition) => {
      const issues = issuesOf(
        mutateFlow((flow) => {
          flow.transitions[0] = { from: 'gov_id', to: 'selfie', condition };
        }),
      );
      expect(issues.some((message) => message.startsWith('transitions.0.condition'))).toBe(true);
    });
  });

  it.each([null, 'flow', 42, []])('rejects the non-object input %j', (input) => {
    expect(safeParseFlow(input).success).toBe(false);
  });
});

describe('parseFlow errors', () => {
  it('throws a typed domain error that lists the issues', () => {
    let thrown: unknown;
    try {
      parseFlow(
        mutateFlow((flow) => {
          flow.steps = [];
          flow.transitions = [];
        }),
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FlowSpecError);
    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({
      code: 'invalid_flow',
      issues: [{ path: 'steps', message: 'a flow needs at least one step' }],
    });
  });

  it('returns the parsed flow from safeParseFlow', () => {
    const result = safeParseFlow(validFlow());
    expect(result.success).toBe(true);
    expect(result.success && result.data.metadata.id).toBe('kyc-standard');
  });
});
