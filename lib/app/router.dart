import 'package:go_router/go_router.dart';

import '../features/home/home_screen.dart';

/// Builds the app's route table. New feature routes (food, diary, settings…)
/// are added here as milestones land.
GoRouter createRouter() {
  return GoRouter(
    initialLocation: '/',
    routes: [
      GoRoute(
        path: '/',
        name: 'home',
        builder: (context, state) => const HomeScreen(),
      ),
    ],
  );
}
