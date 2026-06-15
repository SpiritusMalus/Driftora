import 'package:drift/drift.dart';

/// How a food entry was captured.
enum FoodSource { voice, text }

/// One logged meal/snack (with its parsed macro totals).
class FoodEntries extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get ts => dateTime()();
  TextColumn get rawText => text()();
  IntColumn get source => intEnum<FoodSource>()();
  RealColumn get kcal => real().withDefault(const Constant(0))();
  RealColumn get proteinG => real().withDefault(const Constant(0))();
  RealColumn get fatG => real().withDefault(const Constant(0))();
  RealColumn get carbG => real().withDefault(const Constant(0))();
  BoolColumn get confirmed => boolean().withDefault(const Constant(false))();
}

/// The LLM breakdown of a [FoodEntries] row into individual items.
class FoodItems extends Table {
  IntColumn get id => integer().autoIncrement()();
  IntColumn get entryId =>
      integer().references(FoodEntries, #id, onDelete: KeyAction.cascade)();
  TextColumn get name => text()();
  RealColumn get qtyG => real().nullable()();
  RealColumn get kcal => real().withDefault(const Constant(0))();
  RealColumn get proteinG => real().withDefault(const Constant(0))();
  RealColumn get fatG => real().withDefault(const Constant(0))();
  RealColumn get carbG => real().withDefault(const Constant(0))();
}

/// Daily step count pulled from the OS health store. One row per day.
class StepsDays extends Table {
  /// Local date at midnight; the primary key.
  DateTimeColumn get date => dateTime()();
  IntColumn get steps => integer().withDefault(const Constant(0))();
  DateTimeColumn get syncedAt => dateTime()();

  @override
  Set<Column> get primaryKey => {date};
}

/// A СМЭР (CBT) thought record. Emotions are stored as a JSON array of
/// `{ "name": String, "intensity": 0..100 }`.
class DiaryEntries extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get ts => dateTime()();
  TextColumn get situation => text().withDefault(const Constant(''))();
  TextColumn get thoughts => text().withDefault(const Constant(''))();
  TextColumn get emotions => text().withDefault(const Constant('[]'))();
  TextColumn get reactionBody => text().withDefault(const Constant(''))();
  TextColumn get reactionBehavior => text().withDefault(const Constant(''))();
  TextColumn get evidenceFor => text().withDefault(const Constant(''))();
  TextColumn get evidenceAgainst => text().withDefault(const Constant(''))();
  TextColumn get reframe => text().withDefault(const Constant(''))();

  /// Overall mood, 0..10 (nullable until the user sets it).
  IntColumn get mood => integer().nullable()();
}

/// A celebrated success / achievement.
class Wins extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get ts => dateTime()();
  TextColumn get kind => text()();

  // NB: named `message` rather than `text` — `text` is drift's column builder
  // and can't also be a column getter.
  TextColumn get message => text()();
}

/// Single-row app settings (always `id = 0`). Reminder times are a JSON array
/// of `"HH:mm"` strings.
class AppSettingsRows extends Table {
  IntColumn get id => integer().withDefault(const Constant(0))();
  RealColumn get targetKcal => real().withDefault(const Constant(2000))();
  RealColumn get targetProteinG => real().withDefault(const Constant(120))();
  RealColumn get targetFatG => real().withDefault(const Constant(70))();
  RealColumn get targetCarbG => real().withDefault(const Constant(200))();

  /// Personal, achievable goal — deliberately NOT the "10,000 steps" myth.
  IntColumn get stepsGoal => integer().withDefault(const Constant(7000))();
  TextColumn get reminderTimes => text().withDefault(const Constant('[]'))();

  /// Privacy/UX guardrail flags.
  BoolColumn get hideCalories => boolean().withDefault(const Constant(false))();
  BoolColumn get llmDiaryAssist =>
      boolean().withDefault(const Constant(false))();

  @override
  Set<Column> get primaryKey => {id};
}
