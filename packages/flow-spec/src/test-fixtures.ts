/** A flow using every step type and field type; shared by the flow-spec tests. */
export function validFlow(): Record<string, unknown> {
  return {
    metadata: {
      specVersion: 1,
      id: 'kyc-standard',
      version: 3,
      name: 'Standard KYC',
      description: 'Government ID, selfie and proof of address',
    },
    steps: [
      {
        id: 'consent',
        type: 'consent',
        textKeys: ['consent.biometric.title', 'consent.biometric.body'],
        required: true,
      },
      {
        id: 'details',
        type: 'form',
        fields: [
          {
            type: 'text',
            name: 'first_name',
            labelKey: 'form.first_name',
            required: true,
            validation: { minLength: 1, maxLength: 100, pattern: '^[^0-9]+$' },
          },
          {
            type: 'date',
            name: 'birthdate',
            labelKey: 'form.birthdate',
            required: true,
            validation: { min: '1900-01-01', max: '2010-12-31' },
          },
          { type: 'email', name: 'email', labelKey: 'form.email', required: false },
          {
            type: 'phone',
            name: 'phone',
            labelKey: 'form.phone',
            required: false,
            validation: { allowedCountries: ['US', 'CA'] },
          },
          {
            type: 'select',
            name: 'occupation',
            labelKey: 'form.occupation',
            required: false,
            options: [
              { value: 'employed', labelKey: 'form.occupation.employed' },
              { value: 'other', labelKey: 'form.occupation.other' },
            ],
          },
          {
            type: 'country',
            name: 'residence',
            labelKey: 'form.residence',
            required: true,
            validation: { allowedCountries: ['US'] },
          },
        ],
      },
      {
        id: 'gov_id',
        type: 'government_id',
        sides: 'both',
        allowedCountries: ['US', 'CA'],
        allowedIdClasses: ['passport', 'drivers_license'],
        maxAttempts: 3,
        captureMethods: ['camera', 'upload'],
      },
      { id: 'nfc_chip', type: 'nfc', androidOnly: true },
      {
        id: 'selfie',
        type: 'selfie',
        poses: ['center', 'left', 'right'],
        liveness: 'active',
        maxAttempts: 3,
      },
      {
        id: 'proof_of_address',
        type: 'document',
        documentTypes: ['utility_bill', 'bank_statement'],
        captureMethods: ['upload', 'camera'],
        maxAttempts: 3,
      },
      {
        id: 'phone',
        type: 'phone_otp',
        allowedCountries: ['US', 'CA'],
        codeLength: 6,
        allowVoip: false,
        maxAttempts: 3,
      },
      { id: 'email', type: 'email_otp' },
      {
        id: 'database',
        type: 'database',
        fields: ['name_first', 'name_last', 'birthdate', 'address_country_code'],
        requiredFields: ['name_first', 'name_last', 'birthdate'],
        maxAttempts: 1,
      },
      { id: 'aamva', type: 'aamva', source: 'government_id' },
      {
        id: 'wallet',
        type: 'crypto_wallet',
        chains: ['eip155:1', 'bip122:000000000019d6689c085ae165831e93'],
        signing: ['wallet', 'paste'],
        maxAttempts: 3,
      },
      { id: 'business', type: 'database_business', collectAssociatedPersons: true },
      { id: 'website', type: 'business_website', maxAttempts: 3 },
      // Phase 7 (C96.1): the move to a phone.
      { id: 'handoff', type: 'device_handoff', methods: ['qr', 'email'], qrTtlSeconds: 300 },
      { id: 'done', type: 'completion', messageKey: 'flow.done' },
      { id: 'rejected', type: 'failure', messageKey: 'flow.rejected' },
    ],
    transitions: [
      { from: 'gov_id', to: 'nfc_chip', condition: { '==': [{ var: 'platform' }, 'android'] } },
      { from: 'gov_id', to: 'selfie' },
      {
        from: 'selfie',
        to: 'rejected',
        condition: { '==': [{ var: 'verifications.selfie.status' }, 'failed'] },
      },
    ],
  };
}

type Json = Record<string, unknown>;

/** Deep-copies the valid flow and applies `mutate` to the copy. */
export function mutateFlow(
  mutate: (flow: Json & { steps: Json[]; transitions: Json[] }) => void,
): Json {
  const flow = structuredClone(validFlow()) as Json & { steps: Json[]; transitions: Json[] };
  mutate(flow);
  return flow;
}

/** Index of a step in the valid flow, by id. */
export function stepIndex(id: string): number {
  const index = (validFlow().steps as { id: string }[]).findIndex((step) => step.id === id);
  if (index === -1) {
    throw new Error(`no step ${id}`);
  }
  return index;
}
