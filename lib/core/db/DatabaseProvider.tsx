import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import type { Database } from './client';

const DatabaseContext = createContext<Database | null>(null);

/**
 * Opens the encrypted database on mount and provides it to the tree.
 *
 * The op-sqlite client is imported dynamically so Jest and Expo Go (which lack
 * the native module) don't crash at module-eval time — `db` simply stays `null`
 * there, and screens fall back to placeholders.
 */
export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [{ openDatabase }, { ensureSettings }] = await Promise.all([
          import('./client'),
          import('./settings'),
        ]);
        const opened = await openDatabase();
        await ensureSettings(opened);
        if (mounted) setDb(opened);
      } catch (e) {
        console.warn('DB init failed:', e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  return <DatabaseContext.Provider value={db}>{children}</DatabaseContext.Provider>;
}

/// The opened database, or null while it initializes / on platforms without the
/// native SQLite module.
export function useDatabase(): Database | null {
  return useContext(DatabaseContext);
}
