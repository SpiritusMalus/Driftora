-- Random per-install id for the server's AI-quota meter (X-Install-Id header).
-- Not an account, not a device identifier — a 128-bit coin flip generated on
-- first launch. Null until the app mints one.
ALTER TABLE `app_settings` ADD `install_id` text;
