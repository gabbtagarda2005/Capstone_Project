import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

const _kMaxPoints = 120;
const _kFileName = 'gps_telemetry_outbox.json';

/// Queues GPS samples when the device cannot reach the server; flush in order when online.
class GpsOutboxStore {
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
        _cache = decoded
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
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

  Future<void> enqueue(Map<String, dynamic> point) async {
    await load();
    _cache.add(point);
    while (_cache.length > _kMaxPoints) {
      _cache.removeAt(0);
    }
    await _persist();
  }

  /// Returns queued points oldest-first and clears the outbox.
  Future<List<Map<String, dynamic>>> drainAll() async {
    await load();
    final out = List<Map<String, dynamic>>.from(_cache);
    _cache = [];
    await _persist();
    return out;
  }
}
