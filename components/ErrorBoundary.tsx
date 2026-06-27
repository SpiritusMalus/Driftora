import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import i18n from '@/lib/i18n';

/// Colors the fallback paints with. Passed in (not read via `useTheme`) because
/// a class error boundary can't use hooks, and the fallback must stay self
/// contained — it must never depend on app components that may be the very
/// thing that just crashed.
export interface ErrorBoundaryColors {
  background: string;
  text: string;
  subtle: string;
  primary: string;
  onPrimary: string;
}

interface Props {
  children: ReactNode;
  colors: ErrorBoundaryColors;
}

interface State {
  error: Error | null;
}

/// Top-level crash net. Without this, any render error in a screen unmounts the
/// whole tree and the user is left on a white screen (and Google Play's
/// pre-launch report flags it as a crash). Here we catch it, show a calm,
/// localized recovery screen, and let the user retry by remounting the subtree.
///
/// Strings use `i18n.t` with baked-in defaults so the fallback never shows a raw
/// key even if translations failed to load.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    // Surfaces in `adb logcat` / device logs for diagnosis; no PII is included
    // beyond the error message itself.
    console.error('Unhandled render error:', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error == null) return this.props.children;

    const { colors } = this.props;
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <Text style={[styles.title, { color: colors.text }]}>
          {i18n.t('errorBoundary.title', { defaultValue: 'Something went wrong' })}
        </Text>
        <Text style={[styles.body, { color: colors.subtle }]}>
          {i18n.t('errorBoundary.body', {
            defaultValue:
              'The screen ran into an unexpected problem. Your data is safe on this device. Try again.',
          })}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={this.reset}
          style={[styles.button, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.buttonLabel, { color: colors.onPrimary }]}>
            {i18n.t('errorBoundary.retry', { defaultValue: 'Try again' })}
          </Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  button: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
});
