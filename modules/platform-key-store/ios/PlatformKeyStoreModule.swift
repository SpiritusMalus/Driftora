import ExpoModulesCore
import Security

// iCloud-Keychain custody for the E2E master private key (Phase-2 native).
//
// Stores the value as a Keychain generic-password item with
// `kSecAttrSynchronizable = true`, which Apple replicates across every device
// signed into the same Apple ID that has iCloud Keychain enabled. A new iPhone
// therefore receives the master key automatically — no recovery phrase to type.
//
// NOTE: synchronizable items sync via iCloud Keychain WITHOUT any special
// entitlement (unlike `keychain-access-groups`, which is only for inter-app
// sharing). The only user prerequisite is that iCloud Keychain is turned on.
//
// ⚠️ UNVERIFIED IN CI — this compiles + runs only in a real dev build on two
// physical devices. See modules/platform-key-store/README.md.
public class PlatformKeyStoreModule: Module {
  // A dedicated service name so these items never collide with expo-secure-store's.
  private let service = "com.healthroutine.e2ee.keysync"

  public func definition() -> ModuleDefinition {
    Name("PlatformKeyStore")

    // Exposed to JS as `module.kind` — lets the JS layer label the UI without
    // importing react-native's Platform.
    Constants([
      "kind": "icloud"
    ])

    AsyncFunction("isAvailableAsync") { () -> Bool in
      // The Keychain is always present on iOS. Whether items actually *sync* depends
      // on the user having iCloud Keychain enabled, which we can't reliably probe;
      // we report available and let custody be best-effort.
      return true
    }

    AsyncFunction("setItemAsync") { (key: String, value: String) -> Bool in
      return self.set(key: key, value: value)
    }

    AsyncFunction("getItemAsync") { (key: String) -> String? in
      return self.get(key: key)
    }

    AsyncFunction("deleteItemAsync") { (key: String) -> Void in
      self.delete(key: key)
    }
  }

  private func set(key: String, value: String) -> Bool {
    guard let data = value.data(using: .utf8) else { return false }
    // Replace any existing item (synchronizable or not) to keep writes idempotent.
    delete(key: key)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      kSecValueData as String: data,
      kSecAttrSynchronizable as String: kCFBooleanTrue as Any,
      // Available after first unlock so a background restore can read it; required
      // for an item to be eligible for iCloud Keychain syncing.
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
    ]
    let status = SecItemAdd(query as CFDictionary, nil)
    return status == errSecSuccess
  }

  private func get(key: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      // `Any` matches both synced and local copies.
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
      kSecReturnData as String: kCFBooleanTrue as Any,
      kSecMatchLimit as String: kSecMatchLimitOne
    ]
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private func delete(key: String) {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      kSecAttrSynchronizable as String: kSecAttrSynchronizableAny
    ]
    SecItemDelete(query as CFDictionary)
  }
}
