import 'dart:convert';

import 'package:http/http.dart' as http;
import '../models/trip_result.dart';

class ApiClient {
  ApiClient({String? baseUrl})
      : baseUrl = (baseUrl ??
                const String.fromEnvironment(
                  'API_BASE_URL',
                  defaultValue: 'http://10.0.2.2:4011',
                ))
            .replaceAll(RegExp(r'/+$'), '');

  final String baseUrl;

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
          .timeout(const Duration(seconds: 12));
    } catch (_) {
      return ApiAuthResult.failure('Network timeout. Please try again.');
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
      return ApiAuthResult.ok(token: token, displayName: name.isEmpty ? email : name);
    }
    try {
      final err = jsonDecode(res.body) as Map<String, dynamic>;
      return ApiAuthResult.failure(err['error']?.toString() ?? 'Login failed');
    } catch (_) {
      return ApiAuthResult.failure('Login failed (${res.statusCode})');
    }
  }

  Future<ApiDashboardSummary> fetchDashboardSummary({required String token}) async {
    final uri = Uri.parse('$baseUrl/api/dashboard/summary');
    final res = await http.get(uri, headers: {
      'Authorization': 'Bearer $token',
    });
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
    final res = await http.get(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
      },
    );
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

  Future<List<ApiIssuedTicket>> fetchRecentTickets({required String token}) async {
    final uri = Uri.parse('$baseUrl/api/tickets/recent');
    final res = await http.get(uri, headers: {
      'Authorization': 'Bearer $token',
    });
    if (res.statusCode != 200) {
      throw Exception('Could not load tickets (${res.statusCode})');
    }
    final map = jsonDecode(res.body) as Map<String, dynamic>;
    final items = (map['items'] as List<dynamic>? ?? const <dynamic>[])
        .whereType<Map<String, dynamic>>()
        .map(
          (x) => ApiIssuedTicket(
            id: (x['id'] ?? '').toString(),
            passengerId: (x['passengerId'] ?? '').toString(),
            passengerName: (x['passengerName'] ?? '').toString(),
            from: (x['from'] ?? '').toString(),
            to: (x['to'] ?? '').toString(),
            category: (x['category'] ?? '').toString(),
            fare: (x['fare'] as num?)?.toDouble() ?? 0,
            createdAt: DateTime.tryParse((x['createdAt'] ?? '').toString()) ?? DateTime.now(),
          ),
        )
        .toList();
    return items;
  }

  Future<ApiIssueTicketResult> issueTicket({
    required String token,
    required String passengerId,
    required String passengerName,
    required String from,
    required String to,
    required String category,
    required double fare,
  }) async {
    final uri = Uri.parse('$baseUrl/api/tickets/issue');
    final body = <String, dynamic>{
      'passengerId': passengerId.trim(),
      'passengerName': passengerName.trim(),
      'from': from.trim(),
      'to': to.trim(),
      'category': category.trim().toLowerCase(),
      'fare': fare,
    };
    final res = await http.post(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode(body),
    );
    if (res.statusCode == 201) {
      final map = jsonDecode(res.body) as Map<String, dynamic>;
      return ApiIssueTicketResult.ok(
        ApiIssuedTicket(
          id: (map['id'] ?? '').toString(),
          passengerId: (map['passengerId'] ?? '').toString(),
          passengerName: (map['passengerName'] ?? '').toString(),
          from: (map['from'] ?? '').toString(),
          to: (map['to'] ?? '').toString(),
          category: (map['category'] ?? '').toString(),
          fare: (map['fare'] as num?)?.toDouble() ?? 0,
          createdAt: DateTime.tryParse((map['createdAt'] ?? '').toString()) ?? DateTime.now(),
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

  Future<ApiProfileMe> fetchProfile({
    required String token,
  }) async {
    final uri = Uri.parse('$baseUrl/api/profile/me');
    final res = await http.get(uri, headers: {
      'Authorization': 'Bearer $token',
    });
    if (res.statusCode != 200) {
      throw Exception('Could not load profile (${res.statusCode})');
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

  // Backward-compatible helper for existing legacy screen.
  Future<List<TripResult>> searchTrips({
    required String from,
    required String to,
    required String dateIso,
    required String token,
    String ticketType = 'Regular',
  }) async {
    final recent = await fetchRecentTickets(token: token);
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

class ApiIssuedTicket {
  const ApiIssuedTicket({
    required this.id,
    required this.passengerId,
    required this.passengerName,
    required this.from,
    required this.to,
    required this.category,
    required this.fare,
    required this.createdAt,
  });

  final String id;
  final String passengerId;
  final String passengerName;
  final String from;
  final String to;
  final String category;
  final double fare;
  final DateTime createdAt;
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
