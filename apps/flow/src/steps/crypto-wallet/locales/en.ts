/**
 * English messages of the crypto wallet step (C57, C64.1), under `cryptoWallet` in the flow's
 * messages. No message shows a wallet address or a signature.
 */
export const cryptoWalletEn = {
  title: 'Prove that you control your crypto wallet',
  intro:
    'You sign a message with your wallet. Signing a message is free: it sends no transaction and moves no funds.',
  network: 'Network',
  networkIs: 'Network: {{network}}',
  restarted:
    'Your last attempt ended because too many messages to sign were asked for. Start again.',
  wallet: {
    connect: 'Connect your wallet',
    connectNamed: 'Connect {{name}}',
    connecting: 'Waiting for your wallet…',
    signing: 'Sign the message in your wallet. It shows this website and why we ask.',
    submitting: 'Sending your signature…',
    pasteInstead: 'Paste a signature instead',
    declined: 'You declined the request in your wallet. Try again when you are ready.',
    failed: 'Your wallet could not complete the request. Try again, or paste a signature instead.',
    failedNoPaste: 'Your wallet could not complete the request. Try again.',
    needed:
      'This step needs a browser wallet. Open this page in a browser with a wallet extension, or in your wallet app’s browser.',
  },
  paste: {
    address: 'Wallet address',
    addressHint: 'Copy it from your wallet, then paste it here.',
    getMessage: 'Get the message to sign',
    gettingMessage: 'Getting the message…',
    message: 'Message to sign',
    messageHint:
      'Sign this exact message in your wallet, then paste the signature below. Sign it before {{time}}.',
    copy: 'Copy the message',
    copied: 'Message copied.',
    copyFailed: 'We could not copy the message. Select it and copy it yourself.',
    signature: 'Signature',
    signedMessage: 'Signed message (optional)',
    signedMessageHint:
      'Some Solana wallets show the bytes they signed. If yours does, paste them here.',
    submit: 'Submit signature',
    submitting: 'Sending your signature…',
    otherAddress: 'Use a different address',
    walletInstead: 'Use your browser wallet instead',
  },
  errors: {
    addressRequired: 'Enter your wallet address.',
    addressInvalid:
      'This wallet address is not valid for the network you chose. Check that you copied the whole address.',
    addressNotExpected:
      'This is not the wallet address you were asked to verify. Use the expected wallet address.',
    chainNotOffered: 'This network is not accepted here. Choose another network.',
    signatureRequired: 'Paste the signature from your wallet.',
    signatureTooLong: 'This signature is too long. Paste only the signature.',
    challengeInvalid: 'This message has expired or was already used. Get a new message to sign.',
  },
  chains: {
    bitcoin: 'Bitcoin',
    bitcoinTestnet: 'Bitcoin testnet',
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
    sepolia: 'Sepolia testnet',
    evm: 'EVM network {{number}}',
  },
} as const;
