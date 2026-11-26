/**
 * The pinned Valkey image of every integration test (CLAUDE.md, `infra/docker-compose.yml`; C258.1,
 * Phase 11, Workflow 11C, images-11c): one constant, so the digest is written once, beside
 * `RUSTFS_TEST_IMAGE` and `POSTGRES_TEST_IMAGE`. `infra/tests/images.test.sh pins` holds it to the
 * plan's pin and fails a quoted Valkey image anywhere else.
 */
export const VALKEY_TEST_IMAGE =
  'valkey/valkey:9.1@sha256:3add1a336a920ea54770a001ab6feb3da5fceea96a40373a3a2cd469b815f0b7';
