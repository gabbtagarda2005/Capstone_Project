import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'api_client.dart';

const _kFileName = 'bus_assignment_cache.json';

/// Persists the last successfully-fetched bus assignment so a network failure (offline, timeout)
/// can fall back to "last known assignment" instead of silently presenting as "unassigned" — see
/// main_shell.dart's `_resolveAssignment`. Same JSON-file-on-disk pattern as TicketOutboxStore /
/// GpsOutboxStore.
class AssignmentCache {
  Future<File> _file() async {
    final dir = await getApplicationSupportDirectory();
    return File('${dir.path}/$_kFileName');
  }

  Future<void> save(ApiBusAssignment assignment) async {
    try {
      final f = await _file();
      await f.parent.create(recursive: true);
      await f.writeAsString(jsonEncode(assignment.toJson()));
    } catch (_) {}
  }

  /// Returns null if nothing has ever been cached (e.g. first-ever launch while offline) — the
  /// caller should fall back to "unassigned" only in that case, never for a genuine fetch failure
  /// once a real assignment has been seen at least once.
  Future<ApiBusAssignment?> load() async {
    try {
      final f = await _file();
      if (!await f.exists()) return null;
      final raw = await f.readAsString();
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return null;
      return ApiBusAssignment.fromJson(Map<String, dynamic>.from(decoded));
    } catch (_) {
      return null;
    }
  }
}
