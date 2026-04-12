import 'package:shared_preferences/shared_preferences.dart';

class SessionStore {
  static const _kToken = 'auth_token';
  static const _kName = 'display_name';
  static const _kTicketing = 'ticketing_token';

  Future<void> saveSession({
    required String token,
    required String displayName,
    String? ticketingToken,
  }) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kToken, token);
    await p.setString(_kName, displayName);
    final t = ticketingToken?.trim();
    if (t != null && t.isNotEmpty) {
      await p.setString(_kTicketing, t);
    } else {
      await p.remove(_kTicketing);
    }
  }

  Future<void> clear() async {
    final p = await SharedPreferences.getInstance();
    await p.remove(_kToken);
    await p.remove(_kName);
    await p.remove(_kTicketing);
  }

  Future<String?> getToken() async {
    final p = await SharedPreferences.getInstance();
    return p.getString(_kToken);
  }

  Future<String?> getDisplayName() async {
    final p = await SharedPreferences.getInstance();
    return p.getString(_kName);
  }

  Future<String?> getTicketingToken() async {
    final p = await SharedPreferences.getInstance();
    return p.getString(_kTicketing);
  }
}
