/**
 * EIP-55's eight test addresses (all upper case, all lower case and mixed case, each correctly
 * checksummed), transcribed from ethereum/ERCs `ERCS/erc-55.md` at commit 8dd085d159cb, and the
 * three example messages of EIP-4361 (`ERCS/erc-4361.md` at commit faa49e076526). ERCs are CC0-1.0.
 * Test data, never shipped.
 */

export const EIP55_TEST_ADDRESSES: readonly string[] = [
  '0x52908400098527886E0F7030069857D2E4169EE7',
  '0x8617E340B3D01FA5F11F306F4090FD50E238070D',
  '0xde709f2102306220921060314715629080e2fb77',
  '0x27b1fdb04752bbc536007a920d24acb045561c26',
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
];

export const EIP4361_EXAMPLE_MESSAGES: readonly string[] = [
  'example.com wants you to sign in with your Ethereum account:\n0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2\n\nI accept the ExampleOrg Terms of Service: https://example.com/tos\n\nURI: https://example.com/login\nVersion: 1\nChain ID: 1\nNonce: 32891756\nIssued At: 2021-09-30T16:25:24Z\nResources:\n- ipfs://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq/\n- https://example.com/my-web2-claim.json',
  'example.com:3388 wants you to sign in with your Ethereum account:\n0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2\n\nI accept the ExampleOrg Terms of Service: https://example.com/tos\n\nURI: https://example.com/login\nVersion: 1\nChain ID: 1\nNonce: 32891756\nIssued At: 2021-09-30T16:25:24Z\nResources:\n- ipfs://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq/\n- https://example.com/my-web2-claim.json',
  'https://example.com wants you to sign in with your Ethereum account:\n0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2\n\nI accept the ExampleOrg Terms of Service: https://example.com/tos\n\nURI: https://example.com/login\nVersion: 1\nChain ID: 1\nNonce: 32891756\nIssued At: 2021-09-30T16:25:24Z\nResources:\n- ipfs://bafybeiemxf5abjwjbikoz4mc3a3dla6ual3jsgpdr4cjr3oz3evfyavhwq/\n- https://example.com/my-web2-claim.json',
];
