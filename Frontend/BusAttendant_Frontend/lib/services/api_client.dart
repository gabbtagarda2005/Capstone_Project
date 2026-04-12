import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import '../models/trip_result.dart';
import 'maintenance_shield.dart';

String _parseApiErrorBody(http.Response res, String fallbackPrefix) {
  try {
    final decoded = jsonDecode(res.body);
    if (decoded is Map<String, dynamic>) {
      final msg = decoded['error']?.toString() ?? decoded['message']?.toString();
      if (msg != null && msg.isNotEmpty) {
        return res.statusCode == 404 ? msg : '$msg (${res.statusCode})';
      }
    }
  } catch (_) {}
  final trimmed = res.body.trim();
  if (trimmed.isNotEmpty && trimmed.length < 500 && !trimmed.startsWith('<')) {
    return '$fallbackPrefix (${res.statusCode}): $trimmed';
  }
  return '$fallbackPrefix (HTTP ${res.statusCode}). Run BusAttendant_Backend (4011) and Admin_Backend (4001) from the latest project code, restart both, then retry.';
}

class ApiClient {
  ApiClient({String? baseUrl})
      : baseUrl = (baseUrl ??
                const String.fromEnvironment(
                  'API_BASE_URL',
                  defaultValue: 'http://localhost:4011',
                ))
            .replaceAll(RegExp(r'/+$'), '');

  final String baseUrl;

  String _adminFallbackBaseUrl() {
    final swapped = baseUrl.replaceFirst(RegExp(r':4011(?=/|$)'), ':4001');
    return swapped;
  }

  /// Human-readable cause when the HTTP client fails before a response (offline, wrong URL, CORS, etc.).
  String mapRequestFailure(String whatFailed, Object error) {
    if (error is TimeoutException) {
      return '$whatFailed timed out. Check that the API is running at $baseUrl.';
    }
    final s = error.toString().toLowerCase();
    if (s.contains('socketexception') || s.contains('connection reset')) {
      return 'No connection to $baseUrl — start BusAttendant_Backend (port 4011).';
    }
    if (s.contains('connection refused') ||
        s.contains('failed host lookup') ||
        s.contains('failed to fetch') ||
        s.contains('networkerror') ||
        s.contains('xmlhttprequest')) {
      return 'Cannot reach $baseUrl (Bus Attendant API). Start BusAttendant_Backend on port 4011, or set '
          '--dart-define=API_BASE_URL= to your deployed attendant API. Admin_Backend (4001) must run too '
          'and use MONGODB_URI for Atlas — the app does not talk to Mongo directly.';
    }
    return '$whatFailed: $error';
  }

