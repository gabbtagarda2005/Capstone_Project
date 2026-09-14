import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Lets an attendant who has already signed in successfully at least once on THIS device sign
/// in again — with the same email and password — while there is no internet connection at all,
/// including right after signing out. This is deliberately separate from [SessionStore]: signing
/// out clears the active session, but must NOT erase the ability to get back in offline, so this
/// store is never touched by SessionStore.clear().
///
/// Security notes:
/// - The password itself is never stored, in memory or on disk — only a salted SHA-256 hash,
///   verified locally against a freshly-typed password. flutter_secure_storage backs this with
///   platform-level encryption (Android Keystore / iOS Keychain), which is the real protection
///   for data at rest; the hash exists so the plaintext password is never persisted at all.
/// - This can only ever succeed for an email that has already been verified by the real server at
///   least once ON THIS DEVICE — there is no way to offline-verify an account this device has
///   never seen, and that's intentional; it would otherwise mean no server round trip could ever
///   reject a login.
/// - The restored session reuses whatever token was issued at that last successful online login.
///   If the device stays offline long enough for that token to expire server-side (JWT_EXPIRES_IN,
///   8h by default), server actions will start failing with 401 once back online until the
///   attendant signs in online again — offline sign-in gets you back into the app and into the
///   GPS/ticket/SOS queues, but it cannot mint a fresh server session without a server.
class OfflineCredentialStore {
  static const _storage = FlutterSecureStorage();

  static const _kEmail = 'offline_login_email';
  static const _kSalt = 'offline_login_salt';
  static const _kHash = 'offline_login_hash';
  static const _kToken = 'offline_login_token';
  static const _kDisplayName = 'offline_login_display_name';
  static const _kTicketingToken = 'offline_login_ticketing_token';
  static const _kSavedAt = 'offline_login_saved_at';

  static final _rand = Random.secure();

  String _generateSalt() {
    final bytes = List<int>.generate(16, (_) => _rand.nextInt(256));
    return base64Url.encode(bytes);
  }

  String _hash(String salt, String email, String password) {
    return sha256.convert(utf8.encode('$salt:$email:$password')).toString();
  }

  /// Call this right after a real, server-verified login succeeds — refreshes both the
  /// credential verifier and the cached session so offline sign-in always reflects the most
  /// recent successful online login.
  Future<void> saveVerifiedLogin({
    required String email,
    required String password,
    required String token,
    required String displayName,
    String? ticketingToken,
  }) async {
    final normalizedEmail = email.trim().toLowerCase();
    final salt = _generateSalt();
    final hash = _hash(salt, normalizedEmail, password);
    await Future.wait([
      _storage.write(key: _kEmail, value: normalizedEmail),
      _storage.write(key: _kSalt, value: salt),
      _storage.write(key: _kHash, value: hash),
      _storage.write(key: _kToken, value: token),
      _storage.write(key: _kDisplayName, value: displayName),
      _storage.write(key: _kTicketingToken, value: ticketingToken ?? ''),
      _storage.write(key: _kSavedAt, value: DateTime.now().toUtc().toIso8601String()),
    ]);
  }

  /// Verifies [email]/[password] against what was cached from the last successful online login.
  /// Returns the cached session to restore on a match, or null if there's nothing cached for this
  /// email or the password doesn't match — never throws, never distinguishes "wrong password"
  /// from "no cached account" in its return value (the caller shows one generic message either
  /// way, same as a real server rejection would).
  Future<OfflineLoginResult?> tryOfflineLogin({
    required String email,
    required String password,
  }) async {
    final normalizedEmail = email.trim().toLowerCase();
    final savedEmail = await _storage.read(key: _kEmail);
    if (savedEmail == null || savedEmail != normalizedEmail) return null;
    final salt = await _storage.read(key: _kSalt);
    final savedHash = await _storage.read(key: _kHash);
    if (salt == null || savedHash == null) return null;
    if (_hash(salt, normalizedEmail, password) != savedHash) return null;

    final token = await _storage.read(key: _kToken);
    final displayName = await _storage.read(key: _kDisplayName);
    if (token == null || token.isEmpty || displayName == null || displayName.isEmpty) return null;
    final ticketingToken = await _storage.read(key: _kTicketingToken);

    return OfflineLoginResult(
      token: token,
      displayName: displayName,
      ticketingToken: (ticketingToken != null && ticketingToken.isNotEmpty) ? ticketingToken : null,
    );
  }

  /// True if any account has ever been cached for offline sign-in on this device — used only for
  /// UI copy (e.g. whether to mention offline sign-in is available at all).
  Future<bool> hasAnyCachedAccount() async {
    final email = await _storage.read(key: _kEmail);
    return email != null && email.isNotEmpty;
  }

  /// Not wired to sign-out on purpose (see class doc). Exposed for a future explicit
  /// "forget this device" control if one gets added.
  Future<void> clear() async {
    await Future.wait([
      _storage.delete(key: _kEmail),
      _storage.delete(key: _kSalt),
      _storage.delete(key: _kHash),
      _storage.delete(key: _kToken),
      _storage.delete(key: _kDisplayName),
      _storage.delete(key: _kTicketingToken),
      _storage.delete(key: _kSavedAt),
    ]);
  }
}

class OfflineLoginResult {
  const OfflineLoginResult({
    required this.token,
    required this.displayName,
    this.ticketingToken,
  });

  final String token;
  final String displayName;
  final String? ticketingToken;
}
