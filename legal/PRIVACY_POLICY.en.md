# Privacy Policy — Driftora

**Effective date:** August 13, 2026.
**Operator (“we”):** Individual entrepreneur Evgeny Yuryevich Tikhonenko, OGRNIP 326508100294665, INN 504414138460 (“Driftora”).
**Contact:** support@family-pie.ru

Driftora is a self-care mobile app: a thought diary (CBT / situation–thoughts–emotions–reactions), mood check-ins, weight, steps and food logging. Your records live **on your device** in an encrypted database. You may create an **encrypted backup** that you keep yourself, or enable **optional encrypted synchronization**. In both cases, **the operator cannot read** the contents. There is no email or phone registration. This policy explains what is processed, where it is stored and exactly what leaves your device.

## At a glance

- The app works **without email or phone registration**. Optional synchronization uses an anonymous key account (a cryptographic key, rather than an email and password).
- Your diary, mood, weight, steps and food records stay in an encrypted database on your device. You may create an **encrypted backup** or enable **encrypted synchronization**; in both cases, **the operator cannot read** the contents.
- Only **food recognition** — a meal description, photo or voice recording — is sent over the internet, and only if you enable AI recognition yourself.
- The **shared food database** is a separate feature, off by default. If enabled, food names and their calories and macronutrients become publicly searchable, without portion weight, time, entry text or a link to you.
- We **do not sell** your data or **show third-party ads**.

## Where data is stored

Your diary, mood, weight and food records are stored on your device in an encrypted database (SQLCipher; the key is in your phone’s secure storage). The operator cannot access or read this database.

**Backup (your choice).** You can export an **encrypted file** containing all your data and save it through the system Share dialog to **your own cloud** (iCloud, Google Drive or another destination you choose). You hold the encryption key; the operator is not involved and cannot read the file. A **recovery phrase** (or key file) lets you restore on a new device. **Only you** save and keep it; the operator never sees it. To simplify transfers within one ecosystem, the master key may be mirrored to **iCloud Keychain / Google Block Store** in your own Apple/Google account.

**Synchronization (optional, your choice).** You can enable **encrypted synchronization** between your devices. The operator’s server then stores only the backup’s **unreadable ciphertext** and operational metadata (see “What data is processed”). The operator has no decryption key. This feature is **off by default** and enabled only by you. Before it is enabled in production, the applicable-law checks must be completed; when synchronization is enabled, its server is in the Russian Federation.

## What data is processed

**On the device.** Thought-diary entries (situation, thoughts, emotions, reactions, evidence and reframing), mood check-ins (0–10), daily weight and steps, food and nutrition records, your goals, reminder times and settings flags. Some of this is health and mental-state data (a “special category”). Readable data is processed **on your device** and leaves it only as described below (encrypted backup or synchronization, always as unreadable ciphertext).

**No identifying information.** The app does not request your name, email, phone number or precise location, and does not link records to your identity. Records are tied only to the device.

**Synchronization metadata.** If you enable synchronization, the server receives an **encrypted database snapshot** (unreadable ciphertext) and non-content metadata: your anonymous key account’s **public key**, device identifier, snapshot size and timestamps. Your **IP address** is visible at the network level. Decrypted records are **never** sent to the server. This metadata is not encrypted and is the only additional disclosed information when synchronization is enabled.

## Data transfer for food recognition

If you enable AI food recognition, the meal’s text, photo or voice recording is sent through our server to OpenRouter (OpenRouter, Inc., servers in the USA), which identifies foods using AI. This is a cross-border transfer. Calories and macronutrients are calculated from the built-in database, rather than by the neural network. Your diary, mood, weight and other records are not sent. Recognition is off by default, enabled manually and can be revoked in Settings. Photos are resized and location tags removed before sending. The voice recording goes to the same model and is not sent to the phone’s system speech recognizer.

An **installation identifier** accompanies the request: a random value the app creates on first launch. It is unrelated to your identity, phone or account, and is used only to count remaining free recognitions and associate a paid subscription with an installation. Our server stores it with the recognition counter; the request contents are not stored alongside it. Reinstalling creates a new identifier and counter.

## Shared food database