  Future<ApiAuthResult> login({required String email, required String password}) async {
    final uri = Uri.parse('$baseUrl/api/auth/operator-login');
    http.Response res;
    try {
      res = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'email': email.trim(), 'password': password}),
          )
          .timeout(const Duration(seconds: 25));
    } catch (e) {
      return ApiAuthResult.failure(mapRequestFailure('Login', e));
    }
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
      final rawTicketing = map['ticketingToken'];
      final ticketingToken =
          rawTicketing is String && rawTicketing.trim().isNotEmpty ? rawTicketing.trim() : null;
      if (ticketingToken == null || ticketingToken.isEmpty) {
        return ApiAuthResult.failure(
          'No operator token (ticketingToken) from server — live map cannot sync. '
          'Restart Bus Attendant Backend (4011) and Admin_Backend (4001); sign in again.',
        );
      }
      return ApiAuthResult.ok(
        token: token,
        displayName: name.isEmpty ? email : name,
        ticketingToken: ticketingToken,
      );
    }
    if (res.statusCode == 503) {
      try {
        final err = jsonDecode(res.body) as Map<String, dynamic>;
        if (err['maintenance'] == true) {
          MaintenanceShield.instance.applyFrom503Body(err);
          return ApiAuthResult.failure(
            err['message']?.toString() ?? 'System maintenance in progress.',
          );
        }
      } catch (_) {}
    }
    try {
      final err = jsonDecode(res.body) as Map<String, dynamic>;
      return ApiAuthResult.failure(err['error']?.toString() ?? 'Login failed');
    } catch (_) {
      return ApiAuthResult.failure('Login failed (${res.statusCode})');
    }
  }

  Future<ApiForgotPasswordResult> operatorForgotPassword({
    required String email,
    required String personnelId,
  }) async {
    final uri = Uri.parse('$baseUrl/api/auth/operator-forgot-password');
    http.Response res;
    try {
      res = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'email': email.trim(),
              'personnelId': personnelId.trim(),
            }),
          )
          .timeout(const Duration(seconds: 25));
    } catch (e) {
      return ApiForgotPasswordResult.failure(mapRequestFailure('Password reset request', e));
    }
    if (res.statusCode == 200) {
      final map = jsonDecode(res.body) as Map<String, dynamic>;
      return ApiForgotPasswordResult.ok(
        message: map['message']?.toString() ?? 'Check your email for a code.',
        devOtp: map['devOtp']?.toString(),
        simulatedEmail: map['simulatedEmail'] == true,
        hint: map['hint']?.toString(),
      );
    }
    return ApiForgotPasswordResult.failure(_parseApiErrorBody(res, 'Could not send reset code'));
  }

  Future<ApiForgotEmailResult> operatorForgotEmail({required String personnelId}) async {
    final uri = Uri.parse('$baseUrl/api/auth/operator-forgot-email');
    http.Response res;
    try {
      res = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'personnelId': personnelId.trim()}),
          )
          .timeout(const Duration(seconds: 18));
    } catch (e) {
      return ApiForgotEmailResult.failure(mapRequestFailure('Email lookup', e));
    }
    if (res.statusCode == 200) {
      final map = jsonDecode(res.body) as Map<String, dynamic>;
      final email = map['email']?.toString().trim() ?? '';
      if (email.isEmpty) return ApiForgotEmailResult.failure('No email found for this Personnel ID.');
      return ApiForgotEmailResult.ok(email);
    }
    final body = res.body;
    final looksLikeMissingProxyRoute =
        res.statusCode == 404 &&
        body.contains('Unknown route') &&
        body.contains('/api/auth/operator-forgot-email') &&
        body.contains('bus attendant API');
    if (looksLikeMissingProxyRoute) {
      final adminUri = Uri.parse('${_adminFallbackBaseUrl()}/api/auth/operator-forgot-email');
      try {
        final adminRes = await http
            .post(
              adminUri,
              headers: {'Content-Type': 'application/json'},
              body: jsonEncode({'personnelId': personnelId.trim()}),
            )
            .timeout(const Duration(seconds: 18));
        if (adminRes.statusCode == 200) {
          final map = jsonDecode(adminRes.body) as Map<String, dynamic>;
          final email = map['email']?.toString().trim() ?? '';
          if (email.isEmpty) return ApiForgotEmailResult.failure('No email found for this Personnel ID.');
          return ApiForgotEmailResult.ok(email);
        }
      } catch (_) {
        // Continue to default error below.
      }
    }
    return ApiForgotEmailResult.failure(_parseApiErrorBody(res, 'Could not find email'));
  }

  /// Admin-style recovery: email → OTP → reset token → new password (no personnel ID).
  Future<ApiForgotPasswordResult> operatorForgotPasswordOtp({required String email}) async {
    final uri = Uri.parse('$baseUrl/api/auth/operator-forgot-password-otp');
    http.Response res;
    try {
      res = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'email': email.trim()}),
          )
          .timeout(const Duration(seconds: 25));
    } catch (e) {
      return ApiForgotPasswordResult.failure(mapRequestFailure('Password reset request', e));
    }
    if (res.statusCode == 200) {
      final map = jsonDecode(res.body) as Map<String, dynamic>;
      return ApiForgotPasswordResult.ok(
        message: map['message']?.toString() ?? 'Check your email for a code.',
        devOtp: map['devOtp']?.toString(),
        simulatedEmail: map['simulatedEmail'] == true,
        hint: map['hint']?.toString(),
        preview: ApiRecoveryPreview.fromJson(map['preview']),
      );
    }
    return ApiForgotPasswordResult.failure(_parseApiErrorBody(res, 'Could not send reset code'));
  }

  Future<ApiVerifyResetOtpResult> operatorVerifyResetOtp({
    required String email,
    required String otp,
  }) async {
    final uri = Uri.parse('$baseUrl/api/auth/operator-verify-reset-otp');
    http.Response res;
    try {
      res = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'email': email.trim(), 'otp': otp.trim()}),
          )
          .timeout(const Duration(seconds: 25));
    } catch (e) {
      return ApiVerifyResetOtpResult.failure(mapRequestFailure('OTP verification', e));
    }
    if (res.statusCode == 200) {
      final map = jsonDecode(res.body) as Map<String, dynamic>;
      final t = map['resetToken']?.toString();
      if (t == null || t.isEmpty) {
        return ApiVerifyResetOtpResult.failure('Invalid response: no reset token');
      }
      return ApiVerifyResetOtpResult.ok(
        resetToken: t,
        message: map['message']?.toString() ?? 'Code verified.',
      );
    }
    return ApiVerifyResetOtpResult.failure(_parseApiErrorBody(res, 'Verification failed'));
  }

  Future<ApiResetPasswordResult> operatorResetPasswordWithToken({
    required String token,
    required String password,
    required String confirmPassword,
  }) async {
    final uri = Uri.parse('$baseUrl/api/auth/operator-reset-password-token');
    http.Response res;
    try {
      res = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'token': token,
              'password': password,
              'confirmPassword': confirmPassword,
            }),
          )
          .timeout(const Duration(seconds: 25));
    } catch (e) {
      return ApiResetPasswordResult.failure(mapRequestFailure('Password reset', e));
    }
    if (res.statusCode == 200) {
      final map = jsonDecode(res.body) as Map<String, dynamic>;
      return ApiResetPasswordResult.ok(
        map['message']?.toString() ?? 'Password updated. You can sign in.',
      );
    }
    return ApiResetPasswordResult.failure(_parseApiErrorBody(res, 'Reset failed'));
  }

  Future<ApiResetPasswordResult> operatorResetPassword({
    required String email,
    required String otp,
    required String newPassword,
  }) async {
    final uri = Uri.parse('$baseUrl/api/auth/operator-reset-password');
    http.Response res;
    try {
      res = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'email': email.trim(),
              'otp': otp.trim(),
              'newPassword': newPassword,
            }),
          )
          .timeout(const Duration(seconds: 25));
    } catch (e) {
      return ApiResetPasswordResult.failure(mapRequestFailure('Password reset', e));
    }
    if (res.statusCode == 200) {
      final map = jsonDecode(res.body) as Map<String, dynamic>;
      return ApiResetPasswordResult.ok(
        map['message']?.toString() ?? 'Password updated. You can sign in.',
      );
    }
    try {
      final err = jsonDecode(res.body) as Map<String, dynamic>;
      return ApiResetPasswordResult.failure(
        err['error']?.toString() ?? 'Reset failed (${res.statusCode})',
      );
    } catch (_) {
      return ApiResetPasswordResult.failure('Reset failed (${res.statusCode})');
    }
  }

  Future<ApiDashboardSummary> fetchDashboardSummary({
    required String token,
    String? ticketingToken,
  }) async {
    final uri = Uri.parse('$baseUrl/api/dashboard/summary');
    http.Response res;
    try {
      final headers = <String, String>{
        'Authorization': 'Bearer $token',
      };
      final tt = ticketingToken?.trim() ?? '';
      if (tt.isNotEmpty) {
        headers['X-Ticket-Issuer-Token'] = tt;
      }
      res = await http.get(uri, headers: headers).timeout(const Duration(seconds: 12));
    } catch (_) {
      throw Exception('Network timeout while loading dashboard');
    }
    if (res.statusCode != 200) {
      throw Exception('Could not load dashboard (${res.statusCode})');
    }
    final map = jsonDecode(res.body) as Map<String, dynamic>;
    return ApiDashboardSummary(
      busNumber: (map['busNumber'] ?? '').toString(),
      todayTickets: (map['todayTickets'] as num?)?.toInt() ?? 0,
      todayRevenue: (map['todayRevenue'] as num?)?.toDouble() ?? 0,
      activePassengers: (map['activePassengers'] as num?)?.toInt() ?? 0,
      topRoute: (map['topRoute'] ?? '').toString(),
    );
  }

  Future<List<ApiPassenger>> fetchPassengers({
    required String token,
    String query = '',
  }) async {
    final uri = Uri.parse('$baseUrl/api/passengers?q=${Uri.encodeQueryComponent(query)}');
    http.Response res;
    try {
      res = await http
          .get(
            uri,
            headers: {
              'Authorization': 'Bearer $token',
            },
          )
          .timeout(const Duration(seconds: 25));
    } catch (_) {
      throw Exception('Network timeout while loading passengers');
    }
    if (res.statusCode != 200) {
      throw Exception('Could not load passengers (${res.statusCode})');
    }
    final map = jsonDecode(res.body) as Map<String, dynamic>;
    final items = (map['items'] as List<dynamic>? ?? const <dynamic>[])
        .whereType<Map<String, dynamic>>()
        .map(
          (x) => ApiPassenger(
            id: (x['id'] ?? '').toString(),
            name: (x['name'] ?? '').toString(),
            category: (x['category'] ?? '').toString(),
            lastTrip: (x['lastTrip'] ?? '').toString(),
          ),
        )
        .toList();
    return items;
  }

  /// Route coverage from Admin (Location Management): one row per town/area with terminal + bus stops.
  Future<List<ApiRouteCoverage>> fetchRouteCoverages({required String token}) async {
    final uri = Uri.parse('$baseUrl/api/meta/deployed-points');
    http.Response res;
    try {
      res = await http.get(uri, headers: {
        'Authorization': 'Bearer $token',
      }).timeout(const Duration(seconds: 12));
    } catch (_) {
      throw Exception('Network timeout while loading route coverage');
    }
    if (res.statusCode != 200) {
      throw Exception('Could not load route coverage (${res.statusCode})');
    }
    final map = jsonDecode(res.body) as Map<String, dynamic>;
    return (map['items'] as List<dynamic>? ?? const <dynamic>[])
        .whereType<Map<String, dynamic>>()
        .map(ApiRouteCoverage.fromJson)
        .where((c) => c.locationName.trim().isNotEmpty)
        .toList();
  }

  Future<List<ApiIssuedTicket>> fetchRecentTickets({
    required String attendantToken,
    String? ticketingToken,
  }) async {
    if (ticketingToken == null || ticketingToken.isEmpty) {
      return [];
    }
    final uri = Uri.parse('$baseUrl/api/tickets/recent');
    http.Response res;
    try {
      res = await http.get(uri, headers: {
        'Authorization': 'Bearer $attendantToken',
        'X-Ticket-Issuer-Token': ticketingToken,
      }).timeout(const Duration(seconds: 12));
    } catch (_) {
      throw Exception('Network timeout while loading tickets');
    }
    if (res.statusCode != 200) {
      throw Exception('Could not load tickets (${res.statusCode})');
    }
    final map = jsonDecode(res.body) as Map<String, dynamic>;
    final items = (map['items'] as List<dynamic>? ?? const <dynamic>[])
        .whereType<Map<String, dynamic>>()
        .map(
          (x) => ApiIssuedTicket(
            id: (x['id'] ?? '').toString(),
            ticketCode: (x['ticketCode'] ?? '').toString(),
            passengerId: (x['passengerId'] ?? '').toString(),
            passengerName: (x['passengerName'] ?? '').toString(),
            from: (x['from'] ?? '').toString(),
            to: (x['to'] ?? '').toString(),
            category: (x['category'] ?? '').toString(),
            fare: (x['fare'] as num?)?.toDouble() ?? 0,
            createdAt: DateTime.tryParse((x['createdAt'] ?? '').toString()) ?? DateTime.now(),
            busNumber: x['busNumber'] != null ? x['busNumber'].toString().trim() : null,
          ),
        )
        .toList();
    return items;
  }

  Future<ApiIssueTicketResult> issueTicket({
    required String attendantToken,
    required String ticketingToken,
    required String passengerId,
    required String passengerName,
    required String from,
    required String to,
    required String category,
    required double fare,
    String? busNumber,
  }) async {
    if (ticketingToken.isEmpty) {
      return ApiIssueTicketResult.failure('Missing ticketing session. Sign out and sign in again.');
    }
    final uri = Uri.parse('$baseUrl/api/tickets/issue');
    final body = <String, dynamic>{
      'passengerId': passengerId.trim(),
      'passengerName': passengerName.trim(),
      'from': from.trim(),
      'to': to.trim(),
      'category': category.trim().toLowerCase(),
      'fare': fare,
      if (busNumber != null && busNumber.trim().isNotEmpty) 'busNumber': busNumber.trim(),
    };
    http.Response res;
    try {
      res = await http
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $attendantToken',
              'X-Ticket-Issuer-Token': ticketingToken,
            },
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 25));
    } catch (_) {
      return ApiIssueTicketResult.failure('Network timeout. Please try again.');
    }
    if (res.statusCode == 201) {
      final map = jsonDecode(res.body) as Map<String, dynamic>;
      return ApiIssueTicketResult.ok(
        ApiIssuedTicket(
          id: (map['id'] ?? '').toString(),
          ticketCode: (map['ticketCode'] ?? '').toString(),
          passengerId: (map['passengerId'] ?? '').toString(),
          passengerName: (map['passengerName'] ?? '').toString(),
          from: (map['from'] ?? map['startLocation'] ?? '').toString(),
          to: (map['to'] ?? map['destination'] ?? '').toString(),
          category: (map['category'] ?? '').toString(),
          fare: (map['fare'] as num?)?.toDouble() ?? 0,
          createdAt: DateTime.tryParse((map['createdAt'] ?? '').toString()) ?? DateTime.now(),
          busNumber: map['busNumber'] != null ? map['busNumber'].toString().trim() : null,
        ),
      );
    }
    try {
      final err = jsonDecode(res.body) as Map<String, dynamic>;
      return ApiIssueTicketResult.failure(err['error']?.toString() ?? 'Issue failed');
    } catch (_) {
      return ApiIssueTicketResult.failure('Issue failed (${res.statusCode})');
    }
  }

  /// Server-side fare (matrix hub-to-hub + optional per-km to/from sub-stops, discounts, ₱0.50 rounding).
  Future<ApiFareQuoteResult> quoteFare({
    required String attendantToken,
    required String ticketingToken,
    required String startLocation,
    required String destination,
    required String passengerCategory,
  }) async {
    if (ticketingToken.isEmpty) {
      return ApiFareQuoteResult.failure('Missing ticketing session. Sign out and sign in again.');
    }
    final uri = Uri.parse('$baseUrl/api/fares/quote');
    final body = <String, dynamic>{
      'startLocation': startLocation.trim(),
      'destination': destination.trim(),
      'passengerCategory': passengerCategory.trim().toLowerCase(),
    };
    http.Response res;
    try {
      res = await http
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $attendantToken',
              'X-Ticket-Issuer-Token': ticketingToken,
            },
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 20));
    } catch (e) {
      return ApiFareQuoteResult.failure(mapRequestFailure('Fare quote', e));
    }
    if (res.statusCode == 200) {
      try {
        final map = jsonDecode(res.body) as Map<String, dynamic>;
        final matched = map['matched'] == true;
        final fare = (map['fare'] as num?)?.toDouble();
        if (matched && fare != null && fare >= 0) {
          return ApiFareQuoteResult.ok(
            fare: fare,
            pricingMode: map['pricingMode']?.toString(),
            extraDistanceKm: (map['extraDistanceKm'] as num?)?.toDouble(),
            distanceChargePesos: (map['distanceChargePesos'] as num?)?.toDouble(),
            baseFarePesos: (map['baseFarePesos'] as num?)?.toDouble(),
            farePerKmPesos: (map['farePerKmPesos'] as num?)?.toDouble(),
            originSpurKm: (map['originSpurKm'] as num?)?.toDouble(),
            destinationSpurKm: (map['destinationSpurKm'] as num?)?.toDouble(),
            pricingSummary: map['pricingSummary']?.toString(),
            fareBreakdownDisplay: map['fareBreakdownDisplay']?.toString(),
          );
        }
        return ApiFareQuoteResult.unmatched(map['message']?.toString() ?? 'No fare for this route');
      } catch (_) {
        return ApiFareQuoteResult.failure('Invalid fare quote response');
      }
    }
    try {
      final err = jsonDecode(res.body) as Map<String, dynamic>;
      return ApiFareQuoteResult.failure(err['error']?.toString() ?? 'Fare quote failed (${res.statusCode})');
    } catch (_) {
      return ApiFareQuoteResult.failure('Fare quote failed (${res.statusCode})');
    }
  }

  Future<ApiVerifyEditPinResult> verifyTicketEditPin({
    required String attendantToken,
    required String ticketingToken,
    required String busNumber,
    required String pin,
    required String ticketId,
  }) async {
    final uri = Uri.parse('$baseUrl/api/tickets/verify-edit-pin');
    try {
      final res = await http
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $attendantToken',
              'X-Ticket-Issuer-Token': ticketingToken,
            },
            body: jsonEncode({
              'busNumber': busNumber.trim(),
              'pin': pin.trim(),
              'ticketId': int.tryParse(ticketId) ?? ticketId,
            }),
          )
          .timeout(const Duration(seconds: 20));
      if (res.statusCode == 200) {
        final map = jsonDecode(res.body) as Map<String, dynamic>;
        final tok = map['editToken']?.toString() ?? '';
        if (tok.isEmpty) {
          return ApiVerifyEditPinResult.failure('No edit token returned');
        }
        return ApiVerifyEditPinResult.ok(
          editToken: tok,
          driverName: map['driverName']?.toString() ?? '',
        );
      }
      try {
        final err = jsonDecode(res.body) as Map<String, dynamic>;
        return ApiVerifyEditPinResult.failure(err['error']?.toString() ?? 'Verification failed');
      } catch (_) {
        return ApiVerifyEditPinResult.failure('Verification failed (${res.statusCode})');
      }
    } catch (e) {
      return ApiVerifyEditPinResult.failure(mapRequestFailure('PIN verification', e));
    }
  }

  Future<ApiPatchTicketResult> patchTicket({
    required String attendantToken,
    required String ticketingToken,
    required String editToken,
    required String ticketId,
    required String startLocation,
    required String destination,
    required double fare,
    required String passengerCategory,
  }) async {
    final uri = Uri.parse('$baseUrl/api/tickets/${Uri.encodeComponent(ticketId)}');
    try {
      final res = await http
          .patch(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $attendantToken',
              'X-Ticket-Issuer-Token': ticketingToken,
              'X-Ticket-Edit-Token': editToken,
            },
            body: jsonEncode({
              'startLocation': startLocation.trim(),
              'destination': destination.trim(),
              'fare': fare,
              'passengerCategory': passengerCategory.trim().toLowerCase(),
            }),
          )
          .timeout(const Duration(seconds: 25));
      if (res.statusCode == 200) {
        return ApiPatchTicketResult.ok();
      }
      try {
        final err = jsonDecode(res.body) as Map<String, dynamic>;
        return ApiPatchTicketResult.failure(err['error']?.toString() ?? 'Update failed');
      } catch (_) {
        return ApiPatchTicketResult.failure('Update failed (${res.statusCode})');
      }
    } catch (e) {
      return ApiPatchTicketResult.failure(mapRequestFailure('Ticket update', e));
    }
  }

  Future<ApiBusAssignment> fetchBusAssignment({
    required String attendantToken,
    required String ticketingToken,
  }) async {
    if (ticketingToken.isEmpty) {
      return const ApiBusAssignment(assigned: false, bus: null);
    }
    final uri = Uri.parse('$baseUrl/api/bus-assignment');
    http.Response res;
    try {
      res = await http.get(
        uri,
        headers: {
          'Authorization': 'Bearer $attendantToken',
          'X-Ticket-Issuer-Token': ticketingToken,
        },
      ).timeout(const Duration(seconds: 15));
    } catch (e) {
      throw Exception(mapRequestFailure('Bus assignment', e));
    }
    if (res.statusCode != 200) {
      throw Exception('Could not load bus assignment (${res.statusCode})');
    }
    final map = jsonDecode(res.body) as Map<String, dynamic>;
    return ApiBusAssignment.fromJson(map);
  }

  /// Streams GPS to Admin (assignment resolved server-side). Canonical path name in product docs.
  Future<void> postLiveLocation({
    required String attendantToken,
    required String ticketingToken,
    required double latitude,
    required double longitude,
    double? speedKph,
    double? heading,
    bool forceSync = false,
    String? signal,
    String? clientRecordedAt,
  }) async {
    if (ticketingToken.isEmpty) {
      throw Exception(
        'Missing operator (ticketing) token — sign out and sign in again so live GPS can reach Admin.',
      );
    }
    final uri = Uri.parse('$baseUrl/api/live-location');
    final body = <String, dynamic>{
      'latitude': latitude,
      'longitude': longitude,
      if (speedKph != null) 'speedKph': speedKph,
      if (heading != null) 'heading': heading,
      if (forceSync) 'forceSync': true,
      if (signal != null && signal.isNotEmpty) 'signal': signal,
      if (signal != null && signal.isNotEmpty) 'signal_status': signal,
      if (clientRecordedAt != null && clientRecordedAt.isNotEmpty) 'clientRecordedAt': clientRecordedAt,
    };
    try {
      final res = await http
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $attendantToken',
              'X-Ticket-Issuer-Token': ticketingToken,
            },
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 204 && res.statusCode != 200) {
        var detail = '';
        try {
          final j = jsonDecode(res.body);
          if (j is Map<String, dynamic>) {
            final err = j['error']?.toString();
            if (err != null && err.isNotEmpty) detail = ': $err';
          }
        } catch (_) {}
        throw Exception('Live location rejected (${res.statusCode})$detail');
      }
    } catch (_) {
      rethrow;
    }
  }

  /// Clears this operator's bus from Admin live map (gps_logs). Call on sign-out / end shift.
  Future<void> postEndLiveSession({
    required String attendantToken,
    required String ticketingToken,
  }) async {
    if (attendantToken.isEmpty) return;
    final uri = Uri.parse('$baseUrl/api/live-session/end');
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Authorization': 'Bearer $attendantToken',
    };
    if (ticketingToken.isNotEmpty) {
      headers['X-Ticket-Issuer-Token'] = ticketingToken;
    }
    try {
      final res = await http
          .post(
            uri,
            headers: headers,
            body: '{}',
          )
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 204 && res.statusCode != 200) {
        /* non-fatal — socket path may have already cleared */
      }
    } catch (_) {
      /* ignore */
    }
  }

  /// Store-and-forward: replay queued points in one round-trip (max 40 server-side).
  Future<void> postLiveLocationBatch({
    required String attendantToken,
    required String ticketingToken,
    required List<Map<String, dynamic>> points,
  }) async {
    if (points.isEmpty) return;
    if (ticketingToken.isEmpty) {
      throw Exception('Missing operator (ticketing) token — cannot upload queued GPS.');
    }
    final uri = Uri.parse('$baseUrl/api/live-location/batch');
    try {
      final res = await http
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $attendantToken',
              'X-Ticket-Issuer-Token': ticketingToken,
            },
            body: jsonEncode({'points': points}),
          )
          .timeout(const Duration(seconds: 45));
      if (res.statusCode != 200 && res.statusCode != 204) {
        throw Exception('Live location batch rejected (${res.statusCode})');
      }
    } catch (_) {
      rethrow;
    }
  }

  /// Streams to Admin live route DB via attendant proxy (every ~5s from caller).
  Future<void> postAttendantPing({
    required String attendantToken,
    required String ticketingToken,
    required double latitude,
    required double longitude,
    double? speedKph,
    double? heading,
  }) async {
    if (ticketingToken.isEmpty) return;
    final uri = Uri.parse('$baseUrl/api/bus-attendant-ping');
    final body = <String, dynamic>{
      'latitude': latitude,
      'longitude': longitude,
      if (speedKph != null) 'speedKph': speedKph,
      if (heading != null) 'heading': heading,
    };
    try {
      final res = await http
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $attendantToken',
              'X-Ticket-Issuer-Token': ticketingToken,
            },
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 12));
      if (res.statusCode != 204 && res.statusCode != 200) {
        throw Exception('Ping rejected (${res.statusCode})');
      }
    } catch (_) {
      rethrow;
    }
  }

  Future<ApiSimpleActionResult> postAttendantSos({
    required String attendantToken,
    required String ticketingToken,
    required double latitude,
    required double longitude,
    /// Backend: normal | medium | emergency
    String level = 'emergency',
    String? note,
  }) async {
    if (ticketingToken.isEmpty) {
      return ApiSimpleActionResult.failure('Sign in again to refresh your security session.');
    }
    final uri = Uri.parse('$baseUrl/api/bus-attendant-sos');
    final n = note?.trim() ?? '';
    try {
      final res = await http
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $attendantToken',
              'X-Ticket-Issuer-Token': ticketingToken,
            },
            body: jsonEncode({
              'latitude': latitude,
              'longitude': longitude,
              'level': level,
              if (n.isNotEmpty) 'note': n,
            }),
          )
          .timeout(const Duration(seconds: 22));
      if (res.statusCode == 201) {
        return ApiSimpleActionResult.ok();
      }
      try {
        final err = jsonDecode(res.body) as Map<String, dynamic>;
        return ApiSimpleActionResult.failure(err['error']?.toString() ?? 'SOS failed (${res.statusCode})');
      } catch (_) {
        return ApiSimpleActionResult.failure('SOS failed (${res.statusCode})');
      }
    } catch (e) {
      return ApiSimpleActionResult.failure(mapRequestFailure('SOS', e));
    }
  }

  Future<ApiSimpleActionResult> postAttendantIncident({
    required String attendantToken,
    required String ticketingToken,
    required String category,
    required double latitude,
    required double longitude,
    String? note,
  }) async {
    if (ticketingToken.isEmpty) {
      return ApiSimpleActionResult.failure('Sign in again to refresh your security session.');
    }
    final uri = Uri.parse('$baseUrl/api/bus-attendant-incident');
    final body = <String, dynamic>{
      'category': category,
      'latitude': latitude,
      'longitude': longitude,
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    };
    try {
      final res = await http
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $attendantToken',
              'X-Ticket-Issuer-Token': ticketingToken,
            },
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 22));
      if (res.statusCode == 201) {
        return ApiSimpleActionResult.ok();
      }
      try {
        final err = jsonDecode(res.body) as Map<String, dynamic>;
        return ApiSimpleActionResult.failure(err['error']?.toString() ?? 'Report failed (${res.statusCode})');
      } catch (_) {
        return ApiSimpleActionResult.failure('Report failed (${res.statusCode})');
      }
    } catch (e) {
      return ApiSimpleActionResult.failure(mapRequestFailure('Incident report', e));
    }
  }

  Future<ApiProfileMe> fetchProfile({
    required String token,
  }) async {
    final uri = Uri.parse('$baseUrl/api/profile/me');
    http.Response res;
    try {
      res = await http.get(uri, headers: {
        'Authorization': 'Bearer $token',
      }).timeout(const Duration(seconds: 12));
    } catch (_) {
      throw Exception('Network timeout while loading profile');
    }
    if (res.statusCode != 200) {
      throw Exception(_parseApiErrorBody(res, 'Could not load profile'));
    }
    final map = jsonDecode(res.body) as Map<String, dynamic>;
    return ApiProfileMe(
      id: (map['id'] ?? '').toString(),
      firstName: (map['firstName'] ?? '').toString(),
      lastName: (map['lastName'] ?? '').toString(),
      email: (map['email'] ?? '').toString(),
      role: (map['role'] ?? '').toString(),
      busNumber: (map['busNumber'] ?? '').toString(),
      phone: (map['phone'] ?? '').toString(),
    );
  }

  Future<ApiStaffProfileHud> fetchStaffProfileHud({
    required String attendantToken,
    required String ticketingToken,
  }) async {
    if (ticketingToken.isEmpty) {
      throw Exception('Missing operator (ticketing) token — sign out and sign in again.');
    }
    final uri = Uri.parse('$baseUrl/api/staff-profile');
    http.Response res;
    try {
      res = await http.get(
        uri,
        headers: {
          'Authorization': 'Bearer $attendantToken',
          'X-Ticket-Issuer-Token': ticketingToken,
        },
      ).timeout(const Duration(seconds: 15));
    } catch (_) {
      throw Exception('Network timeout while loading staff profile');
    }
    if (res.statusCode != 200) {
      String detail = '';
      try {
        final j = jsonDecode(res.body);
        if (j is Map<String, dynamic>) {
          final e = j['error']?.toString();
          if (e != null && e.isNotEmpty) detail = ': $e';
        }
      } catch (_) {}
      throw Exception('Could not load staff profile (${res.statusCode})$detail');
    }
    final map = jsonDecode(res.body) as Map<String, dynamic>;
    return ApiStaffProfileHud.fromJson(map);
  }

  Future<ApiShiftSummary> fetchShiftSummary({
    required String attendantToken,
    required String ticketingToken,
  }) async {
    if (ticketingToken.isEmpty) {
      throw Exception('Missing operator (ticketing) token — sign out and sign in again.');
    }
    final uri = Uri.parse('$baseUrl/api/staff-shift-summary');
    http.Response res;
    try {
      res = await http.get(
        uri,
        headers: {
          'Authorization': 'Bearer $attendantToken',
          'X-Ticket-Issuer-Token': ticketingToken,
        },
      ).timeout(const Duration(seconds: 20));
    } catch (_) {
      throw Exception('Network timeout while loading shift summary');
    }
    if (res.statusCode != 200) {
      String detail = '';
      try {
        final j = jsonDecode(res.body);
        if (j is Map<String, dynamic>) {
          final e = j['error']?.toString();
          if (e != null && e.isNotEmpty) detail = ': $e';
        }
      } catch (_) {}
      throw Exception('Could not load shift summary (${res.statusCode})$detail');
    }
    final map = jsonDecode(res.body) as Map<String, dynamic>;
    return ApiShiftSummary.fromJson(map);
  }

  Future<ApiStaffEta> fetchStaffEta({
    required String attendantToken,
    required String ticketingToken,
  }) async {
    if (ticketingToken.isEmpty) {
      throw Exception('Missing operator (ticketing) token — sign out and sign in again.');
    }
    final uri = Uri.parse('$baseUrl/api/staff-eta');
    http.Response res;
    try {
      res = await http.get(
        uri,
        headers: {
          'Authorization': 'Bearer $attendantToken',
          'X-Ticket-Issuer-Token': ticketingToken,
        },
      ).timeout(const Duration(seconds: 15));
    } catch (_) {
      throw Exception('Network timeout while loading ETA');
    }
    if (res.statusCode != 200) {
      throw Exception('Could not load ETA (${res.statusCode})');
    }
    final map = jsonDecode(res.body) as Map<String, dynamic>;
    return ApiStaffEta.fromJson(map);
  }

  Future<ApiCompanyInfo> fetchPublicCompanyInfo() async {
    final uri = Uri.parse('$baseUrl/api/public/company-profile');
    http.Response res;
    try {
      res = await http.get(uri).timeout(const Duration(seconds: 12));
    } catch (_) {
      throw Exception('Network timeout while loading company profile');
    }
    if (res.statusCode != 200) {
      throw Exception('Could not load company profile (${res.statusCode})');
    }
    final map = jsonDecode(res.body) as Map<String, dynamic>;
    return ApiCompanyInfo(
      name: (map['name'] ?? '').toString(),
      phone: (map['phone'] ?? '').toString(),
      email: (map['email'] ?? '').toString(),
      address: (map['location'] ?? '').toString(),
      logoUrl: (map['logoUrl'] ?? '').toString(),
    );
  }

  // Backward-compatible helper for existing legacy screen.
  Future<List<TripResult>> searchTrips({
    required String from,
    required String to,
    required String dateIso,
    required String token,
    String ticketType = 'Regular',
  }) async {
    final recent = await fetchRecentTickets(attendantToken: token, ticketingToken: null);
    if (recent.isNotEmpty) {
      final first = recent.first;
      return [
        TripResult(
          from: first.from,
          to: first.to,
          departLabel: 'Now',
          durationLabel: '45 min',
          priceLabel: '₱${first.fare.toStringAsFixed(2)}',
          statusLabel: 'Recent fare',
        ),
      ];
    }
    return [
      TripResult(
        from: from,
        to: to,
        departLabel: '11:45 AM',
        durationLabel: '65 min',
        priceLabel: '₱45.00',
        statusLabel: 'Available',
      ),
      TripResult(
        from: from,
        to: to,
        departLabel: '2:15 PM',
        durationLabel: '70 min',
        priceLabel: '₱45.00',
        statusLabel: 'Boarding',
      ),
    ];
  }
}

