/// Parsed result confidence, mirroring the LLM contract.
enum ParseConfidence { high, medium, low }

/// One parsed food item with its macros (БЖУ) and the assumptions made.
class ParsedFoodItem {
  const ParsedFoodItem({
    required this.name,
    required this.kcal,
    required this.proteinG,
    required this.fatG,
    required this.carbG,
    this.qtyG,
    this.assumptions = '',
  });

  final String name;
  final double? qtyG;
  final double kcal;
  final double proteinG;
  final double fatG;
  final double carbG;
  final String assumptions;
}

/// Structured result of parsing a Russian food utterance into items + totals.
class FoodParseResult {
  const FoodParseResult({
    required this.items,
    required this.kcal,
    required this.proteinG,
    required this.fatG,
    required this.carbG,
    required this.confidence,
    this.needsClarification = false,
    this.clarifyQuestion,
  });

  final List<ParsedFoodItem> items;
  final double kcal;
  final double proteinG;
  final double fatG;
  final double carbG;
  final ParseConfidence confidence;
  final bool needsClarification;
  final String? clarifyQuestion;
}

/// Turns a free-form Russian food utterance into structured macros.
///
/// Implemented in M1 over the Anthropic Messages API (tool use, low temperature).
/// This is the app's ONLY external network call; nothing else leaves the device.
abstract interface class FoodParser {
  Future<FoodParseResult> parse(String utterance);
}
