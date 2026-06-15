import 'package:drift/drift.dart';
import 'package:drift/native.dart';

import 'tables.dart';

part 'database.g.dart';

/// The app's encrypted local database.
///
/// Construct with an encrypted [QueryExecutor] in `main()` (see
/// `openEncryptedExecutor`), or with [AppDatabase.memory] in tests.
@DriftDatabase(
  tables: [
    FoodEntries,
    FoodItems,
    StepsDays,
    DiaryEntries,
    Wins,
    AppSettingsRows,
  ],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase(super.e);

  /// In-memory database, for tests.
  AppDatabase.memory() : super(NativeDatabase.memory());

  @override
  int get schemaVersion => 1;

  /// Returns the single settings row, creating it with sensible defaults the
  /// first time.
  Future<AppSettingsRow> ensureSettings() async {
    await into(appSettingsRows).insert(
      const AppSettingsRowsCompanion(id: Value(0)),
      mode: InsertMode.insertOrIgnore,
    );
    return (select(appSettingsRows)..where((t) => t.id.equals(0))).getSingle();
  }

  /// Logs a celebrated win.
  Future<int> addWin({
    required String kind,
    required String text,
    DateTime? ts,
  }) {
    return into(wins).insert(
      WinsCompanion.insert(ts: ts ?? DateTime.now(), kind: kind, message: text),
    );
  }

  /// Watches all wins, newest first.
  Stream<List<Win>> watchWins() {
    return (select(wins)..orderBy([(t) => OrderingTerm.desc(t.ts)])).watch();
  }
}
