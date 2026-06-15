import 'package:flutter_test/flutter_test.dart';
import 'package:health_routine/core/insights/step_insight.dart';

void main() {
  group('stepBand', () {
    test('classifies counts into evidence-based bands', () {
      expect(stepBand(0), StepBand.none);
      expect(stepBand(1500), StepBand.low);
      expect(stepBand(3500), StepBand.building);
      expect(stepBand(7000), StepBand.beneficial);
      expect(stepBand(12000), StepBand.ample);
    });

    test('older adults reach the plateau earlier', () {
      expect(stepBand(7000, ageYears: 65), StepBand.ample);
      expect(stepBand(7000, ageYears: 30), StepBand.beneficial);
    });
  });

  group('stepInsight', () {
    test('never promotes the 10,000-steps myth', () {
      for (final steps in [0, 3000, 7000, 9000, 15000]) {
        final s = stepInsight(steps: steps, goal: 7000);
        expect(s.contains('10 000'), isFalse, reason: 'for $steps steps');
        expect(s.contains('10000'), isFalse, reason: 'for $steps steps');
        expect(s, isNotEmpty);
      }
    });

    test('low movement is encouraged, not shamed', () {
      final s = stepInsight(steps: 800, goal: 7000);
      expect(s.toLowerCase(), isNot(contains('провал')));
      expect(s, contains('в плюс').or(contains('снизит')));
    });

    test('hitting the personal goal is acknowledged', () {
      final s = stepInsight(steps: 7200, goal: 7000);
      expect(s, contains('цель'));
    });
  });
}

extension _StringMatcherOr on Matcher {
  Matcher or(Matcher other) => anyOf(this, other);
}
