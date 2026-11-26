import { defineConfig } from 'drizzle-kit';

// Generating migrations needs no database: `pnpm --filter @openverify/db db:generate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
