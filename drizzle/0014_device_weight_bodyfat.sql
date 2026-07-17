ALTER TABLE `app_settings` ADD `health_import_extended` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `weights` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `weights` ADD `body_fat_pct` real;