class ApiDashboardSummary {
  const ApiDashboardSummary({
    required this.busNumber,
    required this.todayTickets,
    required this.todayRevenue,
    required this.activePassengers,
    required this.topRoute,
  });

  final String busNumber;
  final int todayTickets;
  final double todayRevenue;
  final int activePassengers;
  final String topRoute;
}

class ApiIssueTicketResult {
  ApiIssueTicketResult._({this.ok = false, this.ticket, this.message});

  factory ApiIssueTicketResult.ok(ApiIssuedTicket ticket) =>
      ApiIssueTicketResult._(ok: true, ticket: ticket);

  factory ApiIssueTicketResult.failure(String message) =>
      ApiIssueTicketResult._(ok: false, message: message);

  final bool ok;
  final ApiIssuedTicket? ticket;
  final String? message;
}

class ApiFareQuoteResult {
  ApiFareQuoteResult._({
    this.ok = false,
    this.matched = false,
    this.fare,
    this.pricingMode,
    this.extraDistanceKm,
    this.distanceChargePesos,
    this.baseFarePesos,
    this.farePerKmPesos,
    this.originSpurKm,
    this.destinationSpurKm,
    this.pricingSummary,
    this.fareBreakdownDisplay,
    this.message,
  });

  factory ApiFareQuoteResult.ok({
    required double fare,
    String? pricingMode,
    double? extraDistanceKm,
    double? distanceChargePesos,
    double? baseFarePesos,
    double? farePerKmPesos,
    double? originSpurKm,
    double? destinationSpurKm,
    String? pricingSummary,
    String? fareBreakdownDisplay,
  }) =>
      ApiFareQuoteResult._(
        ok: true,
        matched: true,
        fare: fare,
        pricingMode: pricingMode,
        extraDistanceKm: extraDistanceKm,
        distanceChargePesos: distanceChargePesos,
        baseFarePesos: baseFarePesos,
        farePerKmPesos: farePerKmPesos,
        originSpurKm: originSpurKm,
        destinationSpurKm: destinationSpurKm,
        pricingSummary: pricingSummary,
        fareBreakdownDisplay: fareBreakdownDisplay,
      );

