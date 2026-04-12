import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'api_client.dart';

class AppBroadcastState {
  AppBroadcastState({required this.message, required this.severity});

  final String message;
  final String severity;

  bool get visible => message.trim().isNotEmpty;
}

/// Latest operations broadcast for attendants (from Admin command center).
class AppBroadcastController extends ChangeNotifier {
  AppBroadcastController._();
  static final AppBroadcastController instance = AppBroadcastController._();

  AppBroadcastState? _state;
  AppBroadcastState? get state => _state;

  Future<void> poll() async {
    final base = ApiClient().baseUrl;
    try {
      final uri = Uri.parse('$base/api/public/broadcast/attendant');
      final res = await http.get(uri).timeout(const Duration(seconds: 12));
      if (res.statusCode != 200) return;
      final m = jsonDecode(res.body);
      if (m is! Map<String, dynamic>) return;
      final msg = m['message']?.toString().trim() ?? '';
      if (msg.isEmpty) {
        if (_state != null) {
          _state = null;
          notifyListeners();
        }
        return;
      }
      final sev = m['severity']?.toString().trim().toLowerCase() ?? 'normal';
      final severity = sev == 'medium' || sev == 'critical' ? sev : 'normal';
      _state = AppBroadcastState(message: msg, severity: severity);
      notifyListeners();
    } catch (_) {
      /* offline */
    }
  }
}
