import 'package:flutter_test/flutter_test.dart';
import 'package:health_routine/core/db/database.dart';

void main() {
  late AppDatabase db;

  setUp(() => db = AppDatabase.memory());
  tearDown(() => db.close());

  test(
    'ensureSettings creates one row with an honest (non-10k) step goal',
    () async {
      final settings = await db.ensureSettings();
      expect(settings.id, 0);
      expect(settings.stepsGoal, 7000);
      expect(settings.hideCalories, isFalse);
      expect(settings.llmDiaryAssist, isFalse);
    },
  );

  test('ensureSettings is idempotent', () async {
    await db.ensureSettings();
    await db.ensureSettings();
    final count = await db.select(db.appSettingsRows).get();
    expect(count, hasLength(1));
  });

  test('wins can be added and watched newest-first', () async {
    await db.addWin(kind: 'manual', text: 'older', ts: DateTime(2026, 1, 1));
    await db.addWin(kind: 'manual', text: 'newer', ts: DateTime(2026, 2, 1));
    final wins = await db.watchWins().first;
    expect(wins.map((w) => w.message), ['newer', 'older']);
  });
}
