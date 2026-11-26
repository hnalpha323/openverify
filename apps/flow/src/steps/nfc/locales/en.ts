/**
 * English messages of the `nfc` step in a browser (C207.10; Phase 5 C64.1 amended). A browser
 * cannot read a document chip, and the words never send the person to another phone ("a phone with
 * NFC" would open the same web page there; review H11), never promise an outcome, and never say
 * where the other way leads.
 */
export const nfcEn = {
  title: 'This step needs the organization’s app',
  needsApp: 'Reading a document chip needs the organization’s app; a browser cannot read it.',
  otherWay: 'You can continue here another way.',
  useAnotherWay: 'Use another way',
  switching: 'Switching to another way…',
  noOtherWay:
    'Continue in the organization’s app. If you do not have it, contact the organization that asked you to verify.',
} as const;
