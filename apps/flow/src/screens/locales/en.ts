/**
 * English messages of the `screen` step's built-in labels (C148.7) and of the server-position
 * screens (C150.5, C151.2, C158.5, C171.4): the source the other four catalogs are typed against.
 */
export const screenEn = {
  // C147.10 (`MIGRATED_SUBMIT_LABEL_KEY`): the submit button of a migrated form.
  continue: 'Continue',
  // Shown as a visually hidden heading when a screen has no title of its own.
  heading: 'Your details',
  required: 'Fields marked * are required.',
  choose: 'Choose…',
  set: 'Already provided. Type a new value to change it.',
  // The error summary shown at the top on submit; each problem below links to its field.
  summary: 'Check these answers:',
  errors: {
    required: 'Enter or choose a value.',
    tooShort: 'Enter at least {{limit}} characters.',
    tooLong: 'Enter at most {{limit}} characters.',
    pattern: 'This is not in the expected format.',
    number: 'Enter a number.',
    tooSmall: 'Enter {{limit}} or more.',
    tooLarge: 'Enter {{limit}} or less.',
    date: 'Enter a date.',
    dateTooEarly: 'Enter {{limit}} or later.',
    dateTooLate: 'Enter {{limit}} or earlier.',
    email: 'Enter an email address, such as name@example.com.',
    phone: 'Enter a phone number, with its country code.',
    url: 'Enter a web address that starts with https://.',
    option: 'Choose one of the options.',
    country: 'Choose one of the countries.',
    refused: 'This value was not accepted. Check it and try again.',
  },
  address: {
    street1: 'Street address',
    street2: 'Apartment, suite or building (optional)',
    city: 'City',
    subdivision: 'State, province or region',
    postalCode: 'Postal code',
    country: 'Country',
  },
  saving: 'Saving your answers…',
  cancel: {
    title: 'Stop for now?',
    message: 'Your answers so far are kept. You can come back with the same link to continue.',
    confirm: 'Yes, stop for now',
    keep: 'No, keep going',
    stopped: 'You stopped for now',
    stoppedMessage: 'You can come back with the same link to continue where you left off.',
  },
  unavailable: 'This screen cannot be shown in this version.',
  help: 'Help and privacy',
  helpLink: 'Get help',
  privacyLink: 'Privacy notice',
  // C150.5: a branch waiting for facts, or an action step waiting for its workflow.
  waiting: {
    title: 'One moment',
    message: 'We are getting the next step ready…',
  },
  // C151.2: the flow stopped at its caps; an operator resumes or expires it.
  halted: {
    title: 'This verification cannot continue',
    message:
      'Something stopped this verification from continuing. Contact the organization that asked you to verify.',
  },
  // C158.5: the outcome is announced, and the person goes back with a button, never on a timer.
  redirect: {
    announce: 'Your part is done. Use Continue to go back to the website you came from.',
    continue: 'Continue',
  },
  // C171.4 (WCAG 2.2.1): the warning 20 seconds before a selfie capture ends, and its extension.
  extend: {
    warning: 'About {{seconds}} seconds left to take your photos. Need more time?',
    button: 'More time',
    extended: 'You have more time.',
    failed:
      'We could not add more time. Take your photos now, or start again if the time runs out.',
  },
};
