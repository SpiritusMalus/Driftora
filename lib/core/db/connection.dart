import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

/// Opens the on-device SQLite database, encrypted at rest with SQLCipher.
///
/// The SQLCipher-enabled build of `sqlite3` is selected at native build time
/// via the `hooks:` block in pubspec.yaml (`sqlite3: source: sqlcipher`) — the
/// old `sqlcipher_flutter_libs` / `open.overrideFor` API was removed in
/// `sqlite3` v3.x. [key] is a secret passphrase kept in OS secure storage
/// (see [DbKeyStore]).
///
/// NOTE: this native path runs only on a real device/simulator (tests use
/// `AppDatabase.memory`). It is currently UNVERIFIED on-device because the
/// iOS/Android toolchains are not yet installed — validate on the first device
/// build (the [StateError] below will fire if encryption isn't actually active).
QueryExecutor openEncryptedExecutor(String key) {
  return LazyDatabase(() async {
    final dir = await getApplicationDocumentsDirectory();
    final file = File(p.join(dir.path, 'health_routine.db'));

    return NativeDatabase(
      file,
      setup: (raw) {
        // The key MUST be applied before any other statement.
        final escaped = key.replaceAll("'", "''");
        raw.execute("PRAGMA key = '$escaped';");
        // Refuse to continue if encryption isn't actually active — we never
        // want to silently store health/therapy data unencrypted.
        final cipher = raw.select('PRAGMA cipher_version;');
        if (cipher.isEmpty) {
          throw StateError(
            'SQLCipher unavailable: refusing to open an unencrypted database.',
          );
        }
      },
    );
  });
}
