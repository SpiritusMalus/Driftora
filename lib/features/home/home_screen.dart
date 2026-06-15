import 'package:flutter/material.dart';

import '../../l10n/app_localizations.dart';
import '../../shared/section_card.dart';

/// The home dashboard. In M0 it's an empty skeleton; later milestones fill the
/// sections with today's macros, steps, the last win, etc.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.homeTitle)),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(l.homeGreeting, style: theme.textTheme.titleMedium),
          const SizedBox(height: 16),
          SectionCard(
            icon: Icons.restaurant_outlined,
            title: l.sectionNutrition,
            subtitle: l.comingSoon,
          ),
          SectionCard(
            icon: Icons.directions_walk_outlined,
            title: l.sectionSteps,
            subtitle: l.comingSoon,
          ),
          SectionCard(
            icon: Icons.psychology_alt_outlined,
            title: l.sectionDiary,
            subtitle: l.comingSoon,
          ),
          SectionCard(
            icon: Icons.emoji_events_outlined,
            title: l.sectionWins,
            subtitle: l.comingSoon,
          ),
          const SizedBox(height: 24),
          Text(
            l.emptyHomeHint,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}
