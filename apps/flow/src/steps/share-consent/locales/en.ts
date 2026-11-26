/**
 * English messages of the share-consent step (C238.6, C237.6; Phase 11, Workflow 11A), under `share`
 * in the flow's messages. English is the source.
 *
 * `consent` holds the built-in `share.consent.*` texts (Phase 9 `COPY_KEYS`, `legal: consent`). They
 * carry exactly C238.3's required content: who discloses (`{{source}}`), the named recipient
 * (`{{recipient}}`), the categories (`{{categories}}`), the purpose (reusing a verification), the
 * expiry (`{{expires}}`, a duration), on the destination side the destination's retention term
 * (`{{retention}}`), and how to withdraw (`{{withdraw}}`, the step's withdrawal contact). The server
 * fills every placeholder, normalises the text to NFC and digests it; the flow shows what the server
 * composed and never fills these itself. They are pending counsel's review (Q7, C238.10:
 * `counsel-unreviewed` in `COUNSEL_REVIEW_STATUS`); a commit that records counsel's review is the
 * only one that may call them reviewed.
 *
 * `step` and `categories` are the screen's own words, which carry no legal weight: labels, states,
 * errors and the categories in words.
 */
export const shareConsentEn = {
  consent: {
    title: 'Share your verified details with {{recipient}}',
    source:
      '{{source}} asks for your agreement to share the details it verified about you with {{recipient}}, so that {{recipient}} can reuse this verification instead of asking you to verify again.\n\nWhat is shared: {{categories}}. Nothing is shared unless you agree, and choosing not to share does not stop your verification.\n\nYour agreement covers one share with {{recipient}} for this purpose only. It ends after {{expires}} if the details have not been shared by then.\n\nTo withdraw your agreement, {{withdraw}}. Withdrawing stops any share that has not happened yet. Details already shared are kept by {{recipient}} under its own privacy notice.',
    destination:
      '{{recipient}} asks for your agreement to receive the details {{source}} verified about you, so that you do not have to verify again.\n\nWhat {{recipient}} receives: {{categories}}. {{recipient}} uses them only to verify your identity for this request and keeps them for {{retention}}. Nothing is received unless you agree, and choosing not to share does not stop your verification: you verify here instead.\n\nYour agreement ends after {{expires}} if the details have not been received by then.\n\nTo withdraw your agreement, {{withdraw}}. Withdrawing stops any transfer that has not happened yet.',
    'biometric-source':
      'I agree that {{source}} shares my biometric data with {{recipient}}: the photo of my face on my ID document, my selfie and the results of comparing them.',
    'biometric-destination':
      'I agree that {{recipient}} receives my biometric data from {{source}}: the photo of my face on my ID document, my selfie and the results of comparing them. {{recipient}} keeps it for {{retention}}, only to verify my identity.',
    accept: 'I agree',
    decline: 'Do not share',
    withdraw: 'Withdraw my agreement to share with {{recipient}}',
  },
  step: {
    sharedBy: 'Shared by',
    sharedWith: 'Shared with',
    whatIsShared: 'What is shared',
    saving: 'Saving your choice…',
    biometricRequired:
      'Tick the box to agree to share your biometric data, or choose not to share.',
    withdrawHeading: 'Your agreement to share',
    withdrawIntro:
      'You agreed to share your verified details with {{recipient}}. You can withdraw that agreement while this verification is open.',
    withdrawing: 'Withdrawing your agreement…',
    withdrawn: 'You withdrew your agreement to share with {{recipient}}.',
  },
  categories: {
    'identity-fields': 'your identity details, such as your name and date of birth',
    'contact-fields': 'your contact details, such as your email address and phone number',
    'other-fields': 'other details you entered',
    'document-images': 'images of your ID documents',
    biometric: 'biometric data: photos of your face and the results of comparing them',
    'check-results': 'the results of the checks on your details',
  },
} as const;