  factory ApiFareQuoteResult.unmatched(String message) =>
      ApiFareQuoteResult._(ok: true, matched: false, message: message);

  factory ApiFareQuoteResult.failure(String message) =>
      ApiFareQuoteResult._(ok: false, matched: false, message: message);

  final bool ok;
  final bool matched;
  final double? fare;
  final String? pricingMode;
  final double? extraDistanceKm;
  final double? distanceChargePesos;
  /// Hub-to-hub matrix component (inter-hub trips), when returned by API.
  final double? baseFarePesos;
  final double? farePerKmPesos;
  final double? originSpurKm;
  final double? destinationSpurKm;
  /// Human-readable breakdown, e.g. Hub-to-hub ₱20 + 5 km × ₱10/km = ₱70
  final String? pricingSummary;
  /// Compact segment sum, e.g. ₱20.00 (DC-MAR) + ₱50.00 (MAR-VAL) + ₱63.00 (Distance) = ₱133.00 total
  final String? fareBreakdownDisplay;
  final String? message;
}

class ApiVerifyEditPinResult {
  ApiVerifyEditPinResult._({this.ok = false, this.editToken, this.driverName, this.message});

  factory ApiVerifyEditPinResult.ok({required String editToken, required String driverName}) =>
      ApiVerifyEditPinResult._(ok: true, editToken: editToken, driverName: driverName);

