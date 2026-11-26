import { cryptoWalletDe } from '../../steps/crypto-wallet/locales/de';
import { shareConsentDe } from '../../steps/share-consent/locales/de';
import { nfcDe } from '../../steps/nfc/locales/de';
import { documentDe } from '../../steps/document/locales/de';
import { screenDe } from '../../screens/locales/de';
import { formsDe } from '../../steps/forms/locales/de';
import { handoffDe } from '../../handoff/locales/de';
import { otpDe } from '../../steps/otp/locales/de';
import type { Messages } from './en';

/**
 * German messages (C161.1). Machine-drafted by the build agents, which is machine translation, and
 * shipped `machine-drafted` until a fluent person reviews them (C161.5, decisions 31 and 67).
 * Translator notes: the person is addressed as „Sie“, with no gendered noun for them or for
 * anyone else (C161.6); placeholders keep their `{{name}}` syntax. The consent and notice texts
 * are legal texts: drafted, not reviewed.
 */
export const de: Messages = {
  app: {
    name: 'OpenVerify',
    language: 'Sprache',
  },
  loading: 'Ihre Verifizierung wird geladen…',
  attempt: 'Versuch {{current}} von {{max}}',
  consent: {
    title: 'Einwilligung in die Nutzung Ihrer biometrischen Daten',
    biometric:
      'Um Ihre Identität zu bestätigen, vergleichen wir ein Selfie mit dem Foto in Ihrem Ausweisdokument. Dieser Vergleich nutzt biometrische Daten: Messwerte Ihrer Gesichtszüge. Ihre biometrischen Daten werden nur genutzt, um Ihre Identität für diese Anfrage zu verifizieren.',
    processing:
      'Wir verarbeiten die Fotos Ihres Ausweisdokuments und Ihr Selfie nur für diese Verifizierung. Sie werden gelöscht, sobald die Organisation, die diese Verifizierung angefordert hat, sie nicht mehr benötigt, gemäß ihren Aufbewahrungsregeln. Sie können jederzeit aufhören, indem Sie diese Seite schließen.',
    'biometric-matching':
      'Optional: Wir vergleichen Ihr Selfie und seinen Hintergrund auch mit früheren Selfies, die an diese Organisation gesendet wurden, damit niemand mehrere Identitäten nutzen kann. Eine Vorlage Ihres Gesichts wird {{days}} Tage lang aufbewahrt. Sie können sich auch verifizieren, wenn Sie dieses Kästchen nicht ankreuzen.',
    'device-recognition':
      'Optional: Dieses Gerät bei späteren Besuchen wiedererkennen, um mein Konto vor Missbrauch zu schützen.',
    'automated-decision':
      'Optional: Ich bin einverstanden, dass über diese Verifizierung anhand meiner biometrischen Daten automatisierte Entscheidungen getroffen werden können, ohne dass eine Person sie vorher prüft. Sie können verlangen, dass eine Person eine Entscheidung prüft.',
    checkbox:
      'Ich willige in die Erhebung und Nutzung meiner biometrischen Daten wie oben beschrieben ein.',
    continue: 'Weiter',
    saving: 'Ihre Einwilligung wird gespeichert…',
    unavailable:
      'Diese Verifizierung bittet Sie, einem Text zuzustimmen, den diese Version nicht anzeigen kann. Wenden Sie sich an die Organisation, die Sie um die Verifizierung gebeten hat.',
  },
  notice: {
    'session-integrity':
      'Um Ihre Verifizierung vor Betrug zu schützen, prüft diese Seite, wie sie genutzt wird, etwa ob ein Browser automatisiert ist. Sie liest weder Ihre Tastenanschläge noch das, was Sie eingeben.',
    'device-recognition':
      'Dieser Dienst erkennt das Gerät, das Sie nutzen, wieder, um Konten vor Missbrauch zu schützen.',
    'play-integrity':
      'Um Ihre Verifizierung vor Betrug zu schützen, bittet die App, die Sie verwenden, Google Play zu bestätigen, dass sie die echte App auf einem unveränderten Gerät ist. Dazu erhält Google den Paketnamen, die Version und das Signaturzertifikat der App, ihren Lizenzstatus und eine Bestätigung der Integrität dieses Geräts.',
  },
  nativeApp: {
    consent: {
      processing:
        'Wir verarbeiten die Fotos Ihres Ausweisdokuments und Ihr Selfie nur für diese Verifizierung. Sie werden gelöscht, sobald die Organisation, die diese Verifizierung angefordert hat, sie nicht mehr benötigt, gemäß ihren Aufbewahrungsregeln. Sie können jederzeit aufhören, indem Sie diesen Bildschirm schließen.',
      'biometric-matching-checkbox':
        'Ja, mein Selfie auch mit früheren Selfies vergleichen (freiwillig)',
      'device-recognition-checkbox':
        'Ja, dieses Gerät bei späteren Besuchen wiedererkennen (freiwillig)',
      'automated-decision-checkbox':
        'Ja, automatisierte Entscheidungen anhand meiner biometrischen Daten erlauben (freiwillig)',
    },
    notice: {
      'session-integrity':
        'Um Ihre Verifizierung vor Betrug zu schützen, prüft diese App, wie sie genutzt wird: ob ein Debugger verbunden ist und ob es Anzeichen für einen Emulator, ein gerootetes Gerät oder ein Manipulationswerkzeug gibt. Dazu liest sie die Build-Eigenschaften des Geräts, den eigenen Prozess der App (seine Speicherzuordnung, Thread-Namen und geladenen Klassen), die Mount-Tabelle und ob bekannte Dateien vorhanden sind, und sendet nur die Namen der gefundenen Anzeichen. Sie liest nicht, was Sie eingeben, und nicht, welche anderen Apps Sie haben.',
    },
  },
  camera: {
    title: 'Kamerazugriff',
    intro:
      'Als Nächstes brauchen wir Ihre Kamera, um Fotos Ihres Ausweisdokuments und ein Selfie aufzunehmen.',
    request: 'Kamerazugriff erlauben',
    requesting: 'Warten auf die Kameraberechtigung…',
    ready: 'Ihre Kamera ist bereit.',
    errors: {
      'permission-denied':
        'Der Kamerazugriff ist blockiert. Erlauben Sie ihn in den Einstellungen Ihres Browsers und versuchen Sie es dann erneut.',
      'no-camera':
        'Wir konnten keine Kamera finden. Schließen Sie eine an oder wechseln Sie zu einem Gerät mit Kamera.',
      'constraints-not-satisfied':
        'Ihre Kamera unterstützt die nötigen Einstellungen nicht. Versuchen Sie eine andere Kamera oder ein anderes Gerät.',
      'camera-in-use':
        'Eine andere App nutzt Ihre Kamera. Schließen Sie diese App und versuchen Sie es dann erneut.',
      'insecure-context': 'Der Kamerazugriff erfordert eine sichere Verbindung (https).',
      unsupported:
        'Dieser Browser kann keine Kamera nutzen. Versuchen Sie es mit einem aktuellen Browser.',
      unknown: 'Beim Starten Ihrer Kamera ist ein Fehler aufgetreten. Versuchen Sie es erneut.',
    },
  },
  capture: {
    progress: 'Foto {{current}} von {{total}}',
    takePhoto: 'Foto aufnehmen',
    uploadPhoto: 'Foto hochladen',
    startingCamera: 'Ihre Kamera wird gestartet…',
    cameraReady: 'Ihre Kamera ist bereit. Wählen Sie „Aufnehmen“, um das Foto zu machen.',
    photoReady: 'Ihr Foto kann geprüft werden. Verwenden Sie es oder nehmen Sie es neu auf.',
    preview: 'Kameravorschau',
    shutter: 'Aufnehmen',
    cancel: 'Abbrechen',
    back: 'Zurück',
    tryAgain: 'Erneut versuchen',
    captureFailed: 'Wir konnten das Foto nicht aufnehmen. Versuchen Sie es erneut.',
    uploadInstead: 'Sie können stattdessen auch ein Foto hochladen.',
    checkPhoto:
      'Prüfen Sie, ob das Foto scharf und gut beleuchtet ist und alles zeigt, worum wir gebeten haben.',
    retake: 'Neu aufnehmen',
    usePhoto: 'Dieses Foto verwenden',
    barcodeHint: 'Achten Sie darauf, dass der Barcode scharf und innerhalb des Rahmens ist.',
    photoCheck: {
      blurry:
        'Dieses Foto wirkt unscharf. Halten Sie Ihren Ausweis bei gutem Licht ruhig, lassen Sie die Kamera scharf stellen und nehmen Sie es erneut auf.',
      'too-small':
        'Die Auflösung dieses Fotos ist zu gering, um Ihren Ausweis zu lesen. Nehmen Sie es erneut auf, oder verwenden Sie eine andere Kamera, wenn das Problem bleibt.',
      useAnyway: 'Dieses Foto trotzdem verwenden',
    },
    fileErrors: {
      empty: 'Diese Datei ist leer. Wählen Sie ein anderes Foto aus.',
      'too-large': 'Dieses Foto ist größer als 10 MB. Wählen Sie ein kleineres Foto aus.',
      'unsupported-type':
        'Diese Datei ist kein unterstütztes Bild. Wählen Sie ein JPEG-, PNG- oder WebP-Foto aus.',
      unreadable: 'Wir konnten diese Datei nicht lesen. Wählen Sie ein anderes Foto aus.',
    },
  },
  governmentId: {
    title: 'Fotografieren Sie Ihren Ausweis',
    intro:
      'Verwenden Sie einen gültigen amtlichen Ausweis. Legen Sie ihn bei gutem Licht auf eine ebene Fläche, sodass alle vier Ecken zu sehen sind.',
    front: {
      title: 'Vorderseite Ihres Ausweises',
      instruction: 'Bringen Sie die Vorderseite Ihres Ausweises in den Rahmen.',
      alt: 'Ihr Foto der Vorderseite Ihres Ausweises',
      upload: 'Ein Foto der Vorderseite Ihres Ausweises auswählen',
    },
    back: {
      title: 'Rückseite Ihres Ausweises',
      instruction: 'Drehen Sie Ihren Ausweis um und bringen Sie die Rückseite in den Rahmen.',
      alt: 'Ihr Foto der Rückseite Ihres Ausweises',
      upload: 'Ein Foto der Rückseite Ihres Ausweises auswählen',
    },
  },
  selfie: {
    title: 'Nehmen Sie ein Selfie auf',
    intro:
      'Wir vergleichen Ihr Selfie mit dem Foto in Ihrem Ausweis. Nehmen Sie Sonnenbrille und Hut ab und suchen Sie sich einen gut beleuchteten Ort.',
    center: {
      title: 'Schauen Sie geradeaus',
      instruction: 'Bringen Sie Ihr Gesicht in das Oval und schauen Sie direkt in die Kamera.',
      alt: 'Ihr Selfie, geradeaus schauend',
      upload: 'Ein Selfie auswählen, geradeaus schauend',
    },
    left: {
      title: 'Drehen Sie den Kopf nach links',
      instruction: 'Lassen Sie Ihr Gesicht im Oval und drehen Sie den Kopf langsam nach links.',
      alt: 'Ihr Selfie, mit nach links gedrehtem Kopf',
      upload: 'Ein Selfie auswählen, mit nach links gedrehtem Kopf',
    },
    right: {
      title: 'Drehen Sie den Kopf nach rechts',
      instruction: 'Lassen Sie Ihr Gesicht im Oval und drehen Sie den Kopf langsam nach rechts.',
      alt: 'Ihr Selfie, mit nach rechts gedrehtem Kopf',
      upload: 'Ein Selfie auswählen, mit nach rechts gedrehtem Kopf',
    },
    howItWorks:
      'Wir bitten Sie, direkt in die Kamera zu schauen und den Kopf zu drehen, wenn Sie dazu aufgefordert werden. Jedes Foto wird automatisch aufgenommen, sobald Sie stillhalten.',
    howItWorksCenter:
      'Schauen Sie direkt in die Kamera. Das Foto wird automatisch aufgenommen, sobald Sie stillhalten.',
    start: 'Kamera starten',
    uploadInstead: 'Fotos hochladen',
    preparing: 'Vorbereitung',
    opening: 'Ihr Selfie wird gestartet…',
    prompt: 'Foto {{current}} von {{total}}: {{title}}',
    uploadingPose: 'Foto {{current}} von {{total}} wird hochgeladen…',
    submitting: 'Ihre Fotos werden gesendet…',
    restarted:
      'Ihre Selfie-Sitzung endete, bevor alle Fotos gesendet waren, deshalb haben wir neu begonnen. Folgen Sie den Hinweisen noch einmal.',
    shutterSoon:
      'Das Foto wird automatisch aufgenommen, wenn Sie stillhalten. In wenigen Sekunden können Sie es auch selbst aufnehmen.',
    shutterReady: 'Wenn das Foto nicht automatisch aufgenommen wird, wählen Sie „Aufnehmen“.',
    retakePose: 'Dieses Foto neu aufnehmen',
    guidance: {
      starting: 'Die Gesichtsführung wird vorbereitet…',
      manual: 'Halten Sie die Position und wählen Sie dann „Aufnehmen“.',
      'no-face': 'Wir sehen Ihr Gesicht nicht. Bringen Sie Ihr Gesicht in das Oval.',
      'multiple-faces': 'Achten Sie darauf, dass nur Ihr Gesicht im Bild ist.',
      'too-far': 'Gehen Sie näher an die Kamera heran.',
      'too-close': 'Gehen Sie etwas zurück.',
      'off-centre': 'Bringen Sie Ihr Gesicht in die Mitte des Ovals.',
      'look-straight': 'Schauen Sie direkt in die Kamera.',
      'turn-left': 'Drehen Sie den Kopf langsam nach links.',
      'turn-right': 'Drehen Sie den Kopf langsam nach rechts.',
      'hold-still': 'Bitte stillhalten…',
    },
  },
  otp: otpDe,
  handoff: handoffDe,
  cryptoWallet: cryptoWalletDe,
  // C238.6, C237.6 (Workflow 11A, clients-connect): the share-consent step; share.consent.* are
  // legal texts, counsel-unreviewed (C238.10), machine-drafted outside en (C161.5).
  share: shareConsentDe,
  // C207.10 (Workflow 10C, api-nfc): the nfc step in a browser; machine-drafted outside en (C161.5).
  nfc: nfcDe,
  forms: formsDe,
  document: documentDe,
  // C148.7, C150.5, C151.2, C158.5, C171.4 (Workflow 9A, flow-renderer): machine-drafted (C161.5).
  screen: screenDe,
  submission: {
    uploading: 'Ihre Fotos werden hochgeladen…',
    retry: 'Erneut versuchen',
    retake: 'Fotos neu aufnehmen',
  },
  processing: {
    title: 'Ihre Fotos werden geprüft',
    verificationTitle: 'Ihre Verifizierung wird geprüft',
    message: 'Das dauert meist nur wenige Sekunden. Lassen Sie diese Seite geöffnet.',
    slow: 'Das dauert länger als üblich.',
    checkAgain: 'Erneut prüfen',
  },
  finalizing: {
    title: 'Ihre Verifizierung wird abgeschlossen',
    message: 'Das dauert meist nur wenige Sekunden. Lassen Sie diese Seite geöffnet.',
  },
  retry: {
    title: 'Wir konnten Ihre letzten Fotos nicht verwenden',
    attemptTitle: 'Ihr letzter Versuch ist nicht durchgegangen',
    generic:
      'Etwas auf dem Foto war nicht deutlich genug. Versuchen Sie es bei gutem Licht erneut.',
    reasons: {
      image_blurry:
        'Das Foto war unscharf. Halten Sie Ihr Gerät ruhig und warten Sie, bis das Bild scharf ist.',
      glare_present:
        'Auf Ihrem Ausweis war eine Spiegelung. Gehen Sie aus dem direkten Licht oder kippen Sie den Ausweis leicht.',
      portrait_not_present:
        'Wir konnten das Foto auf Ihrem Ausweis nicht finden. Achten Sie darauf, dass die ganze Vorderseite im Rahmen ist.',
      front_not_present: 'Wir brauchen ein Foto der Vorderseite Ihres Ausweises.',
      back_not_present: 'Wir brauchen ein Foto der Rückseite Ihres Ausweises.',
      image_too_dark: 'Das Foto war zu dunkel. Suchen Sie sich einen helleren Ort.',
      image_too_bright: 'Das Foto war zu hell. Gehen Sie aus starkem Licht.',
      face_not_present: 'Wir konnten Ihr Gesicht nicht sehen. Bringen Sie Ihr Gesicht in das Oval.',
      multiple_faces_present:
        'Auf dem Foto war mehr als ein Gesicht. Achten Sie darauf, dass nur Sie im Bild sind.',
      image_unreadable:
        'Wir konnten das Foto nicht öffnen. Nehmen Sie ein neues auf oder wählen Sie ein JPEG-, PNG- oder WebP-Bild.',
      document_not_found:
        'Wir konnten Ihren Ausweis auf dem Foto nicht finden. Legen Sie ihn auf eine einfarbige, kontrastreiche Fläche, sodass alle vier Ecken im Rahmen sind.',
      insufficient_text:
        'Wir konnten den Text auf Ihrem Ausweis nicht lesen. Achten Sie darauf, dass das Foto scharf, gut beleuchtet und ohne Spiegelung ist und den ganzen Ausweis zeigt.',
      identity_features_not_found:
        'Wir konnten weder Ihr Foto noch die Zeilen aus Buchstaben und Ziffern auf Ihrem Ausweis finden. Fotografieren Sie die Seite mit Ihrem Foto, mit dem ganzen Ausweis im Rahmen.',
      resolution_too_low:
        'Ihr Ausweis war auf dem Foto zu klein. Gehen Sie mit dem Gerät näher heran, sodass der Ausweis den größten Teil des Rahmens ausfüllt.',
      back_feature_not_found:
        'Wir konnten die Rückseite Ihres Ausweises nicht lesen. Drehen Sie ihn um und fotografieren Sie die Rückseite scharf und ohne Spiegelung, damit ihr Strichcode oder ihre Zeilen aus Buchstaben und Ziffern lesbar sind.',
      portrait_too_small:
        'Das Foto Ihres Gesichts auf dem Ausweis war zu klein. Gehen Sie mit dem Gerät näher heran, sodass der Ausweis den größten Teil des Rahmens ausfüllt.',
      portrait_blurry:
        'Das Foto Ihres Gesichts auf dem Ausweis war nicht scharf. Halten Sie Ihr Gerät ruhig und warten Sie, bis das Bild scharf ist.',
      portrait_obstructed:
        'Etwas hat das Foto Ihres Gesichts auf dem Ausweis verdeckt. Halten Sie Finger und Spiegelungen davon fern.',
      mrz_not_found:
        'Wir konnten die Zeilen aus Buchstaben, Ziffern und <<<-Zeichen auf Ihrem Ausweis nicht finden. Achten Sie darauf, dass der ganze Ausweis im Rahmen ist, auch die Unterkante.',
      mrz_unreadable:
        'Wir konnten die Zeilen aus Buchstaben, Ziffern und <<<-Zeichen auf Ihrem Ausweis nicht lesen. Halten Sie Ihr Gerät ruhig und vermeiden Sie Spiegelungen, damit diese Zeilen scharf sind.',
      barcode_not_found:
        'Wir konnten den Strichcode auf Ihrem Ausweis nicht finden. Fotografieren Sie die Seite mit dem Strichcode, mit dem ganzen Ausweis im Rahmen und ohne Spiegelung auf dem Strichcode.',
      required_fields_missing:
        'Wir konnten nicht alle Angaben auf Ihrem Ausweis lesen. Achten Sie darauf, dass der ganze Ausweis scharf und ohne Spiegelung im Rahmen ist.',
      face_too_small:
        'Ihr Gesicht war auf dem Foto zu klein. Gehen Sie näher heran, sodass Ihr Gesicht das Oval ausfüllt.',
      face_glare:
        'Licht hat sich auf Ihrem Gesicht gespiegelt. Wenden Sie sich vom direkten Licht ab und versuchen Sie es erneut.',
      pose_not_center:
        'Schauen Sie beim ersten Foto direkt in die Kamera, mit Ihrem Gesicht in der Mitte des Ovals.',
      pose_not_left:
        'Ihr Kopf war nicht weit genug nach links gedreht. Drehen Sie den Kopf auf Aufforderung langsam nach links und halten Sie ihn dort.',
      pose_not_right:
        'Ihr Kopf war nicht weit genug nach rechts gedreht. Drehen Sie den Kopf auf Aufforderung langsam nach rechts und halten Sie ihn dort.',
      face_covered:
        'Ein Teil Ihres Gesichts war verdeckt. Nehmen Sie Maske oder Schal ab und halten Sie die Hände vom Gesicht fern.',
      glasses_detected: 'Nehmen Sie Ihre Brille ab und versuchen Sie es dann erneut.',
      document_type_not_accepted:
        'Diese Dokumentart wird hier nicht akzeptiert. Laden Sie eine der Dokumentarten hoch, die dieser Schritt nennt.',
      document_unreadable:
        'Wir konnten Ihr Dokument nicht öffnen oder lesen. Laden Sie ein deutliches Foto oder ein PDF des ganzen Dokuments hoch.',
      document_password_protected:
        'Ihr PDF ist mit einem Passwort geschützt. Laden Sie eine Kopie ohne Passwort oder ein Foto des Dokuments hoch.',
      document_too_large:
        'Ihre Datei ist zu groß. Laden Sie eine kleinere Datei hoch, etwa ein Foto des Dokuments oder ein PDF mit weniger Seiten.',
      document_too_many_pages:
        'Ihr PDF hat zu viele Seiten. Laden Sie nur die Seiten hoch, auf denen Ihr Name, Ihre Adresse und das Datum stehen.',
      name_not_found:
        'Wir konnten auf Ihrem Dokument keinen Namen finden. Laden Sie ein Dokument hoch, auf dem Ihr vollständiger Name steht.',
      address_not_found:
        'Wir konnten auf Ihrem Dokument keine Adresse finden. Laden Sie ein Dokument hoch, auf dem Ihre vollständige Adresse steht.',
      issue_date_not_found:
        'Wir konnten das Ausstellungsdatum Ihres Dokuments nicht finden. Laden Sie ein Dokument hoch, auf dem das Ausstellungsdatum steht.',
      issuer_not_found:
        'Wir konnten nicht erkennen, wer Ihr Dokument ausgestellt hat. Laden Sie ein Dokument hoch, auf dem das ausstellende Unternehmen oder die ausstellende Behörde steht.',
      document_expired: 'Ihr Dokument ist abgelaufen. Laden Sie eines hoch, das noch gültig ist.',
      document_too_old: 'Ihr Dokument ist zu alt. Laden Sie ein neueres hoch.',
      po_box_detected:
        'Ein Postfach kann nicht als Ihre Adresse verwendet werden. Geben Sie die Adresse ein, unter der Sie wohnen.',
      otp_attempts_exhausted:
        'Es wurden zu viele falsche Codes eingegeben. Beginnen Sie von vorn, um einen neuen Code zu erhalten.',
      otp_not_confirmed:
        'Der Code wurde nicht rechtzeitig bestätigt. Beginnen Sie von vorn, um einen neuen Code zu erhalten.',
      domain_not_found:
        'Der Teil Ihrer E-Mail-Adresse nach dem @ existiert nicht. Prüfen Sie ihn auf Tippfehler.',
      domain_rejects_mail:
        'Diese E-Mail-Domain nimmt keine E-Mails an. Verwenden Sie eine andere E-Mail-Adresse.',
      no_mail_server:
        'An diese Adresse kann keine E-Mail zugestellt werden. Prüfen Sie sie oder verwenden Sie eine andere E-Mail-Adresse.',
      address_invalid:
        'Diese Wallet-Adresse ist für das gewählte Netzwerk nicht gültig. Prüfen Sie, ob Sie die ganze Adresse kopiert haben.',
      address_checksum_invalid:
        'Diese Wallet-Adresse enthält einen Tippfehler. Kopieren Sie sie erneut aus Ihrer Wallet, statt sie abzutippen.',
      signature_invalid:
        'Die Signatur konnte nicht gelesen werden. Signieren Sie die Nachricht erneut in Ihrer Wallet und fügen Sie die ganze Signatur ein.',
      signature_address_mismatch:
        'Die Nachricht wurde von einer anderen Wallet-Adresse signiert. Signieren Sie sie mit der Adresse, die Sie eingegeben haben.',
      expected_address_mismatch:
        'Das ist nicht die Wallet-Adresse, die Sie verifizieren sollen. Verwenden Sie die erwartete Wallet-Adresse.',
      country_not_enabled:
        'Unternehmen aus diesem Land können hier nicht verifiziert werden. Prüfen Sie das gewählte Land.',
      domain_not_resolving:
        'Wir konnten diese Website nicht finden. Prüfen Sie die Webadresse auf Tippfehler.',
      document_name_mismatch:
        'Der Name auf Ihrem Dokument stimmt nicht mit Ihrem überein. Laden Sie ein Dokument auf Ihren eigenen Namen hoch.',
    },
  },
  flow: {
    completion:
      'Vielen Dank. Ihre Verifizierung wurde übermittelt, und Sie können diese Seite schließen.',
    failure:
      'Wir konnten Ihre Identität nicht verifizieren. Wenden Sie sich an die Organisation, die Sie um die Verifizierung gebeten hat.',
  },
  completion: {
    title: 'Verifizierung übermittelt',
  },
  failure: {
    title: 'Verifizierung nicht abgeschlossen',
  },
  contest: {
    heading: 'Überprüfung anfordern',
    intro: 'Wenn Sie mit dem Ergebnis nicht einverstanden sind, kann eine Person es überprüfen.',
    host: 'Dieser Link öffnet {{host}}',
    link: 'Überprüfung anfordern',
    contact: 'Sie erreichen außerdem: {{contact}}',
  },
  expired: {
    title: 'Dieser Verifizierungslink ist abgelaufen',
    message: 'Bitten Sie die Organisation, die ihn gesendet hat, um einen neuen Link.',
  },
  ended: {
    expired: {
      title: 'Ihre Verifizierungssitzung ist abgelaufen',
      message:
        'Zu Ihrer Sicherheit endet eine Verifizierungssitzung nach einiger Zeit. Bitten Sie die Organisation, die Sie um die Verifizierung gebeten hat, um einen neuen Link.',
    },
    canceled: {
      title: 'Diese Verifizierungssitzung ist beendet',
      message:
        'Die Sitzung wurde geschlossen, etwa weil die Verifizierung abgeschlossen oder zurückgezogen wurde. Wenn Sie sich noch verifizieren müssen, bitten Sie die Organisation, die Sie darum gebeten hat, um einen neuen Link.',
    },
    redacted: {
      title: 'Diese Verifizierung ist nicht mehr verfügbar',
      message:
        'Die Informationen dieser Verifizierung wurden gelöscht, daher kann sie nicht fortgesetzt werden. Wenn Sie sich noch verifizieren müssen, wenden Sie sich an die Organisation, die Sie darum gebeten hat.',
    },
  },
  sandbox: {
    label: 'Testumgebung',
    message:
      'Dies ist eine Testverifizierung. Verwenden Sie nur Testdaten, niemals einen echten Ausweis.',
  },
  unsupported: {
    title: 'Dieser Schritt ist hier nicht verfügbar',
    step: 'Diese Verifizierung enthält einen Schritt, den diese Version des Web-Ablaufs noch nicht unterstützt: {{step}}.',
    flow: 'Diese Verifizierung nutzt eine Regel, die diese Version des Web-Ablaufs noch nicht unterstützt.',
    contact: 'Wenden Sie sich an die Organisation, die Sie um die Verifizierung gebeten hat.',
    steps: {
      form: 'ein Formular',
      document: 'das Hochladen eines Dokuments',
      phone_otp: 'ein Code, der an Ihr Telefon gesendet wird',
      email_otp: 'ein Code, der an Ihre E-Mail-Adresse gesendet wird',
      database: 'ein Abgleich Ihrer Angaben mit einer Datenbank',
      aamva: 'eine Prüfung Ihrer Führerscheindaten bei der ausstellenden Stelle',
      nfc: 'das Auslesen des Chips in Ihrem Ausweis, wofür die mobile App nötig ist',
      crypto_wallet: 'der Nachweis, dass Sie eine Krypto-Wallet kontrollieren',
      database_business: 'eine Prüfung Ihres Unternehmens in Unternehmensregistern',
      business_website: 'eine Prüfung der Website Ihres Unternehmens',
    },
  },
  link: {
    title: 'Wir konnten Ihre Verifizierung nicht öffnen',
    missing:
      'Öffnen Sie diese Seite über den Verifizierungslink, den Sie erhalten haben. Der Link fehlt oder ist unvollständig.',
    invalid:
      'Dieser Verifizierungslink ist ungültig. Prüfen Sie, ob Sie den ganzen Link geöffnet haben, oder fordern Sie einen neuen an.',
    mismatch:
      'Dieser Link gehört zu einer anderen Verifizierung. Öffnen Sie den neuesten Link, den Sie erhalten haben.',
    used: 'Dieser Link wurde bereits verwendet oder ist abgelaufen. Jeder Link funktioniert nur einmal. Bitten Sie die Organisation, die ihn gesendet hat, um einen neuen.',
    reloaded:
      'Diese Seite wurde über einen Einmal-Link geöffnet, der nur einmal funktioniert, daher kann sie nicht neu geladen werden. Öffnen Sie den erhaltenen Link erneut, oder fordern Sie einen neuen an, wenn er nicht mehr funktioniert.',
  },
  errors: {
    title: 'Etwas ist schiefgelaufen',
    network:
      'Wir konnten den Verifizierungsdienst nicht erreichen. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
    timeout:
      'Der Verifizierungsdienst hat zu lange für eine Antwort gebraucht. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
    unauthorized:
      'Dieser Verifizierungslink ist nicht mehr gültig. Bitten Sie die Organisation, die ihn gesendet hat, um einen neuen.',
    conflict:
      'Ihre Verifizierung hat sich geändert, vielleicht in einem anderen Fenster. Versuchen Sie es erneut, um fortzufahren.',
    tooLarge:
      'Dieses Foto ist größer als 10 MB. Nehmen Sie es neu auf oder wählen Sie ein kleineres Foto.',
    unsupportedImage:
      'Wir konnten dieses Foto nicht verwenden. Nehmen Sie es neu auf oder wählen Sie ein JPEG-, PNG- oder WebP-Foto.',
    notAccepted:
      'Dies wurde nicht akzeptiert. Prüfen Sie Ihre Eingabe und versuchen Sie es erneut.',
    rateLimited:
      'Zu viele Versuche in kurzer Zeit. Warten Sie einen Moment und versuchen Sie es dann erneut.',
    server: 'Der Verifizierungsdienst hat Probleme. Versuchen Sie es in ein paar Minuten erneut.',
    unexpected: 'Etwas ist schiefgelaufen. Versuchen Sie es erneut.',
    retry: 'Erneut versuchen',
  },
  notFound: {
    title: 'Seite nicht gefunden',
    back: 'Von vorn beginnen',
  },
};
