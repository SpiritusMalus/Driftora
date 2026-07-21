-- Background-parse lifecycle for entries saved BEFORE their parse finished
-- (the user left the log screen mid-photo): 'pending' → still parsing in this
-- process, 'failed' → parse lost (tap to retry while the photo lives, reshoot
-- otherwise). NULL = a normal, fully parsed entry.
ALTER TABLE `food_entries` ADD `parse_status` text;