  factory ApiVerifyEditPinResult.failure(String message) =>
      ApiVerifyEditPinResult._(ok: false, message: message);

  final bool ok;
  final String? editToken;
  final String? driverName;
  final String? message;
}

class ApiPatchTicketResult {
  ApiPatchTicketResult._({this.ok = false, this.message});

  factory ApiPatchTicketResult.ok() => ApiPatchTicketResult._(ok: true);

  factory ApiPatchTicketResult.failure(String message) =>
      ApiPatchTicketResult._(ok: false, message: message);

  final bool ok;
  final String? message;
}

class ApiIssuedTicket {
  const ApiIssuedTicket({
    required this.id,
    required this.ticketCode,
    required this.passengerId,
    required this.passengerName,
    required this.from,
    required this.to,
    required this.category,
    required this.fare,
    required this.createdAt,
    this.busNumber,
  });

  final String id;
  final String ticketCode;
  final String passengerId;
  final String passengerName;
  final String from;
  final String to;
  final String category;
  final double fare;
  final DateTime createdAt;
  final String? busNumber;
}

class ApiPassenger {
  const ApiPassenger({
    required this.id,
    required this.name,
    required this.category,
    required this.lastTrip,
  });

  final String id;
  final String name;
  final String category;
  final String lastTrip;
}

