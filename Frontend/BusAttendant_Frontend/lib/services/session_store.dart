import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Auth/ticketing tokens are session credentials — kept in platform-backed secure storage
/// (Keychain on iOS, Keystore on Android, Credential Manager on Windows) rather than
/// shared_preferences, which is plain unencrypted storage on-device.
///
/// One-time migration: earlier app versions stored these same keys in shared_preferences.
/// On first read after updating, an existing session is moved into secure storage and the
/// old plaintext copy is deleted, so nobody already signed in gets silently logged out.
class SessionStore {
  static const _kToken = 'auth_token';
  static const _kName = 'display_name';
  static const _kTicketing = 'ticketing_token';

  static const _storage = FlutterSecureStorage();
  static bool _migrated = false;

  Future<void> _migrateLegacyIfNeeded() async {
    if (_migrated) return;
    _migrated = true;
    final prefs = await SharedPreferences.getInstance();
    final legacyToken = prefs.getString(_kToken);
    if (legacyToken == null) return; // nothing to migrate
    final existing = await _storage.read(key: _kToken);
    if (existing == null) {
      await _storage.write(key: _kToken, value: legacyToken);
      final legacyName = prefs.getString(_kName);
      if (legacyName != null) await _storage.write(key: _kName, value: legacyName);
      final legacyTicketing = prefs.getString(_kTicketing);
      if (legacyTicketing != null) await _storage.write(key: _kTicketing, value: legacyTicketing);
    }
    await prefs.remove(_kToken);
    await prefs.remove(_kName);
    await prefs.remove(_kTicketing);
  }

  Future<void> saveSession({
    required String token,
    required String displayName,
    String? ticketingToken,
  }) async {
    await _storage.write(key: _kToken, value: token);
    await _storage.write(key: _kName, value: displayName);
    final t = ticketingToken?.trim();
    if (t != null && t.isNotEmpty) {
      await _storage.write(key: _kTicketing, value: t);
    } else {
      await _storage.delete(key: _kTicketing);
    }
  }

  Future<void> clear() async {
    await _storage.delete(key: _kToken);
    await _storage.delete(key: _kName);
    await _storage.delete(key: _kTicketing);
  }

  Future<String?> getToken() async {
    await _migrateLegacyIfNeeded();
    return _storage.read(key: _kToken);
  }

  Future<String?> getDisplayName() async {
    await _migrateLegacyIfNeeded();
    return _storage.read(key: _kName);
  }

  Future<String?> getTicketingToken() async {
    await _migrateLegacyIfNeeded();
    return _storage.read(key: _kTicketing);
  }
}
