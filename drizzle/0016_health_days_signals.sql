CREATE TABLE `health_days` (
	`date` text PRIMARY KEY NOT NULL,
	`resting_bpm` integer,
	`hrv_ms` real,
	`hrv_method` text,
	`spo2_pct` real,
	`resp_rate` real,
	`vo2max` real,
	`synced_at` integer NOT NULL
);