The shared food database is separate and **off by default**. If enabled, a food whose **calories and macronutrients you entered yourself** (or read from its packaging) is sent to our server and becomes searchable by other users. **Only the name and calories and macronutrients per 100 g** are sent: no portion weight, time, entry text, installation identifier or link to you. The database records nothing that would identify the contributor. Names are visible to all users, so do not include personal information. You can **search** without sharing: sharing has its own Settings switch. Previously shared foods remain after disabling sharing because they are already anonymous and indistinguishable from other submissions. To request deletion of a specific entry you can identify, contact support@family-pie.ru.

## Special-category data

Health and mental-state data (thought diary, mood, weight) is processed in **readable form** on the device. Neither the operator nor third parties receives its **readable contents**. It is not sent to the AI food-recognition service; backups and synchronization contain it only as **unreadable ciphertext**, whose key the operator does not have.

## Why data is processed

- To display your records, goals and trends on your device.
- To send local reminders (you can disable them in your phone’s settings).
- If you enable AI recognition, to identify foods from text or photos; the numbers still come from the built-in database.

## Legal grounds (Federal Law No. 152-FZ)

On-device processing takes place in your interests and under your control. Cross-border transfer for AI recognition takes place **only with your separate consent**, given in the app before the first transfer and revocable in Settings. Backups and synchronization are also **under your control and with your consent**, and off by default. When synchronization is enabled, the encrypted snapshot is stored on the operator’s server in the **Russian Federation**. Processing is recorded in Roskomnadzor’s operator register (entry 77-26-554244, notification 82677/77 dated May 25, 2026). Notification of cross-border transfer to the USA for AI recognition has been submitted to Roskomnadzor.

## Third-party transfers

The only recipient of **content** outside the device is the AI recognition provider (OpenRouter, Inc., USA), within the scope described in “Data transfer for food recognition”. In addition:

- A **backup you initiate** is sent as an encrypted file to **a cloud provider you choose** (iCloud, Google Drive, etc.). That provider’s terms govern the transfer; the operator is not involved and cannot read the file.
- **Synchronization, if enabled**, transfers only **unreadable ciphertext** and metadata to the operator’s server in the **Russian Federation**, without decrypted records.
- **Subscription payments, if you subscribe**, are processed by **YooKassa (YooMoney non-bank credit organization LLC, Russian Federation)**. Card details are entered with YooKassa and not given to the operator. The operator receives only the payment fact and status, its identifier and, if provided, your receipt email. Diary, weight, mood and food records are not transferred during payment.

We do not sell personal data or share it for advertising. Disclosure may occur only when required by law.

## Retention and deletion

Records remain on your device until you delete them or uninstall the app. You delete a **backup** yourself by deleting its file from your cloud. With **synchronization**, deleting the account/snapshot removes the operator’s stored ciphertext. AI requests are processed ephemerally: the operator’s server does not store or log their contents. Retention by the AI provider (OpenRouter, Inc., USA) is governed by OpenRouter’s terms and data processing agreement.

## Your rights

You can access, correct and delete your records directly in the app; revoke AI recognition consent in Settings; disable synchronization; and delete backups. For **portability**, you do not need to contact the operator: you already hold a complete encrypted export in your backup file. Because the operator does not store your records in readable form, a separate content-access, correction or deletion request is unnecessary. With synchronization, stored ciphertext is removed by deleting the account/snapshot. For other questions: support@family-pie.ru.

## Children

The app is not intended for children under 16. We do not knowingly collect data from children below that age.

## Security

The on-device database is encrypted (SQLCipher); its key is stored in OS secure storage (Keychain/Keystore). AI-service transfers use TLS. Backups and synchronization use **end-to-end encryption (E2E)**: you hold the key, and the operator **does not have a key** capable of reading your data. Even on the server, only unreadable ciphertext is stored. No storage or transfer method is completely secure, but we work to protect your data.

## Changes

We may update this policy. The new effective date will appear here. Material changes require renewed consent in the app.

## Contact

Individual entrepreneur Evgeny Yuryevich Tikhonenko, OGRNIP 326508100294665, INN 504414138460 — support@family-pie.ru
