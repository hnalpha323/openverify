/**
 * BIP-137 message signature vectors:
 * - Bitcoin Core's `test/functional/rpc_signmessagewithprivkey.py` at commit fa5f29774872
 *   (MIT): a testnet P2PKH signature of a fixed message (the private key is left out);
 * - bitcoinjs-message `test/fixtures.json` at commit 281289ef04ad (MIT, Copyright (c) 2015-2016
 *   Bitcoinjs developers): P2PKH with uncompressed and compressed keys, P2SH-P2WPKH and P2WPKH
 *   headers, a Dogecoin signature, and the four signatures it must refuse.
 * Test data, never shipped.
 */

export interface Bip137Vector {
  description: string;
  network: 'bitcoin' | 'testnet' | 'dogecoin';
  address: string;
  message: string;
  signature: string;
}

export const BIP137_VALID_VECTORS: readonly Bip137Vector[] = [
  {
    description: 'Bitcoin Core: testnet P2PKH, compressed key (header 32)',
    network: 'testnet',
    address: 'mpLQjfK79b7CCV4VMJWEWAj5Mpx8Up5zxB',
    message: 'This is just a test message',
    signature:
      'INbVnW4e6PeRmsv2Qgu8NuopvrVjkcxob+sX8OcZG0SALhWybUjzMLPdAsXI46YZGb0KQTRii+wWIQzRpG/U+S0=',
  },
  {
    description: 'bitcoinjs-message: bitcoin P2PKH, uncompressed key (header 27)',
    network: 'bitcoin',
    address: '16UwLL9Risc3QfPqBUvKofHmBQ7wMtjvM',
    message: 'vires is numeris',
    signature:
      'G8JawPtQOrybrSP1WHQnQPr67B9S3qrxBrl1mlzoTJOSHEpmnF7D3+t+LX0Xei9J20B5AIdPbeL3AaTBZ4N3bY0=',
  },
  {
    description: 'bitcoinjs-message: bitcoin P2PKH, compressed key (header 31)',
    network: 'bitcoin',
    address: '1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs',
    message: 'vires is numeris',
    signature:
      'H8JawPtQOrybrSP1WHQnQPr67B9S3qrxBrl1mlzoTJOSHEpmnF7D3+t+LX0Xei9J20B5AIdPbeL3AaTBZ4N3bY0=',
  },
  {
    description: 'bitcoinjs-message: bitcoin P2SH-P2WPKH header (header 36)',
    network: 'bitcoin',
    address: '3JvL6Ymt8MVWiCNHC7oWU6nLeHNJKLZGLN',
    message: 'vires is numeris',
    signature:
      'JF8nHqFr3K2UKYahhX3soVeoW8W1ECNbr0wfck7lzyXjCS5Q16Ek45zyBuy1Fiy9sTPKVgsqqOuPvbycuVSSVl8=',
  },
  {
    description: 'bitcoinjs-message: bitcoin P2WPKH header (header 40)',
    network: 'bitcoin',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    message: 'vires is numeris',
    signature:
      'KF8nHqFr3K2UKYahhX3soVeoW8W1ECNbr0wfck7lzyXjCS5Q16Ek45zyBuy1Fiy9sTPKVgsqqOuPvbycuVSSVl8=',
  },
  {
    description: 'bitcoinjs-message: dogecoin P2PKH, compressed key (header 31)',
    network: 'dogecoin',
    address: 'DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE',
    message: 'vires is numeris',
    signature:
      'H6k+dZwJ8oOei3PCSpdj603fDvhlhQ+sqaFNIDvo/bI+Xh6zyIKGzZpyud6YhZ1a5mcrwMVtTWL+VXq/hC5Zj7s=',
  },
];

