-- Mirror catch-up (2026-08-15): the drizzle/ history had drifted from the
-- runtime migrations in lib/core/db/init.ts — three hand-written SQL files
-- (install_id, parse_status, license_key) existed without journal/snapshot
-- entries, and waist_cm / bmr_factor / streak_restarted_at were missing from
-- the mirror entirely. This generated migration consolidates all six columns;
-- the orphan files were removed. On-device the app still applies init.ts —
-- this chain exists for tooling/history, and db:generate diffs are sane again.
ALTER TABLE `app_settings` ADD `waist_cm` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `bmr_factor` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `install_id` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `license_key` text;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `streak_restarted_at` integer;--> statement-breakpoint
ALTER TABLE `food_entries` ADD `parse_status` text;