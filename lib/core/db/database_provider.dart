import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'database.dart';

/// The opened [AppDatabase].
///
/// Always overridden at the root: in `main()` with the encrypted on-device
/// instance, and in tests with `AppDatabase.memory()`.
final databaseProvider = Provider<AppDatabase>((ref) {
  throw UnimplementedError('databaseProvider must be overridden');
});