class ApiRouteStop {
  const ApiRouteStop({
    required this.name,
    required this.sequence,
    this.latitude,
    this.longitude,
    this.geofenceRadiusM,
    this.kilometersFromStart,
  });

  factory ApiRouteStop.fromJson(Map<String, dynamic> x) {
    return ApiRouteStop(
      name: (x['name'] ?? '').toString().trim(),
      sequence: (x['sequence'] as num?)?.toInt() ?? 0,
      latitude: (x['latitude'] as num?)?.toDouble(),
      longitude: (x['longitude'] as num?)?.toDouble(),
      geofenceRadiusM: (x['geofenceRadiusM'] as num?)?.toDouble(),
      kilometersFromStart: (x['kilometersFromStart'] as num?)?.toDouble(),
    );
  }

  final String name;
  final int sequence;
  final double? latitude;
  final double? longitude;
  final double? geofenceRadiusM;
  /// Corridor chainage (km); server uses with terminal km for fare add-on.
  final double? kilometersFromStart;
}

class ApiTerminalPoint {
  const ApiTerminalPoint({
    required this.name,
    required this.latitude,
    required this.longitude,
    this.geofenceRadiusM,
    this.kilometersFromStart,
  });

  final String name;
  final double latitude;
  final double longitude;
  final double? geofenceRadiusM;
  final double? kilometersFromStart;
}

