import { requireOptionalNativeModule } from 'expo-modules-core';

import type { PlatformKeyStoreModule } from '@/lib/core/security/platformKeyCustody';

/// Typed accessor for the local `PlatformKeyStore` native module (iOS Swift /
/// Android Kotlin in this folder). App code normally reaches the module through
/// `lib/core/security/platformKeyCustody.ts`; this re-export exists so the module
/// folder is self-contained and the native ↔ JS contract has a single source of
/// truth (the `PlatformKeyStoreModule` interface). Returns null where the native
/// module is absent (Expo Go, web, node) — callers must handle that.
export default requireOptionalNativeModule<PlatformKeyStoreModule>('PlatformKeyStore');

export type { PlatformKeyStoreModule };
