/**
 * English messages of the phone and email one-time-code steps (C55, C64.1), under `otp` in the
 * flow's messages. The code itself is never part of a message.
 */
export const otpEn = {
  send: 'Send code',
  sending: 'Sending your code…',
  phone: {
    title: 'Confirm your phone number',
    intro: 'We will send a code to your phone by text message. Your usual message rates may apply.',
    country: 'Country',
    countryOption: '{{country}} ({{code}})',
    number: 'Phone number',
    numberHint: 'You can leave out the country code.',
    change: 'Change phone number',
    errors: {
      required: 'Enter your phone number.',
      invalid: 'Enter a valid phone number for the country you chose.',
      notAllowed:
        'Codes cannot be sent to this number here. Use a number from one of the countries listed.',
      destinationInvalid:
        'This number cannot receive a code. Check it, or use another phone number.',
      deliveryFailed:
        'We could not send a code to this number. Check it and try again, or use another number.',
    },
  },
  email: {
    title: 'Confirm your email address',
    intro: 'We will send a code to your email address.',
    address: 'Email address',
    change: 'Change email address',
    errors: {
      required: 'Enter your email address.',
      invalid: 'Enter an email address in the correct format, like name@example.com.',
      notAllowed: 'Codes cannot be sent to this email address here. Use another email address.',
      destinationInvalid:
        'This email address cannot receive a code. Check it, or use another email address.',
      deliveryFailed:
        'We could not send a code to this email address. Check it and try again, or use another email address.',
    },
  },
  code: {
    title: 'Enter the code',
    sentTo: 'We sent a code to {{destination}}.',
    sentAgain: 'We sent a new code to {{destination}}.',
    label: 'Code',
    hint: 'The code has {{length}} digits.',
    confirm: 'Confirm',
    checking: 'Checking your code…',
    attemptsLeft: 'Tries left for this code: {{remaining}}',
    expiresAt: 'The code expires at {{time}}.',
    resend: 'Send a new code',
    resendIn: 'You can ask for a new code in {{time}}.',
    resendReady: 'You can now ask for a new code.',
    noResend: 'No more codes can be sent.',
    expiredFinal:
      'This code has expired, and no more codes can be sent. Start again to get a new code.',
    startAgain: 'Start again',
    errors: {
      required: 'Enter the code we sent you.',
      format: 'Enter the {{length}}-digit code.',
      incorrect: 'That code is not correct. Check it and try again.',
      expired: 'This code has expired. Ask for a new code.',
      exhausted: 'Too many wrong tries for this code. Ask for a new code.',
      notSent: 'Ask for a code first.',
      tooSoon: 'Wait a little before you ask for a new code.',
    },
  },
  limited: {
    title: 'We cannot send you a code right now',
    message:
      'We could not send or check a code for you just now. You can continue, and the organization that asked you to verify will review your verification.',
    continue: 'Continue',
    continuing: 'Sending your verification…',
    failed: 'We could not continue. Wait a while, then try again.',
  },
  confirmed: {
    title: 'Your code was confirmed',
    submitting: 'Sending your verification…',
  },
} as const;
