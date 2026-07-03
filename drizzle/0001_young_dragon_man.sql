CREATE TABLE `food_choices` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`per100` text NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sleep_days` (
	`date` text PRIMARY KEY NOT NULL,
	`minutes` integer DEFAULT 0 NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `app_settings` ADD `height_cm` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `sex` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `birth_year` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `activity_level` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `onboarding_seen` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `contextual_nudges` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `sync_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `sync_consent_at` integer;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `sync_consent_version` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `diary_entries` ADD `mood_before` integer;--> statement-breakpoint
ALTER TABLE `steps_days` ADD `source` text DEFAULT 'stub' NOT NULL;