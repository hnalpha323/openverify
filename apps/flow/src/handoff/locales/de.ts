import type { Widen } from '../../i18n/locales/en';
import type { handoffEn } from './en';

/** German messages of device handoff (C96.5). Machine-drafted by the build agents (C161.5). */
export const handoffDe: Widen<typeof handoffEn> = {
  desktop: {
    title: 'Auf dem Telefon fortfahren',
    intro:
      'Scannen Sie diesen Code mit der Kamera Ihres Telefons, um diese Verifizierung auf dem Telefon fortzusetzen. Ihr bisheriger Fortschritt bleibt erhalten.',
    issuing: 'Ein Code für Ihr Telefon wird abgerufen…',
    qrLabel: 'QR-Code, der diese Verifizierung auf Ihrem Telefon öffnet',
    linkLabel: 'Oder öffnen Sie diesen Link auf Ihrem Telefon',
    copy: 'Link kopieren',
    copied: 'Link kopiert.',
    expiresIn: 'Dieser Code läuft in {{time}} ab.',
    expired:
      'Dieser Code ist abgelaufen. Rufen Sie einen neuen ab, um auf dem Telefon fortzufahren.',
    newCode: 'Neuen Code abrufen',
    confirmationCode: 'Wenn Ihr Telefon nach einem Code fragt, geben Sie ein: {{code}}',
    emailOption: 'Stattdessen einen Link per E-Mail senden',
    smsOption: 'Stattdessen einen Link per SMS senden',
    emailLabel: 'E-Mail-Adresse',
    smsLabel: 'Telefonnummer mit Ländervorwahl',
    smsHint: 'Zum Beispiel +1 202 555 0123.',
    send: 'Link senden',
    sending: 'Der Link wird gesendet…',
    sentEmail:
      'Wir haben einen Link an Ihre E-Mail-Adresse gesendet. Öffnen Sie ihn innerhalb von {{minutes}} Minuten auf Ihrem Telefon.',
    sentSms:
      'Wir haben einen Link per SMS an Ihr Telefon gesendet. Öffnen Sie ihn innerhalb von {{minutes}} Minuten.',
    showQr: 'Stattdessen einen QR-Code anzeigen',
    continueHere: 'Auf diesem Gerät fortfahren',
    continuing: 'Es geht auf diesem Gerät weiter…',
    waitingTitle: 'Es geht auf Ihrem Telefon weiter',
    waiting:
      'Sie haben um {{time}} auf Ihrem Telefon weitergemacht. Schließen Sie die Verifizierung dort ab; diese Seite aktualisiert sich, wenn Sie fertig sind.',
    waitingDevice: 'Ihr Telefon: {{device}}',
    notMe: 'Das war ich nicht',
    rejecting: 'Die Sitzung auf dem anderen Gerät wird beendet…',
    rejected:
      'Wir haben die Sitzung auf dem anderen Gerät beendet und abgebrochen, was dort noch nicht fertig war. Rufen Sie einen neuen Code ab, oder fahren Sie hier fort.',
    declined:
      'Das andere Gerät hat das Fortfahren abgelehnt. Rufen Sie einen neuen Code ab, oder fahren Sie hier fort.',
    errors: {
      destinationNotConfirmed:
        'Ein Link kann nur an eine E-Mail-Adresse oder Telefonnummer gesendet werden, die Sie zuvor in dieser Verifizierung bestätigt haben.',
      sendLimited:
        'Es wurden zu viele Links gesendet. Warten Sie eine Weile, oder verwenden Sie den QR-Code.',
      required: 'Geben Sie an, wohin der Link gesendet werden soll.',
    },
  },
  phone: {
    title: 'Verifizierung fortsetzen',
    loading: 'Ihr Link wird geprüft…',
    requester: '{{organization}} möchte Ihre Identität verifizieren.',
    verifies: 'Auf diesem Telefon werden Sie um Folgendes gebeten:',
    started: 'Diese Verifizierung wurde um {{time}} auf einem anderen Gerät begonnen.',
    startedIn:
      'Diese Verifizierung wurde um {{time}} auf einem anderen Gerät in {{country}} begonnen.',
    adviceQr:
      'Fahren Sie nur fort, wenn Sie diesen Code gerade auf der Website von {{organization}} gescannt haben. Wenn Ihnen jemand diesen Code geschickt hat, lehnen Sie ab.',
    adviceLink:
      'Fahren Sie nur fort, wenn Sie diesen Link gerade auf der Website von {{organization}} angefordert haben. Andernfalls lehnen Sie ab.',
    codeLabel: 'Auf Ihrem anderen Gerät angezeigter Code',
    codeHint: 'Sechs Ziffern.',
    codeRequired:
      'Geben Sie den sechsstelligen Code ein, der auf Ihrem anderen Gerät angezeigt wird.',
    checkCode: 'Code prüfen',
    checking: 'Der Code wird geprüft…',
    continue: 'Weiter',
    continuing: 'Ihre Verifizierung wird geöffnet…',
    decline: 'Ablehnen',
    declining: 'Wird abgelehnt…',
    declinedTitle: 'Sie haben abgelehnt',
    declined: 'Von diesem Telefon wurde nichts geteilt. Sie können diese Seite schließen.',
    invalid:
      'Dieser Link ist ungültig, abgelaufen oder wurde schon verwendet. Kehren Sie zu dem Gerät zurück, auf dem Sie begonnen haben, um einen neuen Code zu erhalten.',
    limitTitle: 'Diese Verifizierung kann hier nicht fortgesetzt werden',
    limit:
      'Diese Verifizierung kann nicht auf einem anderen Gerät fortgesetzt werden. Kehren Sie zu dem Gerät zurück, auf dem Sie begonnen haben.',
  },
  steps: {
    form: 'einige Angaben zu Ihrer Person',
    government_id: 'ein Foto Ihres Ausweisdokuments',
    selfie: 'ein Selfie',
    document: 'das Hochladen eines Dokuments',
    phone_otp: 'ein Code, der an Ihr Telefon gesendet wird',
    email_otp: 'ein Code, der an Ihre E-Mail-Adresse gesendet wird',
    database: 'ein Abgleich Ihrer Angaben mit einer Datenbank',
    aamva: 'eine Prüfung Ihrer Führerscheindaten bei der ausstellenden Stelle',
    nfc: 'das Auslesen des Chips in Ihrem Ausweisdokument',
    crypto_wallet: 'der Nachweis, dass Sie eine Krypto-Wallet kontrollieren',
    database_business: 'eine Prüfung Ihres Unternehmens in Unternehmensregistern',
    business_website: 'eine Prüfung der Website Ihres Unternehmens',
  },
};
