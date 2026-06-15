// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Russian (`ru`).
class AppLocalizationsRu extends AppLocalizations {
  AppLocalizationsRu([String locale = 'ru']) : super(locale);

  @override
  String get appTitle => 'HealthRoutine';

  @override
  String get homeTitle => 'Сегодня';

  @override
  String get homeGreeting => 'Ваш день в одном экране';

  @override
  String get sectionNutrition => 'Питание';

  @override
  String get sectionSteps => 'Шаги';

  @override
  String get sectionDiary => 'Дневник мыслей';

  @override
  String get sectionWins => 'Победы';

  @override
  String get comingSoon => 'Скоро';

  @override
  String get emptyHomeHint =>
      'Пока тут пусто — записи появятся, как только вы начнёте.';
}
