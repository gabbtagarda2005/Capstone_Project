import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../config/admin_socket_origin.dart';

/// Socket.io live fleet channel on Admin_Backend — mirrors POST /api/buses/live-location.
class LiveFleetSocket {
  LiveFleetSocket({String? origin}) : _origin = origin ?? adminSocketOrigin();

  final String _origin;
  io.Socket? _socket;
  bool _authenticated = false;

  bool get isConnected => _socket?.connected == true;
  bool get isAuthenticated => _authenticated;

  Future<void> connect() async {
    disconnect();
    _authenticated = false;
    final uri = _origin.replaceAll(RegExp(r'/+$'), '');
    _socket = io.io(
      uri,
      io.OptionBuilder()
          .setTransports(['websocket', 'polling'])
          .disableAutoConnect()
          .setPath('/socket.io/')
          .setReconnectionAttempts(12)
          .setReconnectionDelay(2000)
          .build(),
    );
    _socket!.onDisconnect((_) {
      _authenticated = false;
    });
    _socket!.connect();
    await Future<void>.delayed(const Duration(milliseconds: 500));
  }

  Future<bool> authenticate(String ticketingToken) async {
    final s = _socket;
    if (s == null || !s.connected) return false;
    final tok = ticketingToken.trim();
    if (tok.isEmpty) return false;
    final completer = Completer<bool>();
    var done = false;
    s.emitWithAck('live_fleet_authenticate', {'token': tok}, ack: (dynamic data) {
      if (done) return;
      done = true;
      if (data is Map) {
        completer.complete(data['ok'] == true);
      } else {
        completer.complete(false);
      }
    });
    final ok = await completer.future.timeout(
      const Duration(seconds: 8),
      onTimeout: () => false,
    );
    _authenticated = ok;
    return ok;
  }

  /// Returns true if the packet was emitted (socket up + authenticated).
  /// [forceSync]: post-login / go-live precision handshake — admin map snaps + cyan pulse.
  bool emitLocation({
    required double latitude,
    required double longitude,
    double? speedKph,
    double? heading,
    bool forceSync = false,
    String? signal,
  }) {
    final s = _socket;
    if (s == null || !s.connected || !_authenticated) return false;
    s.emitWithAck('attendant_live_location', {
      'lat': latitude,
      'lng': longitude,
      if (speedKph != null && speedKph.isFinite) 'speed': speedKph,
      if (heading != null && heading.isFinite) 'heading': heading,
      if (forceSync) 'forceSync': true,
      if (signal != null && signal.isNotEmpty) 'signal': signal,
      if (signal != null && signal.isNotEmpty) 'signal_status': signal,
    }, ack: (_) {});
    return true;
  }

  void logout() {
    _authenticated = false;
    _socket?.emit('attendant_logout');
  }

  void disconnect() {
    _authenticated = false;
    _socket?.disconnect();
    _socket?.dispose();
    _socket = null;
  }
}
