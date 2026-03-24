import 'dart:convert';

import 'package:http/http.dart' as http;

import '../models/trip_result.dart';

/// Talks to your **JavaScript (Node.js)** backend — e.g. `Backend/Admin_Backend` (`admin-api`) or future `operator-api`.
///
/// **Android emulator:** use `http://10.0.2.2:4001` to reach host machine.
/// **iOS simulator:** `http://127.0.0.1:4001`
/// **Physical device:** use your PC's LAN IP (e.g. `http://192.168.1.5:4001`).
///
/// Override at build time: `flutter run --dart-define=API_BASE_URL=http://10.0.2.2:4001`
class ApiClient {
  ApiClient({String? baseUrl})
      : baseUrl = (baseUrl ??
                const String.fromEnvironment(
                  'API_BASE_URL',
                  defaultValue: 'http://10.0.2.2:4001',
                ))
            .replaceAll(RegExp(r'/+$'), '');

  final String baseUrl;

  /// Operator / admin ticketing login (`POST /api/auth/login` on current admin-api).
  /// Attendants with **Operator** role: your backend may use a dedicated route later.
  Future<ApiAuthResult> login({required String email, required String password}) async {
    final uri = Uri.parse('$baseUrl/api/auth/operator-login');
    final res = await http.post(
      uri,
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'email': email.trim(), 'password': password}),
    );
    if (res.statusCode == 200) {
      final map = jsonDecode(res.body) as Map<String, dynamic>;
      final token = map['token'] as String?;
      if (token == null || token.isEmpty) {
        return ApiAuthResult.failure('Invalid response: no token');
      }
      final user = map['user'] as Map<String, dynamic>?;
      final name = user != null
          ? '${user['firstName'] ?? ''} ${user['lastName'] ?? ''}'.trim()
          : email;
      return ApiAuthResult.ok(token: token, displayName: name.isEmpty ? email : name);
    }
    try {
      final err = jsonDecode(res.body) as Map<String, dynamic>;
      return ApiAuthResult.failure(err['error']?.toString() ?? 'Login failed');
    } catch (_) {
      return ApiAuthResult.failure('Login failed (${res.statusCode})');
    }
  }

  /// Placeholder search — replace with your Node route (e.g. `GET /api/trips`).
  Future<List<TripResult>> searchTrips({
    required String from,
    required String to,
    required String dateIso,
    required String token,
  }) async {
    // Wire to real endpoint when available. Demo data for UI polish.
    await Future<void>.delayed(const Duration(milliseconds: 400));
    return [
      TripResult(
        from: from,
        to: to,
        departLabel: '11:45 AM',
        durationLabel: '65 min',
        priceLabel: '₱15.00',
        statusLabel: 'On time',
      ),
      TripResult(
        from: from,
        to: to,
        departLabel: '2:15 PM',
        durationLabel: '70 min',
        priceLabel: '₱15.00',
        statusLabel: 'Boarding',
      ),
    ];
  }
}

class ApiAuthResult {
  ApiAuthResult._({this.ok = false, this.token, this.displayName, this.message});

  factory ApiAuthResult.ok({required String token, required String displayName}) =>
      ApiAuthResult._(ok: true, token: token, displayName: displayName);

  factory ApiAuthResult.failure(String message) => ApiAuthResult._(ok: false, message: message);

  final bool ok;
  final String? token;
  final String? displayName;
  final String? message;
}
