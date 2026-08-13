-- Licence key for the AI subscription, bought on the payment page and typed in
-- on the Subscription screen. Null = free tier (every existing install).
-- Plaintext on purpose: it is our own invention with no power outside this app,
-- and the owner has to read it back to move the subscription to a new phone.
ALTER TABLE `app_settings` ADD `license_key` text;
