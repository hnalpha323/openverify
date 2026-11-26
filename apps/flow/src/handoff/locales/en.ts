/**
 * English messages of device handoff (C96.5), under `handoff` in the flow's messages: the desktop's
 * `device_handoff` step (`desktop`), the phone's context screen (`phone`) and the words for what
 * will be verified (`steps`). No message ever holds a token; the desktop's code is shown only on
 * the desktop.
 */
export const handoffEn = {
  desktop: {
    title: 'Continue on your phone',
    intro:
      "Scan this code with your phone's camera to continue this verification on your phone. Your progress here carries over.",
    issuing: 'Getting a code for your phone…',
    qrLabel: 'QR code that opens this verification on your phone',
    linkLabel: 'Or open this link on your phone',
    copy: 'Copy link',
    copied: 'Link copied.',
    expiresIn: 'This code expires in {{time}}.',
    expired: 'This code has expired. Get a new one to continue on your phone.',
    newCode: 'Get a new code',
    confirmationCode: 'When your phone asks for a code, enter: {{code}}',
    emailOption: 'Send a link by email instead',
    smsOption: 'Send a link by text message instead',
    emailLabel: 'Email address',
    smsLabel: 'Phone number, with its country code',
    smsHint: 'For example +1 202 555 0123.',
    send: 'Send link',
    sending: 'Sending the link…',
    sentEmail:
      'We sent a link to your email address. Open it on your phone within {{minutes}} minutes.',
    sentSms: 'We sent a link to your phone by text message. Open it within {{minutes}} minutes.',
    showQr: 'Show a QR code instead',
    continueHere: 'Continue on this device',
    continuing: 'Continuing on this device…',
    waitingTitle: 'Continuing on your phone',
    waiting:
      'You continued on your phone at {{time}}. Finish the verification there; this page updates when you are done.',
    waitingDevice: 'Your phone: {{device}}',
    notMe: 'This was not me',
    rejecting: 'Ending the session on the other device…',
    rejected:
      'We ended the session on the other device and canceled what it had not finished. Get a new code, or continue here.',
    declined: 'The other device declined to continue. Get a new code, or continue here.',
    errors: {
      destinationNotConfirmed:
        'A link can only be sent to an email address or phone number you confirmed earlier in this verification.',
      sendLimited: 'Too many links were sent. Wait a while, or use the QR code.',
      required: 'Enter where to send the link.',
    },
  },
  phone: {
    title: 'Continue your verification',
    loading: 'Checking your link…',
    requester: '{{organization}} asked to verify your identity.',
    verifies: 'On this phone you will be asked for:',
    started: 'This verification was started on another device at {{time}}.',
    startedIn: 'This verification was started on another device in {{country}} at {{time}}.',
    adviceQr:
      "Continue only if you just scanned this code on {{organization}}'s own website. If someone sent you this code, decline.",
    adviceLink:
      "Continue only if you just asked for this link on {{organization}}'s own website. If you did not, decline.",
    codeLabel: 'Code shown on your other device',
    codeHint: 'Six digits.',
    codeRequired: 'Enter the six-digit code shown on your other device.',
    checkCode: 'Check code',
    checking: 'Checking the code…',
    continue: 'Continue',
    continuing: 'Opening your verification…',
    decline: 'Decline',
    declining: 'Declining…',
    declinedTitle: 'You declined',
    declined: 'Nothing was shared from this phone. You can close this page.',
    invalid:
      'This link is not valid, has expired or was already used. Go back to the device you started on for a new code.',
    limitTitle: 'This verification cannot continue here',
    limit:
      'This verification cannot be continued on another device. Return to the device you started on.',
  },
  steps: {
    form: 'a few details about you',
    government_id: 'a photo of your ID document',
    selfie: 'a selfie',
    document: 'a document upload',
    phone_otp: 'a code sent to your phone',
    email_otp: 'a code sent to your email',
    database: 'a check of your details against a database',
    aamva: 'a check of your driving licence details with its issuer',
    nfc: 'reading the chip in your ID document',
    crypto_wallet: 'proving that you control a crypto wallet',
    database_business: 'a check of your business against business registries',
    business_website: 'a check of your business website',
  },
} as const;
