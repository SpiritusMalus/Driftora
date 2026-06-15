import 'dart:convert';
import 'dart:math';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Stores (and lazily creates) the database encryption key in the OS secure
/// enclave (Keychain on iOS, Keystore-backed EncryptedSharedPreferences on
/// Android). The key never touches the database file or app preferences.
class DbKeyStore {
  DbKeyStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;
  static const _keyName = 'db_encryption_key_v1';

  /// Returns the existing key, or generates and persists a new 256-bit key.
  Future<String> getOrCreateKey() async {
    final existing = await _storage.read(key: _keyName);
    if (existing != null && existing.isNotEmpty) return existing;
    final key = _generateKey();
    await _storage.write(key: _keyName, value: key);
    return key;
  }

  String _generateKey() {
    final rng = Random.secure();
    final bytes = List<int>.generate(32, (_) => rng.nextInt(256));
    return base64Url.encode(bytes);
  }
}
