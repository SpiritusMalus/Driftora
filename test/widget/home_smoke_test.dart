import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:health_routine/app/app.dart';
import 'package:health_routine/app/router.dart';
import 'package:health_routine/core/db/database.dart';
import 'package:health_routine/core/db/database_provider.dart';

void main() {
  testWidgets('app boots to the Russian Home dashboard', (tester) async {
    final db = AppDatabase.memory();
    addTearDown(db.close);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [databaseProvider.overrideWithValue(db)],
        child: HealthRoutineApp(router: createRouter()),
      ),
    );
    await tester.pumpAndSettle();

    // Localized (ru) strings render, and the dashboard skeleton is present.
    expect(find.text('Сегодня'), findsOneWidget);
    expect(find.text('Питание'), findsOneWidget);
    expect(find.text('Дневник мыслей'), findsOneWidget);
  });
}