class ApiRouteCoverage {
  const ApiRouteCoverage({
    required this.id,
    required this.locationName,
    required this.pointType,
    required this.terminalName,
    this.terminal,
    required this.stops,
  });

  factory ApiRouteCoverage.fromJson(Map<String, dynamic> x) {
    final termRaw = x['terminal'];
    ApiTerminalPoint? terminal;
    if (termRaw is Map<String, dynamic>) {
      final name = (termRaw['name'] ?? '').toString().trim();
      final lat = (termRaw['latitude'] as num?)?.toDouble();
      final lng = (termRaw['longitude'] as num?)?.toDouble();
      if (name.isNotEmpty && lat != null && lng != null) {
        terminal = ApiTerminalPoint(
          name: name,
          latitude: lat,
          longitude: lng,
          geofenceRadiusM: (termRaw['geofenceRadiusM'] as num?)?.toDouble(),
          kilometersFromStart: (termRaw['kilometersFromStart'] as num?)?.toDouble(),
        );
      }
    }
    final stopsRaw = x['stops'];
    final stops = stopsRaw is List<dynamic>
        ? stopsRaw
            .whereType<Map<String, dynamic>>()
            .map(ApiRouteStop.fromJson)
            .where((s) => s.name.isNotEmpty)
            .toList()
          : <ApiRouteStop>[];
    stops.sort((a, b) => a.sequence.compareTo(b.sequence));
    return ApiRouteCoverage(
      id: (x['id'] ?? '').toString(),
      locationName: (x['locationName'] ?? '').toString().trim(),
      pointType: (x['pointType'] ?? 'terminal').toString(),
      terminalName: (x['terminalName'] ?? '').toString().trim(),
      terminal: terminal,
      stops: stops,
    );
  }

  final String id;
  final String locationName;
  final String pointType;
  final String terminalName;
  final ApiTerminalPoint? terminal;
  final List<ApiRouteStop> stops;

  /// Labels shown on tickets: terminal first, then each stop (admin-configured names + area).
  List<String> pickableStopLabels() {
    final out = <String>[];
    final area = locationName;
    if (terminal != null && terminal!.name.isNotEmpty) {
      out.add('${terminal!.name} ($area)');
    }
    for (final s in stops) {
      out.add('${s.name} ($area)');
    }
    if (out.isEmpty && area.isNotEmpty) {
      out.add(area);
    }
    return out;
  }

  /// UI: short hub title via [hubDisplayName]; ticket suffix uses [locationName] so strings match Admin fare resolution (`terminal (locationName)`).
  List<({String ticketLabel, String displayLabel})> pickableStopChoices(String hubDisplayName) {
    final area = locationName.trim().isNotEmpty ? locationName.trim() : hubDisplayName.trim();
    final out = <({String ticketLabel, String displayLabel})>[];
    if (terminal != null && terminal!.name.isNotEmpty) {
      final d = terminal!.name.trim();
      out.add((ticketLabel: '$d ($area)', displayLabel: d));
    }
    for (final s in stops) {
      final d = s.name.trim();
      if (d.isEmpty) continue;
      out.add((ticketLabel: '$d ($area)', displayLabel: d));
    }
    if (out.isEmpty && area.isNotEmpty) {
      out.add((ticketLabel: area, displayLabel: area));
    }
    return out;
  }
}

class ApiProfileMe {
  const ApiProfileMe({
    required this.id,
    required this.firstName,
    required this.lastName,
    required this.email,
    required this.role,
    required this.busNumber,
    required this.phone,
  });

  final String id;
  final String firstName;
  final String lastName;
  final String email;
  final String role;
  final String busNumber;
  final String phone;
}

class ApiCompanyInfo {
  const ApiCompanyInfo({
    required this.name,
    required this.phone,
    required this.email,
    required this.address,
    required this.logoUrl,
  });

  factory ApiCompanyInfo.fromJson(Map<String, dynamic> m) {
    return ApiCompanyInfo(
      name: (m['name'] ?? '').toString(),
      phone: (m['phone'] ?? '').toString(),
      email: (m['email'] ?? '').toString(),
      address: (m['address'] ?? '').toString(),
      logoUrl: (m['logoUrl'] ?? '').toString(),
    );
  }

  final String name;
  final String phone;
  final String email;
  final String address;
  final String logoUrl;
}

class ApiStaffProfileHud {
  const ApiStaffProfileHud({
    required this.profile,
    required this.company,
  });

  factory ApiStaffProfileHud.fromJson(Map<String, dynamic> m) {
    final p = m['profile'];
    final c = m['company'];
    return ApiStaffProfileHud(
      profile: p is Map<String, dynamic>
          ? ApiProfileMe(
              id: (p['id'] ?? '').toString(),
              firstName: (p['firstName'] ?? '').toString(),
              lastName: (p['lastName'] ?? '').toString(),
              email: (p['email'] ?? '').toString(),
              role: (p['role'] ?? '').toString(),
              busNumber: (p['busNumber'] ?? '').toString(),
              phone: (p['phone'] ?? '').toString(),
            )
          : const ApiProfileMe(
              id: '',
              firstName: '',
              lastName: '',
              email: '',
              role: '',
              busNumber: '',
              phone: '',
            ),
      company: c is Map<String, dynamic> ? ApiCompanyInfo.fromJson(c) : const ApiCompanyInfo(name: '', phone: '', email: '', address: '', logoUrl: ''),
    );
  }

  final ApiProfileMe profile;
  final ApiCompanyInfo company;
}

class ApiShiftSummary {
  const ApiShiftSummary({
    required this.generatedAt,
    required this.date,
    required this.staffName,
    required this.staffId,
    required this.staffEmail,
    required this.busNumber,
    required this.companyName,
    required this.companyEmail,
    required this.companyPhone,
    required this.logoUrl,
    required this.startTime,
    required this.endTime,
    required this.kilometers,
    required this.ticketsSold,
    required this.cashRemittance,
    required this.donCarlosAt,
    required this.maramagAt,
    required this.malaybalayAt,
    required this.hardwareStatement,
  });

  factory ApiShiftSummary.fromJson(Map<String, dynamic> m) {
    final p = (m['profile'] is Map<String, dynamic>) ? (m['profile'] as Map<String, dynamic>) : const <String, dynamic>{};
    final c = (m['company'] is Map<String, dynamic>) ? (m['company'] as Map<String, dynamic>) : const <String, dynamic>{};
    final tl = (m['tripLog'] is Map<String, dynamic>) ? (m['tripLog'] as Map<String, dynamic>) : const <String, dynamic>{};
    final rv = (m['revenue'] is Map<String, dynamic>) ? (m['revenue'] as Map<String, dynamic>) : const <String, dynamic>{};
    final st = (m['stops'] is Map<String, dynamic>) ? (m['stops'] as Map<String, dynamic>) : const <String, dynamic>{};
    final hw =
        (m['hardwareHealth'] is Map<String, dynamic>) ? (m['hardwareHealth'] as Map<String, dynamic>) : const <String, dynamic>{};
    return ApiShiftSummary(
      generatedAt: (m['generatedAt'] ?? '').toString(),
      date: (m['date'] ?? '').toString(),
      staffName: (p['name'] ?? '').toString(),
      staffId: (p['staffId'] ?? '').toString(),
      staffEmail: (p['email'] ?? '').toString(),
      busNumber: (p['busNumber'] ?? '').toString(),
      companyName: (c['name'] ?? '').toString(),
      companyEmail: (c['email'] ?? '').toString(),
      companyPhone: (c['phone'] ?? '').toString(),
      logoUrl: (c['logoUrl'] ?? '').toString(),
      startTime: (tl['startTime'] ?? '—').toString(),
      endTime: (tl['endTime'] ?? '—').toString(),
      kilometers: (tl['kilometers'] as num?)?.toDouble() ?? 0,
      ticketsSold: (rv['ticketsSold'] as num?)?.toInt() ?? 0,
      cashRemittance: (rv['totalCashRemittance'] as num?)?.toDouble() ?? 0,
      donCarlosAt: (st['donCarlos'] ?? '—').toString(),
      maramagAt: (st['maramag'] ?? '—').toString(),
      malaybalayAt: (st['malaybalay'] ?? '—').toString(),
      hardwareStatement: (hw['statement'] ?? '').toString(),
    );
  }

