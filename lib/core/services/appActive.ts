import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/// Runs [onActive] every time the app returns to the foreground. Navigation
/// focus effects don't re-fire on an OS-level resume — only on in-app
/// transitions — so the passive signals (device steps, sleep) sat hours-stale
/// in the day budget until the user happened to navigate somewhere («шаги
/// подключились, а калории не меняются», device feedback 2026-07-12). The
/// callback rides a ref, so the latest closure runs without resubscribing.
export function useAppActiveEffect(onActive: () => void): void {
  const cb = useRef(onActive);
  cb.current = onActive;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') cb.current();
    });
    return () => sub.remove();
  }, []);
}
