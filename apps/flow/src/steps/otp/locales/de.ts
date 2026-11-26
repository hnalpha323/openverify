import type { Widen } from '../../../i18n/locales/en';
import type { otpEn } from './en';

/**
 * German messages of the phone and email one-time-code steps (C55, C64.1). Machine-drafted by the
 * build agents (C161.5): the person is addressed as „Sie“, with no gendered noun.
 */
export const otpDe: Widen<typeof otpEn> = {
  send: 'Code senden',
  sending: 'Ihr Code wird gesendet…',
  phone: {
    title: 'Bestätigen Sie Ihre Telefonnummer',
    intro:
      'Wir senden einen Code per SMS an Ihr Telefon. Es können die üblichen Kosten für Nachrichten anfallen.',
    country: 'Land',
    countryOption: '{{country}} ({{code}})',
    number: 'Telefonnummer',
    numberHint: 'Sie können die Ländervorwahl weglassen.',
    change: 'Telefonnummer ändern',
    errors: {
      required: 'Geben Sie Ihre Telefonnummer ein.',
      invalid: 'Geben Sie eine gültige Telefonnummer für das gewählte Land ein.',
      notAllowed:
        'An diese Nummer können hier keine Codes gesendet werden. Verwenden Sie eine Nummer aus einem der aufgeführten Länder.',
      destinationInvalid:
        'Diese Nummer kann keinen Code empfangen. Prüfen Sie sie oder verwenden Sie eine andere Telefonnummer.',
      deliveryFailed:
        'Wir konnten keinen Code an diese Nummer senden. Prüfen Sie sie und versuchen Sie es erneut, oder verwenden Sie eine andere Nummer.',
    },
  },
  email: {
    title: 'Bestätigen Sie Ihre E-Mail-Adresse',
    intro: 'Wir senden einen Code an Ihre E-Mail-Adresse.',
    address: 'E-Mail-Adresse',
    change: 'E-Mail-Adresse ändern',
    errors: {
      required: 'Geben Sie Ihre E-Mail-Adresse ein.',
      invalid:
        'Geben Sie eine E-Mail-Adresse im richtigen Format ein, zum Beispiel name@example.com.',
      notAllowed:
        'An diese E-Mail-Adresse können hier keine Codes gesendet werden. Verwenden Sie eine andere E-Mail-Adresse.',
      destinationInvalid:
        'Diese E-Mail-Adresse kann keinen Code empfangen. Prüfen Sie sie oder verwenden Sie eine andere E-Mail-Adresse.',
      deliveryFailed:
        'Wir konnten keinen Code an diese E-Mail-Adresse senden. Prüfen Sie sie und versuchen Sie es erneut, oder verwenden Sie eine andere E-Mail-Adresse.',
    },
  },
  code: {
    title: 'Code eingeben',
    sentTo: 'Wir haben einen Code an {{destination}} gesendet.',
    sentAgain: 'Wir haben einen neuen Code an {{destination}} gesendet.',
    label: 'Bestätigungscode',
    hint: 'Der Code hat {{length}} Ziffern.',
    confirm: 'Bestätigen',
    checking: 'Ihr Code wird geprüft…',
    attemptsLeft: 'Verbleibende Versuche für diesen Code: {{remaining}}',
    expiresAt: 'Der Code läuft um {{time}} ab.',
    resend: 'Neuen Code senden',
    resendIn: 'Sie können in {{time}} einen neuen Code anfordern.',
    resendReady: 'Sie können jetzt einen neuen Code anfordern.',
    noResend: 'Es können keine weiteren Codes gesendet werden.',
    expiredFinal:
      'Dieser Code ist abgelaufen, und es können keine weiteren Codes gesendet werden. Beginnen Sie von vorn, um einen neuen Code zu erhalten.',
    startAgain: 'Von vorn beginnen',
    errors: {
      required: 'Geben Sie den Code ein, den wir Ihnen gesendet haben.',
      format: 'Geben Sie den {{length}}-stelligen Code ein.',
      incorrect: 'Dieser Code ist nicht korrekt. Prüfen Sie ihn und versuchen Sie es erneut.',
      expired: 'Dieser Code ist abgelaufen. Fordern Sie einen neuen Code an.',
      exhausted: 'Zu viele falsche Versuche für diesen Code. Fordern Sie einen neuen Code an.',
      notSent: 'Fordern Sie zuerst einen Code an.',
      tooSoon: 'Warten Sie kurz, bevor Sie einen neuen Code anfordern.',
    },
  },
  limited: {
    title: 'Wir können Ihnen gerade keinen Code senden',
    message:
      'Wir konnten gerade keinen Code für Sie senden oder prüfen. Sie können fortfahren; die Organisation, die Ihre Verifizierung angefordert hat, prüft sie dann.',
    continue: 'Weiter',
    continuing: 'Ihre Verifizierung wird gesendet…',
    failed: 'Wir konnten nicht fortfahren. Warten Sie eine Weile und versuchen Sie es dann erneut.',
  },
  confirmed: {
    title: 'Ihr Code wurde bestätigt',
    submitting: 'Ihre Verifizierung wird gesendet…',
  },
};