  final String generatedAt;
  final String date;
  final String staffName;
  final String staffId;
  final String staffEmail;
  final String busNumber;
  final String companyName;
  final String companyEmail;
  final String companyPhone;
  final String logoUrl;
  final String startTime;
  final String endTime;
  final double kilometers;
  final int ticketsSold;
  final double cashRemittance;
  final String donCarlosAt;
  final String maramagAt;
  final String malaybalayAt;
  final String hardwareStatement;
}

class ApiStaffEta {
  const ApiStaffEta({
    required this.etaMinutes,
    required this.targetArrivalTime,
    required this.status,
    required this.nextTerminal,
  });

  factory ApiStaffEta.fromJson(Map<String, dynamic> m) {
    return ApiStaffEta(
      etaMinutes: (m['etaMinutes'] as num?)?.toInt(),
      targetArrivalTime: m['targetArrivalTime']?.toString(),
      status: (m['status'] ?? 'ON TIME').toString(),
      nextTerminal: m['nextTerminal']?.toString(),
    );
  }

  final int? etaMinutes;
  final String? targetArrivalTime;
  final String status;
  final String? nextTerminal;
}

class ApiAssignedBus {
  const ApiAssignedBus({
    required this.busId,
    required this.plateNumber,
    required this.busNumber,
  });

  factory ApiAssignedBus.fromJson(Map<String, dynamic> m) {
    return ApiAssignedBus(
      busId: (m['busId'] ?? '').toString(),
      plateNumber: (m['plateNumber'] ?? '—').toString(),
      busNumber: (m['busNumber'] ?? m['busId'] ?? '').toString(),
    );
  }

  final String busId;
  final String plateNumber;
  final String busNumber;
}

class ApiSimpleActionResult {
  ApiSimpleActionResult._({this.ok = false, this.message});

  factory ApiSimpleActionResult.ok() => ApiSimpleActionResult._(ok: true);

  factory ApiSimpleActionResult.failure(String message) =>
      ApiSimpleActionResult._(ok: false, message: message);

  final bool ok;
  final String? message;
}

class ApiBusAssignment {
  const ApiBusAssignment({required this.assigned, this.bus});

  factory ApiBusAssignment.fromJson(Map<String, dynamic> m) {
    final assigned = m['assigned'] == true;
    final raw = m['bus'];
    if (!assigned || raw is! Map<String, dynamic>) {
      return ApiBusAssignment(assigned: assigned, bus: null);
    }
    return ApiBusAssignment(assigned: true, bus: ApiAssignedBus.fromJson(raw));
  }

  final bool assigned;
  final ApiAssignedBus? bus;
}

class ApiAuthResult {
  ApiAuthResult._({
    this.ok = false,
    this.token,
    this.displayName,
    this.ticketingToken,
    this.message,
  });

  factory ApiAuthResult.ok({
    required String token,
    required String displayName,
    String? ticketingToken,
  }) =>
      ApiAuthResult._(ok: true, token: token, displayName: displayName, ticketingToken: ticketingToken);

  factory ApiAuthResult.failure(String message) => ApiAuthResult._(ok: false, message: message);

  final bool ok;
  final String? token;
  final String? displayName;
  /// Admin `JWT_SECRET` operator token — required for bus assignment + live GPS ping.
  final String? ticketingToken;
  final String? message;
}

class ApiRecoveryPreview {
  const ApiRecoveryPreview({
    required this.displayName,
    required this.staffId,
    this.avatarUrl,
  });

  static ApiRecoveryPreview? fromJson(dynamic json) {
    if (json is! Map<String, dynamic>) return null;
    final name = json['displayName']?.toString().trim() ?? '';
    final sid = json['staffId']?.toString().trim() ?? '';
    if (name.isEmpty && sid.isEmpty) return null;
    final av = json['avatarUrl']?.toString().trim();
    return ApiRecoveryPreview(
      displayName: name.isEmpty ? 'Attendant' : name,
      staffId: sid.isEmpty ? '—' : sid,
      avatarUrl: av != null && av.isNotEmpty ? av : null,
    );
  }

  final String displayName;
  final String staffId;
  final String? avatarUrl;
}

class ApiForgotPasswordResult {
  ApiForgotPasswordResult._({
    this.ok = false,
    this.message,
    this.devOtp,
    this.simulatedEmail = false,
    this.hint,
    this.preview,
  });

  factory ApiForgotPasswordResult.ok({
    required String message,
    String? devOtp,
    bool simulatedEmail = false,
    String? hint,
    ApiRecoveryPreview? preview,
  }) =>
      ApiForgotPasswordResult._(
        ok: true,
        message: message,
        devOtp: devOtp,
        simulatedEmail: simulatedEmail,
        hint: hint,
        preview: preview,
      );

  factory ApiForgotPasswordResult.failure(String message) =>
      ApiForgotPasswordResult._(ok: false, message: message);

  final bool ok;
  final String? message;
  final String? devOtp;
  final bool simulatedEmail;
  final String? hint;
  final ApiRecoveryPreview? preview;
}

class ApiForgotEmailResult {
  final bool ok;
  final String? email;
  final String? message;
  const ApiForgotEmailResult._({required this.ok, this.email, this.message});
  factory ApiForgotEmailResult.ok(String email) => ApiForgotEmailResult._(ok: true, email: email);
  factory ApiForgotEmailResult.failure(String msg) => ApiForgotEmailResult._(ok: false, message: msg);
}

class ApiVerifyResetOtpResult {
  ApiVerifyResetOtpResult._({this.ok = false, this.resetToken, this.message});

  factory ApiVerifyResetOtpResult.ok({required String resetToken, String? message}) =>
      ApiVerifyResetOtpResult._(ok: true, resetToken: resetToken, message: message);

  factory ApiVerifyResetOtpResult.failure(String message) =>
      ApiVerifyResetOtpResult._(ok: false, message: message);

  final bool ok;
  final String? resetToken;
  final String? message;
}

class ApiResetPasswordResult {
  ApiResetPasswordResult._({this.ok = false, this.message});

  factory ApiResetPasswordResult.ok(String message) =>
      ApiResetPasswordResult._(ok: true, message: message);

  factory ApiResetPasswordResult.failure(String message) =>
      ApiResetPasswordResult._(ok: false, message: message);

  final bool ok;
  final String? message;
}
