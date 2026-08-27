import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

const _kFileName = 'fare_quote_cache.json';
const _kMaxEntries = 200;

/// Caches successful fare quotes on-device so a route the attendant has already quoted while
/// online can still be issued while offline, without replicating the server's fare-graph
/// algorithm (services/farePricing.js) client-side. The server remains the source of truth —
/// it recomputes and stores its own fare when the queued ticket syncs regardless of what's
/// cached here.
class FareQuoteCache {
  Map<String, dynamic> _cache = {};
  bool _loaded = false;

  Future<File> _file() async {
    final dir = await getApplicationSupportDirectory();
    return File('${dir.path}/$_kFileName');
  }

  String _key(String from, String to, String category) =>
      '${from.trim().toLowerCase()}|${to.trim().toLowerCase()}|${category.trim().toLowerCase()}';

  Future<void> _ensureLoaded() async {
    if (_loaded) return;
    _loaded = true;
    try {
      final f = await _file();
      if (!await f.exists()) return;
      final raw = await f.readAsString();
      final decoded = jsonDecode(raw);
      if (decoded is Map) {
        _cache = Map<String, dynamic>.from(decoded);
      }
    } catch (_) {
      _cache = {};
    }
  }

  Future<void> _persist() async {
    try {
      final f = await _file();
      await f.parent.create(recursive: true);
      await f.writeAsString(jsonEncode(_cache));
    } catch (_) {}
  }

  Future<void> put({
    required String from,
    required String to,
    required String category,
    required double fare,
    String? fareBreakdownDisplay,
    String? pricingSummary,
  }) async {
    await _ensureLoaded();
    final key = _key(from, to, category);
    _cache[key] = {
      'fare': fare,
      'fareBreakdownDisplay': fareBreakdownDisplay,
      'pricingSummary': pricingSummary,
      'cachedAt': DateTime.now().toUtc().toIso8601String(),
    };
    if (_cache.length > _kMaxEntries) {
      // Drop the oldest entry (Dart maps preserve insertion order).
      _cache.remove(_cache.keys.first);
    }
    await _persist();
  }

  /// Returns a cached quote for this exact route/category, or null if never quoted before.
  Future<FareQuoteCacheEntry?> get(String from, String to, String category) async {
    await _ensureLoaded();
    final raw = _cache[_key(from, to, category)];
    if (raw is! Map) return null;
    final fare = (raw['fare'] as num?)?.toDouble();
    if (fare == null) return null;
    return FareQuoteCacheEntry(
      fare: fare,
      fareBreakdownDisplay: raw['fareBreakdownDisplay']?.toString(),
      pricingSummary: raw['pricingSummary']?.toString(),
      cachedAt: raw['cachedAt']?.toString(),
    );
  }
}

class FareQuoteCacheEntry {
  const FareQuoteCacheEntry({
    required this.fare,
    this.fareBreakdownDisplay,
    this.pricingSummary,
    this.cachedAt,
  });

  final double fare;
  final String? fareBreakdownDisplay;
  final String? pricingSummary;
  final String? cachedAt;
}
