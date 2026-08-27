import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:path_provider/path_provider.dart';

const _kMaxTickets = 60;
const _kFileName = 'ticket_issue_outbox.json';
final _rand = Random.secure();

/// Practically-unique per-device ID (timestamp + random suffix) — doesn't need RFC 4122
/// formatting, just needs to be safe as a Mongo idempotency key.
String _generateClientRequestId() {
  final ts = DateTime.now().microsecondsSinceEpoch.toRadixString(36);
  final rnd = List.generate(10, (_) => _rand.nextInt(36).toRadixString(36)).join();
  return '$ts-$rnd';
}

/// One ticket queued while offline. `clientRequestId` is the idempotency key sent with every
/// (re)try, so a retried sync after an ambiguous network failure can't double-issue the same
/// ticket — see Backend/Admin_Backend/models/IssuedTicketRecord.js's `clientRequestId` field.
class OutboxTicket {
  OutboxTicket({
    required this.clientRequestId,
    required this.passengerId,
    required this.passengerName,
    required this.from,
    required this.to,
    required this.category,
    required this.fare,
    required this.fareIsEstimate,
    this.busNumber,
    required this.queuedAt,
  });

  factory OutboxTicket.fromJson(Map<String, dynamic> m) => OutboxTicket(
        clientRequestId: (m['clientRequestId'] ?? '').toString(),
        passengerId: (m['passengerId'] ?? '').toString(),
        passengerName: (m['passengerName'] ?? '').toString(),
        from: (m['from'] ?? '').toString(),
        to: (m['to'] ?? '').toString(),
        category: (m['category'] ?? 'regular').toString(),
        fare: (m['fare'] as num?)?.toDouble() ?? 0,
        fareIsEstimate: m['fareIsEstimate'] == true,
        busNumber: m['busNumber']?.toString(),
        queuedAt: (m['queuedAt'] ?? '').toString(),
      );

  final String clientRequestId;
  final String passengerId;
  final String passengerName;
  final String from;
  final String to;
  final String category;
  final double fare;
  /// True when this fare came from the offline cache or was typed in manually (not a live
  /// server quote) — the server recomputes and stores its own authoritative fare regardless.
  final bool fareIsEstimate;
  final String? busNumber;
  final String queuedAt;

  Map<String, dynamic> toJson() => {
        'clientRequestId': clientRequestId,
        'passengerId': passengerId,
        'passengerName': passengerName,
        'from': from,
        'to': to,
        'category': category,
        'fare': fare,
        'fareIsEstimate': fareIsEstimate,
        'busNumber': busNumber,
        'queuedAt': queuedAt,
      };
}

/// Queues ticket-issue requests when the device cannot reach the server; flush in order when
/// online. Same JSON-file-on-disk pattern as GpsOutboxStore.
class TicketOutboxStore {
  List<OutboxTicket> _cache = [];

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
        _cache = decoded.whereType<Map>().map((e) => OutboxTicket.fromJson(Map<String, dynamic>.from(e))).toList();
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
      await f.writeAsString(jsonEncode(_cache.map((t) => t.toJson()).toList()));
    } catch (_) {}
  }

  int get length => _cache.length;

  /// Enqueues a new ticket and returns its generated idempotency key.
  Future<String> enqueue({
    required String passengerId,
    required String passengerName,
    required String from,
    required String to,
    required String category,
    required double fare,
    required bool fareIsEstimate,
    String? busNumber,
  }) async {
    await load();
    final id = _generateClientRequestId();
    _cache.add(OutboxTicket(
      clientRequestId: id,
      passengerId: passengerId,
      passengerName: passengerName,
      from: from,
      to: to,
      category: category,
      fare: fare,
      fareIsEstimate: fareIsEstimate,
      busNumber: busNumber,
      queuedAt: DateTime.now().toUtc().toIso8601String(),
    ));
    while (_cache.length > _kMaxTickets) {
      _cache.removeAt(0);
    }
    await _persist();
    return id;
  }

  /// Re-enqueues a ticket that failed to sync (same idempotency key — safe to retry).
  Future<void> requeue(OutboxTicket ticket) async {
    await load();
    _cache.add(ticket);
    await _persist();
  }

  /// Returns queued tickets oldest-first and clears the outbox. Caller re-enqueues (via
  /// [requeue]) any that fail to sync.
  Future<List<OutboxTicket>> drainAll() async {
    await load();
    final out = List<OutboxTicket>.from(_cache);
    _cache = [];
    await _persist();
    return out;
  }
}