export const BIP137_INVALID_VECTORS: readonly Bip137Vector[] = [
  {
    description: 'bitcoinjs-message: will fail for the wrong message',
    network: 'bitcoin',
    address: '16UwLL9Risc3QfPqBUvKofHmBQ7wMtjvM',
    message: 'foobar',
    signature:
      'G8JawPtQOrybrSP1WHQnQPr67B9S3qrxBrl1mlzoTJOSHEpmnF7D3+t+LX0Xei9J20B5AIdPbeL3AaTBZ4N3bY0=',
  },
  {
    description: 'bitcoinjs-message: will fail for the wrong address',
    network: 'bitcoin',
    address: '1111111111111111111114oLvT2',
    message: 'vires is numeris',
    signature:
      'H8JawPtQOrybrSP1WHQnQPr67B9S3qrxBrl1mlzoTJOSHEpmnF7D3+t+LX0Xei9J20B5AIdPbeL3AaTBZ4N3bY0=',
  },
  {
    description:
      'bitcoinjs-message: does not cross verify (uncompressed address, compressed signature)',
    network: 'bitcoin',
    address: '16UwLL9Risc3QfPqBUvKofHmBQ7wMtjvM',
    message: 'vires is numeris',
    signature:
      'H8JawPtQOrybrSP1WHQnQPr67B9S3qrxBrl1mlzoTJOSHEpmnF7D3+t+LX0Xei9J20B5AIdPbeL3AaTBZ4N3bY0=',
  },
  {
    description:
      'bitcoinjs-message: does not cross verify (compressed address, uncompressed signature)',
    network: 'bitcoin',
    address: '1PMycacnJaSqwwJqjawXBErnLsZ7RkXUAs',
    message: 'vires is numeris',
    signature:
      'G8JawPtQOrybrSP1WHQnQPr67B9S3qrxBrl1mlzoTJOSHEpmnF7D3+t+LX0Xei9J20B5AIdPbeL3AaTBZ4N3bY0=',
  },
];

/** bitcoinjs-message: the digest of the network's magic and the message. */
export const BIP137_MAGIC_HASH_VECTORS: readonly {
  network: 'bitcoin' | 'dogecoin';
  message: string;
  magicHash: string;
}[] = [
  {
    network: 'bitcoin',
    message: '',
    magicHash: '80e795d4a4caadd7047af389d9f7f220562feb6196032e2131e10563352c4bcc',
  },
  {
    network: 'bitcoin',
    message: 'Vires is Numeris',
    magicHash: 'f8a5affbef4a3241b19067aa694562f64f513310817297089a8929a930f4f933',
  },
  {
    network: 'bitcoin',
    message: 'Virès is Numéris',
    magicHash: 'af3d51b82a6694d76af5b49401d6f824d66cfce6f96213e606e7da95fe675f25',
  },
  {
    network: 'dogecoin',
    message: 'Vires is Numeris',
    magicHash: 'c0963d20d0accd0ea0df6c1020bf85a7e629a40e7b5363f2c3e9dcafd5638f12',
  },
  {
    network: 'dogecoin',
    message: 'Virès is Numéris',
    magicHash: '188eaf871fc659e3dd7503863fcfe051db149eb4dd8fd77ef020f099b7122b75',
  },
];

/** bitcoinjs-message: encodings no verifier may read (a header out of range, wrong lengths). */
export const BIP137_MALFORMED_SIGNATURES: readonly { description: string; signature: string }[] = [
  {
    description: 'bitcoinjs-message: Invalid signature parameter',
    signature:
      'K5h86t5qME/Fgjqzj5n8PF93Ki0+ieoFkx4nJhBfxTueYB/DIx81lixxT8vOXJW0J0lu3Hros9Euk3kddil5W2I=',
  },
  {
    description: 'bitcoinjs-message: Invalid signature length',
    signature:
      'HJh86t5qME/Fgjqzj5n8PF93Ki0+ieoFkx4nJhBfxTueYB/DIx81lixxT8vOXJW0J0lu3Hros9Euk3kddil5W2IAAAA=',
  },
  {
    description: 'bitcoinjs-message: Invalid signature length',
    signature: 'HJh86t5qME/Fgjqzj5n8PF93Ki0+ieoFkx4nJhBfxTueYB/DIx81lixxT8vOXJW0J0lu3Hros9Euk3k=',
  },
];
