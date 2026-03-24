import 'package:shared_preferences/shared_preferences.dart';

class SessionStore {
  static const _kToken = 'auth_token';
  static const _kName = 'display_name';

  Future<void> saveSession({required String token, required String displayName}) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_kToken, token);
    await p.setString(_kName, displayName);
  }

  Future<void> clear() async {
    final p = await SharedPreferences.getInstance();
    await p.remove(_kToken);
    await p.remove(_kName);
  }

  Future<String?> getToken() async {
    final p = await SharedPreferences.getInstance();
    return p.getString(_kToken);
  }

  Future<String?> getDisplayName() async {
    final p = await SharedPreferences.getInstance();
    return p.getString(_kName);
  }
}
