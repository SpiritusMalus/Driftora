CREATE TABLE `workouts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`date` text NOT NULL,
	`type` text NOT NULL,
	`minutes` integer NOT NULL,
	`kcal` real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE `food_entries` ADD `micros` text;