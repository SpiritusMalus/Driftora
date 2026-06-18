CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY DEFAULT 0 NOT NULL,
	`target_kcal` real DEFAULT 2000 NOT NULL,
	`target_protein_g` real DEFAULT 120 NOT NULL,
	`target_fat_g` real DEFAULT 70 NOT NULL,
	`target_carb_g` real DEFAULT 200 NOT NULL,
	`steps_goal` integer DEFAULT 7000 NOT NULL,
	`region` text DEFAULT 'auto' NOT NULL,
	`reminder_times` text DEFAULT '[]' NOT NULL,
	`hide_calories` integer DEFAULT false NOT NULL,
	`llm_diary_assist` integer DEFAULT false NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`show_population_stats` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `diary_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`situation` text DEFAULT '' NOT NULL,
	`thoughts` text DEFAULT '' NOT NULL,
	`emotions` text DEFAULT '[]' NOT NULL,
	`reaction_body` text DEFAULT '' NOT NULL,
	`reaction_behavior` text DEFAULT '' NOT NULL,
	`evidence_for` text DEFAULT '' NOT NULL,
	`evidence_against` text DEFAULT '' NOT NULL,
	`reframe` text DEFAULT '' NOT NULL,
	`mood` integer,
	`distortions` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `food_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`raw_text` text NOT NULL,
	`source` text NOT NULL,
	`kcal` real DEFAULT 0 NOT NULL,
	`protein_g` real DEFAULT 0 NOT NULL,
	`fat_g` real DEFAULT 0 NOT NULL,
	`carb_g` real DEFAULT 0 NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `food_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entry_id` integer NOT NULL,
	`name` text NOT NULL,
	`qty_g` real,
	`kcal` real DEFAULT 0 NOT NULL,
	`protein_g` real DEFAULT 0 NOT NULL,
	`fat_g` real DEFAULT 0 NOT NULL,
	`carb_g` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `food_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `moods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `steps_days` (
	`date` text PRIMARY KEY NOT NULL,
	`steps` integer DEFAULT 0 NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `weights` (
	`date` text PRIMARY KEY NOT NULL,
	`weight_kg` real NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wins` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL
);
