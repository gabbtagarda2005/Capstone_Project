import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:permission_handler/permission_handler.dart';

import '../services/api_client.dart';
import '../services/app_broadcast_controller.dart';
import '../services/weather_advisory_controller.dart';
import '../services/gps_outbox_store.dart';
import '../services/live_fleet_socket.dart';
import '../services/network_signal_tier.dart';
import '../services/session_store.dart';
import '../config/app_branding.dart';
import '../theme/app_colors.dart';
import '../widgets/beacon_lock_handshake.dart';
import '../widgets/gps_visibility_lost_overlay.dart';
import '../widgets/location_access_intro_dialog.dart';
import '../widgets/sos_alert_dialog.dart';
import '../widgets/tactical_notification_panel.dart';
import '../models/ticket_edit_session.dart';
import 'dashboard_page.dart';
import 'login_screen.dart';
import 'passenger_page.dart';
import 'profile_page.dart';
import 'ticketing_page.dart';

/// Web-only: real browser geolocation often fails or is blocked → no pings → admin map empty.
/// Pass both defines to simulate a bus in Bukidnon for stack testing, e.g.
/// `--dart-define=MOCK_GPS_LAT=8.1477 --dart-define=MOCK_GPS_LNG=125.1324`
final double _kMockGpsLat = double.tryParse(
      const String.fromEnvironment('MOCK_GPS_LAT', defaultValue: '')) ??
    0;
final double _kMockGpsLng = double.tryParse(
      const String.fromEnvironment('MOCK_GPS_LNG', defaultValue: '')) ??
    0;

bool _webMockGpsEnabled() =>
    kIsWeb && _kMockGpsLat.abs() > 1e-8 && _kMockGpsLng.abs() > 1e-8;

/// When browser geolocation fails/denied, still post a pin so Admin `/api/buses/live` is not empty (matches default map center).
const double _kWebFallbackLat = 8.1477;
const double _kWebFallbackLng = 125.1324;

class MainShell extends StatefulWidget {
  const MainShell({
    super.key,
    required this.displayName,
    required this.isDarkMode,
    required this.onToggleDarkMode,
  });

  final String displayName;
  final bool isDarkMode;
  final VoidCallback onToggleDarkMode;

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;
  final _session = SessionStore();
  final _api = ApiClient();
  String? _token;
  String _ticketing = '';
  bool _booting = true;

  ApiBusAssignment? _assignment;
  bool _assignmentReady = false;
  bool _beaconLive = false;
  bool _beaconBusy = false;
  bool _gpsBlocked = false;
  bool _gpsLost = false;
  Timer? _pingTimer;
  Timer? _gpsWatchTimer;
  String? _mapSyncError;
  LiveFleetSocket? _liveFleet;
  final GpsOutboxStore _gpsOutbox = GpsOutboxStore();
  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;
  StreamSubscription<Position>? _webGpsSub;
  Position? _lastWebFix;
  /// Web: fixed demo pin if Geolocation API fails or permission denied (still sends telemetry).
  bool _webFallbackGps = false;

  TicketEditSession? _ticketEditBootstrap;
  int _passengerTicketsEpoch = 0;
  AppBroadcastState? _broadcastState;
  Timer? _broadcastPollTimer;

  /// Gates `_onGoLive` until the tactical tracking intro has run (or permission was already granted).
  bool _locationIntroComplete = false;

  LocationSettings _pingLocationSettings({required bool precision}) {
    if (kIsWeb) {
      return WebSettings(
        accuracy: LocationAccuracy.best,
        distanceFilter: 0,
        maximumAge: Duration.zero,
        timeLimit: Duration(seconds: precision ? 60 : 50),
      );
    }
    return LocationSettings(
      accuracy: LocationAccuracy.best,
      distanceFilter: 0,
      timeLimit: Duration(seconds: precision ? 45 : 35),
    );
  }

  void _stopWebGpsStream() {
    _webGpsSub?.cancel();
    _webGpsSub = null;
  }

