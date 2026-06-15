// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'HealthRoutine';

  @override
  String get homeTitle => 'Today';

  @override
  String get homeGreeting => 'Your day at a glance';

  @override
  String get sectionNutrition => 'Nutrition';

  @override
  String get sectionSteps => 'Steps';

  @override
  String get sectionDiary => 'Thought diary';

  @override
  String get sectionWins => 'Wins';

  @override
  String get comingSoon => 'Coming soon';

  @override
  String get emptyHomeHint =>
      'Nothing here yet — entries will appear once you start.';
}
