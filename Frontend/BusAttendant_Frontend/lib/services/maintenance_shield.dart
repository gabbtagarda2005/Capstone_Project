import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../config/app_version.dart';

int compareSemverLoose(String a, String b) {
  List<int> parts(String v) {
    final core = v.split('+').first.trim();
    return core
        .split('.')
        .map((e) => int.tryParse(e.replaceAll(RegExp(r'[^\d]'), '')) ?? 0)
        .toList();
  }

  final pa = parts(a);
  final pb = parts(b);
  for (var i = 0; i < 4; i++) {
    final x = i < pa.length ? pa[i] : 0;
    final y = i < pb.length ? pb[i] : 0;
    if (x != y) return x.compareTo(y);
  }
  return 0;
}

/// Global maintenance lockout from Admin “system shield” (503 JSON or public status poll).
class MaintenanceShield extends ChangeNotifier {
  MaintenanceShield._();
  static final MaintenanceShield instance = MaintenanceShield._();

  bool _active = false;
  String _message = '';
  String? _minClientVersion;

  bool get active => _active;
  String get message => _message;
  String? get minClientVersion => _minClientVersion;

  bool get needsAppUpdate {
    final min = _minClientVersion?.trim();
    if (min == null || min.isEmpty) return false;
    return compareSemverLoose(kAppMarketingVersion, min) < 0;
  }

  void clear() {
    if (!_active && _message.isEmpty && _minClientVersion == null) return;
    _active = false;
    _message = '';
    _minClientVersion = null;
    notifyListeners();
  }

  void _apply(bool on, String msg, String? minV) {
    _active = on;
    _message = msg;
    _minClientVersion = minV;
    notifyListeners();
  }

  void applyFrom503Body(Map<String, dynamic> m) {
    if (m['maintenance'] != true) return;
    _apply(
      true,
      m['message']?.toString() ?? 'System maintenance in progress.',
      m['minClientVersion']?.toString(),
    );
  }

  void applyStatusJson(Map<String, dynamic> m) {
    final attendantKey = m['attendantLocked'];
    if (attendantKey is bool) {
      if (!attendantKey) {
        clear();
        return;
      }
      _apply(
        true,
        m['message']?.toString() ?? 'System maintenance in progress.',
        m['minClientVersion']?.toString(),
      );
      return;
    }
    final on = m['enabled'] == true;
    if (!on) {
      clear();
      return;
    }
    _apply(
      true,
      m['message']?.toString() ?? 'System maintenance in progress.',
      m['minClientVersion']?.toString(),
    );
  }

  void tryApplyFromResponse(http.Response res) {
    if (res.statusCode != 503) return;
    try {
      final raw = jsonDecode(res.body);
      if (raw is Map<String, dynamic> && raw['maintenance'] == true) {
        applyFrom503Body(raw);
      }
    } catch (_) {}
  }
}
