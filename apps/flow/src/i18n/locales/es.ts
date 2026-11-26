import { cryptoWalletEs } from '../../steps/crypto-wallet/locales/es';
import { shareConsentEs } from '../../steps/share-consent/locales/es';
import { nfcEs } from '../../steps/nfc/locales/es';
import { documentEs } from '../../steps/document/locales/es';
import { screenEs } from '../../screens/locales/es';
import { formsEs } from '../../steps/forms/locales/es';
import { handoffEs } from '../../handoff/locales/es';
import { otpEs } from '../../steps/otp/locales/es';
import type { Messages } from './en';

export const es: Messages = {
  app: {
    name: 'OpenVerify',
    language: 'Idioma',
  },
  loading: 'Cargando tu verificación…',
  attempt: 'Intento {{current}} de {{max}}',
  consent: {
    title: 'Consentimiento para usar tus datos biométricos',
    biometric:
      'Para confirmar tu identidad, comparamos un selfi con la foto de tu documento de identidad. Esta comparación usa datos biométricos: medidas de los rasgos de tu cara. Tus datos biométricos se usan solo para verificar tu identidad en esta solicitud.',
    processing:
      'Tratamos las fotos de tu documento de identidad y tu selfi solo para esta verificación. Se eliminan cuando la organización que pidió esta verificación ya no las necesita, conforme a su política de conservación. Puedes detenerte en cualquier momento cerrando esta página.',
    // C42.3: the optional matching consent; {{days}} is the session's face-template-retention-days.
    'biometric-matching':
      'Opcional: también comparamos tu selfi y su fondo con selfis anteriores enviados a esta organización, para evitar que una persona use varias identidades. Una plantilla de tu cara se conserva durante {{days}} días. Puedes verificarte aunque no marques esta casilla.',
    'device-recognition':
      'Opcional: reconocer este dispositivo en visitas posteriores, para proteger mi cuenta de usos indebidos.',
    // C128.4: the optional automated-decision consent.
    'automated-decision':
      'Opcional: acepto que se puedan tomar decisiones automatizadas sobre esta verificación a partir de mis datos biométricos, sin que una persona las revise antes. Puedes pedir que una persona revise una decisión.',
    checkbox:
      'Acepto la recopilación y el uso de mis datos biométricos tal como se describe arriba.',
    continue: 'Continuar',
    saving: 'Guardando tu consentimiento…',
    unavailable:
      'Esta verificación te pide aceptar un texto que esta versión no puede mostrar. Contacta con la organización que te pidió la verificación.',
  },
  notice: {
    'session-integrity':
      'Para proteger tu verificación contra el fraude, esta página comprueba cómo se usa, por ejemplo si un navegador está automatizado. No lee tus pulsaciones de teclas ni lo que escribes.',
    'device-recognition':
      'Este servicio reconoce el dispositivo que usas, para proteger las cuentas de usos indebidos.',
    'play-integrity':
      'Para proteger tu verificación contra el fraude, la aplicación que usas pide a Google Play que confirme que es la aplicación auténtica en un dispositivo que no ha sido manipulado. Para ello, Google recibe el nombre del paquete de la aplicación, su versión y su certificado de firma, el estado de su licencia y una atestación de la integridad de este dispositivo.',
  },
  nativeApp: {
    consent: {
      processing:
        'Tratamos las fotos de tu documento de identidad y tu selfi solo para esta verificación. Se eliminan cuando la organización que pidió esta verificación ya no las necesita, conforme a su política de conservación. Puedes detenerte en cualquier momento cerrando esta pantalla.',
      'biometric-matching-checkbox':
        'Sí, comparar también mi selfi con selfis anteriores (opcional)',
      'device-recognition-checkbox':
        'Sí, reconocer este dispositivo en visitas posteriores (opcional)',
      'automated-decision-checkbox':
        'Sí, permitir decisiones automatizadas a partir de mis datos biométricos (opcional)',
    },
    notice: {
      'session-integrity':
        'Para proteger tu verificación contra el fraude, esta aplicación comprueba cómo se usa: si hay un depurador conectado y si hay indicios de un emulador, un dispositivo rooteado o una herramienta de manipulación. Para ello lee las propiedades de compilación del dispositivo, el propio proceso de la aplicación (su mapa de memoria, los nombres de sus hilos y las clases cargadas), la tabla de montaje y si existen archivos conocidos, y solo envía los nombres de los indicios que encuentra. No lee lo que escribes ni qué otras aplicaciones tienes.',
    },
  },
  camera: {
    title: 'Acceso a la cámara',
    intro:
      'A continuación necesitamos tu cámara para fotografiar tu documento de identidad y tomar un selfi.',
    request: 'Permitir acceso a la cámara',
    requesting: 'Esperando el permiso de la cámara…',
    ready: 'Tu cámara está lista.',
    errors: {
      'permission-denied':
        'El acceso a la cámara está bloqueado. Permítelo en la configuración del navegador y vuelve a intentarlo.',
      'no-camera':
        'No encontramos ninguna cámara. Conecta una o usa un dispositivo que tenga cámara.',
      'constraints-not-satisfied':
        'Tu cámara no admite la configuración que necesitamos. Prueba con otra cámara u otro dispositivo.',
      'camera-in-use': 'Otra aplicación está usando la cámara. Ciérrala y vuelve a intentarlo.',
      'insecure-context': 'El acceso a la cámara requiere una conexión segura (https).',
      unsupported: 'Este navegador no puede usar la cámara. Prueba con un navegador actualizado.',
      unknown: 'Algo salió mal al iniciar la cámara. Vuelve a intentarlo.',
    },
  },
  capture: {
    progress: 'Foto {{current}} de {{total}}',
    takePhoto: 'Tomar una foto',
    uploadPhoto: 'Subir una foto',
    startingCamera: 'Iniciando la cámara…',
    cameraReady: 'Tu cámara está lista. Selecciona Capturar para tomar la foto.',
    photoReady: 'Tu foto está lista para revisarla. Úsala o repítela.',
    preview: 'Vista previa de la cámara',
    shutter: 'Capturar',
    cancel: 'Cancelar',
    back: 'Volver',
    tryAgain: 'Volver a intentarlo',
    captureFailed: 'No pudimos tomar la foto. Vuelve a intentarlo.',
    uploadInstead: 'También puedes subir una foto.',
    checkPhoto: 'Comprueba que la foto sea nítida, tenga buena luz y muestre todo lo que pedimos.',
    retake: 'Repetir',
    usePhoto: 'Usar esta foto',
    barcodeHint: 'Asegúrate de que el código de barras esté nítido y dentro del marco.',
    photoCheck: {
      blurry:
        'Esta foto parece borrosa. Mantén tu documento quieto con buena luz, deja que la cámara enfoque y vuelve a tomarla.',
      'too-small':
        'La resolución de esta foto es demasiado baja para leer tu documento. Vuelve a tomarla o usa otra cámara si el problema continúa.',
      useAnyway: 'Usar esta foto de todos modos',
    },
    fileErrors: {
      empty: 'Este archivo está vacío. Elige otra foto.',
      'too-large': 'Esta foto ocupa más de 10 MB. Elige una foto más pequeña.',
      'unsupported-type':
        'Este archivo no es una imagen admitida. Elige una foto JPEG, PNG o WebP.',
      unreadable: 'No pudimos leer este archivo. Elige otra foto.',
    },
  },
  governmentId: {
    title: 'Fotografía tu documento de identidad',
    intro:
      'Usa un documento de identidad oficial y vigente. Colócalo sobre una superficie plana con buena luz y asegúrate de que se vean las cuatro esquinas.',
    front: {
      title: 'Parte delantera del documento',
      instruction: 'Encuadra la parte delantera de tu documento dentro del marco.',
      alt: 'Tu foto de la parte delantera del documento',
      upload: 'Elige una foto de la parte delantera del documento',
    },
    back: {
      title: 'Parte trasera del documento',
      instruction: 'Da la vuelta al documento y encuadra la parte trasera dentro del marco.',
      alt: 'Tu foto de la parte trasera del documento',
      upload: 'Elige una foto de la parte trasera del documento',
    },
  },
  selfie: {
    title: 'Hazte un selfi',
    intro:
      'Comparamos tu selfi con la foto de tu documento. Quítate las gafas de sol y el sombrero, y busca un lugar con buena luz.',
    center: {
      title: 'Mira al frente',
      instruction: 'Encaja tu cara dentro del óvalo y mira directamente a la cámara.',
      alt: 'Tu selfi, mirando al frente',
      upload: 'Elige un selfi mirando al frente',
    },
    left: {
      title: 'Gira la cabeza a la izquierda',
      instruction: 'Mantén tu cara dentro del óvalo y gira la cabeza despacio hacia la izquierda.',
      alt: 'Tu selfi, con la cabeza girada a la izquierda',
      upload: 'Elige un selfi con la cabeza girada a la izquierda',
    },
    right: {
      title: 'Gira la cabeza a la derecha',
      instruction: 'Mantén tu cara dentro del óvalo y gira la cabeza despacio hacia la derecha.',
      alt: 'Tu selfi, con la cabeza girada a la derecha',
      upload: 'Elige un selfi con la cabeza girada a la derecha',
    },
    howItWorks:
      'Te pediremos que mires directamente a la cámara y después que gires la cabeza cuando se te indique. Cada foto se toma automáticamente cuando mantienes la postura sin moverte.',
    howItWorksCenter:
      'Mira directamente a la cámara. La foto se toma automáticamente cuando mantienes la postura sin moverte.',
    start: 'Abrir la cámara',
    uploadInstead: 'Subir fotos',
    preparing: 'Preparando',
    opening: 'Iniciando tu selfi…',
    prompt: 'Foto {{current}} de {{total}}: {{title}}',
    uploadingPose: 'Subiendo la foto {{current}} de {{total}}…',
    submitting: 'Enviando tus fotos…',
    restarted:
      'Tu sesión de selfi terminó antes de enviar todas las fotos, así que empezamos de nuevo. Sigue las indicaciones otra vez.',
    shutterSoon:
      'La foto se toma automáticamente cuando mantienes la postura sin moverte. En unos segundos también podrás tomarla tú.',
    shutterReady: 'Si la foto no se toma automáticamente, selecciona Capturar.',
    retakePose: 'Repetir esta foto',
    guidance: {
      starting: 'Preparando la guía para tu cara…',
      manual: 'Mantén la postura y selecciona Capturar.',
      'no-face': 'No vemos tu cara. Encaja tu cara dentro del óvalo.',
      'multiple-faces': 'Asegúrate de que solo tu cara aparezca en la imagen.',
      'too-far': 'Acércate a la cámara.',
      'too-close': 'Aléjate un poco.',
      'off-centre': 'Coloca tu cara en el centro del óvalo.',
      'look-straight': 'Mira directamente a la cámara.',
      'turn-left': 'Gira la cabeza despacio hacia la izquierda.',
      'turn-right': 'Gira la cabeza despacio hacia la derecha.',
      'hold-still': 'No te muevas…',
    },
  },
  otp: otpEs,
  // C96.5 (Workflow 7A): device handoff, the desktop's step and the phone's context screen.
  handoff: handoffEs,
  cryptoWallet: cryptoWalletEs,
  // C238.6, C237.6 (Workflow 11A, clients-connect): the share-consent step; share.consent.* are
  // legal texts, counsel-unreviewed (C238.10), machine-drafted outside en (C161.5).
  share: shareConsentEs,
  // C207.10 (Workflow 10C, api-nfc): the nfc step in a browser; machine-drafted outside en (C161.5).
  nfc: nfcEs,
  forms: formsEs,
  document: documentEs,
  // C148.7, C150.5, C151.2, C158.5, C171.4 (Workflow 9A, flow-renderer): machine-drafted (C161.5).
  screen: screenEs,
  submission: {
    uploading: 'Subiendo tus fotos…',
    retry: 'Volver a intentarlo',
    retake: 'Repetir las fotos',
  },
  processing: {
    title: 'Comprobando tus fotos',
    verificationTitle: 'Comprobando tu verificación',
    message: 'Suele tardar unos segundos. Mantén esta página abierta.',
    slow: 'Está tardando más de lo habitual.',
    checkAgain: 'Comprobar de nuevo',
  },
  finalizing: {
    title: 'Finalizando tu verificación',
    message: 'Suele tardar unos segundos. Mantén esta página abierta.',
  },
  retry: {
    title: 'No pudimos usar tus últimas fotos',
    attemptTitle: 'Tu último intento no se pudo completar',
    generic: 'Algo en la foto no se veía con claridad. Vuelve a intentarlo con buena luz.',
    reasons: {
      image_blurry:
        'La foto salió borrosa. Sujeta el dispositivo sin moverlo y espera a que la imagen se enfoque.',
      glare_present:
        'Había reflejos en tu documento. Aléjate de la luz directa o inclina un poco el documento.',
      portrait_not_present:
        'No encontramos la foto de tu documento. Asegúrate de que toda la parte delantera quede dentro del marco.',
      front_not_present: 'Necesitamos una foto de la parte delantera de tu documento.',
      back_not_present: 'Necesitamos una foto de la parte trasera de tu documento.',
      image_too_dark: 'La foto salió demasiado oscura. Busca un lugar con más luz.',
      image_too_bright: 'La foto salió demasiado clara. Aléjate de la luz intensa.',
      face_not_present: 'No pudimos ver tu cara. Encájala dentro del óvalo.',
      multiple_faces_present:
        'Había más de una cara en la foto. Asegúrate de que solo aparezcas tú.',
      image_unreadable:
        'No pudimos abrir la foto. Toma una nueva o elige una imagen JPEG, PNG o WebP.',
      document_not_found:
        'No encontramos tu documento en la foto. Colócalo sobre una superficie lisa que contraste con él y asegúrate de que se vean las cuatro esquinas.',
      insufficient_text:
        'No pudimos leer el texto de tu documento. Asegúrate de que la foto sea nítida, tenga buena luz, no tenga reflejos y muestre todo el documento.',
      identity_features_not_found:
        'No encontramos tu foto ni las líneas de letras y números de tu documento. Fotografía la cara que tiene tu foto, con todo el documento dentro del marco.',
      resolution_too_low:
        'Tu documento se veía demasiado pequeño en la foto. Acerca el dispositivo para que el documento ocupe casi todo el marco.',
      back_feature_not_found:
        'No pudimos leer la parte trasera de tu documento. Dale la vuelta y fotografía la parte trasera, nítida y sin reflejos, para que se pueda leer su código de barras o sus líneas de letras y números.',
      portrait_too_small:
        'La foto de tu cara en el documento se veía demasiado pequeña. Acerca el dispositivo para que el documento ocupe casi todo el marco.',
      portrait_blurry:
        'La foto de tu cara en el documento no se veía nítida. Sujeta el dispositivo sin moverlo y espera a que la imagen se enfoque.',
      portrait_obstructed:
        'Algo tapaba la foto de tu cara en el documento. Mantén los dedos y los reflejos lejos de ella.',
      mrz_not_found:
        'No encontramos las líneas de letras, números y signos <<< de tu documento. Asegúrate de que todo el documento quede dentro del marco, incluido el borde inferior.',
      mrz_unreadable:
        'No pudimos leer las líneas de letras, números y signos <<< de tu documento. Sujeta el dispositivo sin moverlo y evita los reflejos para que esas líneas se vean nítidas.',
      barcode_not_found:
        'No encontramos el código de barras de tu documento. Fotografía la cara que tiene el código de barras, con todo el documento dentro del marco y sin reflejos sobre el código.',
      required_fields_missing:
        'No pudimos leer todos los datos de tu documento. Asegúrate de que todo el documento quede dentro del marco, nítido y sin reflejos.',
      // C39.2: the frozen selfie user-behaviour reasons (Phase 4).
      face_too_small:
        'Tu cara se veía demasiado pequeña en la foto. Acércate para que tu cara llene el óvalo.',
      face_glare: 'La luz se reflejaba en tu cara. Aléjate de la luz directa e inténtalo de nuevo.',
      pose_not_center:
        'Mira directamente a la cámara en la primera foto, con la cara en el centro del óvalo.',
      pose_not_left:
        'No giraste la cabeza lo suficiente hacia la izquierda. Cuando se te pida, gira la cabeza despacio hacia la izquierda y mantenla así.',
      pose_not_right:
        'No giraste la cabeza lo suficiente hacia la derecha. Cuando se te pida, gira la cabeza despacio hacia la derecha y mantenla así.',
      face_covered:
        'Parte de tu cara estaba cubierta. Quítate la mascarilla o la bufanda y aparta las manos de la cara.',
      glasses_detected: 'Quítate las gafas e inténtalo de nuevo.',
      // C51.2: the frozen Phase 5 user-behaviour reasons.
      document_type_not_accepted:
        'Este tipo de documento no se acepta aquí. Sube uno de los tipos de documento que indica este paso.',
      document_unreadable:
        'No pudimos abrir ni leer tu documento. Sube una foto nítida o un PDF del documento completo.',
      document_password_protected:
        'Tu PDF está protegido con contraseña. Sube una copia sin contraseña o una foto del documento.',
      document_too_large:
        'Tu archivo es demasiado grande. Sube un archivo más pequeño, como una foto del documento o un PDF con menos páginas.',
      document_too_many_pages:
        'Tu PDF tiene demasiadas páginas. Sube solo las páginas que muestran tu nombre, tu dirección y la fecha.',
      name_not_found:
        'No encontramos un nombre en tu documento. Sube un documento que muestre tu nombre completo.',
      address_not_found:
        'No encontramos una dirección en tu documento. Sube un documento que muestre tu dirección completa.',
      issue_date_not_found:
        'No encontramos la fecha de emisión de tu documento. Sube un documento que muestre esa fecha.',
      issuer_not_found:
        'No encontramos quién emitió tu documento. Sube un documento que muestre la empresa u oficina que lo emitió.',
      document_expired: 'Tu documento ha caducado. Sube uno que siga vigente.',
      document_too_old: 'Tu documento es demasiado antiguo. Sube uno más reciente.',
      po_box_detected:
        'No se puede usar un apartado de correos como dirección. Escribe la dirección donde vives.',
      otp_attempts_exhausted:
        'Se introdujeron demasiados códigos incorrectos. Vuelve a empezar para recibir un código nuevo.',
      otp_not_confirmed:
        'El código no se confirmó a tiempo. Vuelve a empezar para recibir un código nuevo.',
      domain_not_found:
        'La parte de tu correo electrónico que va después de la @ no existe. Revisa si hay errores de escritura.',
      domain_rejects_mail:
        'Este dominio de correo no acepta mensajes. Usa otra dirección de correo electrónico.',
      no_mail_server:
        'No se puede entregar correo a esta dirección. Revísala o usa otra dirección de correo electrónico.',
      address_invalid:
        'Esta dirección de monedero no es válida para la red que elegiste. Comprueba que copiaste la dirección completa.',
      address_checksum_invalid:
        'Esta dirección de monedero tiene un error de escritura. Cópiala de nuevo desde tu monedero en lugar de escribirla.',
      signature_invalid:
        'No pudimos leer la firma. Vuelve a firmar el mensaje en tu monedero y pega la firma completa.',
      signature_address_mismatch:
        'El mensaje se firmó con otra dirección de monedero. Fírmalo con la dirección que indicaste.',
      expected_address_mismatch:
        'Esta no es la dirección de monedero que se te pidió verificar. Usa la dirección de monedero esperada.',
      country_not_enabled:
        'Aquí no se pueden verificar empresas de este país. Revisa el país que seleccionaste.',
      domain_not_resolving:
        'No pudimos encontrar este sitio web. Revisa la dirección web por si hay errores de escritura.',
      document_name_mismatch:
        'El nombre de tu documento no coincide con el tuyo. Sube un documento a tu nombre.',
    },
  },
  flow: {
    completion: 'Gracias. Tu verificación se ha enviado y ya puedes cerrar esta página.',
    failure:
      'No pudimos verificar tu identidad. Contacta con la organización que te pidió la verificación.',
  },
  completion: {
    title: 'Verificación enviada',
  },
  failure: {
    title: 'Verificación no completada',
  },
  contest: {
    heading: 'Solicitar una revisión',
    intro: 'Si no está de acuerdo con el resultado, una persona puede revisarlo.',
    host: 'Este enlace abre {{host}}',
    link: 'Solicitar una revisión',
    contact: 'También puede contactar con: {{contact}}',
  },
  expired: {
    title: 'Este enlace de verificación ha caducado',
    message: 'Pide un enlace nuevo a la organización que te lo envió.',
  },
  ended: {
    expired: {
      title: 'Tu sesión de verificación ha caducado',
      message:
        'Por seguridad, las sesiones de verificación terminan al cabo de un tiempo. Pide un enlace nuevo a la organización que te pidió la verificación.',
    },
    canceled: {
      title: 'Esta sesión de verificación ha terminado',
      message:
        'La sesión se cerró, por ejemplo porque la verificación se terminó o se retiró. Si todavía necesitas verificarte, pide un enlace nuevo a la organización que te pidió la verificación.',
    },
    redacted: {
      title: 'Esta verificación ya no está disponible',
      message:
        'Los datos de esta verificación se han eliminado, así que no puede continuar. Si todavía necesitas verificarte, contacta con la organización que te pidió la verificación.',
    },
  },
  sandbox: {
    label: 'Entorno de pruebas',
    message:
      'Esta es una verificación de prueba. Usa solo datos de prueba, nunca un documento real.',
  },
  unsupported: {
    title: 'Este paso no está disponible aquí',
    step: 'Esta verificación incluye un paso que esta versión del flujo web todavía no admite: {{step}}.',
    flow: 'Esta verificación usa una regla que esta versión del flujo web todavía no admite.',
    contact: 'Contacta con la organización que te pidió la verificación.',
    steps: {
      form: 'un formulario',
      document: 'la subida de un documento',
      phone_otp: 'un código enviado a tu teléfono',
      email_otp: 'un código enviado a tu correo electrónico',
      database: 'una comprobación de tus datos en una base de datos',
      aamva: 'una comprobación de los datos de tu licencia de conducir con su emisor',
      nfc: 'la lectura del chip de tu documento, que necesita la aplicación móvil',
      crypto_wallet: 'la prueba de que controlas un monedero de criptomonedas',
      database_business: 'una comprobación de tu empresa en registros mercantiles',
      business_website: 'una comprobación del sitio web de tu empresa',
    },
  },
  link: {
    title: 'No pudimos abrir tu verificación',
    missing:
      'Abre esta página desde el enlace de verificación que recibiste. Falta el enlace o está incompleto.',
    invalid:
      'Este enlace de verificación no es válido. Comprueba que abriste el enlace completo o pide uno nuevo.',
    mismatch:
      'Este enlace pertenece a otra verificación. Abre el enlace más reciente que recibiste.',
    used: 'Este enlace ya se ha usado o ha caducado. Cada enlace funciona una sola vez. Pide uno nuevo a la organización que te lo envió.',
    reloaded:
      'Esta página se abrió desde un enlace de un solo uso, así que no se puede recargar. Vuelve a abrir el enlace que recibiste, o pide uno nuevo si ya no funciona.',
  },
  errors: {
    title: 'Algo salió mal',
    network:
      'No pudimos conectar con el servicio de verificación. Comprueba tu conexión y vuelve a intentarlo.',
    timeout:
      'El servicio de verificación tardó demasiado en responder. Comprueba tu conexión y vuelve a intentarlo.',
    unauthorized:
      'Este enlace de verificación ya no es válido. Pide uno nuevo a la organización que te lo envió.',
    conflict: 'Tu verificación cambió, quizá en otra ventana. Vuelve a intentarlo para continuar.',
    tooLarge: 'Esta foto ocupa más de 10 MB. Repítela o elige una foto más pequeña.',
    unsupportedImage: 'No pudimos usar esta foto. Repítela o elige una foto JPEG, PNG o WebP.',
    notAccepted: 'No se aceptó. Revisa lo que escribiste e inténtalo de nuevo.',
    rateLimited: 'Demasiados intentos en poco tiempo. Espera un momento y vuelve a intentarlo.',
    server:
      'El servicio de verificación tiene problemas. Vuelve a intentarlo dentro de unos minutos.',
    unexpected: 'Algo salió mal. Vuelve a intentarlo.',
    retry: 'Volver a intentarlo',
  },
  notFound: {
    title: 'Página no encontrada',
    back: 'Volver a empezar',
  },
};
