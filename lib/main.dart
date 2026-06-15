import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'app/router.dart';
import 'core/db/connection.dart';
import 'core/db/database.dart';
import 'core/db/database_provider.dart';
import 'core/db/db_key_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Open the encrypted local database with a key from OS secure storage.
  final key = await DbKeyStore().getOrCreateKey();
  final db = AppDatabase(openEncryptedExecutor(key));
  await db.ensureSettings();

  runApp(
    ProviderScope(
      overrides: [databaseProvider.overrideWithValue(db)],
      child: HealthRoutineApp(router: createRouter()),
    ),
  );
}
