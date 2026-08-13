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
 * Opens the database on mount and provides it to the tree.
 *
 * `./client` is imported dynamically, and `openDatabase` itself prefers op-sqlite
 * (encrypted) with an expo-sqlite fallback for Expo Go — so the app works without
 * a custom native build. `db` only stays `null` if both drivers fail (e.g. on
 * web), in which case screens fall back to placeholders.
 */
export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<Database | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [{ openDatabase }, { ensureSettings }, { ensureInstallId }] = await Promise.all([
          import('./client'),
          import('./settings'),
          import('../services/installId'),
        ]);
        const opened = await openDatabase();
        await ensureSettings(opened);
        // Fire-and-forget: the AI-quota meter id must never block (or fail) DB
        // provisioning — without it requests just use the server's ip bucket.
        // Re-registering the licence key on launch is not redundant: the server
        // stores only a hash of it and cannot re-check a purchase on its own, so
        // the client resending it is what turns a refund or an expiry into ended
        // access — and what carries a subscription onto a new install id after a
        // reinstall or a backup restore.
        //
        // CHAINED behind the id rather than fired alongside it: the purchase is
        // bound to the install id, and a refresh that starts first would find
        // none cached yet and silently do nothing on most launches.
        void ensureInstallId(opened)
          .catch((e) => {
            console.warn('install id init failed:', e);
            return null;
          })
          .then(async (id) => {
            if (id == null) return;
            const { refreshEntitlement } = await import('../services/billing');
            await refreshEntitlement(opened);
          })
          .catch((e) => console.warn('subscription refresh failed:', e));
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
