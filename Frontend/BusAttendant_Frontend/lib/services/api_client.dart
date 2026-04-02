import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import '../models/trip_result.dart';

class ApiClient {
  ApiClient({String? baseUrl})
      : baseUrl = (baseUrl ??
                const String.fromEnvironment(
                  'API_BASE_URL',
                  defaultValue: 'http://127.0.0.1:4011',
                ))
            .replaceAll(RegExp(r'/+$'), '');

  final String baseUrl;

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
      return 'Cannot reach $baseUrl. Run BusAttendant_Backend (4011). For login, Admin_Backend (4001) must also be running.';
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
          .timeout(const Duration(seconds: 12));
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
    http.Response res;
    try {
      res = await http.get(uri, headers: {
        'Authorization': 'Bearer $token',
      }).timeout(const Duration(seconds: 12));
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
          .timeout(const Duration(seconds: 12));
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

  Future<List<ApiIssuedTicket>> fetchRecentTickets({required String token}) async {
    final uri = Uri.parse('$baseUrl/api/tickets/recent');
    http.Response res;
    try {
      res = await http.get(uri, headers: {
        'Authorization': 'Bearer $token',
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
    http.Response res;
    try {
      res = await http
          .post(
            uri,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(body),
          )
          .timeout(const Duration(seconds: 12));
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
    http.Response res;
    try {
      res = await http.get(uri, headers: {
        'Authorization': 'Bearer $token',
      }).timeout(const Duration(seconds: 12));
    } catch (_) {
      throw Exception('Network timeout while loading profile');
    }
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
    required this.ticketCode,
    required this.passengerId,
    required this.passengerName,
    required this.from,
    required this.to,
    required this.category,
    required this.fare,
    required this.createdAt,
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
  });

  factory ApiRouteStop.fromJson(Map<String, dynamic> x) {
    return ApiRouteStop(
      name: (x['name'] ?? '').toString().trim(),
      sequence: (x['sequence'] as num?)?.toInt() ?? 0,
      latitude: (x['latitude'] as num?)?.toDouble(),
      longitude: (x['longitude'] as num?)?.toDouble(),
      geofenceRadiusM: (x['geofenceRadiusM'] as num?)?.toDouble(),
    );
  }

  final String name;
  final int sequence;
  final double? latitude;
  final double? longitude;
  final double? geofenceRadiusM;
}

class ApiTerminalPoint {
  const ApiTerminalPoint({
    required this.name,
    required this.latitude,
    required this.longitude,
    this.geofenceRadiusM,
  });

  final String name;
  final double latitude;
  final double longitude;
  final double? geofenceRadiusM;
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

  /// UI: short name (CMU, Dulogon); ticket: full `Name (Maramag)` using [hubDisplayName].
  List<({String ticketLabel, String displayLabel})> pickableStopChoices(String hubDisplayName) {
    final hub = hubDisplayName.trim();
    final out = <({String ticketLabel, String displayLabel})>[];
    if (terminal != null && terminal!.name.isNotEmpty) {
      final d = terminal!.name.trim();
      out.add((ticketLabel: '$d ($hub)', displayLabel: d));
    }
    for (final s in stops) {
      final d = s.name.trim();
      if (d.isEmpty) continue;
      out.add((ticketLabel: '$d ($hub)', displayLabel: d));
    }
    if (out.isEmpty && hub.isNotEmpty) {
      out.add((ticketLabel: hub, displayLabel: hub));
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
