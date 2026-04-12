import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'api_client.dart';

/// One hub from Admin Location Management where Open-Meteo reports rain / wet conditions.
class WeatherAdvisoryRow {
  WeatherAdvisoryRow({required this.locationName, required this.summary});

  final String locationName;
  final String summary;
}

/// Polls Admin (via Bus Attendant proxy) for rain advisories at configured terminal hubs.
class WeatherAdvisoryController extends ChangeNotifier {
  WeatherAdvisoryController._();
  static final WeatherAdvisoryController instance = WeatherAdvisoryController._();

  List<WeatherAdvisoryRow> _rows = const [];
  DateTime? _updatedAt;

  List<WeatherAdvisoryRow> get rows => _rows;
  DateTime? get updatedAt => _updatedAt;
  bool get hasAlerts => _rows.isNotEmpty;

  Future<void> poll() async {
    final base = ApiClient().baseUrl;
    try {
      final uri = Uri.parse('$base/api/public/weather-advisories');
      final res = await http.get(uri).timeout(const Duration(seconds: 14));
      if (res.statusCode != 200) return;
      final m = jsonDecode(res.body);
      if (m is! Map<String, dynamic>) return;
      final raw = m['alerts'];
      if (raw is! List<dynamic>) return;
      final next = <WeatherAdvisoryRow>[];
      for (final x in raw) {
        if (x is! Map<String, dynamic>) continue;
        final name = (x['locationName'] ?? '').toString().trim();
        final summary = (x['summary'] ?? 'Rain').toString().trim();
        if (name.isEmpty) continue;
        next.add(WeatherAdvisoryRow(locationName: name, summary: summary.isEmpty ? 'Rain' : summary));
      }
      next.sort((a, b) => a.locationName.toLowerCase().compareTo(b.locationName.toLowerCase()));
      final u = DateTime.tryParse((m['updatedAt'] ?? '').toString());
      var changed = next.length != _rows.length;
      if (!changed) {
        for (var i = 0; i < next.length; i++) {
          if (next[i].locationName != _rows[i].locationName || next[i].summary != _rows[i].summary) {
            changed = true;
            break;
          }
        }
      }
      if (u != _updatedAt) changed = true;
      if (!changed) return;
      _rows = next;
      _updatedAt = u;
      notifyListeners();
    } catch (_) {
      /* offline / admin down */
    }
  }
}
