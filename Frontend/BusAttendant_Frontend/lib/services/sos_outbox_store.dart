import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

const _kMaxAlerts = 20;
const _kFileName = 'sos_outbox.json';

/// Queues SOS alerts when the device cannot reach the server; flush in order when online.
/// Same JSON-file-on-disk pattern as GpsOutboxStore/TicketOutboxStore. SOS payloads are small
/// (level, note, lat/lng, timestamp) and need no fare-style pre-computation, so this is a
/// straightforward enqueue-and-retry queue — no idempotency key needed since the backend
/// `/attendant-sos` handler just appends a SecurityLog entry (a duplicate is a harmless extra
/// alert, not a duplicate financial record).
class SosOutboxStore {
  List<Map<String, dynamic>> _cache = [];

  Future<File> _file() async {
    final dir = await getApplicationSupportDirectory();
    return File('${dir.path}/$_kFileName');
  }

  Future<void> load() async {
    try {
      final f = await _file();
      if (!await f.exists()) {
        _cache = [];
        return;
      }
      final raw = await f.readAsString();
      final decoded = jsonDecode(raw);
      if (decoded is List) {
        _cache = decoded.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
      } else {
        _cache = [];
      }
    } catch (_) {
      _cache = [];
    }
  }

  Future<void> _persist() async {
    try {
      final f = await _file();
      await f.parent.create(recursive: true);
      await f.writeAsString(jsonEncode(_cache));
    } catch (_) {}
  }

  int get length => _cache.length;

  Future<void> enqueue({
    required String level,
    required String note,
    required double latitude,
    required double longitude,
  }) async {
    await load();
    _cache.add({
      'level': level,
      'note': note,
      'latitude': latitude,
      'longitude': longitude,
      'queuedAt': DateTime.now().toUtc().toIso8601String(),
    });
    while (_cache.length > _kMaxAlerts) {
      _cache.removeAt(0);
    }
    await _persist();
  }

  Future<List<Map<String, dynamic>>> drainAll() async {
    await load();
    final out = List<Map<String, dynamic>>.from(_cache);
    _cache = [];
    await _persist();
    return out;
  }
}
