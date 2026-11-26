import { cryptoWalletEn } from '../../steps/crypto-wallet/locales/en';
import { shareConsentEn } from '../../steps/share-consent/locales/en';
import { nfcEn } from '../../steps/nfc/locales/en';
import { documentEn } from '../../steps/document/locales/en';
import { screenEn } from '../../screens/locales/en';
import { formsEn } from '../../steps/forms/locales/en';
import { handoffEn } from '../../handoff/locales/en';
import { otpEn } from '../../steps/otp/locales/en';

/** English messages: the source of truth for message keys (see `Messages`). */
export const en = {
  app: {
    name: 'OpenVerify',
    language: 'Language',
  },
  loading: 'Loading your verification…',
  attempt: 'Attempt {{current}} of {{max}}',
  consent: {
    title: 'Consent to use your biometric data',
    // `consent.biometric` and `consent.processing` are the default template's consent texts
    // (contract C7). The keys are recorded with the user's consent, so never reuse a key for a
    // different meaning: add a new key instead.
    biometric:
      'To confirm your identity, we compare a selfie with the photo on your ID document. This comparison uses biometric data: measurements of your facial features. Your biometric data is used only to verify your identity for this request.',
    processing:
      'We process the photos of your ID document and your selfie only for this verification. They are deleted when the organization that asked for this verification no longer needs them, in line with its retention policy. You can stop at any time by closing this page.',
    // C42.3: the optional matching consent; {{days}} is the session's face-template-retention-days.
    'biometric-matching':
      'Optional: we also compare your selfie and its background with earlier selfies submitted to this organization, to stop one person from using several identities. A template of your face is kept for {{days}} days. You can still verify if you leave this unticked.',
    // C94.6 (ADR 0006): the optional device-recognition consent, unticked by default and ticked on
    // the session that collects.
    'device-recognition':
      'Optional: recognise this device on later visits, to protect my account from misuse.',
    // C128.4: the optional automated-decision consent. An operator lists it in a consent step when an
    // automated decision can rest on a biometric result, and it must say that such decisions are made.
    'automated-decision':
      'Optional: I agree that automated decisions can be made about this verification from my biometric data, without a person reviewing them first. You can ask for a person to review a decision.',
    checkbox: 'I agree to the collection and use of my biometric data as described above.',
    continue: 'Continue',
    saving: 'Saving your consent…',
    unavailable:
      'This verification asks you to agree to a text that this version cannot show. Contact the organization that asked you to verify.',
  },
  // C94.6 (ADR 0006): the notices of the two collection tiers. A template collects session
  // integrity only when its consent step shows `notice.session-integrity`, and device recognition in
  // `exempt` mode only with `notice.device-recognition`.
  notice: {
    'session-integrity':
      'To protect your verification against fraud, this page checks how it is being used, such as whether a browser is automated. It does not read your keystrokes or what you type.',
    'device-recognition':
      'This service recognises the device you use, to protect accounts from misuse.',
    'play-integrity':
      "To protect your verification against fraud, the app you are using asks Google Play to confirm that it is the genuine app on a device that has not been tampered with. For this, Google receives the app's package name, version and signing certificate, its licence status and an attestation of this device's integrity.",
  },
  // C199.1 (Workflow 10A Stage 1a): the native clients' own wording of legal texts the web words for a
  // page, and the labels of the optional consents' own checkboxes, which the web flow does not show.
  // The Android SDK takes them through its key map (android/openverify-sdk/i18n/key-map.json): the
  // flow keys stay `consent.processing` and `notice.session-integrity` (what a template lists, what
  // operator copy overrides and what a consent row is keyed by). The web flow never shows this group.
  nativeApp: {
    consent: {
      processing:
        'We process the photos of your ID document and your selfie only for this verification. They are deleted when the organization that asked for this verification no longer needs them, in line with its retention policy. You can stop at any time by closing this screen.',
      'biometric-matching-checkbox': 'Yes, also compare my selfie with earlier selfies (optional)',
      'device-recognition-checkbox': 'Yes, recognise this device on later visits (optional)',
      'automated-decision-checkbox':
        'Yes, allow automated decisions from my biometric data (optional)',
    },
    notice: {
      'session-integrity':
        "To protect your verification against fraud, this app checks how it is being used: whether a debugger is attached, and signs of an emulator, a rooted device or a tampering tool. For this it reads the device's build properties, the app's own process (its memory map, thread names and loaded classes), the mount table and whether known files are present, and sends only the names of the signs it finds. It does not read what you type or which other apps you have.",
    },
  },
  camera: {
    title: 'Camera access',
    intro: 'Next, we need your camera to take photos of your ID document and a selfie.',
    request: 'Allow camera access',
    requesting: 'Waiting for camera permission…',
    ready: 'Your camera is ready.',
    errors: {
      'permission-denied':
        'Camera access is blocked. Allow camera access in your browser settings, then try again.',
      'no-camera': 'We could not find a camera. Connect one, or switch to a device that has one.',
      'constraints-not-satisfied':
        'Your camera does not support the settings we need. Try another camera or device.',
      'camera-in-use': 'Another app is using your camera. Close that app, then try again.',
      'insecure-context': 'Camera access needs a secure (https) connection.',
      unsupported: 'This browser cannot use a camera. Try an up-to-date browser.',
      unknown: 'Something went wrong while starting your camera. Try again.',
    },
  },
  capture: {
    progress: 'Photo {{current}} of {{total}}',
    takePhoto: 'Take a photo',
    uploadPhoto: 'Upload a photo',
    startingCamera: 'Starting your camera…',
    cameraReady: 'Your camera is ready. Select Capture to take the photo.',
    photoReady: 'Your photo is ready to check. Use it, or retake it.',
    preview: 'Camera preview',
    shutter: 'Capture',
    cancel: 'Cancel',
    back: 'Back',
    tryAgain: 'Try again',
    captureFailed: 'We could not take the photo. Try again.',
    uploadInstead: 'You can also upload a photo instead.',
    checkPhoto: 'Check that the photo is sharp, well lit and shows everything we asked for.',
    retake: 'Retake',
    usePhoto: 'Use this photo',
    barcodeHint: 'Make sure the barcode is sharp and inside the frame.',
    photoCheck: {
      blurry:
        'This photo looks blurry. Hold your ID still in good light, let the camera focus, and take it again.',
      'too-small':
        'This photo’s resolution is too low to read your ID. Take it again, or use another camera if this keeps happening.',
      useAnyway: 'Use this photo anyway',
    },
    fileErrors: {
      empty: 'This file is empty. Choose another photo.',
      'too-large': 'This photo is larger than 10 MB. Choose a smaller photo.',
      'unsupported-type': 'This file is not a supported image. Choose a JPEG, PNG or WebP photo.',
      unreadable: 'We could not read this file. Choose another photo.',
    },
  },
  governmentId: {
    title: 'Photograph your ID',
    intro:
      'Use a valid government-issued ID. Place it on a flat surface in good light and make sure all four corners are visible.',
    front: {
      title: 'Front of your ID',
      instruction: 'Fit the front of your ID inside the frame.',
      alt: 'Your photo of the front of your ID',
      upload: 'Choose a photo of the front of your ID',
    },
    back: {
      title: 'Back of your ID',
      instruction: 'Turn your ID over and fit the back inside the frame.',
      alt: 'Your photo of the back of your ID',
      upload: 'Choose a photo of the back of your ID',
    },
  },
  selfie: {
    title: 'Take a selfie',
    intro:
      'We compare your selfie with the photo on your ID. Take off sunglasses and hats, and find a well-lit spot.',
    center: {
      title: 'Look straight ahead',
      instruction: 'Fit your face inside the oval and look straight at the camera.',
      alt: 'Your selfie, looking straight ahead',
      upload: 'Choose a selfie, looking straight ahead',
    },
    left: {
      title: 'Turn your head to the left',
      instruction: 'Keep your face inside the oval and slowly turn your head to the left.',
      alt: 'Your selfie, with your head turned to the left',
      upload: 'Choose a selfie, with your head turned to the left',
    },
    right: {
      title: 'Turn your head to the right',
      instruction: 'Keep your face inside the oval and slowly turn your head to the right.',
      alt: 'Your selfie, with your head turned to the right',
      upload: 'Choose a selfie, with your head turned to the right',
    },
    // C46.1: the guided capture. Each prompt is announced; each photo is uploaded at once.
    howItWorks:
      'We ask you to look straight at the camera, then to turn your head when asked. Each photo is taken automatically once you hold still.',
    howItWorksCenter:
      'Look straight at the camera. The photo is taken automatically once you hold still.',
    start: 'Start the camera',
    uploadInstead: 'Upload photos',
    preparing: 'Getting ready',
    opening: 'Starting your selfie…',
    prompt: 'Photo {{current}} of {{total}}: {{title}}',
    uploadingPose: 'Uploading photo {{current}} of {{total}}…',
    submitting: 'Sending your photos…',
    restarted:
      'Your selfie session ended before all the photos were sent, so we started again. Follow the prompts once more.',
    shutterSoon:
      'The photo is taken automatically when you hold still. You can also take it yourself in a few seconds.',
    shutterReady: 'If the photo is not taken automatically, select Capture.',
    retakePose: 'Retake this photo',
    guidance: {
      starting: 'Getting the face guide ready…',
      manual: 'Hold the pose, then select Capture.',
      'no-face': 'We cannot see your face. Fit your face inside the oval.',
      'multiple-faces': 'Make sure only your face is in the frame.',
      'too-far': 'Move closer to the camera.',
      'too-close': 'Move back a little.',
      'off-centre': 'Move your face to the middle of the oval.',
      'look-straight': 'Look straight at the camera.',
      'turn-left': 'Slowly turn your head to the left.',
      'turn-right': 'Slowly turn your head to the right.',
      'hold-still': 'Hold still…',
    },
  },
  // C64.1: each Phase 5 step keeps its messages in its own locale modules.
  otp: otpEn,
  // C96.5 (Workflow 7A): device handoff, the desktop's step and the phone's context screen.
  handoff: handoffEn,
  cryptoWallet: cryptoWalletEn,
  // C238.6, C237.6 (Workflow 11A, clients-connect): the share-consent step; share.consent.* are
  // legal texts, counsel-unreviewed (C238.10), machine-drafted outside en (C161.5).
  share: shareConsentEn,
  // C207.10 (Workflow 10C, api-nfc): the nfc step in a browser; machine-drafted outside en (C161.5).
  nfc: nfcEn,
  forms: formsEn,
  document: documentEn,
  // C148.7, C150.5, C151.2, C158.5, C171.4 (Workflow 9A, flow-renderer): machine-drafted (C161.5).
  screen: screenEn,
  submission: {
    uploading: 'Uploading your photos…',
    retry: 'Try again',
    retake: 'Retake photos',
  },
  processing: {
    title: 'Checking your photos',
    // C64.1: a code, a signature or entered values.
    verificationTitle: 'Checking your verification',
    message: 'This usually takes a few seconds. Keep this page open.',
    slow: 'This is taking longer than usual.',
    checkAgain: 'Check again',
  },
  finalizing: {
    title: 'Finishing your verification',
    message: 'This usually takes a few seconds. Keep this page open.',
  },
  retry: {
    title: 'We could not use your last photos',
    // C64.1: a code, a signature or entered values.
    attemptTitle: 'Your last attempt did not go through',
    generic: 'Something in the photo was not clear enough. Try again in good light.',
    reasons: {
      image_blurry:
        'The photo was blurry. Hold your device steady and wait for the image to come into focus.',
      glare_present:
        'There was glare on your ID. Move away from direct light or tilt the ID slightly.',
      portrait_not_present:
        'We could not find the photo on your ID. Make sure the whole front of the ID is in the frame.',
      front_not_present: 'We need a photo of the front of your ID.',
      back_not_present: 'We need a photo of the back of your ID.',
      image_too_dark: 'The photo was too dark. Find a brighter spot.',
      image_too_bright: 'The photo was too bright. Move away from strong light.',
      face_not_present: 'We could not see your face. Fit your face inside the oval.',
      multiple_faces_present:
        'More than one face was in the photo. Make sure only you are in the frame.',
      image_unreadable:
        'We could not open the photo. Take a new one, or choose a JPEG, PNG or WebP image.',
      // Phase 3 government ID reasons (C29.4): what to do differently, never why it matters.
      document_not_found:
        'We could not find your ID in the photo. Place it on a plain surface that contrasts with it, and make sure all four corners are in the frame.',
      insufficient_text:
        'We could not read the text on your ID. Make sure the photo is sharp, well lit and free of glare, and shows the whole ID.',
      identity_features_not_found:
        'We could not find your photo, or the lines of letters and numbers, on your ID. Photograph the side with your photo on it, with the whole ID in the frame.',
      resolution_too_low:
        'Your ID was too small in the photo. Move your device closer, so the ID fills most of the frame.',
      back_feature_not_found:
        'We could not read the back of your ID. Turn it over and photograph the back, sharp and without glare, so its barcode or its lines of letters and numbers can be read.',
      portrait_too_small:
        'The photo of your face on the ID was too small to see. Move your device closer, so the ID fills most of the frame.',
      portrait_blurry:
        'The photo of your face on the ID was not sharp. Hold your device steady and wait for the image to come into focus.',
      portrait_obstructed:
        'Something covered the photo of your face on the ID. Keep your fingers and any glare away from it.',
      mrz_not_found:
        'We could not find the lines of letters, numbers and <<< signs on your ID. Make sure the whole ID is in the frame, including its bottom edge.',
      mrz_unreadable:
        'We could not read the lines of letters, numbers and <<< signs on your ID. Hold your device steady and avoid glare, so those lines are sharp.',
      barcode_not_found:
        'We could not find the barcode on your ID. Photograph the side with the barcode, with the whole ID in the frame and no glare on the barcode.',
      required_fields_missing:
        'We could not read all the details on your ID. Make sure the whole ID is in the frame, sharp and without glare.',
      // C39.2: the frozen selfie user-behaviour reasons (Phase 4).
      face_too_small:
        'Your face was too small in the photo. Move closer, so your face fills the oval.',
      face_glare: 'Light was reflecting off your face. Turn away from direct light and try again.',
      pose_not_center:
        'Look straight at the camera for the first photo, with your face in the middle of the oval.',
      pose_not_left:
        'Your head was not turned far enough to the left. When asked, slowly turn your head to the left and hold it there.',
      pose_not_right:
        'Your head was not turned far enough to the right. When asked, slowly turn your head to the right and hold it there.',
      face_covered:
        'Part of your face was covered. Remove any mask or scarf, and keep your hands away from your face.',
      glasses_detected: 'Take off your glasses, then try again.',
      // C51.2: the frozen Phase 5 user-behaviour reasons.
      document_type_not_accepted:
        'This type of document is not accepted here. Upload one of the document types this step lists.',
      document_unreadable:
        'We could not open or read your document. Upload a clear photo or a PDF of the whole document.',
      document_password_protected:
        'Your PDF is protected with a password. Upload a copy without a password, or a photo of the document.',
      document_too_large:
        'Your file is too large. Upload a smaller file, such as a photo of the document or a PDF with fewer pages.',
      document_too_many_pages:
        'Your PDF has too many pages. Upload only the pages that show your name, your address and the date.',
      name_not_found:
        'We could not find a name on your document. Upload a document that shows your full name.',
      address_not_found:
        'We could not find an address on your document. Upload a document that shows your full address.',
      issue_date_not_found:
        'We could not find the date your document was issued. Upload a document that shows its issue date.',
      issuer_not_found:
        'We could not find who issued your document. Upload a document that shows the company or office that issued it.',
      document_expired: 'Your document has expired. Upload one that is still valid.',
      document_too_old: 'Your document is too old. Upload a more recent one.',
      po_box_detected:
        'A post office box cannot be used as your address. Enter the address where you live.',
      otp_attempts_exhausted:
        'Too many incorrect codes were entered. Start again to get a new code.',
      otp_not_confirmed: 'The code was not confirmed in time. Start again to get a new code.',
      domain_not_found:
        'The part of your email address after the @ does not exist. Check it for typing mistakes.',
      domain_rejects_mail: 'This email domain does not accept email. Use another email address.',
      no_mail_server:
        'No email can be delivered to this address. Check it, or use another email address.',
      address_invalid:
        'This wallet address is not valid for the network you chose. Check that you copied the whole address.',
      address_checksum_invalid:
        'This wallet address has a typing mistake. Copy it again from your wallet instead of typing it.',
      signature_invalid:
        'The signature could not be read. Sign the message again in your wallet and paste the whole signature.',
      signature_address_mismatch:
        'The message was signed by a different wallet address. Sign it with the address you entered.',
      expected_address_mismatch:
        'This is not the wallet address you were asked to verify. Use the expected wallet address.',
      country_not_enabled:
        'Businesses from this country cannot be verified here. Check the country you selected.',
      domain_not_resolving:
        'We could not find this website. Check the web address for typing mistakes.',
      document_name_mismatch:
        'The name on your document does not match yours. Upload a document in your own name.',
    },
  },
  // `flow.completion` and `flow.failure` are the default template's message keys (C7).
  flow: {
    completion: 'Thank you. Your verification has been submitted, and you can close this page.',
    failure:
      'We could not verify your identity. Contact the organization that asked you to verify.',
  },
  completion: {
    title: 'Verification submitted',
  },
  failure: {
    title: 'Verification not completed',
  },
  // C128.7 (K9-33): the words around a decision's contest route; the route itself is the
  // operator's text, shown as written, and {{host}} and {{contact}} are isolated in <bdi>.
  contest: {
    heading: 'Ask for a review',
    intro: 'If you disagree with the result, a person can review it.',
    host: 'This link opens {{host}}',
    link: 'Ask for a review',
    contact: 'You can also reach: {{contact}}',
  },
  expired: {
    title: 'This verification link has expired',
    message: 'Ask the organization that sent it for a new link.',
  },
  // Screens for a session the user can no longer continue (C19); none offers a retry.
  ended: {
    expired: {
      title: 'Your verification session has expired',
      message:
        'For your security, a verification session ends after a while. Ask the organization that asked you to verify for a new link.',
    },
    canceled: {
      title: 'This verification session has ended',
      message:
        'The session was closed, for example because the verification was finished or withdrawn. If you still need to verify, ask the organization that asked you to verify for a new link.',
    },
    redacted: {
      title: 'This verification is no longer available',
      message:
        'The information in this verification has been deleted, so it cannot continue. If you still need to verify, contact the organization that asked you to verify.',
    },
  },
  sandbox: {
    label: 'Sandbox',
    message: 'This is a test verification. Use test data only, never a real ID.',
  },
  unsupported: {
    title: 'This step is not available here',
    step: 'This verification includes a step that this version of the web flow does not support yet: {{step}}.',
    flow: 'This verification uses a rule that this version of the web flow does not support yet.',
    contact: 'Contact the organization that asked you to verify.',
    steps: {
      form: 'a form',
      document: 'a document upload',
      phone_otp: 'a code sent to your phone',
      email_otp: 'a code sent to your email',
      database: 'a check of your details against a database',
      aamva: 'a check of your driving licence details with its issuer',
      nfc: 'reading the chip in your ID, which needs the mobile app',
      crypto_wallet: 'proving that you control a crypto wallet',
      database_business: 'a check of your business against business registries',
      business_website: 'a check of your business website',
    },
  },
  link: {
    title: 'We could not open your verification',
    missing:
      'Open this page from the verification link you received. The link is missing or incomplete.',
    invalid:
      'This verification link is not valid. Check that you opened the whole link, or ask for a new one.',
    mismatch: 'This link belongs to a different verification. Open the latest link you received.',
    used: 'This link has already been used or has expired. Each link works only once. Ask the organization that sent it for a new one.',
    reloaded:
      'This page was opened from a one-time link, which works only once, so it cannot be reloaded. Open the link you received again, or ask for a new one if it no longer works.',
  },
  errors: {
    title: 'Something went wrong',
    network: 'We could not reach the verification service. Check your connection and try again.',
    timeout:
      'The verification service took too long to answer. Check your connection and try again.',
    unauthorized:
      'This verification link is no longer valid. Ask the organization that sent it for a new one.',
    conflict: 'Your verification changed, perhaps in another window. Try again to continue.',
    tooLarge: 'This photo is larger than 10 MB. Retake it or choose a smaller photo.',
    unsupportedImage: 'We could not use this photo. Retake it or choose a JPEG, PNG or WebP photo.',
    // C64.1: a refusal of something the user typed or pasted, which the screen has no words for.
    notAccepted: 'This was not accepted. Check what you entered and try again.',
    rateLimited: 'Too many attempts in a short time. Wait a moment, then try again.',
    server: 'The verification service is having trouble. Try again in a few minutes.',
    unexpected: 'Something went wrong. Try again.',
    retry: 'Try again',
  },
  notFound: {
    title: 'Page not found',
    back: 'Start over',
  },
} as const;

/** The plural categories English never needs and other languages may (C161.6). */
type ExtraPluralCategory = 'zero' | 'two' | 'few' | 'many';

/** For each `<base>_other` message of `T`, the optional `<base>_zero`, `_two`, `_few` and `_many`. */
type PluralForms<T> = {
  [
    K in keyof T as K extends `${infer Base}_other` ? `${Base}_${ExtraPluralCategory}` : never
  ]?: string;
};

/**
 * A locale's shape: the same keys as `T`, any wording, plus the plural forms its language needs
 * (Arabic's six, `many` in French and Spanish). Each step's locale modules use it too.
 */
export type Widen<T> = {
  -readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]>;
} & PluralForms<T>;

/** The shape every locale must match: the same keys as English, any wording. */
export type Messages = Widen<typeof en>;
