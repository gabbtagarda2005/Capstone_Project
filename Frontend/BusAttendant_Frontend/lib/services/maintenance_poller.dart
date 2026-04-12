import 'dart:convert';

import 'package:http/http.dart' as http;

import 'api_client.dart';
import 'maintenance_shield.dart';

/// Polls attendant API proxy → Admin public maintenance status.
class MaintenancePoller {
  static final ApiClient _api = ApiClient();

  static Future<void> poll() async {
    try {
      final uri = Uri.parse('${_api.baseUrl}/api/public/maintenance-status');
      final res = await http.get(uri).timeout(const Duration(seconds: 14));
      if (res.statusCode != 200) return;
      final raw = jsonDecode(res.body);
      if (raw is Map<String, dynamic>) {
        MaintenanceShield.instance.applyStatusJson(raw);
      }
    } catch (_) {
      /* offline — leave prior state */
    }
  }
}
