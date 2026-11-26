import { cryptoWalletFr } from '../../steps/crypto-wallet/locales/fr';
import { shareConsentFr } from '../../steps/share-consent/locales/fr';
import { nfcFr } from '../../steps/nfc/locales/fr';
import { documentFr } from '../../steps/document/locales/fr';
import { screenFr } from '../../screens/locales/fr';
import { formsFr } from '../../steps/forms/locales/fr';
import { handoffFr } from '../../handoff/locales/fr';
import { otpFr } from '../../steps/otp/locales/fr';
import type { Messages } from './en';

/**
 * French messages (C161.1). Machine-drafted by the build agents, which is machine translation, and
 * shipped `machine-drafted` until a fluent person reviews them (C161.5, decisions 31 and 67).
 * Translator notes: the person is addressed as « vous », with no gendered agreement (C161.6);
 * placeholders keep their `{{name}}` syntax; a no-break space comes before « : ».
 * The consent and notice texts are legal texts: drafted, not reviewed.
 */
export const fr: Messages = {
  app: {
    name: 'OpenVerify',
    language: 'Langue',
  },
  loading: 'Chargement de votre vérification…',
  attempt: 'Tentative {{current}} sur {{max}}',
  consent: {
    title: 'Consentement à l’utilisation de vos données biométriques',
    biometric:
      'Pour confirmer votre identité, nous comparons un selfie avec la photo de votre pièce d’identité. Cette comparaison utilise des données biométriques : des mesures des traits de votre visage. Vos données biométriques servent uniquement à vérifier votre identité pour cette demande.',
    processing:
      'Nous traitons les photos de votre pièce d’identité et votre selfie uniquement pour cette vérification. Elles sont supprimées lorsque l’organisation qui a demandé cette vérification n’en a plus besoin, conformément à sa politique de conservation. Vous pouvez arrêter à tout moment en fermant cette page.',
    'biometric-matching':
      'Facultatif : nous comparons aussi votre selfie et son arrière-plan avec des selfies envoyés auparavant à cette organisation, pour empêcher une même personne d’utiliser plusieurs identités. Un modèle de votre visage est conservé pendant {{days}} jours. Vous pouvez quand même vous vérifier si vous laissez cette case décochée.',
    'device-recognition':
      'Facultatif : reconnaître cet appareil lors de mes prochaines visites, pour protéger mon compte contre les abus.',
    'automated-decision':
      'Facultatif : j’accepte que des décisions automatisées soient prises sur cette vérification à partir de mes données biométriques, sans qu’une personne les examine d’abord. Vous pouvez demander qu’une personne examine une décision.',
    checkbox:
      'J’accepte la collecte et l’utilisation de mes données biométriques telles qu’elles sont décrites ci-dessus.',
    continue: 'Continuer',
    saving: 'Enregistrement de votre consentement…',
    unavailable:
      'Cette vérification vous demande d’accepter un texte que cette version ne peut pas afficher. Contactez l’organisation qui vous a demandé de vous vérifier.',
  },
  notice: {
    'session-integrity':
      'Pour protéger votre vérification contre la fraude, cette page vérifie la façon dont elle est utilisée, par exemple si un navigateur est automatisé. Elle ne lit ni vos frappes au clavier ni ce que vous saisissez.',
    'device-recognition':
      'Ce service reconnaît l’appareil que vous utilisez, pour protéger les comptes contre les abus.',
    'play-integrity':
      'Pour protéger votre vérification contre la fraude, l’application que vous utilisez demande à Google Play de confirmer qu’il s’agit de l’application authentique, sur un appareil qui n’a pas été modifié. Pour cela, Google reçoit le nom du paquet de l’application, sa version et son certificat de signature, l’état de sa licence et une attestation de l’intégrité de cet appareil.',
  },
  nativeApp: {
    consent: {
      processing:
        'Nous traitons les photos de votre pièce d’identité et votre selfie uniquement pour cette vérification. Elles sont supprimées lorsque l’organisation qui a demandé cette vérification n’en a plus besoin, conformément à sa politique de conservation. Vous pouvez arrêter à tout moment en fermant cet écran.',
      'biometric-matching-checkbox':
        'Oui, comparer aussi mon selfie avec des selfies antérieurs (facultatif)',
      'device-recognition-checkbox':
        'Oui, reconnaître cet appareil lors de prochaines visites (facultatif)',
      'automated-decision-checkbox':
        'Oui, autoriser des décisions automatisées à partir de mes données biométriques (facultatif)',
    },
    notice: {
      'session-integrity':
        'Pour protéger votre vérification contre la fraude, cette application vérifie la façon dont elle est utilisée : si un débogueur est connecté, et les signes d’un émulateur, d’un appareil rooté ou d’un outil de modification. Pour cela, elle lit les propriétés de build de l’appareil, le processus propre de l’application (sa carte mémoire, les noms de ses threads et les classes chargées), la table des montages et la présence de fichiers connus, et n’envoie que les noms des signes trouvés. Elle ne lit pas ce que vous saisissez ni les autres applications installées.',
    },
  },
  camera: {
    title: 'Accès à la caméra',
    intro:
      'Nous avons maintenant besoin de votre caméra pour prendre des photos de votre pièce d’identité et un selfie.',
    request: 'Autoriser l’accès à la caméra',
    requesting: 'En attente de l’autorisation d’accès à la caméra…',
    ready: 'Votre caméra est prête.',
    errors: {
      'permission-denied':
        'L’accès à la caméra est bloqué. Autorisez-le dans les réglages de votre navigateur, puis réessayez.',
      'no-camera':
        'Nous n’avons trouvé aucune caméra. Branchez-en une, ou utilisez un appareil qui en a une.',
      'constraints-not-satisfied':
        'Votre caméra ne prend pas en charge les réglages nécessaires. Essayez une autre caméra ou un autre appareil.',
      'camera-in-use': 'Une autre application utilise votre caméra. Fermez-la, puis réessayez.',
      'insecure-context': 'L’accès à la caméra nécessite une connexion sécurisée (https).',
      unsupported: 'Ce navigateur ne peut pas utiliser de caméra. Essayez un navigateur à jour.',
      unknown: 'Un problème est survenu au démarrage de votre caméra. Réessayez.',
    },
  },
  capture: {
    progress: 'Photo {{current}} sur {{total}}',
    takePhoto: 'Prendre une photo',
    uploadPhoto: 'Téléverser une photo',
    startingCamera: 'Démarrage de votre caméra…',
    cameraReady: 'Votre caméra est prête. Sélectionnez « Prendre » pour prendre la photo.',
    photoReady: 'Votre photo est prête à être vérifiée. Utilisez-la ou reprenez-la.',
    preview: 'Aperçu de la caméra',
    shutter: 'Prendre',
    cancel: 'Annuler',
    back: 'Retour',
    tryAgain: 'Réessayer',
    captureFailed: 'Nous n’avons pas pu prendre la photo. Réessayez.',
    uploadInstead: 'Vous pouvez aussi téléverser une photo à la place.',
    checkPhoto:
      'Vérifiez que la photo est nette, bien éclairée et montre tout ce que nous avons demandé.',
    retake: 'Reprendre',
    usePhoto: 'Utiliser cette photo',
    barcodeHint: 'Assurez-vous que le code-barres est net et à l’intérieur du cadre.',
    photoCheck: {
      blurry:
        'Cette photo semble floue. Tenez votre pièce d’identité immobile sous un bon éclairage, laissez l’appareil faire la mise au point et reprenez-la.',
      'too-small':
        'La résolution de cette photo est trop faible pour lire votre pièce d’identité. Reprenez-la, ou utilisez une autre caméra si le problème persiste.',
      useAnyway: 'Utiliser cette photo quand même',
    },
    fileErrors: {
      empty: 'Ce fichier est vide. Choisissez une autre photo.',
      'too-large': 'Cette photo dépasse 10 Mo. Choisissez une photo plus petite.',
      'unsupported-type':
        'Ce fichier n’est pas une image prise en charge. Choisissez une photo JPEG, PNG ou WebP.',
      unreadable: 'Nous n’avons pas pu lire ce fichier. Choisissez une autre photo.',
    },
  },
  governmentId: {
    title: 'Photographiez votre pièce d’identité',
    intro:
      'Utilisez une pièce d’identité officielle valide. Posez-la sur une surface plane, sous un bon éclairage, avec ses quatre coins visibles.',
    front: {
      title: 'Recto de votre pièce d’identité',
      instruction: 'Placez le recto de votre pièce d’identité dans le cadre.',
      alt: 'Votre photo du recto de votre pièce d’identité',
      upload: 'Choisir une photo du recto de votre pièce d’identité',
    },
    back: {
      title: 'Verso de votre pièce d’identité',
      instruction: 'Retournez votre pièce d’identité et placez le verso dans le cadre.',
      alt: 'Votre photo du verso de votre pièce d’identité',
      upload: 'Choisir une photo du verso de votre pièce d’identité',
    },
  },
  selfie: {
    title: 'Prenez un selfie',
    intro:
      'Nous comparons votre selfie avec la photo de votre pièce d’identité. Retirez lunettes de soleil et chapeau, et placez-vous dans un endroit bien éclairé.',
    center: {
      title: 'Regardez droit devant',
      instruction: 'Placez votre visage dans l’ovale et regardez droit vers la caméra.',
      alt: 'Votre selfie, en regardant droit devant',
      upload: 'Choisir un selfie, en regardant droit devant',
    },
    left: {
      title: 'Tournez la tête vers la gauche',
      instruction: 'Gardez votre visage dans l’ovale et tournez lentement la tête vers la gauche.',
      alt: 'Votre selfie, la tête tournée vers la gauche',
      upload: 'Choisir un selfie, la tête tournée vers la gauche',
    },
    right: {
      title: 'Tournez la tête vers la droite',
      instruction: 'Gardez votre visage dans l’ovale et tournez lentement la tête vers la droite.',
      alt: 'Votre selfie, la tête tournée vers la droite',
      upload: 'Choisir un selfie, la tête tournée vers la droite',
    },
    howItWorks:
      'Nous vous demandons de regarder droit vers la caméra, puis de tourner la tête quand on vous le demande. Chaque photo est prise automatiquement dès que vous ne bougez plus.',
    howItWorksCenter:
      'Regardez droit vers la caméra. La photo est prise automatiquement dès que vous ne bougez plus.',
    start: 'Démarrer la caméra',
    uploadInstead: 'Téléverser des photos',
    preparing: 'Préparation',
    opening: 'Démarrage de votre selfie…',
    prompt: 'Photo {{current}} sur {{total}} : {{title}}',
    uploadingPose: 'Téléversement de la photo {{current}} sur {{total}}…',
    submitting: 'Envoi de vos photos…',
    restarted:
      'Votre session de selfie s’est terminée avant l’envoi de toutes les photos, nous avons donc recommencé. Suivez à nouveau les instructions.',
    shutterSoon:
      'La photo est prise automatiquement dès que vous ne bougez plus. Vous pourrez aussi la prendre vous-même dans quelques secondes.',
    shutterReady: 'Si la photo n’est pas prise automatiquement, sélectionnez « Prendre ».',
    retakePose: 'Reprendre cette photo',
    guidance: {
      starting: 'Préparation du guide du visage…',
      manual: 'Gardez la pose, puis sélectionnez « Prendre ».',
      'no-face': 'Nous ne voyons pas votre visage. Placez votre visage dans l’ovale.',
      'multiple-faces': 'Assurez-vous que seul votre visage est dans le cadre.',
      'too-far': 'Rapprochez-vous de la caméra.',
      'too-close': 'Reculez un peu.',
      'off-centre': 'Placez votre visage au centre de l’ovale.',
      'look-straight': 'Regardez droit vers la caméra.',
      'turn-left': 'Tournez lentement la tête vers la gauche.',
      'turn-right': 'Tournez lentement la tête vers la droite.',
      'hold-still': 'Ne bougez plus…',
    },
  },
  otp: otpFr,
  handoff: handoffFr,
  cryptoWallet: cryptoWalletFr,
  // C238.6, C237.6 (Workflow 11A, clients-connect): the share-consent step; share.consent.* are
  // legal texts, counsel-unreviewed (C238.10), machine-drafted outside en (C161.5).
  share: shareConsentFr,
  // C207.10 (Workflow 10C, api-nfc): the nfc step in a browser; machine-drafted outside en (C161.5).
  nfc: nfcFr,
  forms: formsFr,
  document: documentFr,
  // C148.7, C150.5, C151.2, C158.5, C171.4 (Workflow 9A, flow-renderer): machine-drafted (C161.5).
  screen: screenFr,
  submission: {
    uploading: 'Téléversement de vos photos…',
    retry: 'Réessayer',
    retake: 'Reprendre les photos',
  },
  processing: {
    title: 'Vérification de vos photos',
    verificationTitle: 'Vérification en cours',
    message: 'Cela prend généralement quelques secondes. Gardez cette page ouverte.',
    slow: 'Cela prend plus de temps que d’habitude.',
    checkAgain: 'Vérifier à nouveau',
  },
  finalizing: {
    title: 'Finalisation de votre vérification',
    message: 'Cela prend généralement quelques secondes. Gardez cette page ouverte.',
  },
  retry: {
    title: 'Nous n’avons pas pu utiliser vos dernières photos',
    attemptTitle: 'Votre dernière tentative n’a pas abouti',
    generic: 'Un élément de la photo n’était pas assez net. Réessayez avec un bon éclairage.',
    reasons: {
      image_blurry:
        'La photo était floue. Tenez votre appareil immobile et attendez que l’image soit nette.',
      glare_present:
        'Un reflet couvrait votre pièce d’identité. Éloignez-vous de la lumière directe ou inclinez légèrement la pièce.',
      portrait_not_present:
        'Nous n’avons pas trouvé la photo sur votre pièce d’identité. Assurez-vous que tout le recto est dans le cadre.',
      front_not_present: 'Nous avons besoin d’une photo du recto de votre pièce d’identité.',
      back_not_present: 'Nous avons besoin d’une photo du verso de votre pièce d’identité.',
      image_too_dark: 'La photo était trop sombre. Trouvez un endroit plus lumineux.',
      image_too_bright: 'La photo était trop claire. Éloignez-vous de la lumière forte.',
      face_not_present: 'Nous n’avons pas vu votre visage. Placez votre visage dans l’ovale.',
      multiple_faces_present:
        'Il y avait plus d’un visage sur la photo. Assurez-vous qu’il n’y a que vous dans le cadre.',
      image_unreadable:
        'Nous n’avons pas pu ouvrir la photo. Prenez-en une nouvelle, ou choisissez une image JPEG, PNG ou WebP.',
      document_not_found:
        'Nous n’avons pas trouvé votre pièce d’identité sur la photo. Posez-la sur une surface unie qui contraste avec elle, avec ses quatre coins dans le cadre.',
      insufficient_text:
        'Nous n’avons pas pu lire le texte de votre pièce d’identité. Assurez-vous que la photo est nette, bien éclairée, sans reflet, et montre toute la pièce.',
      identity_features_not_found:
        'Nous n’avons trouvé ni votre photo ni les lignes de lettres et de chiffres sur votre pièce d’identité. Photographiez la face qui porte votre photo, avec toute la pièce dans le cadre.',
      resolution_too_low:
        'Votre pièce d’identité était trop petite sur la photo. Rapprochez votre appareil pour qu’elle remplisse la plus grande partie du cadre.',
      back_feature_not_found:
        'Nous n’avons pas pu lire le verso de votre pièce d’identité. Retournez-la et photographiez le verso, net et sans reflet, pour que son code-barres ou ses lignes de lettres et de chiffres soient lisibles.',
      portrait_too_small:
        'La photo de votre visage sur la pièce d’identité était trop petite. Rapprochez votre appareil pour que la pièce remplisse la plus grande partie du cadre.',
      portrait_blurry:
        'La photo de votre visage sur la pièce d’identité n’était pas nette. Tenez votre appareil immobile et attendez que l’image soit nette.',
      portrait_obstructed:
        'Quelque chose couvrait la photo de votre visage sur la pièce d’identité. Écartez vos doigts et les reflets de cette zone.',
      mrz_not_found:
        'Nous n’avons pas trouvé les lignes de lettres, de chiffres et de signes <<< sur votre pièce d’identité. Assurez-vous que toute la pièce est dans le cadre, bord inférieur compris.',
      mrz_unreadable:
        'Nous n’avons pas pu lire les lignes de lettres, de chiffres et de signes <<< sur votre pièce d’identité. Tenez votre appareil immobile et évitez les reflets pour que ces lignes soient nettes.',
      barcode_not_found:
        'Nous n’avons pas trouvé le code-barres de votre pièce d’identité. Photographiez la face qui porte le code-barres, avec toute la pièce dans le cadre et sans reflet sur le code-barres.',
      required_fields_missing:
        'Nous n’avons pas pu lire toutes les informations de votre pièce d’identité. Assurez-vous que toute la pièce est dans le cadre, nette et sans reflet.',
      face_too_small:
        'Votre visage était trop petit sur la photo. Rapprochez-vous pour que votre visage remplisse l’ovale.',
      face_glare:
        'La lumière se reflétait sur votre visage. Détournez-vous de la lumière directe et réessayez.',
      pose_not_center:
        'Pour la première photo, regardez droit vers la caméra, le visage au centre de l’ovale.',
      pose_not_left:
        'Votre tête n’était pas assez tournée vers la gauche. Quand on vous le demande, tournez lentement la tête vers la gauche et gardez-la ainsi.',
      pose_not_right:
        'Votre tête n’était pas assez tournée vers la droite. Quand on vous le demande, tournez lentement la tête vers la droite et gardez-la ainsi.',
      face_covered:
        'Une partie de votre visage était couverte. Retirez masque ou écharpe, et écartez vos mains de votre visage.',
      glasses_detected: 'Retirez vos lunettes, puis réessayez.',
      document_type_not_accepted:
        'Ce type de document n’est pas accepté ici. Téléversez l’un des types de documents indiqués par cette étape.',
      document_unreadable:
        'Nous n’avons pas pu ouvrir ou lire votre document. Téléversez une photo nette ou un PDF du document entier.',
      document_password_protected:
        'Votre PDF est protégé par un mot de passe. Téléversez une copie sans mot de passe, ou une photo du document.',
      document_too_large:
        'Votre fichier est trop volumineux. Téléversez un fichier plus petit, par exemple une photo du document ou un PDF avec moins de pages.',
      document_too_many_pages:
        'Votre PDF comporte trop de pages. Téléversez uniquement les pages qui montrent votre nom, votre adresse et la date.',
      name_not_found:
        'Nous n’avons trouvé aucun nom sur votre document. Téléversez un document qui indique votre nom complet.',
      address_not_found:
        'Nous n’avons trouvé aucune adresse sur votre document. Téléversez un document qui indique votre adresse complète.',
      issue_date_not_found:
        'Nous n’avons pas trouvé la date d’émission de votre document. Téléversez un document qui indique sa date d’émission.',
      issuer_not_found:
        'Nous n’avons pas trouvé qui a émis votre document. Téléversez un document qui indique l’entreprise ou l’administration émettrice.',
      document_expired: 'Votre document a expiré. Téléversez-en un qui est encore valide.',
      document_too_old: 'Votre document est trop ancien. Téléversez-en un plus récent.',
      po_box_detected:
        'Une boîte postale ne peut pas servir d’adresse. Saisissez l’adresse où vous habitez.',
      otp_attempts_exhausted:
        'Trop de codes incorrects ont été saisis. Recommencez pour obtenir un nouveau code.',
      otp_not_confirmed:
        'Le code n’a pas été confirmé à temps. Recommencez pour obtenir un nouveau code.',
      domain_not_found:
        'La partie de votre adresse e-mail après le @ n’existe pas. Vérifiez qu’il n’y a pas de faute de frappe.',
      domain_rejects_mail:
        'Ce domaine de messagerie n’accepte pas les e-mails. Utilisez une autre adresse e-mail.',
      no_mail_server:
        'Aucun e-mail ne peut être distribué à cette adresse. Vérifiez-la, ou utilisez une autre adresse e-mail.',
      address_invalid:
        'Cette adresse de portefeuille n’est pas valide pour le réseau choisi. Vérifiez que vous avez copié l’adresse entière.',
      address_checksum_invalid:
        'Cette adresse de portefeuille contient une faute de frappe. Copiez-la à nouveau depuis votre portefeuille au lieu de la saisir.',
      signature_invalid:
        'La signature n’a pas pu être lue. Signez à nouveau le message dans votre portefeuille et collez la signature entière.',
      signature_address_mismatch:
        'Le message a été signé par une autre adresse de portefeuille. Signez-le avec l’adresse que vous avez saisie.',
      expected_address_mismatch:
        'Ce n’est pas l’adresse de portefeuille qu’on vous a demandé de vérifier. Utilisez l’adresse attendue.',
      country_not_enabled:
        'Les entreprises de ce pays ne peuvent pas être vérifiées ici. Vérifiez le pays choisi.',
      domain_not_resolving:
        'Nous n’avons pas trouvé ce site web. Vérifiez qu’il n’y a pas de faute de frappe dans l’adresse.',
      document_name_mismatch:
        'Le nom sur votre document ne correspond pas au vôtre. Téléversez un document à votre nom.',
    },
  },
  flow: {
    completion: 'Merci. Votre vérification a été envoyée et vous pouvez fermer cette page.',
    failure:
      'Nous n’avons pas pu vérifier votre identité. Contactez l’organisation qui vous a demandé de vous vérifier.',
  },
  completion: {
    title: 'Vérification envoyée',
  },
  failure: {
    title: 'Vérification non terminée',
  },
  contest: {
    heading: 'Demander un réexamen',
    intro: 'Si vous contestez le résultat, une personne peut le réexaminer.',
    host: 'Ce lien ouvre {{host}}',
    link: 'Demander un réexamen',
    contact: 'Vous pouvez aussi contacter : {{contact}}',
  },
  expired: {
    title: 'Ce lien de vérification a expiré',
    message: 'Demandez un nouveau lien à l’organisation qui vous l’a envoyé.',
  },
  ended: {
    expired: {
      title: 'Votre session de vérification a expiré',
      message:
        'Pour votre sécurité, une session de vérification se termine au bout d’un certain temps. Demandez un nouveau lien à l’organisation qui vous a demandé de vous vérifier.',
    },
    canceled: {
      title: 'Cette session de vérification est terminée',
      message:
        'La session a été fermée, par exemple parce que la vérification a été terminée ou retirée. Si vous devez encore vous vérifier, demandez un nouveau lien à l’organisation qui vous l’a demandé.',
    },
    redacted: {
      title: 'Cette vérification n’est plus disponible',
      message:
        'Les informations de cette vérification ont été supprimées, elle ne peut donc pas continuer. Si vous devez encore vous vérifier, contactez l’organisation qui vous l’a demandé.',
    },
  },
  sandbox: {
    label: 'Bac à sable',
    message:
      'Ceci est une vérification de test. Utilisez uniquement des données de test, jamais une vraie pièce d’identité.',
  },
  unsupported: {
    title: 'Cette étape n’est pas disponible ici',
    step: 'Cette vérification comprend une étape que cette version du parcours web ne prend pas encore en charge : {{step}}.',
    flow: 'Cette vérification utilise une règle que cette version du parcours web ne prend pas encore en charge.',
    contact: 'Contactez l’organisation qui vous a demandé de vous vérifier.',
    steps: {
      form: 'un formulaire',
      document: 'le téléversement d’un document',
      phone_otp: 'un code envoyé sur votre téléphone',
      email_otp: 'un code envoyé par e-mail',
      database: 'une vérification de vos informations dans une base de données',
      aamva: 'une vérification des informations de votre permis de conduire auprès de son émetteur',
      nfc: 'la lecture de la puce de votre pièce d’identité, qui nécessite l’application mobile',
      crypto_wallet: 'la preuve que vous contrôlez un portefeuille crypto',
      database_business: 'une vérification de votre entreprise dans des registres d’entreprises',
      business_website: 'une vérification du site web de votre entreprise',
    },
  },
  link: {
    title: 'Nous n’avons pas pu ouvrir votre vérification',
    missing:
      'Ouvrez cette page depuis le lien de vérification que vous avez reçu. Le lien est absent ou incomplet.',
    invalid:
      'Ce lien de vérification n’est pas valide. Vérifiez que vous avez ouvert le lien entier, ou demandez-en un nouveau.',
    mismatch:
      'Ce lien appartient à une autre vérification. Ouvrez le dernier lien que vous avez reçu.',
    used: 'Ce lien a déjà été utilisé ou a expiré. Chaque lien ne fonctionne qu’une seule fois. Demandez-en un nouveau à l’organisation qui vous l’a envoyé.',
    reloaded:
      'Cette page a été ouverte depuis un lien à usage unique, qui ne fonctionne qu’une fois : elle ne peut donc pas être rechargée. Ouvrez à nouveau le lien reçu, ou demandez-en un nouveau s’il ne fonctionne plus.',
  },
  errors: {
    title: 'Un problème est survenu',
    network:
      'Nous n’avons pas pu joindre le service de vérification. Vérifiez votre connexion et réessayez.',
    timeout:
      'Le service de vérification a mis trop de temps à répondre. Vérifiez votre connexion et réessayez.',
    unauthorized:
      'Ce lien de vérification n’est plus valide. Demandez-en un nouveau à l’organisation qui vous l’a envoyé.',
    conflict:
      'Votre vérification a changé, peut-être dans une autre fenêtre. Réessayez pour continuer.',
    tooLarge: 'Cette photo dépasse 10 Mo. Reprenez-la ou choisissez une photo plus petite.',
    unsupportedImage:
      'Nous n’avons pas pu utiliser cette photo. Reprenez-la ou choisissez une photo JPEG, PNG ou WebP.',
    notAccepted: 'Cette valeur n’a pas été acceptée. Vérifiez votre saisie et réessayez.',
    rateLimited: 'Trop de tentatives en peu de temps. Patientez un moment, puis réessayez.',
    server:
      'Le service de vérification rencontre des difficultés. Réessayez dans quelques minutes.',
    unexpected: 'Un problème est survenu. Réessayez.',
    retry: 'Réessayer',
  },
  notFound: {
    title: 'Page introuvable',
    back: 'Recommencer',
  },
};
