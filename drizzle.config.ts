import { defineConfig } from 'drizzle-kit';

/// drizzle-kit config for `npm run db:generate`. The app applies schema at
/// runtime via `lib/core/db/init.ts` (idempotent CREATE + ALTER migrations);
/// these generated SQL migrations are the forward-going history/source of truth
/// for the schema, started when `app_settings.region` was added (2026-06-18).
export default defineConfig({
  schema: './lib/core/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
});
