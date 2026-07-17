CREATE TABLE `workout_import_tombstones` (
	`external_id` text PRIMARY KEY NOT NULL,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `steps_days` ADD `workout_steps` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `workouts` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `workouts` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `workouts` ADD `start_ts` integer;--> statement-breakpoint
ALTER TABLE `workouts` ADD `end_ts` integer;--> statement-breakpoint
ALTER TABLE `workouts` ADD `steps_in_window` integer;--> statement-breakpoint
ALTER TABLE `workouts` ADD `kcal_from` text;