  void _startWebGpsStream() {
    if (!kIsWeb || _webMockGpsEnabled() || _webFallbackGps) return;
    _stopWebGpsStream();
    _webGpsSub = Geolocator.getPositionStream(
      locationSettings: WebSettings(
        accuracy: LocationAccuracy.best,
        distanceFilter: 0,
        maximumAge: Duration.zero,
        timeLimit: const Duration(minutes: 2),
      ),
    ).listen(
      (Position p) {
        if (!mounted) return;
        setState(() => _lastWebFix = p);
      },
      onError: (_) {},
    );
  }

  Future<void> _activateWebFallbackBeacon({required String snackMessage}) async {
    if (!kIsWeb || !mounted) return;
    _stopWebGpsStream();
    setState(() {
      _webFallbackGps = true;
      _beaconLive = true;
      _gpsBlocked = false;
      _gpsLost = false;
    });
    _startPingLoop();
    _startGpsWatch();
    _startConnectivityWatch();
    await _pushOnePing(precisionHandshake: true);
    if (!mounted) return;
    SchedulerBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(snackMessage, style: const TextStyle(fontSize: 13)),
          duration: const Duration(seconds: 12),
          backgroundColor: MintObsidian.mint.withValues(alpha: 0.92),
        ),
      );
    });
  }

  @override
  void initState() {
    super.initState();
    _bindBroadcastFeed();
    _loadToken();
  }

  @override
  void dispose() {
    _pingTimer?.cancel();
    _gpsWatchTimer?.cancel();
    _connectivitySub?.cancel();
    _connectivitySub = null;
    _stopWebGpsStream();
    _liveFleet?.disconnect();
    _liveFleet = null;
    _broadcastPollTimer?.cancel();
    AppBroadcastController.instance.removeListener(_onBroadcastChanged);
    WeatherAdvisoryController.instance.removeListener(_onWeatherAdvisoriesChanged);
    super.dispose();
  }

  void _onBroadcastChanged() {
    if (!mounted) return;
    setState(() {
      _broadcastState = AppBroadcastController.instance.state;
    });
  }

  void _onWeatherAdvisoriesChanged() {
    if (!mounted) return;
    setState(() {});
  }

  void _bindBroadcastFeed() {
    final c = AppBroadcastController.instance;
    final w = WeatherAdvisoryController.instance;
    c.removeListener(_onBroadcastChanged);
    c.addListener(_onBroadcastChanged);
    w.removeListener(_onWeatherAdvisoriesChanged);
    w.addListener(_onWeatherAdvisoriesChanged);
    _onBroadcastChanged();
    unawaited(c.poll());
    unawaited(w.poll());
    _broadcastPollTimer?.cancel();
    _broadcastPollTimer = Timer.periodic(const Duration(seconds: 25), (_) {
      unawaited(c.poll());
      unawaited(w.poll());
    });
  }

  List<TacticalNotificationItem> _notificationItems() {
    final items = <TacticalNotificationItem>[];
    final s = _broadcastState;
    if (s != null && s.visible) {
      TacticalNotifCategory cat;
      if (s.severity == 'critical') {
        cat = TacticalNotifCategory.emergency;
      } else if (s.severity == 'medium') {
        cat = TacticalNotifCategory.schedule;
      } else {
        cat = TacticalNotifCategory.routeSync;
      }
      items.add(
        TacticalNotificationItem(
          id: 'broadcast-${DateTime.now().millisecondsSinceEpoch}',
          title: 'Admin broadcast',
          body: s.message,
          at: DateTime.now(),
          category: cat,
        ),
      );
    }
    final wx = WeatherAdvisoryController.instance;
    final wxAt = wx.updatedAt ?? DateTime.now();
    for (final row in wx.rows) {
      items.add(
        TacticalNotificationItem(
          id: 'wx-${row.locationName}',
          title: 'Rain — ${row.locationName}',
          body: '${row.summary} reported at this hub. Reduce speed and watch passengers at stops.',
          at: wxAt,
          category: TacticalNotifCategory.schedule,
        ),
      );
    }
    return items;
  }

  void _startConnectivityWatch() {
    _connectivitySub?.cancel();
    _connectivitySub = null;
    if (kIsWeb) return;
    _connectivitySub = Connectivity().onConnectivityChanged.listen((List<ConnectivityResult> r) {
      if (r.contains(ConnectivityResult.none)) return;
      unawaited(_flushGpsOutbox());
    });
  }

  Future<void> _flushGpsOutbox() async {
    final t = _token ?? '';
    if (t.isEmpty || _ticketing.isEmpty || !_beaconLive) return;
    if (!kIsWeb) {
      final links = await Connectivity().checkConnectivity();
      if (links.contains(ConnectivityResult.none)) return;
    }
    final pending = await _gpsOutbox.drainAll();
    if (pending.isEmpty) return;
    try {
      await _api.postLiveLocationBatch(
        attendantToken: t,
        ticketingToken: _ticketing,
        points: pending,
      );
    } catch (_) {
      for (final p in pending) {
        await _gpsOutbox.enqueue(p);
      }
    }
  }

  /// Admin Command Center Socket.io — same ingest as POST /api/buses/live-location.
  Future<void> _ensureLiveFleetSocket() async {
    if (_ticketing.isEmpty) return;
    try {
      _liveFleet ??= LiveFleetSocket();
      if (!_liveFleet!.isConnected) {
        await _liveFleet!.connect();
      }
      if (_liveFleet!.isConnected && !_liveFleet!.isAuthenticated) {
        await _liveFleet!.authenticate(_ticketing);
      }
    } catch (_) {
      /* REST fallback still runs */
    }
  }

  Future<void> _loadToken() async {
    final t = await _session.getToken();
    final tick = (await _session.getTicketingToken()) ?? '';
    if (!mounted) return;
    setState(() {
      _token = t;
      _ticketing = tick;
      _booting = false;
    });
    if (t != null && t.isNotEmpty) {
      if (tick.isEmpty && mounted) {
        SchedulerBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: const Text(
                'Missing ticketing session — the admin map will not update. Sign out, sign in again, and ensure Bus Attendant Backend (4011) can reach Admin Backend (4001) with the same JWT_SECRET as Admin.',
              ),
              duration: const Duration(seconds: 10),
              backgroundColor: TacticalColors.alertRed,
            ),
          );
        });
      }
      unawaited(_resolveAssignment(t, tick));
      SchedulerBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        unawaited(_runLocationAccessPreface());
      });
    }
  }

  void _markLocationIntroComplete() {
    if (!mounted) return;
    if (!_locationIntroComplete) {
      setState(() => _locationIntroComplete = true);
    }
    unawaited(_tryStartLiveAfterLocationIntro());
  }

  /// Shown once after login: glass intro, then Geolocator permission (browser prompt only after “Sync”).
  Future<void> _runLocationAccessPreface() async {
    if (!mounted || _token == null || _token!.isEmpty) return;
    if (_webMockGpsEnabled()) {
      _markLocationIntroComplete();
      return;
    }
    try {
      final perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.whileInUse || perm == LocationPermission.always) {
        if (!kIsWeb) {
          try {
            await Permission.locationWhenInUse.request();
            await Permission.locationAlways.request();
          } catch (_) {}
        }
        _markLocationIntroComplete();
        return;
      }
    } catch (_) {}

    if (!mounted) return;
    final result = await showLocationAccessIntroDialog(context);
    if (!mounted) return;
    if (result == LocationAccessIntroResult.denied) {
      await showLocationDeniedOperationsDialog(context);
    }
    if (!mounted) return;
    if (result == LocationAccessIntroResult.serviceDisabled) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Location services are off. Turn them on on the Home screen, then tap Sync My Location.',
          ),
        ),
      );
    }
    _markLocationIntroComplete();
  }

  Future<void> _tryStartLiveAfterLocationIntro() async {
    if (!mounted || !_locationIntroComplete) return;
    if (!_assignmentReady || _assignment == null) return;
    final a = _assignment!;
    if (!a.assigned || a.bus == null || _beaconLive) return;
    await _onGoLive();
    if (!mounted) return;
    if (a.assigned && a.bus != null && !_beaconLive) {
      _startGpsWatch();
    }
  }

  Future<void> _resolveAssignment(String attendantToken, String ticketingToken) async {
    try {
      final a = await _api.fetchBusAssignment(
        attendantToken: attendantToken,
        ticketingToken: ticketingToken,
      );
      if (mounted) {
        setState(() {
          _assignment = a;
          _assignmentReady = true;
        });
      }
      if (mounted) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          unawaited(_tryStartLiveAfterLocationIntro());
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _assignment = const ApiBusAssignment(assigned: false, bus: null);
          _assignmentReady = true;
        });
      }
      if (mounted) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          unawaited(_tryStartLiveAfterLocationIntro());
        });
      }
    }
  }

  bool get _showBeaconLock {
    if (!_assignmentReady || _assignment == null) return false;
    final a = _assignment!;
    return a.assigned && a.bus != null && !_beaconLive;
  }

  bool get _assignedBus {
    final a = _assignment;
    return a != null && a.assigned && a.bus != null;
  }

  bool get _liveSessionUnlocked {
    return _assignedBus && _beaconLive && !_gpsLost;
  }

  Future<bool> _gpsHealthy() async {
    if (_webMockGpsEnabled()) return true;
    if (kIsWeb && _webFallbackGps) return true;
    if (!await Geolocator.isLocationServiceEnabled()) return false;
    final p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied || p == LocationPermission.deniedForever) return false;
    return true;
  }

  void _startGpsWatch() {
    _gpsWatchTimer?.cancel();
    _gpsWatchTimer = Timer.periodic(const Duration(seconds: 4), (_) async {
      if (!mounted) return;
      if (!_beaconLive && _assignedBus && !_beaconBusy) {
        final ready = await _gpsHealthy();
        if (ready && mounted) {
          await _onGoLive();
        }
        return;
      }
      if (!_beaconLive || !mounted) return;
      final ok = await _gpsHealthy();
      if (!ok && mounted) {
        _pingTimer?.cancel();
        setState(() => _gpsLost = true);
      }
    });
  }

  Future<void> _onRetryGpsVisibility() async {
    final ok = await _gpsHealthy();
    if (!mounted) return;
    if (ok) {
      setState(() => _gpsLost = false);
      _startPingLoop();
      _startGpsWatch();
      if (kIsWeb && !_webMockGpsEnabled()) {
        _startWebGpsStream();
      }
      await _pushOnePing();
    } else {
      setState(() {});
    }
  }

  Future<void> _onGoLive() async {
    setState(() {
      _beaconBusy = true;
      _gpsBlocked = false;
    });
    try {
      if (_webMockGpsEnabled()) {
        if (mounted) {
          setState(() {
            _beaconLive = true;
            _gpsBlocked = false;
            _gpsLost = false;
          });
        }
        _startPingLoop();
        _startGpsWatch();
        _startConnectivityWatch();
        await _pushOnePing(precisionHandshake: true);
        if (mounted) {
          SchedulerBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  'Web demo GPS ($_kMockGpsLat, $_kMockGpsLng) — admin map should update. Use a real device for production.',
                  style: const TextStyle(fontSize: 13),
                ),
                duration: const Duration(seconds: 6),
                backgroundColor: MintObsidian.mint.withValues(alpha: 0.92),
              ),
            );
          });
        }
        return;
      }

      final enabled = await Geolocator.isLocationServiceEnabled();
      if (!enabled) {
        if (mounted) setState(() => _gpsBlocked = true);
        return;
      }

      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) {
        perm = await Geolocator.requestPermission();
      }
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        if (kIsWeb) {
          await _activateWebFallbackBeacon(
            snackMessage:
                'Location permission blocked — using demo coordinates (${_kWebFallbackLat.toStringAsFixed(4)}, ${_kWebFallbackLng.toStringAsFixed(4)}) so Command still sees your bus. Allow location in the browser for accurate tracking.',
          );
          return;
        }
        if (mounted) setState(() => _gpsBlocked = true);
        return;
      }

      if (!kIsWeb) {
        final whenInUse = await Permission.locationWhenInUse.request();
        if (!whenInUse.isGranted) {
          if (mounted) setState(() => _gpsBlocked = true);
          return;
        }
        await Permission.locationAlways.request();
      }

      try {
        await Geolocator.getCurrentPosition(
          locationSettings: _pingLocationSettings(precision: true),
        );
      } catch (_) {
        if (mounted) {
          setState(() => _gpsBlocked = true);
          if (kIsWeb) {
            SchedulerBinding.instance.addPostFrameCallback((_) {
              if (!mounted) return;
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: const Text(
                    'Browser GPS failed — the admin map will stay empty on web. Run on Android/iPhone, or add '
                    '--dart-define=MOCK_GPS_LAT=8.1477 --dart-define=MOCK_GPS_LNG=125.1324 for a local demo.',
                  ),
                  duration: const Duration(seconds: 12),
                  backgroundColor: TacticalColors.alertRed,
                ),
              );
            });
          }
        }
        return;
      }

      if (mounted) {
        setState(() {
          _beaconLive = true;
          _gpsBlocked = false;
          _gpsLost = false;
          _webFallbackGps = false;
        });
      }
      _startPingLoop();
      _startGpsWatch();
      _startConnectivityWatch();
      if (kIsWeb && !_webMockGpsEnabled()) {
        _startWebGpsStream();
      }
      await _pushOnePing(precisionHandshake: true);
    } finally {
      if (mounted) setState(() => _beaconBusy = false);
    }
  }

  void _startPingLoop() {
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(const Duration(seconds: 5), (_) => _pushOnePing());
  }

  Future<void> _pushOnePing({bool precisionHandshake = false}) async {
    final t = _token ?? '';
    if (t.isEmpty || !_beaconLive || _gpsLost) return;
    if (_ticketing.isEmpty) {
      if (mounted) {
        setState(() {
          _mapSyncError =
              'Missing operator token after login — admin cannot accept GPS. Sign out and sign in again (Bus Attendant + Admin backends must share JWT_SECRET).';
        });
      }
      return;
    }
    try {
      // Connect socket before waiting on Geolocation so the first fix reaches Command with minimal delay.
      await _ensureLiveFleetSocket();
      late final double lat;
      late final double lng;
      double? speedKph;
      double? heading;
      if (_webMockGpsEnabled()) {
        lat = _kMockGpsLat;
        lng = _kMockGpsLng;
        speedKph = null;
        heading = null;
      } else if (kIsWeb && _webFallbackGps) {
        lat = _kWebFallbackLat;
        lng = _kWebFallbackLng;
        speedKph = null;
        heading = null;
      } else if (kIsWeb && _lastWebFix != null) {
        final p = _lastWebFix!;
        lat = p.latitude;
        lng = p.longitude;
        speedKph = p.speed.isFinite ? p.speed * 3.6 : null;
        heading = p.heading.isFinite ? p.heading : null;
      } else {
        final pos = await Geolocator.getCurrentPosition(
          locationSettings: _pingLocationSettings(precision: precisionHandshake),
        );
        lat = pos.latitude;
        lng = pos.longitude;
        speedKph = pos.speed.isFinite ? pos.speed * 3.6 : null;
        heading = pos.heading.isFinite ? pos.heading : null;
      }

      final tier = await classifyNetworkSignalTier();
      final clientIso = DateTime.now().toUtc().toIso8601String();
      Map<String, dynamic> outboxPoint() => {
            'latitude': lat,
            'longitude': lng,
            if (speedKph != null) 'speedKph': speedKph,
            if (heading != null) 'heading': heading,
            'signal': tier,
            'clientRecordedAt': clientIso,
            if (precisionHandshake) 'forceSync': true,
          };

      if (tier == 'offline') {
        await _gpsOutbox.enqueue(outboxPoint());
        if (mounted) {
          setState(() {
            _mapSyncError = 'No data connection — GPS queued (${_gpsOutbox.length} pending)';
          });
        }
        return;
      }

      final viaSocket = _liveFleet?.emitLocation(
            latitude: lat,
            longitude: lng,
            speedKph: speedKph,
            heading: heading,
            forceSync: precisionHandshake,
            signal: tier,
          ) ??
          false;
      if (!viaSocket) {
        try {
          await _api.postLiveLocation(
            attendantToken: t,
            ticketingToken: _ticketing,
            latitude: lat,
            longitude: lng,
            speedKph: speedKph,
            heading: heading,
            forceSync: precisionHandshake,
            signal: tier,
            clientRecordedAt: clientIso,
          );
        } catch (_) {
          await _gpsOutbox.enqueue(outboxPoint());
          rethrow;
        }
      }
      unawaited(_flushGpsOutbox());
      if (mounted) {
        setState(() {
          _mapSyncError = null;
        });
      }
    } catch (e) {
      if (!mounted) return;
      final msg = _api.mapRequestFailure('Live map sync', e);
      setState(() {
        _mapSyncError =
            msg.length > 220 ? '${msg.substring(0, 217)}…' : msg;
      });
    }
  }

  Future<void> _signOut() async {
    final t = _token ?? '';
    final tick = _ticketing;
    _pingTimer?.cancel();
    _gpsWatchTimer?.cancel();
    _pingTimer = null;
    _gpsWatchTimer = null;
    _connectivitySub?.cancel();
    _connectivitySub = null;
    _stopWebGpsStream();
    _webFallbackGps = false;
    if (t.isNotEmpty) {
      try {
        await _api.postEndLiveSession(attendantToken: t, ticketingToken: tick);
      } catch (_) {}
    }
    try {
      _liveFleet?.logout();
    } catch (_) {}
    _liveFleet?.disconnect();
    _liveFleet = null;
    await _session.clear();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute<void>(
        builder: (_) => LoginScreen(
          isDarkMode: widget.isDarkMode,
          onToggleDarkMode: widget.onToggleDarkMode,
        ),
      ),
      (_) => false,
    );
  }

  Future<void> _confirmAndSos(BuildContext context) async {
    await HapticFeedback.lightImpact();
    if (!context.mounted) return;
    final result = await showSosAlertDialog(context);
    if (result == null || !context.mounted) return;
    await _sendSos(
      context,
      level: result.level.apiValue,
      note: result.note,
    );
  }

  Future<void> _sendSos(
    BuildContext context, {
    required String level,
    String note = '',
  }) async {
    final t = _token ?? '';
    if (t.isEmpty) return;
    try {
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: kIsWeb
            ? WebSettings(
                accuracy: LocationAccuracy.best,
                distanceFilter: 0,
                maximumAge: Duration.zero,
                timeLimit: const Duration(seconds: 45),
              )
            : const LocationSettings(
                accuracy: LocationAccuracy.best,
                distanceFilter: 0,
                timeLimit: Duration(seconds: 40),
              ),
      );
      final r = await _api.postAttendantSos(
        attendantToken: t,
        ticketingToken: _ticketing,
        latitude: pos.latitude,
        longitude: pos.longitude,
        level: level,
        note: note.isEmpty ? null : note,
      );
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            r.ok ? 'SOS delivered — $kAppCompanyName / Command notified' : (r.message ?? 'SOS failed'),
          ),
          backgroundColor: r.ok ? null : TacticalColors.alertRed,
        ),
      );
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('SOS failed: $e'), backgroundColor: TacticalColors.alertRed),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_booting) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    final token = _token ?? '';
    if (token.isEmpty) {
      return LoginScreen(
        isDarkMode: widget.isDarkMode,
        onToggleDarkMode: widget.onToggleDarkMode,
      );
    }

    final bus = _assignment?.bus;

    final homePage = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_liveSessionUnlocked &&
            _mapSyncError != null &&
            _mapSyncError!.trim().isNotEmpty)
          Material(
            color: TacticalColors.alertRed.withValues(alpha: 0.18),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              child: Text(
                _mapSyncError!.trim(),
                style: GoogleFonts.plusJakartaSans(
                  color: Colors.white.withValues(alpha: 0.92),
                  fontSize: 12,
                  height: 1.35,
                ),
              ),
            ),
          ),
        Expanded(
          child: DashboardPage(
            displayName: widget.displayName,
            authToken: token,
            ticketingToken: _ticketing,
            onSos: () => _confirmAndSos(context),
          ),
        ),
      ],
    );

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        foregroundColor: Theme.of(context).colorScheme.onSurface,
        title: Text(
          kAppCompanyName,
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 18),
        ),
        actions: [
          TacticalNotificationAction(
            hasActiveAlert: (_broadcastState?.visible == true) || WeatherAdvisoryController.instance.hasAlerts,
            onPressed: () => TacticalNotificationPanel.open(
              context,
              items: _notificationItems(),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              children: [
                IndexedStack(
                  index: _index,
                  children: [
                    homePage,
                    TicketingPage(
                      authToken: token,
                      ticketingToken: _ticketing,
                      busNumber: bus?.busNumber ?? '',
                      editBootstrap: _ticketEditBootstrap,
                      onEditBootstrapConsumed: () {
                        if (mounted) setState(() => _ticketEditBootstrap = null);
                      },
                      onFocusPassengerTickets: () {
                        if (mounted) {
                          setState(() {
                            _index = 2;
                            _passengerTicketsEpoch++;
                          });
                        }
                      },
                      onTicketIssued: () {
                        if (mounted) setState(() => _passengerTicketsEpoch++);
                      },
                      onTicketCorrected: () {
                        if (mounted) setState(() => _passengerTicketsEpoch++);
                      },
                    ),
                    PassengerPage(
                      key: ValueKey<int>(_passengerTicketsEpoch),
                      authToken: token,
                      ticketingToken: _ticketing,
                      assignedBusNumber: bus?.busNumber ?? '',
                      onEditAuthorized: (session) {
                        if (!mounted) return;
                        setState(() {
                          _ticketEditBootstrap = session;
                          _index = 1;
                        });
                      },
                    ),
                    ProfilePage(
                      authToken: token,
                      ticketingToken: _ticketing,
                      onSignOut: _signOut,
                      isDarkMode: widget.isDarkMode,
                      onToggleDarkMode: widget.onToggleDarkMode,
                    ),
                  ],
                ),
                if (_showBeaconLock && bus != null)
                  Positioned.fill(
                    child: BeaconLockHandshake(
                      gpsBlocked: _gpsBlocked,
                      busy: _beaconBusy,
                      onSyncLocation: _onGoLive,
                    ),
                  ),
                if (_gpsLost && _assignedBus)
                  Positioned.fill(
                    child: GpsVisibilityLostOverlay(
                      onRetry: _onRetryGpsVisibility,
                    ),
                  ),
              ],
            ),
          ),
          Theme(
            data: Theme.of(context).copyWith(
              navigationBarTheme: NavigationBarThemeData(
                indicatorColor: const Color(0xFF5EE396).withOpacity(0.28),
                labelTextStyle: WidgetStateProperty.resolveWith((states) {
                  final isDark = Theme.of(context).brightness == Brightness.dark;
                  final selected = states.contains(WidgetState.selected);
                  return TextStyle(
                    fontSize: 11,
                    fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                    letterSpacing: 0.2,
                    color: selected ? const Color(0xFF5EE396) : (isDark ? MintObsidian.textSecondary : const Color(0xFF64748B)),
                  );
                }),
              ),
            ),
            child: NavigationBar(
              backgroundColor: Theme.of(context).brightness == Brightness.dark ? MintObsidian.surface : Colors.white,
              surfaceTintColor: Colors.transparent,
              shadowColor: Colors.black54,
              elevation: 12,
              height: 72,
              labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
              selectedIndex: _index,
              onDestinationSelected: (i) {
                final prev = _index;
                setState(() {
                  _index = i;
                  if (i == 2 && prev != 2) {
                    _passengerTicketsEpoch++;
                  }
                });
              },
              destinations: [
                NavigationDestination(
                  icon: Icon(Icons.home_outlined, color: Theme.of(context).brightness == Brightness.dark ? MintObsidian.textSecondary : const Color(0xFF64748B)),
                  selectedIcon: const Icon(Icons.home_rounded, color: Color(0xFF5EE396)),
                  label: 'Home',
                ),
                NavigationDestination(
                  icon: Icon(Icons.confirmation_number_outlined, color: Theme.of(context).brightness == Brightness.dark ? MintObsidian.textSecondary : const Color(0xFF64748B)),
                  selectedIcon: const Icon(Icons.confirmation_number_rounded, color: Color(0xFF5EE396)),
                  label: 'Tickets',
                ),
                NavigationDestination(
                  icon: Icon(Icons.groups_outlined, color: Theme.of(context).brightness == Brightness.dark ? MintObsidian.textSecondary : const Color(0xFF64748B)),
                  selectedIcon: const Icon(Icons.groups_rounded, color: Color(0xFF5EE396)),
                  label: 'Passengers',
                ),
                NavigationDestination(
                  icon: Icon(Icons.person_outline_rounded, color: Theme.of(context).brightness == Brightness.dark ? MintObsidian.textSecondary : const Color(0xFF64748B)),
                  selectedIcon: const Icon(Icons.person_rounded, color: Color(0xFF5EE396)),
                  label: 'Profile',
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
