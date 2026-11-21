CREATE TABLE `food_entry_photos` (
	`entry_id` integer PRIMARY KEY NOT NULL,
	`jpg_base64` text NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `food_entries`(`id`) ON UPDATE no action ON DELETE cascade
);
