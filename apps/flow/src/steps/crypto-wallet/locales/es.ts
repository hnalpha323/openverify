import type { Widen } from '../../../i18n/locales/en';
import type { cryptoWalletEn } from './en';

/** Spanish messages of the crypto wallet step (C57, C64.1). */
export const cryptoWalletEs: Widen<typeof cryptoWalletEn> = {
  title: 'Demuestra que controlas tu monedero de criptomonedas',
  intro:
    'Firmas un mensaje con tu monedero. Firmar un mensaje es gratis: no envía ninguna transacción ni mueve fondos.',
  network: 'Red',
  networkIs: 'Red: {{network}}',
  restarted:
    'Tu último intento terminó porque se pidieron demasiados mensajes para firmar. Vuelve a empezar.',
  wallet: {
    connect: 'Conectar tu monedero',
    connectNamed: 'Conectar {{name}}',
    connecting: 'Esperando a tu monedero…',
    signing: 'Firma el mensaje en tu monedero. Muestra este sitio web y por qué lo pedimos.',
    submitting: 'Enviando tu firma…',
    pasteInstead: 'Pegar una firma',
    declined: 'Rechazaste la solicitud en tu monedero. Vuelve a intentarlo cuando quieras.',
    failed: 'Tu monedero no pudo completar la solicitud. Vuelve a intentarlo o pega una firma.',
    failedNoPaste: 'Tu monedero no pudo completar la solicitud. Vuelve a intentarlo.',
    needed:
      'Este paso necesita un monedero en el navegador. Abre esta página en un navegador con una extensión de monedero, o en el navegador de la aplicación de tu monedero.',
  },
  paste: {
    address: 'Dirección del monedero',
    addressHint: 'Cópiala de tu monedero y pégala aquí.',
    getMessage: 'Obtener el mensaje para firmar',
    gettingMessage: 'Obteniendo el mensaje…',
    message: 'Mensaje para firmar',
    messageHint:
      'Firma exactamente este mensaje en tu monedero y pega la firma abajo. Fírmalo antes de las {{time}}.',
    copy: 'Copiar el mensaje',
    copied: 'Mensaje copiado.',
    copyFailed: 'No pudimos copiar el mensaje. Selecciónalo y cópialo tú.',
    signature: 'Firma',
    signedMessage: 'Mensaje firmado (opcional)',
    signedMessageHint:
      'Algunos monederos de Solana muestran los bytes que firmaron. Si el tuyo lo hace, pégalos aquí.',
    submit: 'Enviar la firma',
    submitting: 'Enviando tu firma…',
    otherAddress: 'Usar otra dirección',
    walletInstead: 'Usar el monedero del navegador',
  },
  errors: {
    addressRequired: 'Escribe la dirección de tu monedero.',
    addressInvalid:
      'Esta dirección de monedero no es válida para la red que elegiste. Comprueba que copiaste la dirección completa.',
    addressNotExpected:
      'Esta no es la dirección de monedero que se te pidió verificar. Usa la dirección esperada.',
    chainNotOffered: 'Esta red no se acepta aquí. Elige otra red.',
    signatureRequired: 'Pega la firma de tu monedero.',
    signatureTooLong: 'Esta firma es demasiado larga. Pega solo la firma.',
    challengeInvalid: 'Este mensaje caducó o ya se usó. Obtén un mensaje nuevo para firmar.',
  },
  chains: {
    bitcoin: 'Bitcoin',
    bitcoinTestnet: 'Bitcoin (red de pruebas)',
    litecoin: 'Litecoin',
    dogecoin: 'Dogecoin',
    solana: 'Solana',
    tron: 'TRON',
    xrpl: 'XRP Ledger',
    ethereum: 'Ethereum',
    optimism: 'OP Mainnet',
    bnb: 'BNB Smart Chain',
    polygon: 'Polygon',
    base: 'Base',
    arbitrum: 'Arbitrum One',
    sepolia: 'Sepolia (red de pruebas)',
    evm: 'Red EVM {{number}}',
  },
};
